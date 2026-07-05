import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { parseLabels, SCHEMA_NAME_REGEX, type DocModule, type LabelFormat } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { loadEnv } from '../config/env';
import { LABELS_QUEUE, type LabelsJobData } from './labels.service';
import { filterByOrgaoImporta } from './orgao-filter';
import { filterDuplicates } from './duplicate-filter';

/**
 * Worker BullMQ da importacao de etiquetas.
 * Roda FORA do contexto de request — o schema vem do job e e re-validado
 * contra SCHEMA_NAME_REGEX antes de qualquer query (regra de ouro).
 */
@Injectable()
export class LabelsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LabelsWorker.name);
  private worker: Worker<LabelsJobData> | null = null;
  private redis: Redis | null = null;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<LabelsJobData>(
      LABELS_QUEUE,
      (job) => this.process(job),
      { connection: this.redis, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} falhou: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async process(job: Job<LabelsJobData>): Promise<void> {
    const { schemaName, importId, actorId } = job.data;
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new Error(`Schema invalido no job: ${schemaName}`);
    }
    const sql = this.db.tenant(schemaName);

    await sql`UPDATE labels_imports SET status = 'processando' WHERE id = ${importId}`;

    try {
      const rows = await sql<
        Array<{ formato: string; module: string; file_content: string }>
      >`
        SELECT formato, module, file_content FROM labels_imports WHERE id = ${importId} LIMIT 1
      `;
      const imp = rows[0];
      if (!imp) throw new Error('Importacao nao encontrada');

      const result = parseLabels(
        imp.file_content,
        imp.module as DocModule,
        imp.formato as LabelFormat,
      );
      if (!result) throw new Error('Formato invalido no reprocessamento');

      const semDuplicados = await filterDuplicates(
        sql,
        imp.module as DocModule,
        result.records,
        result.errors,
      );
      const { records: registrosValidos, errors: erros, orgaoIdPorRegistro } = await filterByOrgaoImporta(
        sql,
        semDuplicados.records,
        semDuplicados.errors,
      );

      // Insercao em lote dentro de transacao.
      await sql.begin(async (tx) => {
        for (const rec of registrosValidos) {
          // Cada etiqueta vira uma DESPESA PENDENTE (documento sem arquivo,
          // status 'aguardando_arquivo'); o PDF e anexado depois. O exercicio
          // sai do ano da data de pagamento.
          const exercicio = Number(rec.data.slice(0, 4));
          const orgaoId = orgaoIdPorRegistro.get(rec) ?? null;
          const docRows = await tx<Array<{ id: string }>>`
            INSERT INTO documents (
              module, subtype, doc_caixa, empenho, credor, historico,
              document_date, value, exercicio, orgao_id, original_name, status, created_by
            ) VALUES (
              ${rec.module}, ${rec.subtype}, ${rec.docCaixa}, ${rec.empenho || null}, ${rec.credor},
              ${rec.historico}, ${rec.data}, ${rec.valor}, ${exercicio}, ${orgaoId},
              ${`Etiqueta ${rec.docCaixa}`}, 'aguardando_arquivo', ${actorId}
            )
            RETURNING id
          `;
          const documentId = docRows[0]?.id ?? null;
          await tx`
            INSERT INTO labels (import_id, module, doc_caixa, empenho, credor, valor, data, historico, document_id)
            VALUES (
              ${importId}, ${rec.module}, ${rec.docCaixa}, ${rec.empenho},
              ${rec.credor}, ${rec.valor}, ${rec.data}, ${rec.historico}, ${documentId}
            )
          `;
        }
        await tx`
          UPDATE labels_imports SET
            status = 'concluido',
            total_registros = ${result.totalLines},
            registros_ok = ${registrosValidos.length},
            registros_erro = ${erros.length},
            relatorio_erros = ${tx.json(erros as unknown as Parameters<typeof tx.json>[0])},
            concluido_em = now()
          WHERE id = ${importId}
        `;
      });

      await sql`
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata)
        VALUES (
          ${actorId}, 'labels_import_processed', 'labels_import', ${importId},
          ${JSON.stringify({ ok: registrosValidos.length, erros: erros.length })}
        )
      `;
    } catch (err) {
      await sql`
        UPDATE labels_imports SET
          status = 'erro',
          relatorio_erros = ${sql.json([{ line: 0, message: (err as Error).message, raw: '' }] as unknown as Parameters<typeof sql.json>[0])},
          concluido_em = now()
        WHERE id = ${importId}
      `;
      throw err;
    }
  }
}
