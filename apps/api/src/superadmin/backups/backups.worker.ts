import { spawn } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { SCHEMA_NAME_REGEX, schemaNameForSlug } from '@jdoc/shared';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.module';
import { loadEnv } from '../../config/env';
import { BACKUPS_QUEUE, type BackupsQueueData, type ManualBackupJobData } from './backups.service';

/**
 * Worker BullMQ de backup/restore.
 * - Roda FORA do request context. Schema name vem do job e e re-validado
 *   contra SCHEMA_NAME_REGEX antes de qualquer query (regra de ouro).
 * - Executa `pg_dump --schema=<schema>` em subprocesso, bufferizado em
 *   memoria (nunca em foreground / nunca bloqueando o event loop) e envia
 *   pro StorageService (Supabase em producao, disco local so em dev) — os
 *   dumps de UM schema sao pequenos (dados relacionais, nao os PDFs).
 * - Restore roda dentro de UMA TRANSACAO: DROP+CREATE SCHEMA + SQL do dump.
 *   Se qualquer parte falhar, o Postgres desfaz tudo (DDL e transacional) —
 *   o schema original permanece intacto mesmo com falha no meio do caminho.
 */
@Injectable()
export class BackupsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupsWorker.name);
  private worker: Worker<BackupsQueueData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<BackupsQueueData>(
      BACKUPS_QUEUE,
      (job) => this.process(job),
      { connection: this.redis, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} (${job?.name}) falhou: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async process(job: Job<BackupsQueueData>): Promise<void> {
    if (job.data.kind === 'scheduled-backup') {
      await this.processScheduled(job.data.tenantId, job.data.slug, job.data.schemaName);
      return;
    }
    if (job.data.kind === 'manual-backup') {
      await this.processOne(job.data);
      return;
    }
    if (job.data.kind === 'restore') {
      await this.processRestore(job.data);
      return;
    }
  }

  /** Disparo agendado: cria a row de backup e processa, igual a um manual. */
  private async processScheduled(tenantId: string, slug: string, schemaName: string): Promise<void> {
    const sql = this.db.catalog();
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO public.backups (tenant_id, status) VALUES (${tenantId}, 'pendente') RETURNING id
    `;
    const backupId = rows[0]?.id;
    if (!backupId) throw new Error('Falha ao inserir backup agendado');
    await this.processOne({
      kind: 'manual-backup',
      backupId,
      tenantId,
      slug,
      schemaName,
      actorId: '',
    });
  }

  private async processOne(data: ManualBackupJobData): Promise<void> {
    const { schemaName, backupId, tenantId, slug, actorId } = data;
    this.assertSafeSlugAndSchema(slug, schemaName);

    const sql = this.db.catalog();
    await sql`UPDATE public.backups SET status = 'processando', iniciado_em = now() WHERE id = ${backupId}`;

    try {
      const buffer = await this.dumpSchemaToGzipBuffer(schemaName);
      const fileKey = `backup-${randomUUID()}.dump.gz`;
      await this.storage.upload(slug, fileKey, buffer);

      await sql`UPDATE public.backups SET
        status = 'concluido', file_key = ${fileKey}, size_bytes = ${buffer.length}, concluido_em = now()
      WHERE id = ${backupId}`;

      await sql`
        INSERT INTO public.global_audit_logs (actor_id, actor_type, action, target_tenant_id, metadata)
        VALUES (${actorId || null}, 'superadmin', 'backup_created', ${tenantId},
                ${sql.json({ backupId, sizeBytes: buffer.length } as unknown as Parameters<typeof sql.json>[0])})
      `;
      this.logger.log(`Backup ${backupId} do tenant ${slug} concluido (${buffer.length} bytes)`);

      await this.enforceRetention(tenantId, slug);
    } catch (err) {
      await sql`UPDATE public.backups SET
        status = 'erro', erro_mensagem = ${(err as Error).message}, concluido_em = now()
      WHERE id = ${backupId}`;
      throw err;
    }
  }

  /** Apaga (registro + arquivo) backups mais antigos que a retencao configurada do tenant. */
  private async enforceRetention(tenantId: string, slug: string): Promise<void> {
    const sql = this.db.catalog();
    const settings = await sql<Array<{ retencao: number }>>`
      SELECT retencao FROM public.tenant_backup_settings WHERE tenant_id = ${tenantId}
    `;
    const retencao = settings[0]?.retencao ?? 7;

    const excedentes = await sql<Array<{ id: string; file_key: string | null }>>`
      SELECT id, file_key FROM public.backups
      WHERE tenant_id = ${tenantId} AND is_safety_backup = false AND status = 'concluido'
      ORDER BY criado_em DESC
      OFFSET ${retencao}
    `;
    for (const b of excedentes) {
      if (b.file_key) await this.storage.delete(slug, b.file_key).catch(() => undefined);
      await sql`DELETE FROM public.backups WHERE id = ${b.id}`;
    }
    if (excedentes.length > 0) {
      this.logger.log(`Retencao: removidos ${excedentes.length} backup(s) antigos do tenant ${slug}`);
    }
  }

  private async processRestore(data: {
    restoreJobId: string;
    tenantId: string;
    slug: string;
    schemaName: string;
    fileBase64: string;
    actorId: string;
  }): Promise<void> {
    const { restoreJobId, tenantId, slug, schemaName, fileBase64, actorId } = data;
    this.assertSafeSlugAndSchema(slug, schemaName);

    const catalogSql = this.db.catalog();
    await catalogSql`UPDATE public.restore_jobs SET status = 'processando' WHERE id = ${restoreJobId}`;

    try {
      // 1) Backup de seguranca do estado ATUAL antes de tocar em qualquer coisa.
      const safetyBuffer = await this.dumpSchemaToGzipBuffer(schemaName);
      const safetyKey = `backup-${randomUUID()}.dump.gz`;
      await this.storage.upload(slug, safetyKey, safetyBuffer);
      const safetyRows = await catalogSql<Array<{ id: string }>>`
        INSERT INTO public.backups (tenant_id, status, file_key, size_bytes, is_safety_backup, concluido_em)
        VALUES (${tenantId}, 'concluido', ${safetyKey}, ${safetyBuffer.length}, true, now())
        RETURNING id
      `;
      const safetyBackupId = safetyRows[0]?.id ?? null;
      await catalogSql`UPDATE public.restore_jobs SET safety_backup_id = ${safetyBackupId} WHERE id = ${restoreJobId}`;

      // 2) Decodifica + descomprime o arquivo enviado.
      const compressed = Buffer.from(fileBase64, 'base64');
      let dumpSql: string;
      try {
        dumpSql = gunzipSync(compressed).toString('utf8');
      } catch {
        throw new Error('Arquivo enviado nao e um backup .dump.gz valido (falha ao descomprimir)');
      }
      if (!dumpSql.includes('PostgreSQL database dump')) {
        throw new Error('Arquivo nao parece ser um backup gerado por este sistema');
      }

      // 3) DROP + CREATE + restore, tudo em UMA transacao — falha no meio
      //    do caminho desfaz e o schema original fica intacto.
      const tenantSql = this.db.tenant(schemaName);
      await tenantSql.begin(async (tx) => {
        await tx.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
        await tx.unsafe(dumpSql);
      });

      await catalogSql`UPDATE public.restore_jobs SET status = 'concluido', concluido_em = now() WHERE id = ${restoreJobId}`;
      await catalogSql`
        INSERT INTO public.global_audit_logs (actor_id, actor_type, action, target_tenant_id, metadata)
        VALUES (${actorId || null}, 'superadmin', 'tenant_restored', ${tenantId},
                ${catalogSql.json({ restoreJobId, safetyBackupId } as unknown as Parameters<typeof catalogSql.json>[0])})
      `;
      this.logger.log(`Restore ${restoreJobId} do tenant ${slug} concluido`);
    } catch (err) {
      await catalogSql`UPDATE public.restore_jobs SET status = 'erro', erro_mensagem = ${(err as Error).message} WHERE id = ${restoreJobId}`;
      throw err;
    }
  }

  private assertSafeSlugAndSchema(slug: string, schemaName: string): void {
    if (!/^[a-z0-9_]{2,30}$/.test(slug)) throw new Error(`Slug invalido: ${slug}`);
    if (!SCHEMA_NAME_REGEX.test(schemaName)) throw new Error(`Schema invalido: ${schemaName}`);
    if (schemaName !== schemaNameForSlug(slug)) throw new Error('Schema nao corresponde ao slug');
  }

  /** `pg_dump --schema=<schema>` -> gzip, tudo em memoria (sem tocar disco). */
  private dumpSchemaToGzipBuffer(schemaName: string): Promise<Buffer> {
    const env = loadEnv();
    const dbUrl = env.DIRECT_URL ?? env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL nao definido');

    return new Promise<Buffer>((resolveP, rejectP) => {
      const pgDump = spawn(
        'pg_dump',
        ['--no-owner', '--no-acl', '--schema=' + schemaName, '--format=plain', dbUrl],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const chunks: Buffer[] = [];
      pgDump.stdout.on('data', (c: Buffer) => chunks.push(c));

      let stderr = '';
      pgDump.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      pgDump.on('error', (err) => rejectP(new Error(`pg_dump nao executado: ${err.message}`)));
      pgDump.on('close', (code) => {
        if (code !== 0) {
          rejectP(new Error(`pg_dump saiu com codigo ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        const raw = Buffer.concat(chunks);
        resolveP(gzipSync(raw));
      });
    });
  }
}
