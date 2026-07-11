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
 * se o provedor selecionado (CONFERENCIA_PROVIDER, default 'anthropic') tiver
 * a API key correspondente configurada — sem ela, e um no-op (a feature fica
 * desligada, e o anexo do PDF nunca depende dela).
 */
@Injectable()
export class ConferenciaService implements OnModuleDestroy {
  private readonly queue: Queue<ConferenciaJobData> | null;
  private readonly queueRedis: Redis | null;

  constructor() {
    const env = loadEnv();
    const apiKey = env.CONFERENCIA_PROVIDER === 'gemini' ? env.GEMINI_API_KEY : env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.queue = null;
      this.queueRedis = null;
      return;
    }
    this.queueRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
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

  /** Se a feature esta configurada (API key do provedor selecionado presente) neste ambiente. */
  isEnabled(): boolean {
    return this.queue !== null;
  }
}
