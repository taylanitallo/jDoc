import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadEnv } from '../config/env';

export const CONFERENCIA_QUEUE = 'document-conferencia';

export interface ConferenciaJobData {
  schemaName: string;
  slug: string;
  /** Documento "dono" (pra permissao/cancelamento/logs) — a etiqueta e sempre dele, mesmo pra arquivos extras. */
  documentId: string;
  /** Onde gravar o resultado: o documento principal, ou um arquivo extra dele. */
  targetTable: 'documents' | 'document_files';
  targetId: string;
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

  /**
   * Cancela os jobs que AINDA NAO comecaram a rodar (estado 'waiting' ou
   * 'delayed') — economiza o custo dos que nem foram enviados pra IA ainda.
   * Jobs ja em andamento (no maximo 2, concurrency do worker) terminam
   * normalmente; nao da pra abortar uma chamada de API ja em voo com
   * seguranca. Filtra por job.data.targetId OU documentId (nao por jobId —
   * mantemos IDs auto-gerados pra evitar colisao quando o mesmo documento e
   * reanalisado) — targetId cobre arquivos extras, documentId cobre o
   * principal. Devolve quantos foram cancelados de fato.
   */
  async cancelarPendentes(ids: string[]): Promise<number> {
    if (!this.queue) return 0;
    const idSet = new Set(ids);
    const jobs = await this.queue.getJobs(['waiting', 'delayed']);
    let cancelados = 0;
    for (const job of jobs) {
      if (idSet.has(job.data.targetId) || idSet.has(job.data.documentId)) {
        await job.remove();
        cancelados++;
      }
    }
    return cancelados;
  }

  /** Se a feature esta configurada (API key do provedor selecionado presente) neste ambiente. */
  isEnabled(): boolean {
    return this.queue !== null;
  }
}
