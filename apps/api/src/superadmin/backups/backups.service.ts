import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { FUSO_ORGAO, SCHEMA_NAME_REGEX, schemaNameForSlug } from '@jdoc/shared';
import type {
  BackupView,
  BackupsListResponse,
  RestoreJobView,
  TenantBackupSettings,
  TipoBackup,
  UpdateBackupSettingsInput,
} from '@jdoc/shared';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.module';
import { AuditService } from '../../audit/audit.module';
import { SuperadminTenantsService } from '../superadmin-tenants.service';
import { loadEnv } from '../../config/env';

export const BACKUPS_QUEUE = 'jdoc-backups';
/** "Bucket" dos backups completos (slug reservado: nenhum orgao o usa). */
export const SLUG_PLATAFORMA = 'superadmin';

export interface Autor {
  id: string | null;
  nome: string | null;
}

export interface ManualBackupJobData {
  kind: 'manual-backup';
  backupId: string;
  tenantId: string;
  slug: string;
  schemaName: string;
  actorId: string;
  actorNome?: string | null;
}
export interface ScheduledBackupJobData {
  kind: 'scheduled-backup';
  tenantId: string;
  slug: string;
  schemaName: string;
}
export interface FullBackupJobData {
  kind: 'full-backup';
  backupId: string;
  actorId: string;
  actorNome: string | null;
}
export interface RestoreJobData {
  kind: 'restore';
  restoreJobId: string;
  tenantId: string;
  slug: string;
  schemaName: string;
  /** Arquivo .dump.gz no storage (backup existente ou o arquivo enviado). */
  fileSlug: string;
  fileKey: string;
  /** Arquivo enviado: apagar depois de restaurar. */
  descartarArquivo: boolean;
  actorId: string;
  actorNome?: string | null;
  /** Legado: arquivo no proprio job (versao anterior). */
  fileBase64?: string;
}
export type BackupsQueueData = ManualBackupJobData | ScheduledBackupJobData | FullBackupJobData | RestoreJobData;

/** file_key gerado pelo worker: backup-<uuid>.dump.gz (o id no nome evita colisao). */
const BACKUP_FILE_KEY_REGEX = /^backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.dump\.gz$/;

/**
 * Chave estavel do job repetivel no BullMQ, usada tanto como `jobId` quanto
 * como `repeat.key` explicito. Sem passar `repeat.key`, o BullMQ deriva a
 * chave interna de nome+jobId+padrao-cron — mudar o padrao (ex: trocar o
 * horario) geraria uma chave DIFERENTE, deixando o job antigo orfao. Fixando
 * `repeat.key`, reagendar sempre atualiza o mesmo job em vez de duplicar.
 */
function repeatableJobId(tenantId: string): string {
  return `tenant-backup-${tenantId}`;
}

function cronPatternFor(frequencia: string, hora: number): string {
  return frequencia === 'semanal' ? `0 ${hora} * * 0` : `0 ${hora} * * *`;
}

interface BackupRow {
  id: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_nome: string | null;
  status: string;
  file_key: string | null;
  size_bytes: string | number | null;
  erro_mensagem: string | null;
  is_safety_backup: boolean;
  kind: TipoBackup;
  created_by_name: string | null;
  criado_em: Date;
  iniciado_em: Date | null;
  concluido_em: Date | null;
}

const SELECT_BACKUP = `
  b.id, b.tenant_id, t.slug AS tenant_slug, t.nome AS tenant_nome, b.status, b.file_key, b.size_bytes,
  b.erro_mensagem, b.is_safety_backup, b.kind, b.created_by_name, b.criado_em, b.iniciado_em, b.concluido_em
`;

/**
 * Servico de backups (realm superadmin).
 * - Enfileira no BullMQ: backup manual, agendado, completo e restauracao.
 * - Agendamento e retencao por orgao (hora de Fortaleza).
 * - Restauracao a partir de um backup existente ou de arquivo enviado (o
 *   arquivo vai para o storage, nao para o Redis).
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
    const tenants = await sql<Array<{ id: string; slug: string }>>`SELECT id, slug FROM public.tenants WHERE status = 'ativo'`;

    // Remove jobs repetiveis orfaos (cron global legado, chaves antigas e
    // orgaos que nao existem mais); mantem so `tenant-backup-<id>` dos ativos.
    const validKeys = new Set(tenants.map((t) => repeatableJobId(t.id)));
    for (const j of await this.queue.getRepeatableJobs()) {
      if (!validKeys.has(j.key)) await this.queue.removeRepeatableByKey(j.key);
    }
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
    if (!this.queue) throw new Error('Fila de backups nao inicializada');
    return this.queue;
  }

  private async scheduleRepeatable(tenantId: string, slug: string, settings: TenantBackupSettings): Promise<void> {
    const schemaName = schemaNameForSlug(slug);
    await this.requireQueue().add(
      'scheduled-backup',
      { kind: 'scheduled-backup', tenantId, slug, schemaName },
      {
        repeat: { pattern: cronPatternFor(settings.frequencia, settings.hora), tz: FUSO_ORGAO, key: repeatableJobId(tenantId) },
        jobId: repeatableJobId(tenantId),
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  private async unscheduleRepeatable(tenantId: string): Promise<void> {
    const jobs = await this.requireQueue().getRepeatableJobs();
    for (const j of jobs.filter((x) => x.key === repeatableJobId(tenantId))) await this.requireQueue().removeRepeatableByKey(j.key);
  }

  /** Config de agendamento/retencao do orgao. Cria linha padrao se nao existir. */
  async getSettings(tenantId: string): Promise<TenantBackupSettings> {
    const sql = this.db.catalog();
    const rows = await sql<Array<{ enabled: boolean; frequencia: string; hora: number; retencao: number }>>`
      SELECT enabled, frequencia, hora, retencao FROM public.tenant_backup_settings WHERE tenant_id = ${tenantId}
    `;
    let row = rows[0];
    if (!row) {
      [row] = await sql<Array<{ enabled: boolean; frequencia: string; hora: number; retencao: number }>>`
        INSERT INTO public.tenant_backup_settings (tenant_id) VALUES (${tenantId})
        ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
        RETURNING enabled, frequencia, hora, retencao
      `;
    }
    let proximoBackup: string | null = null;
    if (row?.enabled && this.queue) {
      const mine = (await this.queue.getRepeatableJobs()).find((j) => j.key === repeatableJobId(tenantId));
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

  async updateSettings(tenantId: string, input: UpdateBackupSettingsInput, actorId: string, ip: string): Promise<TenantBackupSettings> {
    const tenant = await this.tenants.getById(tenantId);
    const antes = await this.getSettings(tenantId);
    const sql = this.db.catalog();
    await sql`
      INSERT INTO public.tenant_backup_settings (tenant_id, enabled, frequencia, hora, retencao, atualizado_em)
      VALUES (${tenantId}, ${input.enabled}, ${input.frequencia}, ${input.hora}, ${input.retencao}, now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        enabled = ${input.enabled}, frequencia = ${input.frequencia},
        hora = ${input.hora}, retencao = ${input.retencao}, atualizado_em = now()
    `;
    await this.unscheduleRepeatable(tenantId);
    if (input.enabled) await this.scheduleRepeatable(tenantId, tenant.slug, { ...input, proximoBackup: null });
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_settings_updated',
      targetTenantId: tenantId,
      entity: 'backup_agendamento',
      entityId: tenantId,
      ip,
      changes: {
        antes: { ligado: antes.enabled, frequencia: antes.frequencia, hora: antes.hora, retencao: antes.retencao },
        depois: { ligado: input.enabled, frequencia: input.frequencia, hora: input.hora, retencao: input.retencao },
      },
    });
    return this.getSettings(tenantId);
  }

  /** Backup manual (ou disparado pelas correcoes automaticas). */
  async trigger(tenantId: string, autor: Autor, kind: TipoBackup = 'manual'): Promise<{ id: string }> {
    const tenant = await this.tenants.getById(tenantId);
    const schemaName = schemaNameForSlug(tenant.slug);
    if (!SCHEMA_NAME_REGEX.test(schemaName)) throw new Error(`Schema invalido: ${schemaName}`);
    const [r] = await this.db.catalog()<Array<{ id: string }>>`
      INSERT INTO public.backups (tenant_id, status, kind, created_by, created_by_name)
      VALUES (${tenantId}, 'pendente', ${kind}, ${autor.id}, ${autor.nome}) RETURNING id
    `;
    await this.requireQueue().add(
      'manual-backup',
      { kind: 'manual-backup', backupId: r!.id, tenantId, slug: tenant.slug, schemaName, actorId: autor.id ?? '', actorNome: autor.nome },
      { jobId: r!.id },
    );
    return { id: r!.id };
  }

  /** Backup completo: todo o banco (catalogo + todos os orgaos). */
  async triggerCompleto(autor: Autor): Promise<{ id: string }> {
    const [r] = await this.db.catalog()<Array<{ id: string }>>`
      INSERT INTO public.backups (tenant_id, status, kind, created_by, created_by_name)
      VALUES (NULL, 'pendente', 'manual', ${autor.id}, ${autor.nome}) RETURNING id
    `;
    await this.requireQueue().add(
      'full-backup',
      { kind: 'full-backup', backupId: r!.id, actorId: autor.id ?? '', actorNome: autor.nome },
      { jobId: r!.id },
    );
    return { id: r!.id };
  }

  async list(f: { tenantId?: string; kind?: string; status?: string; completo?: boolean } = {}): Promise<BackupsListResponse> {
    const sql = this.db.catalog();
    const filtro = sql`
      WHERE (${f.tenantId ?? null}::uuid IS NULL OR b.tenant_id = ${f.tenantId ?? null})
        AND (${f.kind ?? null}::text IS NULL OR b.kind = ${f.kind ?? null})
        AND (${f.status ?? null}::text IS NULL OR b.status = ${f.status ?? null})
        AND (${f.completo ?? false} = false OR b.tenant_id IS NULL)
    `;
    const items = await sql<BackupRow[]>`
      SELECT ${sql.unsafe(SELECT_BACKUP)} FROM public.backups b LEFT JOIN public.tenants t ON t.id = b.tenant_id
      ${filtro} ORDER BY b.criado_em DESC LIMIT 300
    `;
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM public.backups b ${filtro}`;
    return { items: items.map((r) => this.toView(r)), total: t?.n ?? 0 };
  }

  async detail(id: string): Promise<BackupView> {
    const sql = this.db.catalog();
    const [r] = await sql<BackupRow[]>`
      SELECT ${sql.unsafe(SELECT_BACKUP)} FROM public.backups b LEFT JOIN public.tenants t ON t.id = b.tenant_id WHERE b.id = ${id}
    `;
    if (!r) throw new NotFoundException('Backup não encontrado');
    return this.toView(r);
  }

  private slugDoArquivo(b: BackupView): string {
    return b.tenantSlug ?? SLUG_PLATAFORMA;
  }

  async remove(id: string, actorId: string, ip: string): Promise<void> {
    const b = await this.detail(id);
    if (b.status === 'processando') throw new ConflictException('Backup em andamento; aguarde terminar');
    if (b.fileKey) await this.storage.delete(this.slugDoArquivo(b), b.fileKey).catch(() => undefined);
    await this.db.catalog()`DELETE FROM public.backups WHERE id = ${id}`;
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_deleted',
      targetTenantId: b.tenantId,
      entity: 'backup',
      entityId: id,
      ip,
    });
  }

  /** Limpa o historico de um orgao (registros + arquivos). */
  async clearHistory(tenantId: string, actorId: string, ip: string): Promise<{ count: number }> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.catalog();
    const rows = await sql<Array<{ id: string; file_key: string | null }>>`
      SELECT id, file_key FROM public.backups WHERE tenant_id = ${tenantId} AND status <> 'processando'
    `;
    for (const r of rows) if (r.file_key) await this.storage.delete(tenant.slug, r.file_key).catch(() => undefined);
    await sql`DELETE FROM public.backups WHERE tenant_id = ${tenantId} AND status <> 'processando'`;
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_history_cleared',
      targetTenantId: tenantId,
      ip,
      metadata: { quantidade: rows.length },
    });
    return { count: rows.length };
  }

  /** "Limpar antigos": apaga backups (de todos os orgaos) mais velhos que N dias. */
  async limparAntigos(dias: number, actorId: string, ip: string): Promise<{ count: number }> {
    const sql = this.db.catalog();
    const rows = await sql<BackupRow[]>`
      SELECT ${sql.unsafe(SELECT_BACKUP)} FROM public.backups b LEFT JOIN public.tenants t ON t.id = b.tenant_id
      WHERE b.criado_em < now() - make_interval(days => ${dias}) AND b.status <> 'processando'
    `;
    for (const r of rows) {
      const v = this.toView(r);
      if (v.fileKey) await this.storage.delete(this.slugDoArquivo(v), v.fileKey).catch(() => undefined);
      await sql`DELETE FROM public.backups WHERE id = ${r.id}`;
    }
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_history_cleared',
      ip,
      metadata: { quantidade: rows.length, maisAntigosQueDias: dias },
    });
    return { count: rows.length };
  }

  /** Download: valida status e file_key, gera URL assinada de 60 s e audita. */
  async signedDownloadUrl(id: string, actorId: string, ip: string): Promise<{ url: string; expiresInSeconds: number }> {
    const b = await this.detail(id);
    if (b.status !== 'concluido') throw new ConflictException('O backup ainda não está concluído');
    if (!b.fileKey || !BACKUP_FILE_KEY_REGEX.test(b.fileKey)) throw new ConflictException('Backup sem arquivo válido');
    const dataHora = b.criadoEm.slice(0, 19).replace(/[:T]/g, '-');
    const url = await this.storage.createSignedUrl(this.slugDoArquivo(b), b.fileKey, 60, `backup-${b.tenantSlug ?? 'completo'}-${dataHora}`);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'backup_downloaded',
      targetTenantId: b.tenantId,
      entity: 'backup',
      entityId: id,
      ip,
    });
    return { url, expiresInSeconds: 60 };
  }

  private async enfileirarRestauracao(
    tenantId: string,
    autor: Autor,
    origem: { source: 'backup' | 'upload'; backupId?: string; fileSlug: string; fileKey: string; fileName?: string },
  ): Promise<{ id: string }> {
    const tenant = await this.tenants.getById(tenantId);
    if (tenant.status === 'manutencao') throw new ConflictException('Já há uma restauração em andamento neste órgão');
    const schemaName = schemaNameForSlug(tenant.slug);
    if (!SCHEMA_NAME_REGEX.test(schemaName)) throw new Error(`Schema invalido: ${schemaName}`);
    const [r] = await this.db.catalog()<Array<{ id: string }>>`
      INSERT INTO public.restore_jobs (tenant_id, status, step, source, backup_id, file_name, created_by, created_by_name)
      VALUES (${tenantId}, 'pendente', 'fila', ${origem.source}, ${origem.backupId ?? null}, ${origem.fileName ?? null}, ${autor.id}, ${autor.nome})
      RETURNING id
    `;
    await this.requireQueue().add(
      'restore',
      {
        kind: 'restore',
        restoreJobId: r!.id,
        tenantId,
        slug: tenant.slug,
        schemaName,
        fileSlug: origem.fileSlug,
        fileKey: origem.fileKey,
        descartarArquivo: origem.source === 'upload',
        actorId: autor.id ?? '',
        actorNome: autor.nome,
      },
      { jobId: r!.id },
    );
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId: autor.id,
      action: 'backup_restore_started',
      targetTenantId: tenantId,
      entity: 'restauracao',
      entityId: r!.id,
      metadata: { origem: origem.source === 'backup' ? 'backup existente' : 'arquivo enviado' },
    });
    return { id: r!.id };
  }

  /** Restaura a partir de um backup ja existente do proprio orgao. */
  async restaurarDeBackup(tenantId: string, backupId: string, autor: Autor): Promise<{ id: string }> {
    const b = await this.detail(backupId);
    if (b.tenantId !== tenantId) throw new BadRequestException('Este backup não é deste órgão');
    if (b.status !== 'concluido' || !b.fileKey) throw new ConflictException('O backup não está concluído');
    return this.enfileirarRestauracao(tenantId, autor, { source: 'backup', backupId, fileSlug: b.tenantSlug!, fileKey: b.fileKey });
  }

  /** Restaura a partir de um arquivo .dump.gz enviado (guardado no storage do orgao). */
  async triggerRestore(tenantId: string, fileBuffer: Buffer, autor: Autor, fileName?: string): Promise<{ id: string }> {
    const tenant = await this.tenants.getById(tenantId);
    const fileKey = `backup-${randomUUID()}.dump.gz`;
    await this.storage.upload(tenant.slug, fileKey, fileBuffer);
    return this.enfileirarRestauracao(tenantId, autor, { source: 'upload', fileSlug: tenant.slug, fileKey, fileName });
  }

  async restoreDetail(id: string): Promise<RestoreJobView> {
    const [r] = await this.db.catalog()<
      Array<{
        id: string;
        tenant_id: string;
        status: string;
        step: string | null;
        source: string;
        safety_backup_id: string | null;
        erro_mensagem: string | null;
        criado_em: Date;
        concluido_em: Date | null;
      }>
    >`SELECT id, tenant_id, status, step, source, safety_backup_id, erro_mensagem, criado_em, concluido_em
      FROM public.restore_jobs WHERE id = ${id}`;
    if (!r) throw new NotFoundException('Restauração não encontrada');
    return {
      id: r.id,
      tenantId: r.tenant_id,
      step: r.step as RestoreJobView['step'],
      source: r.source as RestoreJobView['source'],
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
      kind: r.kind ?? (r.is_safety_backup ? 'seguranca' : 'manual'),
      criadoPor: r.created_by_name,
      status: r.status as BackupView['status'],
      fileKey: r.file_key,
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      erroMensagem: r.erro_mensagem,
      isSafetyBackup: r.is_safety_backup,
      criadoEm: r.criado_em.toISOString(),
      iniciadoEm: r.iniciado_em?.toISOString() ?? null,
      concluidoEm: r.concluido_em?.toISOString() ?? null,
    };
  }
}
