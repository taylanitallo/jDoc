import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';

export const CONFERENCIA_QUEUE = 'document-conferencia';

export interface ConferenciaJobData {
  schemaName: string;
  slug: string;
  documentId: string;
  fileKey: string;
  docCaixa: string | null;
  empenho: string | null;
  credor: string | null;
  value: number | null;
}

/**
 * Enfileira a conferencia por IA de um documento recem-anexado. So dispara
 * se ANTHROPIC_API_KEY estiver configurada — sem a key, e um no-op (a
 * feature fica desligada, e o anexo do PDF nunca depende dela).
 */
@Injectable()
export class ConferenciaService implements OnModuleDestroy {
  private readonly queue: Queue<ConferenciaJobData> | null;
  private readonly queueRedis: Redis | null;

  constructor() {
    if (!loadEnv().ANTHROPIC_API_KEY) {
      this.queue = null;
      this.queueRedis = null;
      return;
    }
    this.queueRedis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<ConferenciaJobData>(CONFERENCIA_QUEUE, { connection: this.queueRedis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.queueRedis?.quit();
  }

  async enqueueConferencia(data: ConferenciaJobData): Promise<void> {
    if (!this.queue) return;
    await this.queue.add('conferir', data);
  }
}
