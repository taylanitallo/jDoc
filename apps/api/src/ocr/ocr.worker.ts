import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SCHEMA_NAME_REGEX, normalizarParaBusca } from '@jdoc/shared';
import type { Sql } from 'postgres';
import { loadEnv } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { extrairTexto } from './extrator';
import { OCR_QUEUE, OcrService, type OcrJobData } from './ocr.service';

/** Texto por pagina guardado no banco — PDFs de imagem com lixo de OCR nao incham a tabela. */
const MAX_CHARS_PAGINA = 100_000;

@Injectable()
export class OcrWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrWorker.name);
  private worker: Worker<OcrJobData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ocr.ready();
    if (!this.ocr.isEnabled()) return;
    const env = loadEnv();
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    // concurrency 1: OCR e CPU-bound; paralelizar so disputa CPU com a API.
    this.worker = new Worker<OcrJobData>(OCR_QUEUE, (job) => this.process(job), {
      connection: this.redis,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) => this.logger.error(`OCR job ${job?.id} falhou: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async setStatus(sql: Sql, d: OcrJobData, status: string, erro: string | null): Promise<void> {
    const tabela = d.documentFileId ? 'document_files' : 'documents';
    const id = d.documentFileId ?? d.documentId;
    // tabela vem de constante acima, nunca do usuario; sql() e o helper de identificador seguro.
    await sql`
      UPDATE ${sql(tabela)} SET ocr_status = ${status}, ocr_erro = ${erro}, ocr_processado_em = now()
      WHERE id = ${id}
    `;
  }

  /** O arquivo ainda e o mesmo do job? (pode ter sido removido/substituido enquanto esperava na fila) */
  private async aindaAtual(sql: Sql, d: OcrJobData): Promise<boolean> {
    const rows = d.documentFileId
      ? await sql`SELECT 1 FROM document_files WHERE id = ${d.documentFileId} AND file_key = ${d.fileKey}`
      : await sql`SELECT 1 FROM documents WHERE id = ${d.documentId} AND file_key = ${d.fileKey}`;
    return rows.length > 0;
  }

  private async process(job: Job<OcrJobData>): Promise<void> {
    const d = job.data;
    if (!SCHEMA_NAME_REGEX.test(d.schemaName)) throw new Error(`Schema invalido no job: ${d.schemaName}`);
    const sql = this.db.tenant(d.schemaName);
    if (!(await this.aindaAtual(sql, d))) return;

    await this.setStatus(sql, d, 'processando', null);
    try {
      const pdf = await this.storage.download(d.slug, d.fileKey);
      const paginas = await extrairTexto(pdf, this.ocr.ferramentas());
      const uteis = paginas
        .map((p) => ({ ...p, texto: p.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PAGINA) }))
        .filter((p) => p.texto.length > 0);

      if (!(await this.aindaAtual(sql, d))) return;
      await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        await tx`
          DELETE FROM document_textos
          WHERE document_id = ${d.documentId} AND document_file_id IS NOT DISTINCT FROM ${d.documentFileId}::uuid
        `;
        for (const p of uteis) {
          await tx`
            INSERT INTO document_textos (document_id, document_file_id, pagina, texto, tsv, origem)
            VALUES (${d.documentId}, ${d.documentFileId}, ${p.pagina}, ${p.texto},
                    to_tsvector('portuguese', ${normalizarParaBusca(p.texto)}), ${p.origem})
          `;
        }
      });
      await this.setStatus(sql, d, uteis.length > 0 ? 'concluido' : 'sem_texto', null);
      this.logger.log(
        `Indexado ${d.documentId}${d.documentFileId ? `/${d.documentFileId}` : ''}: ${uteis.length}/${paginas.length} pagina(s), ${paginas.filter((p) => p.origem === 'ocr').length} por OCR`,
      );
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await this.setStatus(sql, d, 'erro', msg);
      throw err; // BullMQ faz a 2a tentativa (attempts: 2)
    }
  }
}
