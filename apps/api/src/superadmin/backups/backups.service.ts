import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createHmac } from 'node:crypto';
import { SCHEMA_NAME_REGEX, schemaNameForSlug } from '@jdoc/shared';
import { DatabaseService } from '../../database/database.service';
import { loadEnv } from '../../config/env';
import { SuperadminTenantsService } from '../superadmin-tenants.service';
import { type BackupView, type BackupsListResponse } from '@jdoc/shared';

export const BACKUPS_QUEUE = 'jdoc-backups';
const SIGNED_URL_TTL_S = 60;

/** file_key gerado pelo worker: backup-<uuid>.dump.gz */
const BACKUP_FILE_KEY_REGEX =
  /^backup-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.dump\.gz$/;

export interface BackupJobData {
  backupId: string;
  tenantId: string;
  slug: string;
  schemaName: string;
  actorId: string;
}

/** Job do agendamento diario: dispara backup para todos os tenants ativos. */
export interface DailyBackupJobData {
  kind: 'all-tenants';
}

export type BackupsQueueData = BackupJobData | DailyBackupJobData;

/**
 * Servico de backups (realm superadmin).
 * - Enfileira job no BullMQ.
 * - Lista / detalhe / download.
 * - Download valida file_key contra regex (anti-IDOR + anti path-traversal).
 * - 409 se status != concluido.
 */
@Injectable()
export class BackupsService implements OnModuleInit, OnModuleDestroy {
  private queue: Queue<BackupsQueueData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: SuperadminTenantsService,
  ) {}

  onModuleInit(): void {
    const env = loadEnv();
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<BackupsQueueData>(BACKUPS_QUEUE, { connection: this.redis });
    // Job repeatable: backup diario de TODOS os tenants ativos, 03:00 America/Sao_Paulo.
    // BullMQ repeatable jobs deduplicam por key; se ja existir um com mesma key, nao duplica.
    const q = this.queue;
    void q.add(
      'scheduled-daily-backup',
      { kind: 'all-tenants' },
      {
        repeat: { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' },
        jobId: 'daily-backup-all-tenants',
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.redis?.quit();
  }

  /** Dispara novo backup. Cria registro com status pendente + enfileira. */
  async trigger(tenantId: string, actorId: string): Promise<{ id: string }> {
    const tenant = await this.tenants.getById(tenantId);
    // tenant.schema_name JA vem do banco com formato `tenant_<slug>`; ainda assim
    // rederivamos do slug para garantir a forma canonica e validamos contra regex.
    const schemaName = schemaNameForSlug(tenant.slug);
    // Revalidacao defensiva — mesma regra aplicada no provision.ts.
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new Error(`Schema invalido: ${schemaName}`);
    }

    const sql = this.db.catalog();
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO public.backups (tenant_id, status)
      VALUES (${tenantId}, 'pendente')
      RETURNING id
    `;
    const id = rows[0]?.id;
    if (!id) throw new Error('Falha ao inserir backup');

    // jobId deterministico = backupId -> dedupe + facilita busca no worker.
    if (!this.queue) throw new Error('Backups queue nao inicializada');
    await this.queue.add(
      'run-backup',
      {
        backupId: id,
        tenantId,
        slug: tenant.slug,
        schemaName,
        actorId,
      },
      { jobId: id },
    );

    return { id };
  }

  /** Lista backups com join em tenants. Filtra opcionalmente por tenantId. */
  async list(tenantId?: string): Promise<BackupsListResponse> {
    const sql = this.db.catalog();

    const items = await sql<
      Array<{
        id: string;
        tenant_id: string;
        tenant_slug: string;
        tenant_nome: string;
        status: string;
        file_key: string | null;
        size_bytes: number | null;
        erro_mensagem: string | null;
        criado_em: Date;
        iniciado_em: Date | null;
        concluido_em: Date | null;
      }>
    >`
      SELECT
        b.id, b.tenant_id, t.slug AS tenant_slug, t.nome AS tenant_nome,
        b.status, b.file_key, b.size_bytes, b.erro_mensagem,
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

    return {
      items: items.map((r) => this.toView(r)),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async detail(id: string): Promise<BackupView> {
    const sql = this.db.catalog();
    const rows = await sql<
      Array<{
        id: string;
        tenant_id: string;
        tenant_slug: string;
        tenant_nome: string;
        status: string;
        file_key: string | null;
        size_bytes: number | null;
        erro_mensagem: string | null;
        criado_em: Date;
        iniciado_em: Date | null;
        concluido_em: Date | null;
      }>
    >`
      SELECT
        b.id, b.tenant_id, t.slug AS tenant_slug, t.nome AS tenant_nome,
        b.status, b.file_key, b.size_bytes, b.erro_mensagem,
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

  /** Download: valida file_key, valida status, gera URL assinada HMAC 60s. */
  async signedDownloadUrl(id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const sql = this.db.catalog();
    const rows = await sql<
      Array<{ status: string; file_key: string | null }>
    >`SELECT status, file_key FROM public.backups WHERE id = ${id} LIMIT 1`;
    const r = rows[0];
    if (!r) throw new NotFoundException('Backup nao encontrado');
    if (r.status !== 'concluido') {
      throw new ConflictException(`Backup nao esta concluido (status: ${r.status})`);
    }
    if (!r.file_key) {
      throw new ConflictException('Backup sem arquivo');
    }
    if (!BACKUP_FILE_KEY_REGEX.test(r.file_key)) {
      // Defesa em profundidade: file_key deve ser gerado pelo worker.
      throw new ConflictException('Chave de arquivo invalida');
    }
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_S;
    const env = loadEnv();
    const sig = createHmac('sha256', env.COOKIE_SECRET)
      .update(`backups|${r.file_key}|${exp}`)
      .digest('hex');
    const baseUrl = env.API_PUBLIC_URL.replace(/\/$/, '');
    const url = `${baseUrl}/files/backups/${r.file_key}?exp=${exp}&sig=${sig}`;
    return { url, expiresInSeconds: SIGNED_URL_TTL_S };
  }

  private toView(r: {
    id: string;
    tenant_id: string;
    tenant_slug: string;
    tenant_nome: string;
    status: string;
    file_key: string | null;
    size_bytes: number | null;
    erro_mensagem: string | null;
    criado_em: Date;
    iniciado_em: Date | null;
    concluido_em: Date | null;
  }): BackupView {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      tenantSlug: r.tenant_slug,
      tenantNome: r.tenant_nome,
      status: r.status as BackupView['status'],
      fileKey: r.file_key,
      sizeBytes: r.size_bytes,
      erroMensagem: r.erro_mensagem,
      criadoEm: r.criado_em.toISOString(),
      iniciadoEm: r.iniciado_em?.toISOString() ?? null,
      concluidoEm: r.concluido_em?.toISOString() ?? null,
    };
  }
}