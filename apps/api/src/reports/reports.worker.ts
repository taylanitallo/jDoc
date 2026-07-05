import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SCHEMA_NAME_REGEX } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { loadEnv } from '../config/env';
import { REPORTS_QUEUE, type ReportsJobData } from './reports.service';
import { buildIndiceHtml, type IndiceEntry, type Midia } from './midia-indice-html';

/** file_key regex para validacao anti path-traversal. */
const FILE_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|zip)$/;

function assertSafeFileKey(key: string): void {
  if (!FILE_KEY_REGEX.test(key)) {
    throw new Error(`Chave de arquivo invalida: ${key}`);
  }
}

/** Midias cujo ZIP organiza os arquivos em subpastas por orgao. Balancete fica sempre "achatado". */
const ORG_FOLDER_MIDIAS = new Set(['despesa']);

/** Nome de pasta seguro dentro do ZIP — remove caracteres invalidos em Windows/Unix. */
function sanitizeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 100) || 'SEM ORGAO';
}

interface MidiaRow {
  subtype: string | null;
  doc_caixa: string | null;
  empenho: string | null;
  credor: string | null;
  historico: string | null;
  descricao: string | null;
  document_date: Date | null;
  value: string | null;
  competencia: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  file_key: string;
  criado_em: Date;
  orgao_codigo: string | null;
  orgao_nome: string | null;
  document_type_nome: string | null;
}

@Injectable()
export class ReportsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportsWorker.name);
  private worker: Worker<ReportsJobData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<ReportsJobData>(
      REPORTS_QUEUE,
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

  private async process(job: Job<ReportsJobData>): Promise<void> {
    const { schemaName, slug, jobId, actorId, tipo, params, tenantNome, corDestaque, nomeExibido, brasaoDataUri } = job.data;

    // Regra de ouro: validar schema name antes de qualquer query
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new Error(`Schema invalido no job: ${schemaName}`);
    }

    const sql = this.db.tenant(schemaName);

    // Marcar como processando
    await sql`UPDATE report_jobs SET status = 'processando', iniciado_em = now() WHERE id = ${jobId}`;

    try {
      if (tipo === 'prestacao_contas') {
        await this.processPrestacaoContas(sql, slug, jobId, params as any);
      } else if (tipo === 'midia_legislativa') {
        await this.processMidiaLegislativa(
          sql, slug, jobId, params as any, tenantNome, corDestaque, nomeExibido, brasaoDataUri, actorId,
        );
      }

      await sql`
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata)
        VALUES (${actorId}, 'report_processed', 'report_job', ${jobId},
                ${sql.json({ tipo, success: true } as unknown as Parameters<typeof sql.json>[0])})
      `;
    } catch (err) {
      await sql`
        UPDATE report_jobs SET
          status = 'erro',
          erro_mensagem = ${(err as Error).message},
          concluido_em = now()
        WHERE id = ${jobId}
      `;
      throw err;
    }
  }

  /** Categorias do relatorio resumido — uma por modulo (nao agrupa mais tudo em "outros"). */
  private static readonly CATEGORIAS_ORDEM = ['RECEITA', 'DESPESA', 'EXTRATO', 'BALANCETE', 'OUTROS TIPOS DE DOCUMENTOS'];

  private static readonly CATEGORIA_POR_MODULO: Record<string, string> = {
    receitas: 'RECEITA',
    despesas: 'DESPESA',
    extrato: 'EXTRATO',
    balancete: 'BALANCETE',
    outros: 'OUTROS TIPOS DE DOCUMENTOS',
  };

  private categoriaDoModulo(module: string): string {
    return ReportsWorker.CATEGORIA_POR_MODULO[module] ?? 'OUTROS TIPOS DE DOCUMENTOS';
  }

  private formatDataBR(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  private async contarPaginas(slug: string, fileKey: string): Promise<number> {
    const buffer = await this.storage.download(slug, fileKey);
    const pdf = await PdfLibDocument.load(buffer, { ignoreEncryption: true });
    return pdf.getPageCount();
  }

  private async processPrestacaoContas(
    sql: any,
    slug: string,
    jobId: string,
    params: { periodoInicio: string; periodoFim: string; ordenacao: string; relatorio: string },
  ): Promise<void> {
    // Query documents com filtros. SQL 100% parametrizado (decisao #1).
    const rows = await sql<Array<{
      module: string;
      subtype: string | null;
      doc_caixa: string | null;
      empenho: string | null;
      credor: string | null;
      historico: string | null;
      value: string | number | null;
      document_date: Date | string;
      competencia: string | null;
      exercicio: number;
      file_key: string;
    }>>`
      SELECT module, subtype, doc_caixa, empenho, credor, historico, value, document_date, competencia, exercicio, file_key
      FROM documents
      WHERE deleted_at IS NULL
        AND document_date >= ${params.periodoInicio}::date
        AND document_date <= ${params.periodoFim}::date
      ORDER BY ${params.ordenacao === 'alfabetica' ? sql`credor ASC` : sql`document_date ASC`}
    `;

    // 1) Gerar relatorio.pdf (capa + resumo/listagem) na raiz do ZIP.
    const tmpRelatorio = join(tmpdir(), `relatorio-${randomUUID()}.pdf`);
    {
      const doc = new PDFDocument({ margin: 50 });
      const stream = createWriteStream(tmpRelatorio);
      doc.pipe(stream);

      const periodoLabel = `${this.formatDataBR(params.periodoInicio)} À ${this.formatDataBR(params.periodoFim)}`;

      // Formato espelha o sistema de referencia: titulo + tabela Categoria/Arquivos/Paginas.
      doc.fontSize(16).font('Helvetica-Bold').text(
        'PRESTAÇÃO DE CONTAS POR DATA DA DOCUMENTAÇÃO - POR CATEGORIA',
        { align: 'center' },
      );
      doc.fontSize(10).font('Helvetica').text(`PERÍODO DE: ${periodoLabel}`, { align: 'center' });
      doc.moveDown(1.5);

      const stats = new Map<string, { arquivos: number; paginas: number }>();
      for (const row of rows) {
        const cat = this.categoriaDoModulo(row.module);
        const entry = stats.get(cat) ?? { arquivos: 0, paginas: 0 };
        entry.arquivos += 1;
        if (row.file_key && FILE_KEY_REGEX.test(row.file_key)) {
          try {
            entry.paginas += await this.contarPaginas(slug, row.file_key);
          } catch (err) {
            this.logger.warn(`Falha ao contar paginas de ${row.file_key}: ${(err as Error).message}`);
          }
        }
        stats.set(cat, entry);
      }

      const ordemCategorias = ReportsWorker.CATEGORIAS_ORDEM;
      let totalArquivos = 0;
      let totalPaginas = 0;

      const colCategoria = 50;
      const colArquivos = 380;
      const colPaginas = 470;

      doc.font('Helvetica-Bold').fontSize(10);
      doc.text('Categoria', colCategoria, doc.y, { continued: false });
      doc.text('Quant. de arquivos', colArquivos, doc.y - doc.currentLineHeight(), { width: 90, align: 'right' });
      doc.text('Quant. de páginas', colPaginas, doc.y - doc.currentLineHeight(), { width: 90, align: 'right' });
      doc.moveDown(0.3);
      doc.moveTo(colCategoria, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(0.3);

      doc.font('Helvetica').fontSize(10);
      for (const cat of ordemCategorias) {
        const entry = stats.get(cat);
        if (!entry) continue;
        const y = doc.y;
        doc.text(cat, colCategoria, y, { width: 320 });
        doc.text(String(entry.arquivos), colArquivos, y, { width: 90, align: 'right' });
        doc.text(String(entry.paginas), colPaginas, y, { width: 90, align: 'right' });
        doc.moveDown(0.5);
        totalArquivos += entry.arquivos;
        totalPaginas += entry.paginas;
      }

      doc.moveDown(0.2);
      doc.moveTo(colCategoria, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold');
      const yTotal = doc.y;
      doc.text('Total geral:', colCategoria, yTotal, { width: 320, align: 'right' });
      doc.text(String(totalArquivos), colArquivos, yTotal, { width: 90, align: 'right' });
      doc.text(String(totalPaginas), colPaginas, yTotal, { width: 90, align: 'right' });

      doc.moveDown(2);
      doc.font('Helvetica-Oblique').fontSize(9).text(
        `Data da emissão do documento: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}`,
      );

      doc.end();

      await new Promise<void>((resolve, reject) => {
        stream.on('finish', () => resolve());
        stream.on('error', (err: Error) => reject(err));
      });
    }

    // 2) Upload direto do PDF gerado (sem empacotar em zip).
    const fileKey = `${randomUUID()}.pdf`;
    assertSafeFileKey(fileKey);
    const pdfBuffer = await readFile(tmpRelatorio);
    await this.storage.upload(slug, fileKey, pdfBuffer);
    await unlink(tmpRelatorio);

    // Atualizar job
    await sql`
      UPDATE report_jobs SET
        status = 'concluido',
        file_key = ${fileKey},
        tamanho_bytes = ${pdfBuffer.length},
        total_registros = ${rows.length},
        concluido_em = now()
      WHERE id = ${jobId}
    `;
  }

  private async processMidiaLegislativa(
    sql: any,
    slug: string,
    jobId: string,
    params: { exercicio: number; competencias: number[]; midias: string[] },
    tenantNome: string,
    corDestaque: string | null,
    nomeExibido: string | null,
    brasaoDataUri: string | null,
    actorId: string,
  ): Promise<void> {
    const meses = [
      '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
    ];

    const userRows = await sql<Array<{ nome: string }>>`
      SELECT nome FROM users WHERE id = ${actorId} LIMIT 1
    `;
    const geradoPor = userRows[0]?.nome ?? 'Desconhecido';
    const geradoEm = new Date().toISOString();

    // Criar ZIP temporario
    const tmpZip = join(tmpdir(), `${randomUUID()}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const zipStream = createWriteStream(tmpZip);
    archive.pipe(zipStream);

    let totalRegistros = 0;

    const moduleMap: Record<string, string> = {
      balancete: 'balancete',
      extrato: 'extrato',
      receita: 'receitas',
      despesa: 'despesas',
      outros: 'outros',
    };
    // Despesas/receitas/outros nao preenchem "competencia" — o mes deles vem
    // de document_date. So balancete/extrato usam competencia (YYYY-MM).
    const usaDocumentDate = (midia: string) => midia === 'despesa' || midia === 'receita' || midia === 'outros';

    for (const mes of params.competencias) {
      const mesNome = meses[mes];
      const mesEntries: IndiceEntry[] = [];

      for (const midia of params.midias) {
        const module = moduleMap[midia] ?? 'outros';

        const rows = usaDocumentDate(midia)
          ? await sql<Array<MidiaRow>>`
              SELECT d.subtype, d.doc_caixa, d.empenho, d.credor, d.historico, d.descricao,
                     d.document_date, d.value, d.competencia, d.banco, d.agencia, d.conta,
                     d.file_key, d.criado_em,
                     o.codigo AS orgao_codigo, o.descricao AS orgao_nome,
                     dt.nome AS document_type_nome
              FROM documents d
              LEFT JOIN orgaos o ON o.id = d.orgao_id
              LEFT JOIN document_types dt ON dt.id = d.document_type_id
              WHERE d.exercicio = ${params.exercicio}
                AND d.module = ${module}
                AND d.deleted_at IS NULL
                AND d.file_key IS NOT NULL
                AND EXTRACT(YEAR FROM d.document_date) = ${params.exercicio}
                AND EXTRACT(MONTH FROM d.document_date) = ${mes}
            `
          : await sql<Array<MidiaRow>>`
              SELECT d.subtype, d.doc_caixa, d.empenho, d.credor, d.historico, d.descricao,
                     d.document_date, d.value, d.competencia, d.banco, d.agencia, d.conta,
                     d.file_key, d.criado_em,
                     o.codigo AS orgao_codigo, o.descricao AS orgao_nome,
                     dt.nome AS document_type_nome
              FROM documents d
              LEFT JOIN orgaos o ON o.id = d.orgao_id
              LEFT JOIN document_types dt ON dt.id = d.document_type_id
              WHERE d.exercicio = ${params.exercicio}
                AND d.module = ${module}
                AND d.deleted_at IS NULL
                AND d.file_key IS NOT NULL
                AND d.competencia = ${`${params.exercicio}-${String(mes).padStart(2, '0')}`}
            `;

        for (const row of rows) {
          if (!FILE_KEY_REGEX.test(row.file_key)) continue;
          try {
            const content = await this.storage.download(slug, row.file_key);
            const subFolder = ORG_FOLDER_MIDIAS.has(midia)
              ? sanitizeFolderName([row.orgao_codigo, row.orgao_nome].filter(Boolean).join(' - '))
              : null;
            const entryPath = subFolder
              ? `${params.exercicio}/${mesNome}/${midia}/${subFolder}/${row.file_key}`
              : `${params.exercicio}/${mesNome}/${midia}/${row.file_key}`;
            archive.append(content, { name: entryPath });
            mesEntries.push({
              midia: midia as Midia,
              fileKey: row.file_key,
              subFolder,
              docCaixa: row.doc_caixa,
              empenho: row.empenho,
              credor: row.credor,
              historico: row.historico,
              descricao: row.descricao,
              subtype: row.subtype,
              documentDate: row.document_date
                ? row.document_date.toISOString().slice(0, 10)
                : row.criado_em.toISOString().slice(0, 10),
              value: row.value === null ? null : Number(row.value),
              competencia: row.competencia,
              banco: row.banco,
              agencia: row.agencia,
              conta: row.conta,
              orgaoCodigo: row.orgao_codigo,
              orgaoNome: row.orgao_nome,
              documentTypeNome: row.document_type_nome,
            });
            totalRegistros++;
          } catch (err) {
            this.logger.warn(`Arquivo nao encontrado: ${row.file_key}`);
          }
        }
      }

      const indiceHtml = buildIndiceHtml({
        tenantNome,
        exercicio: params.exercicio,
        mesNome,
        geradoPor,
        geradoEm,
        corDestaque,
        nomeExibido,
        brasaoDataUri,
        midiasSelecionadas: params.midias as Midia[],
        entries: mesEntries,
      });
      archive.append(Buffer.from(indiceHtml, 'utf8'), {
        name: `${params.exercicio}/${mesNome}/MIDIA LEG - VISUALIZAR DOCUMENTOS.html`,
      });
    }

    // Finalizar ZIP
    archive.finalize();

    // Aguardar ZIP terminar
    await new Promise<void>((resolve, reject) => {
      zipStream.on('finish', () => resolve());
      zipStream.on('error', (err: Error) => reject(err));
    });

    // Upload para storage
    const fileKey = `${randomUUID()}.zip`;
    assertSafeFileKey(fileKey);
    const zipBuffer = await readFile(tmpZip);
    await this.storage.upload(slug, fileKey, zipBuffer);

    // Cleanup temporario
    await unlink(tmpZip);

    // Atualizar job
    await sql`
      UPDATE report_jobs SET
        status = 'concluido',
        file_key = ${fileKey},
        tamanho_bytes = ${zipBuffer.length},
        total_registros = ${totalRegistros},
        concluido_em = now()
      WHERE id = ${jobId}
    `;
  }
}
