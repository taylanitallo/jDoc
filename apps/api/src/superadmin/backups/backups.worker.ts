import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { resolve } from 'node:path';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { SCHEMA_NAME_REGEX, schemaNameForSlug } from '@jdoc/shared';
import { DatabaseService } from '../../database/database.service';
import { loadEnv } from '../../config/env';
import { BACKUPS_QUEUE, type BackupJobData } from './backups.service';

/**
 * Worker BullMQ de backup.
 * - Roda FORA do request context. Schema name vem do job e e re-validado
 *   contra SCHEMA_NAME_REGEX antes de qualquer query (regra de ouro).
 * - Executa `pg_dump --schema=<schema>` em subprocesso (NUNCA em foreground
 *   para nao bloquear o event loop).
 * - Comprime o dump com gzip -> escreve em .storage/backups/<key>.
 * - Em caso de erro: marca status = erro e propaga para o BullMQ.
 */
@Injectable()
export class BackupsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupsWorker.name);
  private worker: Worker<BackupJobData> | null = null;
  private redis: Redis | null = null;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<BackupJobData>(
      BACKUPS_QUEUE,
      (job) => this.process(job),
      { connection: this.redis, concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Backup job ${job?.id} falhou: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async process(job: Job<BackupJobData | { kind: 'all-tenants' }>): Promise<void> {
    // Job repetido: dispara backup para todos os tenants ativos.
    if ('kind' in job.data && (job.data as { kind: string }).kind === 'all-tenants') {
      await this.processAllTenants();
      return;
    }
    const data = job.data as BackupJobData;
    await this.processOne(data);
  }

  private async processAllTenants(): Promise<void> {
    const sql = this.db.catalog();
    const tenants = await sql<Array<{ id: string; slug: string }>>`
      SELECT id, slug FROM public.tenants WHERE status = 'ativo' ORDER BY criado_em
    `;
    for (const t of tenants) {
      try {
        const data = await this.createBackupRowAndEnqueue(t.id, t.slug, null);
        await this.processOne(data);
      } catch (err) {
        this.logger.error(`Backup agendado do tenant ${t.slug} falhou: ${(err as Error).message}`);
      }
    }
  }

  /** Cria row em public.backups e enfileira — usado tanto pelo trigger do controller quanto pelo agendamento. */
  async createBackupRowAndEnqueue(
    tenantId: string,
    slug: string,
    actorId: string | null,
  ): Promise<BackupJobData> {
    if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
      throw new Error(`Slug invalido: ${slug}`);
    }
    const schemaName = schemaNameForSlug(slug);
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
    return { backupId: id, tenantId, slug, schemaName, actorId: actorId ?? '' };
  }

  private async processOne(data: BackupJobData): Promise<void> {
    const { schemaName, backupId, tenantId, slug, actorId } = data;

    // Regra de ouro: validar schema name antes de qualquer query ou shell exec.
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new Error(`Schema invalido no job: ${schemaName}`);
    }
    if (!/^[a-z0-9_]{2,30}$/.test(slug)) {
      throw new Error(`Slug invalido no job: ${slug}`);
    }

    const env = loadEnv();
    const dbUrl = env.DIRECT_URL ?? env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL nao definido');
    }

    const sql = this.db.catalog();
    await sql`UPDATE public.backups SET status = 'processando', iniciado_em = now() WHERE id = ${backupId}`;

    const fileKey = `backup-${randomUUID()}.dump.gz`;
    const backupDir = resolve(env.STORAGE_DIR, 'backups');
    const outPath = resolve(backupDir, fileKey);
    await mkdir(backupDir, { recursive: true });

    try {
      await this.runPgDumpAndCompress(dbUrl, schemaName, outPath);

      const st = await stat(outPath);
      const sizeBytes = st.size;

      await sql`UPDATE public.backups SET
        status = 'concluido',
        file_key = ${fileKey},
        size_bytes = ${sizeBytes},
        concluido_em = now()
      WHERE id = ${backupId}`;

      await sql`
        INSERT INTO public.global_audit_logs (actor_id, actor_type, action, target_tenant_id, metadata)
        VALUES (${actorId}, 'superadmin', 'backup_created', ${tenantId},
                ${sql.json({ backupId, sizeBytes } as unknown as Parameters<typeof sql.json>[0])})
      `;

      this.logger.log(
        `Backup ${backupId} do tenant ${slug} concluido: ${fileKey} (${sizeBytes} bytes)`,
      );
    } catch (err) {
      await sql`UPDATE public.backups SET
        status = 'erro',
        erro_mensagem = ${(err as Error).message},
        concluido_em = now()
      WHERE id = ${backupId}`;
      // tenta remover arquivo parcial
      await unlink(outPath).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Stream pg_dump -> gzip -> arquivo.
   * NAO usa shell — array de args (anti injecao).
   */
  private runPgDumpAndCompress(dbUrl: string, schemaName: string, outPath: string): Promise<void> {
    return new Promise<void>((resolveP, rejectP) => {
      const pgDump = spawn(
        'pg_dump',
        [
          '--no-owner',
          '--no-acl',
          '--schema=' + schemaName,
          '--format=plain',
          '--file=/dev/stdout',
          dbUrl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const gzip = createGzip();
      const out = createWriteStream(outPath);
      const sink = pgDump.stdout.pipe(gzip).pipe(out);

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
      });

      sink.on('finish', () => resolveP());
      sink.on('error', (err) => rejectP(err));
      gzip.on('error', (err) => rejectP(err));
    });
  }

  /** Le arquivo local de backup — usado pelo endpoint de download. */
  static async readBackup(fileKey: string): Promise<NodeJS.ReadableStream> {
    const env = loadEnv();
    const backupDir = resolve(env.STORAGE_DIR, 'backups');
    return createReadStream(resolve(backupDir, fileKey));
  }
}