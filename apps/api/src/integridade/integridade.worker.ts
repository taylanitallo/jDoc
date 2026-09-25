import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SCHEMA_NAME_REGEX } from '@jdoc/shared';
import { loadEnv } from '../config/env';
import { INTEGRIDADE_QUEUE, IntegridadeService, type IntegridadeJobData } from './integridade.service';

@Injectable()
export class IntegridadeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegridadeWorker.name);
  private worker: Worker<IntegridadeJobData> | null = null;
  private redis: Redis | null = null;

  constructor(private readonly service: IntegridadeService) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    // concurrency 1: baixar e calcular hash de muitos PDFs e I/O pesado; uma execucao por vez.
    this.worker = new Worker<IntegridadeJobData>(INTEGRIDADE_QUEUE, (job) => this.process(job), {
      connection: this.redis,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) => this.logger.error(`Integridade job ${job?.id} falhou: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async process(job: Job<IntegridadeJobData>): Promise<void> {
    const d = job.data;
    if (d.tipo === 'diaria') return this.service.executarDiaria();
    if (!SCHEMA_NAME_REGEX.test(d.schemaName)) throw new Error(`Schema invalido no job: ${d.schemaName}`);
    await this.service.executar(d.schemaName, d.slug, d.verificacaoId, false);
  }
}
