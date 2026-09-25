import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { detectarFerramentas, type Ferramentas } from './extrator';

export const OCR_QUEUE = 'document-ocr';

export interface OcrJobData {
  schemaName: string;
  slug: string;
  documentId: string;
  /** null = arquivo principal (colunas de documents); senao, um PDF extra. */
  documentFileId: string | null;
  fileKey: string;
}

/**
 * Indexacao do conteudo dos PDFs para a busca. So liga se o ambiente tiver
 * pdftotext (poppler-utils); OCR de paginas escaneadas exige tambem pdftoppm +
 * tesseract. Sem as ferramentas (ex.: dev no Windows), enfileirar e no-op e o
 * upload nunca depende disso.
 */
@Injectable()
export class OcrService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private queue: Queue<OcrJobData> | null = null;
  private queueRedis: Redis | null = null;
  private tools: Ferramentas = { pdftotext: false, ocr: false, idiomaOcr: 'por' };
  private iniciando: Promise<void> | null = null;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): Promise<void> {
    return this.ready();
  }

  /** Deteccao das ferramentas, uma vez so (o worker aguarda isso antes de decidir se sobe). */
  ready(): Promise<void> {
    this.iniciando ??= this.iniciar();
    return this.iniciando;
  }

  private async iniciar(): Promise<void> {
    const env = loadEnv();
    if (env.OCR_DISABLED) {
      this.logger.log('Indexacao de conteudo desligada (OCR_DISABLED)');
      return;
    }
    this.tools = await detectarFerramentas();
    if (!this.tools.pdftotext) {
      this.logger.warn('pdftotext nao encontrado — busca no conteudo desligada (instale poppler-utils)');
      return;
    }
    this.queueRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<OcrJobData>(OCR_QUEUE, { connection: this.queueRedis });
    this.logger.log(
      `Busca no conteudo ativa — OCR ${this.tools.ocr ? `ligado (${this.tools.idiomaOcr})` : 'desligado (sem tesseract/pdftoppm)'}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.queueRedis?.quit();
  }

  isEnabled(): boolean {
    return this.queue !== null;
  }

  ferramentas(): Ferramentas {
    return this.tools;
  }

  async enqueue(data: OcrJobData): Promise<void> {
    if (!this.queue) return;
    const sql = this.db.tenant(data.schemaName);
    if (data.documentFileId) {
      await sql`UPDATE document_files SET ocr_status = 'pendente', ocr_erro = NULL WHERE id = ${data.documentFileId}`;
    } else {
      await sql`UPDATE documents SET ocr_status = 'pendente', ocr_erro = NULL WHERE id = ${data.documentId}`;
    }
    await this.queue.add('indexar', data, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }
}
