import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { SCHEMA_NAME_REGEX, schemaNameForSlug } from '@jdoc/shared';
import type {
  BackupView,
  BackupsListResponse,
  TenantBackupSettings,
  UpdateBackupSettingsInput,
  RestoreJobView,
} from '@jdoc/shared';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.module';
import { AuditService } from '../../audit/audit.module';
import { SuperadminTenantsService } from '../superadmin-tenants.service';
import { loadEnv } from '../../config/env';

export const BACKUPS_QUEUE = 'jdoc-backups';

export interface ManualBackupJobData {
  kind: 'manual-backup';
  backupId: string;
  tenantId: string;
  slug: string;
  schemaName: string;
  actorId: string;
}
export interface ScheduledBackupJobData {
  kind: 'scheduled-backup';
  tenantId: string;
  slug: string;
  schemaName: string;
}
export interface RestoreJobData {
  kind: 'restore';
  restoreJobId: string;
  tenantId: string;
  slug: string;
  schemaName: string;
  fileBase64: string;
  actorId: string;
}
export type BackupsQueueData = ManualBackupJobData | ScheduledBackupJobData | RestoreJobData;

/** file_key gerado pelo worker: backup-<uuid>.dump.gz */
const BACKUP_FILE_KEY_REGEX =
  /^backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.dump\.gz$/;

/**
 * Chave estavel do job repetivel no BullMQ, usada tanto como `jobId` quanto
 * como `repeat.key` explicito. Sem passar `repeat.key`, o BullMQ deriva a
 * chave interna de nome+jobId+padrao-cron — mudar o padrao (ex: trocar o
 * horario) geraria uma chave DIFERENTE, deixando o job antigo orfao (nunca
 * removido, ja que `getRepeatableJobs()` nao devolve nenhum campo `id`
 * comparavel). Fixando `repeat.key` como esta string estavel, reagendar
 * sempre atualiza o mesmo job em vez de duplicar.
 */
function repeatableJobId(tenantId: string): string {
  return `tenant-backup-${tenantId}`;
}

function cronPatternFor(frequencia: string, hora: number): string {
  return frequencia === 'semanal' ? `0 ${hora} * * 0` : `0 ${hora} * * *`;
}

/**
 * Servico de backups (realm superadmin).
 * - Enfileira jobs no BullMQ (manual, agendado, restore).
 * - Lista / detalhe / download / exclui / limpa historico.
 * - Agendamento e retencao configuraveis POR TENANT (nao mais um cron fixo
 *   global) — ao salvar settings, o job repetivel do tenant e recriado.
 * - Download valida file_key contra regex (anti-IDOR + anti path-traversal).
 */
@Injectable()
export class BackupsService implements OnModuleInit, OnModuleDestroy {
  private queue: Queue<BackupsQueueData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly tenants: SuperadminTenantsService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<BackupsQueueData>(BACKUPS_QUEUE, { connection: this.redis });

    const sql = this.db.catalog();
    const tenants = await sql<Array<{ id: string; slug: string }>>`
      SELECT id, slug FROM public.tenants WHERE status = 'ativo'
    `;

    // Remove qualquer job repetivel orfao: o cron global legado de antes do
    // agendamento por tenant, chaves hasheadas de uma versao anterior (que
    // nao usava `repeat.key` estavel) e agendamentos de tenants que nao
    // existem mais. Mantem so as chaves estaveis `tenant-backup-<id>` dos
    // tenants ativos.
    const validKeys = new Set(tenants.map((t) => repeatableJobId(t.id)));
    const existing = await this.queue.getRepeatableJobs();
    for (const j of existing) {
      if (!validKeys.has(j.key)) await this.queue.removeRepeatableByKey(j.key);
    }

    // Garante settings + agendamento pra todo tenant ativo (idempotente:
    // BullMQ dedupe por repeat.key, entao reagendar o mesmo padrao e um no-op).
    for (const t of tenants) {
      const settings = await this.getSettings(t.id);
      if (settings.enabled) await this.scheduleRepeatable(t.id, t.slug, settings);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.redis?.quit();
  }

  private requireQueue(): Queue<BackupsQueueData> {
    if (!this.queue) throw new Error('Backups queue nao inicializada');
    return this.queue;
  }

  private async scheduleRepeatable(
    tenantId: string,
    slug: string,
    settings: TenantBackupSettings,
  ): Promise<void> {
    const schemaName = schemaNameForSlug(slug);
    await this.requireQueue().add(
      'scheduled-backup',
      { kind: 'scheduled-backup', tenantId, slug, schemaName },
      {
        repeat: {
          pattern: cronPatternFor(settings.frequencia, settings.hora),
          tz: 'America/Sao_Paulo',
          key: repeatableJobId(tenantId),
        },
        jobId: repeatableJobId(tenantId),
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  private async unscheduleRepeatable(tenantId: string): Promise<void> {
    const jobs = await this.requireQueue().getRepeatableJobs();
    const mine = jobs.filter((j) => j.key === repeatableJobId(tenantId));
    for (const j of mine) await this.requireQueue().removeRepeatableByKey(j.key);
  }

  /** Config de agendamento/retencao do tenant. Cria linha padrao se nao existir. */
  async getSettings(tenantId: string): Promise<TenantBackupSettings> {
    const sql = this.db.catalog();
    const rows = await sql<
      Array<{ enabled: boolean; frequencia: string; hora: number; retencao: number }>
    >`
      SELECT enabled, frequencia, hora, retencao FROM public.tenant_backup_settings WHERE tenant_id = ${tenantId}
    `;
    let row = rows[0];
    if (!row) {
      const inserted = await sql<Array<{ enabled: boolean; frequencia: string; hora: number; retencao: number }>>`
        INSERT INTO public.tenant_backup_settings (tenant_id) VALUES (${tenantId})
        ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
        RETURNING enabled, frequencia, hora, retencao
      `;
      row = inserted[0];
    }

    let proximoBackup: string | null = null;
    if (row?.enabled && this.queue) {
      const jobs = await this.queue.getRepeatableJobs();
      const mine = jobs.find((j) => j.key === repeatableJobId(tenantId));
      proximoBackup = mine?.next ? new Date(mine.next).toISOString() : null;
    }

    return {
      enabled: row?.enabled ?? true,
      frequencia: (row?.frequencia as TenantBackupSettings['frequencia']) ?? 'diario',
      hora: row?.hora ?? 3,
      retencao: row?.retencao ?? 7,
      proximoBackup,
    };
  }

  async updateSettings(
    tenantId: string,
    input: UpdateBackupSettingsInput,
    actorId: string,
    ip: string,
  ): Promise<TenantBackupSettings> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.catalog();
    await sql`
      INSERT INTO public.tenant_backup_settings (tenant_id, enabled, frequencia, hora, retencao, atualizado_em)
      VALUES (${tenantId}, ${input.enabled}, ${input.frequencia}, ${input.hora}, ${input.retencao}, now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        enabled = ${input.enabled}, frequencia = ${input.frequencia},
        hora = ${input.hora}, retencao = ${input.retencao}, atualizado_em = now()
    `;

    await this.unscheduleRepeatable(tenantId);
    if (input.enabled) {
      await this.scheduleRepeatable(tenantId, tenant.slug, {
        ...input,
        proximoBackup: null,
      });
    }

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_settings_updated',
      targetTenantId: tenantId,
      ip,
      metadata: { ...input },
    });

    return this.getSettings(tenantId);
  }

  /** Dispara novo backup manual. Cria registro com status pendente + enfileira. */
  async trigger(tenantId: string, actorId: string): Promise<{ id: string }> {
    const tenant = await this.tenants.getById(tenantId);
    const schemaName = schemaNameForSlug(tenant.slug);
    if (!SCHEMA_NAME_REGEX.test(schemaName)) throw new Error(`Schema invalido: ${schemaName}`);

    const sql = this.db.catalog();
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO public.backups (tenant_id, status) VALUES (${tenantId}, 'pendente') RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('Falha ao inserir backup');

    await this.requireQueue().add(
      'manual-backup',
      { kind: 'manual-backup', backupId: id, tenantId, slug: tenant.slug, schemaName, actorId },
      { jobId: id },
    );
    return { id };
  }

  async triggerNow(tenantId: string, actorId: string): Promise<{ id: string }> {
    return this.trigger(tenantId, actorId);
  }

  /** Lista backups com join em tenants. Filtra opcionalmente por tenantId. */
  async list(tenantId?: string): Promise<BackupsListResponse> {
    const sql = this.db.catalog();
    const items = await sql<BackupRow[]>`
      SELECT
        b.id, b.tenant_id, t.slug AS tenant_slug, t.nome AS tenant_nome,
        b.status, b.file_key, b.size_bytes, b.erro_mensagem, b.is_safety_backup,
        b.criado_em, b.iniciado_em, b.concluido_em
      FROM public.backups b
      JOIN public.tenants t ON t.id = b.tenant_id
      WHERE (${tenantId ?? null}::uuid IS NULL OR b.tenant_id = ${tenantId ?? null})
      ORDER BY b.criado_em DESC
      LIMIT 200
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM public.backups
      WHERE (${tenantId ?? null}::uuid IS NULL OR tenant_id = ${tenantId ?? null})
    `;
    return { items: items.map((r) => this.toView(r)), total: Number(totalRows[0]?.total ?? 0) };
  }

  async detail(id: string): Promise<BackupView> {
    const sql = this.db.catalog();
    const rows = await sql<BackupRow[]>`
      SELECT
        b.id, b.tenant_id, t.slug AS tenant_slug, t.nome AS tenant_nome,
        b.status, b.file_key, b.size_bytes, b.erro_mensagem, b.is_safety_backup,
        b.criado_em, b.iniciado_em, b.concluido_em
      FROM public.backups b
      JOIN public.tenants t ON t.id = b.tenant_id
      WHERE b.id = ${id}
      LIMIT 1
    `;
    const r = rows[0];
    if (!r) throw new NotFoundException('Backup nao encontrado');
    return this.toView(r);
  }

  /** Exclui um backup: apaga o arquivo (se houver) e o registro. */
  async remove(id: string, actorId: string, ip: string): Promise<void> {
    const b = await this.detail(id);
    if (b.fileKey) await this.storage.delete(b.tenantSlug, b.fileKey).catch(() => undefined);
    const sql = this.db.catalog();
    await sql`DELETE FROM public.backups WHERE id = ${id}`;
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_deleted',
      targetTenantId: b.tenantId,
      ip,
      metadata: { backupId: id },
    });
  }

  /** Limpa TODO o historico de backups de um tenant (registros + arquivos). */
  async clearHistory(tenantId: string, actorId: string, ip: string): Promise<{ count: number }> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.catalog();
    const rows = await sql<Array<{ id: string; file_key: string | null }>>`
      SELECT id, file_key FROM public.backups WHERE tenant_id = ${tenantId}
    `;
    for (const r of rows) {
      if (r.file_key) await this.storage.delete(tenant.slug, r.file_key).catch(() => undefined);
    }
    await sql`DELETE FROM public.backups WHERE tenant_id = ${tenantId}`;
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_history_cleared',
      targetTenantId: tenantId,
      ip,
      metadata: { count: rows.length },
    });
    return { count: rows.length };
  }

  /** Download: valida file_key, valida status, gera URL assinada (Supabase ou local). */
  async signedDownloadUrl(id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const b = await this.detail(id);
    if (b.status !== 'concluido') {
      throw new ConflictException(`Backup nao esta concluido (status: ${b.status})`);
    }
    if (!b.fileKey) throw new ConflictException('Backup sem arquivo');
    if (!BACKUP_FILE_KEY_REGEX.test(b.fileKey)) {
      throw new ConflictException('Chave de arquivo invalida');
    }
    const dataHora = b.criadoEm.slice(0, 19).replace(/[:T]/g, '-');
    const friendlyName = `backup-${b.tenantSlug}-${dataHora}`;
    const url = await this.storage.createSignedUrl(b.tenantSlug, b.fileKey, 60, friendlyName);
    return { url, expiresInSeconds: 60 };
  }

  /** Dispara restauracao a partir de um arquivo .dump.gz enviado. */
  async triggerRestore(
    tenantId: string,
    fileBuffer: Buffer,
    actorId: string,
  ): Promise<{ id: string }> {
    const tenant = await this.tenants.getById(tenantId);
    const schemaName = schemaNameForSlug(tenant.slug);
    if (!SCHEMA_NAME_REGEX.test(schemaName)) throw new Error(`Schema invalido: ${schemaName}`);

    const sql = this.db.catalog();
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO public.restore_jobs (tenant_id, status) VALUES (${tenantId}, 'pendente') RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('Falha ao inserir restore job');

    await this.requireQueue().add(
      'restore',
      {
        kind: 'restore',
        restoreJobId: id,
        tenantId,
        slug: tenant.slug,
        schemaName,
        fileBase64: fileBuffer.toString('base64'),
        actorId,
      },
      { jobId: id },
    );
    return { id };
  }

  async restoreDetail(id: string): Promise<RestoreJobView> {
    const sql = this.db.catalog();
    const rows = await sql<
      Array<{
        id: string;
        tenant_id: string;
        status: string;
        safety_backup_id: string | null;
        erro_mensagem: string | null;
        criado_em: Date;
        concluido_em: Date | null;
      }>
    >`SELECT id, tenant_id, status, safety_backup_id, erro_mensagem, criado_em, concluido_em
      FROM public.restore_jobs WHERE id = ${id} LIMIT 1`;
    const r = rows[0];
    if (!r) throw new NotFoundException('Restauracao nao encontrada');
    return {
      id: r.id,
      tenantId: r.tenant_id,
      status: r.status as RestoreJobView['status'],
      safetyBackupId: r.safety_backup_id,
      erroMensagem: r.erro_mensagem,
      criadoEm: r.criado_em.toISOString(),
      concluidoEm: r.concluido_em?.toISOString() ?? null,
    };
  }

  private toView(r: BackupRow): BackupView {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      tenantSlug: r.tenant_slug,
      tenantNome: r.tenant_nome,
      status: r.status as BackupView['status'],
      fileKey: r.file_key,
      sizeBytes: r.size_bytes,
      erroMensagem: r.erro_mensagem,
      isSafetyBackup: r.is_safety_backup,
      criadoEm: r.criado_em.toISOString(),
      iniciadoEm: r.iniciado_em?.toISOString() ?? null,
      concluidoEm: r.concluido_em?.toISOString() ?? null,
    };
  }
}

interface BackupRow {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_nome: string;
  status: string;
  file_key: string | null;
  size_bytes: number | null;
  erro_mensagem: string | null;
  is_safety_backup: boolean;
  criado_em: Date;
  iniciado_em: Date | null;
  concluido_em: Date | null;
}
