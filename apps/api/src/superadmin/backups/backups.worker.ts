import { spawn } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SCHEMA_NAME_REGEX, schemaNameForSlug, type EtapaRestauracao, type TipoBackup } from '@jdoc/shared';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.module';
import { TenancyService } from '../../tenancy/tenancy.service';
import { JobsService } from '../../operacao/jobs.service';
import { loadEnv } from '../../config/env';
import { executarDump } from './executar-dump';
import { BACKUPS_QUEUE, SLUG_PLATAFORMA, type BackupsQueueData, type FullBackupJobData, type RestoreJobData } from './backups.service';

const fmtTamanho = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/**
 * Worker BullMQ de backup/restauracao.
 * - Roda FORA do request context. Schema name vem do job e e re-validado
 *   contra SCHEMA_NAME_REGEX antes de qualquer query (regra de ouro).
 * - `pg_dump` em subprocesso, comprimido em memoria e enviado ao storage.
 * - Cada execucao fica em platform.job_runs (tela de Jobs).
 * - Restauracao em etapas: backup de seguranca -> orgao em manutencao ->
 *   restaura numa UNICA transacao (DROP + CREATE + dump: se falhar no meio,
 *   o Postgres desfaz e o original permanece) -> orgao volta ao status de antes.
 */
@Injectable()
export class BackupsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupsWorker.name);
  private worker: Worker<BackupsQueueData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly tenancy: TenancyService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<BackupsQueueData>(BACKUPS_QUEUE, (job) => this.process(job), { connection: this.redis, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} (${job?.name}) falhou: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async process(job: Job<BackupsQueueData>): Promise<void> {
    const d = job.data;
    const tentativa = job.attemptsMade + 1;
    if (d.kind === 'restore') {
      const run = await this.jobs.iniciarRegistro('restauracao', { tenantId: d.tenantId, origem: 'manual', disparadoPor: d.actorNome }, tentativa);
      try {
        await this.processRestore(d);
        await this.jobs.concluirRegistro(run, null, { resumo: 'Restauração concluída' });
      } catch (e) {
        await this.jobs.concluirRegistro(run, (e as Error).message);
        throw e;
      }
      return;
    }
    if (d.kind === 'full-backup') {
      const run = await this.jobs.iniciarRegistro('backup_completo', { origem: 'manual', disparadoPor: d.actorNome }, tentativa);
      try {
        const tam = await this.processCompleto(d);
        await this.jobs.concluirRegistro(run, null, { resumo: `Backup completo de ${fmtTamanho(tam)}` });
      } catch (e) {
        await this.jobs.concluirRegistro(run, (e as Error).message);
        throw e;
      }
      return;
    }
    const agendado = d.kind === 'scheduled-backup';
    const run = await this.jobs.iniciarRegistro(
      'backup',
      { tenantId: d.tenantId, origem: agendado ? 'agendado' : 'manual', disparadoPor: agendado ? null : (d.actorNome ?? null) },
      tentativa,
    );
    try {
      let backupId: string;
      if (agendado) {
        const [r] = await this.db.catalog()<Array<{ id: string }>>`
          INSERT INTO public.backups (tenant_id, status, kind) VALUES (${d.tenantId}, 'pendente', 'agendado') RETURNING id
        `;
        backupId = r!.id;
        await this.db.catalog()`UPDATE public.tenant_backup_settings SET last_run_at = now() WHERE tenant_id = ${d.tenantId}`;
      } else {
        backupId = d.backupId;
      }
      const tam = await this.processOne(backupId, d.tenantId, d.slug, d.schemaName, d.kind === 'manual-backup' ? d.actorId : '');
      await this.jobs.concluirRegistro(run, null, { resumo: `Backup de ${fmtTamanho(tam)}` });
    } catch (e) {
      await this.jobs.concluirRegistro(run, (e as Error).message);
      throw e;
    }
  }

  private async processOne(backupId: string, tenantId: string, slug: string, schemaName: string, actorId: string): Promise<number> {
    this.assertSafeSlugAndSchema(slug, schemaName);
    const sql = this.db.catalog();
    await sql`UPDATE public.backups SET status = 'processando', iniciado_em = now() WHERE id = ${backupId}`;
    try {
      const buffer = await this.dumpGzip(schemaName);
      const fileKey = `backup-${backupId}.dump.gz`;
      await this.storage.upload(slug, fileKey, buffer);
      await sql`UPDATE public.backups SET status = 'concluido', file_key = ${fileKey}, size_bytes = ${buffer.length}, concluido_em = now() WHERE id = ${backupId}`;
      await sql`
        INSERT INTO public.global_audit_logs (actor_id, actor_type, action, target_tenant_id, entity, entity_id, metadata)
        VALUES (${actorId || null}, ${actorId ? 'superadmin' : 'system'}, 'backup_created', ${tenantId}, 'backup', ${backupId},
                ${sql.json({ tamanhoBytes: buffer.length })})
      `;
      await this.enforceRetention(tenantId, slug);
      return buffer.length;
    } catch (err) {
      await sql`UPDATE public.backups SET status = 'erro', erro_mensagem = ${(err as Error).message}, concluido_em = now() WHERE id = ${backupId}`;
      throw err;
    }
  }

  private async processCompleto(d: FullBackupJobData): Promise<number> {
    const sql = this.db.catalog();
    await sql`UPDATE public.backups SET status = 'processando', iniciado_em = now() WHERE id = ${d.backupId}`;
    try {
      const buffer = await this.dumpGzip(null);
      const fileKey = `backup-${d.backupId}.dump.gz`;
      await this.storage.upload(SLUG_PLATAFORMA, fileKey, buffer);
      await sql`UPDATE public.backups SET status = 'concluido', file_key = ${fileKey}, size_bytes = ${buffer.length}, concluido_em = now() WHERE id = ${d.backupId}`;
      return buffer.length;
    } catch (err) {
      await sql`UPDATE public.backups SET status = 'erro', erro_mensagem = ${(err as Error).message}, concluido_em = now() WHERE id = ${d.backupId}`;
      throw err;
    }
  }

  /** Apaga backups (manuais e agendados) alem da retencao do orgao; os de seguranca ficam. */
  private async enforceRetention(tenantId: string, slug: string): Promise<void> {
    const sql = this.db.catalog();
    const [s] = await sql<Array<{ retencao: number }>>`SELECT retencao FROM public.tenant_backup_settings WHERE tenant_id = ${tenantId}`;
    const excedentes = await sql<Array<{ id: string; file_key: string | null }>>`
      SELECT id, file_key FROM public.backups
      WHERE tenant_id = ${tenantId} AND kind <> 'seguranca' AND status = 'concluido'
      ORDER BY criado_em DESC OFFSET ${s?.retencao ?? 7}
    `;
    for (const b of excedentes) {
      if (b.file_key) await this.storage.delete(slug, b.file_key).catch(() => undefined);
      await sql`DELETE FROM public.backups WHERE id = ${b.id}`;
    }
  }

  private async etapa(id: string, step: EtapaRestauracao): Promise<void> {
    await this.db.catalog()`UPDATE public.restore_jobs SET step = ${step} WHERE id = ${id}`;
  }

  private async processRestore(d: RestoreJobData): Promise<void> {
    const { restoreJobId, tenantId, slug, schemaName } = d;
    this.assertSafeSlugAndSchema(slug, schemaName);
    const cat = this.db.catalog();
    await cat`UPDATE public.restore_jobs SET status = 'processando' WHERE id = ${restoreJobId}`;
    const [t] = await cat<Array<{ status: string }>>`SELECT status FROM public.tenants WHERE id = ${tenantId}`;
    const statusAnterior = t?.status && t.status !== 'manutencao' ? t.status : 'ativo';
    let emManutencao = false;

    try {
      // 1) Backup de seguranca do estado ATUAL antes de tocar em qualquer coisa.
      await this.etapa(restoreJobId, 'backup_seguranca');
      const [seg] = await cat<Array<{ id: string }>>`
        INSERT INTO public.backups (tenant_id, status, kind, is_safety_backup, created_by, created_by_name, iniciado_em)
        VALUES (${tenantId}, 'processando', ${'seguranca' satisfies TipoBackup}, true, ${d.actorId || null}, ${d.actorNome ?? null}, now())
        RETURNING id
      `;
      const seguro = await this.dumpGzip(schemaName);
      const segKey = `backup-${seg!.id}.dump.gz`;
      await this.storage.upload(slug, segKey, seguro);
      await cat`UPDATE public.backups SET status = 'concluido', file_key = ${segKey}, size_bytes = ${seguro.length}, concluido_em = now() WHERE id = ${seg!.id}`;
      await cat`UPDATE public.restore_jobs SET safety_backup_id = ${seg!.id} WHERE id = ${restoreJobId}`;

      // 2) Orgao indisponivel durante a troca (usuarios recebem "em manutencao").
      await this.etapa(restoreJobId, 'manutencao');
      await cat`UPDATE public.restore_jobs SET status_anterior = ${statusAnterior} WHERE id = ${restoreJobId}`;
      await cat`UPDATE public.tenants SET status = 'manutencao', atualizado_em = now() WHERE id = ${tenantId}`;
      await this.tenancy.invalidate(slug);
      emManutencao = true;

      // 3) Arquivo: do storage (backup existente ou enviado) ou, legado, do proprio job.
      await this.etapa(restoreJobId, 'preparando');
      const compactado = d.fileBase64 ? Buffer.from(d.fileBase64, 'base64') : await this.storage.download(d.fileSlug, d.fileKey);
      let dumpSql: string;
      try {
        dumpSql = gunzipSync(compactado).toString('utf8');
      } catch {
        throw new Error('O arquivo não é um backup .dump.gz válido (falha ao descomprimir)');
      }
      if (!dumpSql.includes('PostgreSQL database dump')) throw new Error('O arquivo não parece ser um backup gerado por este sistema');
      if (!dumpSql.includes(`"${schemaName}"`) && !dumpSql.includes(`${schemaName}.`)) {
        throw new Error('O backup é de outro órgão');
      }

      // 4) DROP + CREATE + dump numa unica transacao.
      await this.etapa(restoreJobId, 'restaurando');
      await this.db.tenant(schemaName).begin(async (tx) => {
        await tx.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        // O pg_dump --schema ja traz o CREATE SCHEMA; dumps antigos sem ele ganham um aqui.
        if (!new RegExp(`^CREATE SCHEMA "?${schemaName}"?;`, 'm').test(dumpSql)) await tx.unsafe(`CREATE SCHEMA "${schemaName}"`);
        await executarDump(tx, dumpSql);
      });
      await this.db.closeTenant(schemaName);

      await this.etapa(restoreJobId, 'reativando');
      await cat`UPDATE public.restore_jobs SET status = 'concluido', step = 'concluido', concluido_em = now() WHERE id = ${restoreJobId}`;
      await cat`
        INSERT INTO public.global_audit_logs (actor_id, actor_type, action, target_tenant_id, entity, entity_id, admin_name, metadata)
        VALUES (${d.actorId || null}, 'superadmin', 'tenant_restored', ${tenantId}, 'restauracao', ${restoreJobId}, ${d.actorNome ?? null},
                ${cat.json({ backupSeguranca: seg!.id })})
      `;
    } catch (err) {
      await cat`UPDATE public.restore_jobs SET status = 'erro', erro_mensagem = ${(err as Error).message}, concluido_em = now() WHERE id = ${restoreJobId}`;
      throw err;
    } finally {
      if (emManutencao) {
        await cat`UPDATE public.tenants SET status = ${statusAnterior}, atualizado_em = now() WHERE id = ${tenantId}`;
        await this.tenancy.invalidate(slug);
      }
      if (d.descartarArquivo && d.fileKey) await this.storage.delete(d.fileSlug, d.fileKey).catch(() => undefined);
    }
  }

  private assertSafeSlugAndSchema(slug: string, schemaName: string): void {
    if (!/^[a-z0-9_]{2,30}$/.test(slug)) throw new Error(`Slug invalido: ${slug}`);
    if (!SCHEMA_NAME_REGEX.test(schemaName)) throw new Error(`Schema invalido: ${schemaName}`);
    if (schemaName !== schemaNameForSlug(slug)) throw new Error('Schema nao corresponde ao slug');
  }

  /** `pg_dump` (de um schema, ou do banco todo com null) -> gzip em memoria. */
  private dumpGzip(schemaName: string | null): Promise<Buffer> {
    const env = loadEnv();
    const dbUrl = env.DIRECT_URL ?? env.DATABASE_URL;
    const args = ['--no-owner', '--no-acl', '--format=plain', ...(schemaName ? [`--schema=${schemaName}`] : []), dbUrl];
    return new Promise<Buffer>((ok, falha) => {
      const p = spawn('pg_dump', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const partes: Buffer[] = [];
      let stderr = '';
      p.stdout.on('data', (c: Buffer) => partes.push(c));
      p.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      p.on('error', (err) => falha(new Error(`pg_dump não executado: ${err.message}`)));
      p.on('close', (code) => {
        if (code !== 0) return falha(new Error(`pg_dump saiu com código ${code}: ${stderr.slice(0, 500)}`));
        ok(gzipSync(Buffer.concat(partes)));
      });
    });
  }
}
