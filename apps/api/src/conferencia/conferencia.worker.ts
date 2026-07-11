import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { z } from 'zod';
import { SCHEMA_NAME_REGEX, type ConferenciaResultado, type ConferenciaStatus } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { loadEnv } from '../config/env';
import { CONFERENCIA_QUEUE, type ConferenciaJobData } from './conferencia.service';

/** Beta necessaria para upload de PDF via Files API (evita o limite de 32MB de payload inline). */
const FILES_API_BETA = 'files-api-2025-04-14';

/**
 * JSON schema puro (nao via zodOutputFormat) para o output_config.format do
 * request — o helper zodOutputFormat do SDK traz sua propria copia do zod
 * como peer dep, que conflita em tipo com o zod do projeto (pnpm resolve
 * versoes isoladas). Schema simples o bastante pra escrever a mao.
 */
const CONFERENCIA_JSON_SCHEMA = {
  type: 'object',
  properties: {
    valorEncontrado: { type: ['number', 'null'] },
    credorEncontrado: { type: ['string', 'null'] },
    docCaixaEncontrado: { type: ['string', 'null'] },
    divergencias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string' },
          esperado: { type: ['string', 'null'] },
          encontrado: { type: ['string', 'null'] },
        },
        required: ['campo', 'esperado', 'encontrado'],
        additionalProperties: false,
      },
    },
    resumo: { type: 'string' },
    status: { type: 'string', enum: ['conforme', 'divergente'] },
  },
  required: ['valorEncontrado', 'credorEncontrado', 'docCaixaEncontrado', 'divergencias', 'resumo', 'status'],
  additionalProperties: false,
} as const;

/** Valida em runtime a saida da IA (mesma forma do JSON schema acima). */
const conferenciaSchema = z.object({
  valorEncontrado: z.number().nullable(),
  credorEncontrado: z.string().nullable(),
  docCaixaEncontrado: z.string().nullable(),
  divergencias: z.array(
    z.object({
      campo: z.string(),
      esperado: z.string().nullable(),
      encontrado: z.string().nullable(),
    }),
  ),
  resumo: z.string(),
  status: z.enum(['conforme', 'divergente']),
});

function formatEsperado(v: string | number | null): string {
  return v === null ? 'nao informado' : String(v);
}

/** Mensagem de erro curta e legivel pra guardar/exibir (nunca o stack inteiro). */
function erroLegivel(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
}

/**
 * Worker da conferencia por IA. Roda fora do request: baixa o PDF pelo
 * file_key, sobe pra Claude via Files API (evita o limite de 32MB de payload
 * inline em base64 — documentos grandes/escaneados passam disso facil), pede
 * pra extrair valor/credor/doc de caixa e comparar com o que a etiqueta tem
 * cadastrado, e grava o veredito nas colunas de documents. Best-effort —
 * qualquer falha grava status 'falha' + o motivo (nunca propaga: nao deve
 * derrubar a fila nem afetar o anexo, que ja terminou antes deste job).
 */
@Injectable()
export class ConferenciaWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConferenciaWorker.name);
  private worker: Worker<ConferenciaJobData> | null = null;
  private redis: Redis | null = null;
  private anthropic: Anthropic | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    const apiKey = loadEnv().ANTHROPIC_API_KEY;
    if (!apiKey) return; // feature desligada — sem worker, sem fila (ConferenciaService.enqueueConferencia tambem e no-op).

    this.anthropic = new Anthropic({ apiKey });
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<ConferenciaJobData>(CONFERENCIA_QUEUE, (job) => this.process(job), {
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

  private async process(job: Job<ConferenciaJobData>): Promise<void> {
    const { schemaName, slug, documentId, fileKey, docCaixa, empenho, credor, value } = job.data;
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new Error(`Schema invalido no job: ${schemaName}`);
    }
    const sql = this.db.tenant(schemaName);

    try {
      const pdf = await this.storage.download(slug, fileKey);
      const resultado = await this.conferir(pdf, { docCaixa, empenho, credor, value });
      await sql`
        UPDATE documents SET
          conferencia_status = ${resultado.status},
          conferencia_resultado = ${sql.json(resultado as unknown as Parameters<typeof sql.json>[0])},
          conferencia_erro = NULL,
          conferencia_verificada_em = now()
        WHERE id = ${documentId}
      `;
      this.logger.log(`Conferencia de ${documentId}: ${resultado.status}`);
    } catch (err) {
      const status: ConferenciaStatus = 'falha';
      const erro = erroLegivel(err);
      await sql`
        UPDATE documents SET
          conferencia_status = ${status},
          conferencia_erro = ${erro},
          conferencia_verificada_em = now()
        WHERE id = ${documentId}
      `;
      this.logger.warn(`Conferencia de ${documentId} falhou: ${erro}`);
    }
  }

  private async conferir(
    pdf: Buffer,
    etiqueta: { docCaixa: string | null; empenho: string | null; credor: string | null; value: number | null },
  ): Promise<ConferenciaResultado & { status: ConferenciaStatus }> {
    if (!this.anthropic) throw new Error('Conferencia por IA desativada (sem ANTHROPIC_API_KEY)');

    // Upload via Files API (nao embutido em base64 no corpo do request) —
    // documentos escaneados/grandes passam facil do limite de 32MB inline.
    const uploaded = await this.anthropic.beta.files.upload({
      file: await toFile(pdf, 'documento.pdf', { type: 'application/pdf' }),
      betas: [FILES_API_BETA],
    });

    try {
      const response = await this.anthropic.beta.messages.create({
        // Haiku 4.5 (nao o default Opus) - decisao explicita do usuario por
        // custo: ~5x mais barato, e essa tarefa (extrair valor/credor/doc
        // caixa de 1 PDF e comparar) e simples o bastante pra nao precisar
        // do modelo mais caro.
        model: 'claude-haiku-4-5',
        max_tokens: 4096,
        thinking: { type: 'enabled', budget_tokens: 2048 },
        betas: [FILES_API_BETA],
        output_config: { format: { type: 'json_schema', schema: CONFERENCIA_JSON_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'file', file_id: uploaded.id } },
              {
                type: 'text',
                text: [
                  'Este PDF foi anexado como comprovante de uma despesa publica (nota fiscal, empenho ou ordem de pagamento).',
                  'Extraia do documento o valor, o credor/fornecedor e o numero do documento de caixa (se aparecer), e compare com os dados cadastrados abaixo.',
                  '',
                  `Valor esperado: ${formatEsperado(etiqueta.value)}`,
                  `Credor esperado: ${formatEsperado(etiqueta.credor)}`,
                  `Empenho esperado: ${formatEsperado(etiqueta.empenho)}`,
                  `Documento de caixa esperado: ${formatEsperado(etiqueta.docCaixa)}`,
                  '',
                  'Liste em "divergencias" apenas os campos onde o valor do PDF diverge claramente do esperado (nao liste campos que baterem ou que o PDF simplesmente nao mostra).',
                  'Use status "divergente" se houver qualquer divergencia de valor ou credor; "conforme" caso contrario.',
                ].join('\n'),
              },
            ],
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        throw new Error(`IA recusou a analise (stop_reason=refusal)`);
      }
      const textBlock = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
      if (!textBlock) throw new Error('Resposta da IA sem bloco de texto');
      return conferenciaSchema.parse(JSON.parse(textBlock.text));
    } finally {
      // Best-effort: nao deve derrubar a analise se a limpeza falhar.
      await this.anthropic.beta.files.delete(uploaded.id, { betas: [FILES_API_BETA] }).catch(() => {});
    }
  }
}
