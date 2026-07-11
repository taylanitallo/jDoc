import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SCHEMA_NAME_REGEX } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { loadEnv } from '../config/env';
import { SIGNATURE_QUEUE, type SignatureJobData } from './signature.service';
import { validatePdfSignature } from './validate';

/**
 * Worker da validacao de assinatura. Roda fora do request: baixa o PDF pelo
 * file_key, valida (integridade + cadeia + revogacao) e grava o resultado nas
 * colunas de documents. Schema re-validado (regra de ouro).
 */
@Injectable()
export class SignatureWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignatureWorker.name);
  private worker: Worker<SignatureJobData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<SignatureJobData>(SIGNATURE_QUEUE, (job) => this.process(job), {
      connection: this.redis,
      concurrency: 2,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} falhou: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async process(job: Job<SignatureJobData>): Promise<void> {
    const { schemaName, slug, documentId, targetTable, targetId, fileKey } = job.data;
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new Error(`Schema invalido no job: ${schemaName}`);
    }

    const pdf = await this.storage.download(slug, fileKey);
    const result = await validatePdfSignature(pdf);

    const sql = this.db.tenant(schemaName);
    // targetTable so vem de 'documents' | 'document_files' (uniao de tipos
    // fixada no job data, nunca de input de usuario) — sql() e o helper de
    // identificador seguro do postgres.js, nao interpolacao crua.
    await sql`
      UPDATE ${sql(targetTable)} SET
        assinatura_status = ${result.status},
        assinado_por = ${result.signerCN},
        assinatura_verificada_em = now()
      WHERE id = ${targetId}
    `;
    this.logger.log(
      `Assinatura de ${documentId} (${targetTable}:${targetId}): ${result.status} (signer: ${result.signerCN ?? '—'})`,
    );
  }
}
