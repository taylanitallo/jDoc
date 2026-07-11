import { createHash, randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  TRASH_RETENTION_DAYS,
  type AnalisarConferenciaResult,
  type ConferenciaResultado,
  type ConferenciaStatus,
  type ConferenciaStatusItem,
  type DocModule,
  type DocumentFields,
  type DocumentPage,
  type DocumentView,
  type EtiquetaCandidate,
  type EtiquetasPendentesResult,
  type SearchDocumentsQuery,
  type TenantAccessClaims,
  type TrashQuery,
  type UpdateDocumentInput,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';
import { SignatureService } from '../signature/signature.service';
import { hasSignature } from '../signature/pdf-signature';
import { ConferenciaService } from '../conferencia/conferencia.service';

const PDF_MAGIC = Buffer.from('%PDF');

interface DocRow {
  id: string;
  module: DocModule;
  subtype: string | null;
  doc_caixa: string | null;
  empenho: string | null;
  credor: string | null;
  historico: string | null;
  descricao: string | null;
  budget_unit_id: string | null;
  budget_unit_nome: string | null;
  orgao_id: string | null;
  orgao_codigo: string | null;
  orgao_nome: string | null;
  document_type_id: string | null;
  document_type_nome: string | null;
  document_date: Date | null;
  value: string | null;
  competencia: string | null;
  exercicio: number;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  original_name: string;
  file_key: string | null;
  file_size: string | null;
  file_hash: string | null;
  paginas: number | null;
  status: string;
  criado_em: Date;
  deleted_at: Date | null;
  conferencia_status: ConferenciaStatus | null;
  conferencia_resultado: ConferenciaResultado | string | null;
  conferencia_erro: string | null;
  conferencia_verificada_em: Date | null;
}

function toView(r: DocRow): DocumentView {
  // jsonb pode chegar como string dependendo do driver — parse defensivo.
  const conferenciaResultado =
    typeof r.conferencia_resultado === 'string'
      ? (JSON.parse(r.conferencia_resultado) as ConferenciaResultado)
      : r.conferencia_resultado;
  return {
    id: r.id,
    module: r.module,
    subtype: r.subtype,
    docCaixa: r.doc_caixa,
    empenho: r.empenho,
    credor: r.credor,
    historico: r.historico,
    descricao: r.descricao,
    budgetUnitId: r.budget_unit_id,
    budgetUnitNome: r.budget_unit_nome,
    orgaoId: r.orgao_id,
    orgaoCodigo: r.orgao_codigo,
    orgaoNome: r.orgao_nome,
    documentTypeId: r.document_type_id,
    documentTypeNome: r.document_type_nome,
    documentDate: r.document_date ? r.document_date.toISOString().slice(0, 10) : null,
    value: r.value === null ? null : Number(r.value),
    competencia: r.competencia,
    exercicio: r.exercicio,
    banco: r.banco,
    agencia: r.agencia,
    conta: r.conta,
    originalName: r.original_name,
    fileSize: r.file_size === null ? 0 : Number(r.file_size),
    fileHash: r.file_hash ?? '',
    pageCount: r.paginas,
    status: r.status,
    criadoEm: r.criado_em.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    conferenciaStatus: r.conferencia_status,
    conferenciaResultado: conferenciaResultado,
    conferenciaErro: r.conferencia_erro,
    conferenciaVerificadaEm: r.conferencia_verificada_em ? r.conferencia_verificada_em.toISOString() : null,
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly signature: SignatureService,
    private readonly conferencia: ConferenciaService,
  ) {}

  /**
   * RBAC dinamico por modulo (rotas compartilham handler; permissao depende
   * do modulo do documento). admin passa; demais exigem `${module}:${action}`.
   */
  assertPermission(user: TenantAccessClaims, module: DocModule, action: string): void {
    if (user.role === 'admin') return;
    if (!user.permissions.includes(`${module}:${action}`)) {
      throw new ForbiddenException('Acesso negado');
    }
  }

  /** Conta paginas do PDF; retorna null se o arquivo estiver corrompido/ilegivel (nao bloqueia o upload). */
  private async countPages(buffer: Buffer): Promise<number | null> {
    try {
      const pdf = await PdfLibDocument.load(buffer, { ignoreEncryption: true });
      return pdf.getPageCount();
    } catch {
      return null;
    }
  }

  /** Uso atual em bytes — real do bucket de storage do tenant (nao uma soma local). */
  async usageBytes(): Promise<number> {
    const ctx = requireTenantContext();
    return this.storage.usageBytes(ctx.slug);
  }

  async create(
    user: TenantAccessClaims,
    fields: DocumentFields,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    ip: string,
  ): Promise<DocumentView> {
    const ctx = requireTenantContext();
    this.assertPermission(user, fields.module, 'create');

    // PDF e opcional: sem arquivo, o documento nasce como etiqueta
    // 'aguardando_arquivo' (mesmo estado de uma etiqueta importada) — o PDF
    // pode ser anexado depois pelo upload normal ou pela Pasta Monitorada.
    if (file) {
      // 1) Validacao do arquivo: magic bytes %PDF (nunca confiar no MIME do cliente).
      if (file.size < 5 || !file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
        throw new BadRequestException('Arquivo invalido: apenas PDF e aceito');
      }
      const env = loadEnv();
      const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
      if (file.size > maxBytes) {
        throw new PayloadTooLargeException(`Arquivo excede o limite de ${env.MAX_UPLOAD_MB} MB`);
      }

      // 2) Quota ANTES de aceitar: uso + novo arquivo vs quota do tenant.
      const quotaBytes = ctx.quotaDiscoMb * 1024 * 1024;
      const uso = await this.usageBytes();
      if (uso + file.size > quotaBytes) {
        throw new ForbiddenException(
          'Quota de disco do orgao atingida. Contate a JEOS para ampliar o plano.',
        );
      }
    }

    // 3) Nome no storage = UUID gerado pelo servidor (anti path-traversal).
    const fileKey = file ? `${randomUUID()}.pdf` : null;
    const fileHash = file ? createHash('sha256').update(file.buffer).digest('hex') : null;
    const pageCount = file ? await this.countPages(file.buffer) : null;
    if (file && fileKey) await this.storage.upload(ctx.slug, fileKey, file.buffer);

    const sql = this.db.tenant(ctx.schemaName);
    const f = fields as Record<string, unknown>;
    const originalName = file
      ? file.originalname.slice(0, 255)
      : `Aguardando arquivo${f.docCaixa ? ` — ${f.docCaixa}` : ''}`.slice(0, 255);
    const rows = await sql<DocRow[]>`
      INSERT INTO documents (
        module, subtype, doc_caixa, empenho, credor, historico, descricao,
        budget_unit_id, orgao_id, document_type_id, document_date, value, competencia,
        exercicio, banco, agencia, conta,
        original_name, file_key, file_size, file_hash, paginas, status, created_by
      ) VALUES (
        ${fields.module},
        ${(f.subtype as string) ?? null},
        ${(f.docCaixa as string) ?? null},
        ${(f.empenho as string) ?? null},
        ${(f.credor as string) ?? null},
        ${(f.historico as string) ?? null},
        ${(f.descricao as string) ?? null},
        ${(f.budgetUnitId as string) ?? null},
        ${(f.orgaoId as string) ?? null},
        ${(f.documentTypeId as string) ?? null},
        ${f.documentDate ? (f.documentDate as Date) : null},
        ${f.value === undefined ? null : (f.value as number)},
        ${(f.competencia as string) ?? null},
        ${fields.exercicio},
        ${(f.banco as string) ?? null},
        ${(f.agencia as string) ?? null},
        ${(f.conta as string) ?? null},
        ${originalName},
        ${fileKey},
        ${file ? file.size : null},
        ${fileHash},
        ${pageCount},
        ${file ? 'disponivel' : 'aguardando_arquivo'},
        ${user.sub}
      )
      RETURNING id, module, subtype, doc_caixa, empenho, credor, historico, descricao,
                budget_unit_id, NULL AS budget_unit_nome,
                orgao_id, NULL AS orgao_codigo, NULL AS orgao_nome,
                document_type_id, NULL AS document_type_nome,
                document_date, value, competencia, exercicio, banco, agencia, conta,
                original_name, file_key, file_size, file_hash, paginas, status, criado_em, deleted_at,
                conferencia_status, conferencia_resultado, conferencia_erro, conferencia_verificada_em
    `;

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_created',
      resourceType: 'document',
      resourceId: rows[0]?.id,
      ip,
      metadata: { module: fields.module, fileKey, fileHash, size: file?.size ?? null },
    });

    // Se o PDF contem assinatura, valida em background (integridade + cadeia + revogacao).
    const documentId = rows[0]?.id;
    if (documentId && file && fileKey && hasSignature(file.buffer)) {
      await this.signature.enqueueValidation({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId,
        fileKey,
      });
    }

    return toView(rows[0] as DocRow);
  }

  /**
   * Busca as ETIQUETAS (documentos importados sem PDF, status aguardando_arquivo)
   * de um modulo com o doc de caixa informado. Usado pela Pasta Monitorada pra
   * casar cada PDF (nomeado pelo doc de caixa) com a etiqueta certa. Pode voltar
   * 0 (sem etiqueta), 1, ou varias (o usuario escolhe qual, pelo empenho/valor).
   */
  async findEtiquetasByDocCaixa(
    user: TenantAccessClaims,
    module: DocModule,
    docCaixa: string,
  ): Promise<EtiquetaCandidate[]> {
    const ctx = requireTenantContext();
    this.assertPermission(user, module, 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<
      Array<{
        id: string;
        doc_caixa: string | null;
        empenho: string | null;
        credor: string | null;
        subtype: string | null;
        document_date: Date | null;
        value: string | number | null;
      }>
    >`
      SELECT id, doc_caixa, empenho, credor, subtype, document_date, value
      FROM documents
      WHERE module = ${module}
        AND status = 'aguardando_arquivo'
        AND deleted_at IS NULL
        AND doc_caixa = ${docCaixa}
      ORDER BY document_date ASC NULLS LAST, value ASC NULLS LAST, id ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      docCaixa: r.doc_caixa,
      empenho: r.empenho,
      credor: r.credor,
      subtype: r.subtype,
      documentDate: r.document_date ? r.document_date.toISOString().slice(0, 10) : null,
      value: r.value === null ? null : Number(r.value),
    }));
  }

  /**
   * Lista as ETIQUETAS de um modulo ainda sem PDF (aguardando_arquivo). Usado
   * pelo painel da Pasta Monitorada pra mostrar quais despesas ainda faltam
   * arquivo. Itens limitados a 500 (o total real vem separado).
   */
  async listEtiquetasPendentes(
    user: TenantAccessClaims,
    module: DocModule,
  ): Promise<EtiquetasPendentesResult> {
    const ctx = requireTenantContext();
    this.assertPermission(user, module, 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<
      Array<{
        id: string;
        doc_caixa: string | null;
        empenho: string | null;
        credor: string | null;
        subtype: string | null;
        document_date: Date | null;
        value: string | number | null;
      }>
    >`
      SELECT id, doc_caixa, empenho, credor, subtype, document_date, value
      FROM documents
      WHERE module = ${module} AND status = 'aguardando_arquivo' AND deleted_at IS NULL
      ORDER BY doc_caixa ASC NULLS LAST, document_date ASC NULLS LAST, id ASC
      LIMIT 500
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM documents
      WHERE module = ${module} AND status = 'aguardando_arquivo' AND deleted_at IS NULL
    `;
    return {
      total: Number(totalRows[0]?.total ?? 0),
      items: rows.map((r) => ({
        id: r.id,
        docCaixa: r.doc_caixa,
        empenho: r.empenho,
        credor: r.credor,
        subtype: r.subtype,
        documentDate: r.document_date ? r.document_date.toISOString().slice(0, 10) : null,
        value: r.value === null ? null : Number(r.value),
      })),
    };
  }

  /**
   * Dispara a conferencia por IA para os documentos selecionados (botao
   * "Analisar Doc (IA)" — sob demanda, para o usuario controlar o gasto de
   * tokens em vez de rodar automatico em todo anexo). So elegiveis: modulo
   * despesas, com arquivo anexado (status disponivel). Reseta o status pra
   * 'pendente' na hora (feedback visual imediato: o selo vira "carregando").
   */
  async analisarConferencia(user: TenantAccessClaims, ids: string[]): Promise<AnalisarConferenciaResult> {
    const ctx = requireTenantContext();
    this.assertPermission(user, 'despesas', 'update');
    if (!this.conferencia.isEnabled()) {
      throw new BadRequestException('Conferencia por IA nao esta configurada neste ambiente.');
    }

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<
      Array<{
        id: string;
        status: string;
        file_key: string | null;
        doc_caixa: string | null;
        empenho: string | null;
        credor: string | null;
        value: string | null;
      }>
    >`
      SELECT id, status, file_key, doc_caixa, empenho, credor, value
      FROM documents
      WHERE id = ANY(${ids}) AND deleted_at IS NULL AND module = 'despesas'
    `;
    const elegiveis = rows.filter((r) => r.status === 'disponivel' && r.file_key);
    if (elegiveis.length === 0) return { enqueued: [], skipped: rows.length };

    const enqueuedIds = elegiveis.map((r) => r.id);
    await sql`
      UPDATE documents SET
        conferencia_status = 'pendente',
        conferencia_resultado = NULL,
        conferencia_erro = NULL,
        conferencia_verificada_em = NULL
      WHERE id = ANY(${enqueuedIds})
    `;
    for (const r of elegiveis) {
      await this.conferencia.enqueueConferencia({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId: r.id,
        fileKey: r.file_key as string,
        docCaixa: r.doc_caixa,
        empenho: r.empenho,
        credor: r.credor,
        value: r.value === null ? null : Number(r.value),
      });
    }
    return { enqueued: enqueuedIds, skipped: rows.length - elegiveis.length };
  }

  /**
   * Cancela um lote de conferencia em andamento (botao "Cancelar" no painel
   * central de progresso). Remove da fila os jobs que ainda nao comecaram
   * (economiza o custo) e volta o status desses pra null — os que ja estavam
   * em andamento terminam normalmente e gravam o resultado real ao concluir.
   */
  async cancelarConferencia(user: TenantAccessClaims, ids: string[]): Promise<{ cancelados: number }> {
    const ctx = requireTenantContext();
    this.assertPermission(user, 'despesas', 'update');
    const cancelados = await this.conferencia.cancelarPendentes(ids);
    const sql = this.db.tenant(ctx.schemaName);
    await sql`
      UPDATE documents SET conferencia_status = NULL, conferencia_verificada_em = NULL
      WHERE id = ANY(${ids}) AND deleted_at IS NULL AND module = 'despesas' AND conferencia_status = 'pendente'
    `;
    return { cancelados };
  }

  /** Status atual da conferencia de um lote (polling da barra de progresso + lista de falhas). */
  async statusConferencia(user: TenantAccessClaims, ids: string[]): Promise<ConferenciaStatusItem[]> {
    const ctx = requireTenantContext();
    this.assertPermission(user, 'despesas', 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<
      Array<{
        id: string;
        doc_caixa: string | null;
        credor: string | null;
        conferencia_status: ConferenciaStatus | null;
        conferencia_erro: string | null;
      }>
    >`
      SELECT id, doc_caixa, credor, conferencia_status, conferencia_erro FROM documents
      WHERE id = ANY(${ids}) AND deleted_at IS NULL AND module = 'despesas'
    `;
    return rows.map((r) => ({
      id: r.id,
      docCaixa: r.doc_caixa,
      credor: r.credor,
      conferenciaStatus: r.conferencia_status,
      conferenciaErro: r.conferencia_erro,
    }));
  }

  /**
   * Relatorio em PDF ("Críticas") com os documentos divergentes/com falha na
   * conferencia por IA — aberto pelo botao "Abrir Críticas" apos um lote de
   * analise com problemas. So lista o que ja esta gravado no banco (nao
   * confia em nada vindo do cliente alem dos ids a filtrar).
   */
  async gerarRelatorioCriticas(user: TenantAccessClaims, ids: string[]): Promise<Buffer> {
    const ctx = requireTenantContext();
    this.assertPermission(user, 'despesas', 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<
      Array<{
        doc_caixa: string | null;
        empenho: string | null;
        credor: string | null;
        value: string | null;
        conferencia_status: ConferenciaStatus | null;
        conferencia_resultado: ConferenciaResultado | string | null;
        conferencia_erro: string | null;
      }>
    >`
      SELECT doc_caixa, empenho, credor, value, conferencia_status, conferencia_resultado, conferencia_erro
      FROM documents
      WHERE id = ANY(${ids}) AND deleted_at IS NULL AND module = 'despesas'
        AND conferencia_status IN ('divergente', 'falha')
      ORDER BY doc_caixa ASC NULLS LAST
    `;

    return new Promise((resolve, reject) => {
      const doc = new PDFKitDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).font('Helvetica-Bold').text('CRÍTICAS DA CONFERÊNCIA POR IA', { align: 'center' });
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(`Gerado em ${new Date().toLocaleString('pt-BR')} — ${rows.length} documento(s)`, {
          align: 'center',
        });
      doc.moveDown(1.5);

      if (rows.length === 0) {
        doc.fontSize(11).text('Nenhuma divergência ou falha encontrada neste lote.');
      }

      for (const r of rows) {
        const resultado =
          typeof r.conferencia_resultado === 'string'
            ? (JSON.parse(r.conferencia_resultado) as ConferenciaResultado)
            : r.conferencia_resultado;
        const valorFmt =
          r.value === null ? '—' : Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const statusLabel = r.conferencia_status === 'divergente' ? 'DIVERGENTE' : 'FALHA NA ANÁLISE';

        doc.fontSize(11).font('Helvetica-Bold').text(`Doc. Caixa ${r.doc_caixa ?? '—'} — ${r.credor ?? '—'}`);
        doc
          .fontSize(9)
          .font('Helvetica')
          .text(`Empenho: ${r.empenho ?? '—'}    Valor: ${valorFmt}    Status: ${statusLabel}`);

        if (r.conferencia_status === 'divergente' && resultado) {
          doc.fontSize(9).text(`Resumo: ${resultado.resumo}`);
          for (const d of resultado.divergencias) {
            doc.text(`  •  ${d.campo}: esperado "${d.esperado ?? '—'}", encontrado "${d.encontrado ?? '—'}"`);
          }
        } else if (r.conferencia_erro) {
          doc.fontSize(9).text(`Motivo: ${r.conferencia_erro}`);
        }

        doc.moveDown(0.6);
        doc
          .moveTo(50, doc.y)
          .lineTo(560, doc.y)
          .strokeColor('#dddddd')
          .stroke();
        doc.moveDown(0.6);
      }

      doc.end();
    });
  }

  /**
   * Relatorio em PDF ("Imprimir Etiquetas") com TODOS os documentos que
   * batem com os filtros da tela (mesmo WHERE do search(), sem paginacao) —
   * respeita exatamente o que o usuario esta vendo (ou tudo, sem filtro).
   */
  async gerarRelatorioEtiquetas(user: TenantAccessClaims, q: SearchDocumentsQuery): Promise<Buffer> {
    const ctx = requireTenantContext();
    this.assertPermission(user, q.module, 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const where = this.buildSearchWhere(sql, q);
    const orderBy = {
      data_desc: 'd.document_date DESC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      data_asc: 'd.document_date ASC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      valor_desc: 'd.value DESC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      valor_asc: 'd.value ASC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      criado_desc: 'd.criado_em DESC',
    }[q.sort];

    const rows = await sql<
      Array<{
        document_date: Date | null;
        doc_caixa: string | null;
        empenho: string | null;
        credor: string | null;
        value: string | null;
        status: string;
        conferencia_status: ConferenciaStatus | null;
      }>
    >`
      SELECT d.document_date, d.doc_caixa, d.empenho, d.credor, d.value, d.status, d.conferencia_status
      FROM documents d
      WHERE ${where}
      ORDER BY ${sql.unsafe(orderBy)}
    `;

    return new Promise((resolve, reject) => {
      const doc = new PDFKitDocument({ margin: 40, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const colData = 40;
      const colDocCaixa = 105;
      const colEmpenho = 200;
      const colCredor = 300;
      const colValor = 580;
      const colStatus = 680;
      const pageBottom = doc.page.height - doc.page.margins.bottom;

      const header = (): void => {
        doc.fontSize(14).font('Helvetica-Bold').text('RELATÓRIO DE ETIQUETAS — DESPESAS', { align: 'center' });
        doc
          .fontSize(8)
          .font('Helvetica')
          .text(`Gerado em ${new Date().toLocaleString('pt-BR')} — ${rows.length} documento(s)`, {
            align: 'center',
          });
        doc.moveDown(1);
        doc.font('Helvetica-Bold').fontSize(8);
        const y = doc.y;
        doc.text('Data', colData, y, { width: 60 });
        doc.text('Doc. Caixa', colDocCaixa, y, { width: 85 });
        doc.text('Empenho', colEmpenho, y, { width: 95 });
        doc.text('Credor', colCredor, y, { width: 270 });
        doc.text('Valor', colValor, y, { width: 90, align: 'right' });
        doc.text('Status', colStatus, y, { width: 100 });
        doc.moveDown(0.4);
        doc.moveTo(colData, doc.y).lineTo(800, doc.y).strokeColor('#999999').stroke();
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(8);
      };

      header();
      for (const r of rows) {
        if (doc.y > pageBottom - 20) {
          doc.addPage();
          header();
        }
        const y = doc.y;
        const dataFmt = r.document_date ? new Date(r.document_date).toLocaleDateString('pt-BR') : '—';
        const valorFmt =
          r.value === null ? '—' : Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const statusLabel = r.status === 'disponivel' ? 'Com PDF' : 'Sem PDF';
        const criticaLabel =
          r.conferencia_status === 'divergente'
            ? ' · Divergente'
            : r.conferencia_status === 'falha'
              ? ' · Falha'
              : '';
        doc.text(dataFmt, colData, y, { width: 60 });
        doc.text(r.doc_caixa ?? '—', colDocCaixa, y, { width: 85 });
        doc.text(r.empenho ?? '—', colEmpenho, y, { width: 95 });
        doc.text(r.credor ?? '—', colCredor, y, { width: 270 });
        doc.text(valorFmt, colValor, y, { width: 90, align: 'right' });
        doc.text(`${statusLabel}${criticaLabel}`, colStatus, y, { width: 100 });
        doc.moveDown(0.5);
      }

      doc.end();
    });
  }

  /** Anexa o PDF a uma etiqueta (documento importado sem arquivo, status aguardando_arquivo). */
  async attachFile(
    user: TenantAccessClaims,
    id: string,
    file: { buffer: Buffer; originalname: string; size: number },
    ip: string,
  ): Promise<DocumentView> {
    const ctx = requireTenantContext();
    const row = await this.getRow(id);
    this.assertPermission(user, row.module, 'update');

    if (file.size < 5 || !file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
      throw new BadRequestException('Arquivo invalido: apenas PDF e aceito');
    }
    const env = loadEnv();
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(`Arquivo excede o limite de ${env.MAX_UPLOAD_MB} MB`);
    }

    // Quota desconta o arquivo antigo (se houver): esta chamada pode ser uma
    // substituicao, nao so um primeiro anexo.
    const quotaBytes = ctx.quotaDiscoMb * 1024 * 1024;
    const uso = await this.usageBytes();
    const usoSemArquivoAtual = uso - Number(row.file_size ?? 0);
    if (usoSemArquivoAtual + file.size > quotaBytes) {
      throw new ForbiddenException(
        'Quota de disco do orgao atingida. Contate a JEOS para ampliar o plano.',
      );
    }

    const oldFileKey = row.file_key;
    const fileKey = `${randomUUID()}.pdf`;
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const pageCount = await this.countPages(file.buffer);
    await this.storage.upload(ctx.slug, fileKey, file.buffer);

    const sql = this.db.tenant(ctx.schemaName);
    await sql`
      UPDATE documents SET
        original_name = ${file.originalname.slice(0, 255)},
        file_key = ${fileKey},
        file_size = ${file.size},
        file_hash = ${fileHash},
        paginas = ${pageCount},
        status = 'disponivel',
        atualizado_em = now(),
        -- o veredito antigo era sobre o PDF anterior; substituir o arquivo
        -- sem limpar isso deixaria um selo verde/laranja mentiroso ate o
        -- usuario clicar em "Analisar Doc (IA)" de novo.
        conferencia_status = NULL,
        conferencia_resultado = NULL,
        conferencia_erro = NULL,
        conferencia_verificada_em = NULL
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    if (oldFileKey) await this.storage.delete(ctx.slug, oldFileKey);

    await this.audit.logTenant({
      actorId: user.sub,
      action: oldFileKey ? 'document_file_replaced' : 'document_file_attached',
      resourceType: 'document',
      resourceId: id,
      ip,
      metadata: { module: row.module, fileKey, fileHash, size: file.size },
    });

    if (hasSignature(file.buffer)) {
      await this.signature.enqueueValidation({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId: id,
        fileKey,
      });
    }

    // Conferencia por IA e sob demanda (botao "Analisar Doc (IA)"), nao roda
    // automatico no anexo — controla o custo de tokens. Ver analisarConferencia().

    return this.get(user, id);
  }

  /** Remove o PDF anexado, voltando o documento para aguardando_arquivo (etiqueta). */
  async removeFile(user: TenantAccessClaims, id: string, ip: string): Promise<DocumentView> {
    const ctx = requireTenantContext();
    const row = await this.getRow(id);
    this.assertPermission(user, row.module, 'update');
    if (!row.file_key) {
      throw new BadRequestException('Documento nao possui arquivo anexado');
    }

    const sql = this.db.tenant(ctx.schemaName);
    await sql`
      UPDATE documents SET
        file_key = NULL,
        file_size = NULL,
        file_hash = NULL,
        paginas = NULL,
        status = 'aguardando_arquivo',
        atualizado_em = now(),
        -- sem isso, o selo (verde/laranja) continuaria mostrando o veredito
        -- do arquivo que nao existe mais — abrindo brecha pro usuario tirar
        -- um PDF divergente e deixar o documento "aparentando" conforme.
        conferencia_status = NULL,
        conferencia_resultado = NULL,
        conferencia_erro = NULL,
        conferencia_verificada_em = NULL
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    await this.storage.delete(ctx.slug, row.file_key);

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_file_removed',
      resourceType: 'document',
      resourceId: id,
      ip,
      metadata: { module: row.module, fileKey: row.file_key },
    });

    return this.get(user, id);
  }

  /**
   * WHERE compartilhado por search() e gerarRelatorioEtiquetas() — garante
   * que o relatorio impresso respeite exatamente os mesmos filtros da tela
   * (nunca duplicar essa logica).
   */
  private buildSearchWhere(sql: Sql, q: SearchDocumentsQuery) {
    const text = q.q ? `%${q.q}%` : null;
    return sql`
      d.module = ${q.module} AND d.deleted_at IS NULL
      AND (${text}::text IS NULL OR d.credor ILIKE ${text} OR d.historico ILIKE ${text}
           OR d.descricao ILIKE ${text} OR d.empenho ILIKE ${text} OR d.doc_caixa ILIKE ${text}
           OR d.original_name ILIKE ${text})
      AND (${q.subtype ?? null}::varchar IS NULL OR d.subtype = ${q.subtype ?? null})
      AND (${q.exercicio ?? null}::int IS NULL OR d.exercicio = ${q.exercicio ?? null})
      AND (${q.competencia ?? null}::varchar IS NULL OR d.competencia = ${q.competencia ?? null})
      AND (${q.budgetUnitId ?? null}::uuid IS NULL OR d.budget_unit_id = ${q.budgetUnitId ?? null})
      AND (${q.orgaoId ?? null}::uuid IS NULL OR d.orgao_id = ${q.orgaoId ?? null})
      AND (${q.credor ?? null}::text IS NULL OR d.credor ILIKE ${q.credor ? `%${q.credor}%` : null})
      AND (${q.empenho ?? null}::varchar IS NULL OR d.empenho = ${q.empenho ?? null})
      AND (${q.de ?? null}::date IS NULL OR d.document_date >= ${q.de ?? null})
      AND (${q.ate ?? null}::date IS NULL OR d.document_date <= ${q.ate ?? null})
      AND (${q.valorMin ?? null}::numeric IS NULL OR d.value >= ${q.valorMin ?? null})
      AND (${q.valorMax ?? null}::numeric IS NULL OR d.value <= ${q.valorMax ?? null})
      AND (${q.comArquivo ?? null}::varchar IS NULL
           OR (${q.comArquivo ?? null} = 'sim' AND d.status = 'disponivel')
           OR (${q.comArquivo ?? null} = 'nao' AND d.status = 'aguardando_arquivo'))
      AND (${q.critica ?? null}::varchar IS NULL
           OR (${q.critica ?? null} = 'sim' AND d.conferencia_status IN ('divergente', 'falha'))
           OR (${q.critica ?? null} = 'nao'
               AND (d.conferencia_status IS NULL OR d.conferencia_status NOT IN ('divergente', 'falha'))))
    `;
  }

  async search(user: TenantAccessClaims, q: SearchDocumentsQuery): Promise<DocumentPage> {
    const ctx = requireTenantContext();
    this.assertPermission(user, q.module, 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (q.page - 1) * q.pageSize;

    // Ordem estavel: data (ou valor) como chave primaria + doc_caixa como desempate,
    // para que anexar um PDF (que nao altera data/doc_caixa) nunca mude a posicao da linha.
    const orderBy = {
      data_desc: 'd.document_date DESC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      data_asc: 'd.document_date ASC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      valor_desc: 'd.value DESC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      valor_asc: 'd.value ASC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      criado_desc: 'd.criado_em DESC',
    }[q.sort];

    const where = this.buildSearchWhere(sql, q);

    const items = await sql<DocRow[]>`
      SELECT d.id, d.module, d.subtype, d.doc_caixa, d.empenho, d.credor, d.historico, d.descricao,
             d.budget_unit_id, bu.nome AS budget_unit_nome,
             d.orgao_id, o.codigo AS orgao_codigo, o.descricao AS orgao_nome,
             d.document_type_id, dt.nome AS document_type_nome,
             d.document_date, d.value, d.competencia, d.exercicio,
             d.banco, d.agencia, d.conta,
             d.original_name, d.file_key, d.file_size, d.file_hash, d.paginas, d.status,
             d.criado_em, d.deleted_at,
             d.conferencia_status, d.conferencia_resultado, d.conferencia_erro, d.conferencia_verificada_em
      FROM documents d
      LEFT JOIN budget_units bu ON bu.id = d.budget_unit_id
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      WHERE ${where}
      ORDER BY ${sql.unsafe(orderBy)}
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM documents d WHERE ${where}
    `;

    return {
      items: items.map(toView),
      total: Number(totalRows[0]?.total ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  private async getRow(id: string, includeDeleted = false): Promise<DocRow> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<DocRow[]>`
      SELECT d.id, d.module, d.subtype, d.doc_caixa, d.empenho, d.credor, d.historico, d.descricao,
             d.budget_unit_id, bu.nome AS budget_unit_nome,
             d.orgao_id, o.codigo AS orgao_codigo, o.descricao AS orgao_nome,
             d.document_type_id, dt.nome AS document_type_nome,
             d.document_date, d.value, d.competencia, d.exercicio,
             d.banco, d.agencia, d.conta,
             d.original_name, d.file_key, d.file_size, d.file_hash, d.paginas, d.status,
             d.criado_em, d.deleted_at,
             d.conferencia_status, d.conferencia_resultado, d.conferencia_erro, d.conferencia_verificada_em
      FROM documents d
      LEFT JOIN budget_units bu ON bu.id = d.budget_unit_id
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      WHERE d.id = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Documento nao encontrado');
    if (!includeDeleted && row.deleted_at) throw new NotFoundException('Documento nao encontrado');
    return row;
  }

  async get(user: TenantAccessClaims, id: string): Promise<DocumentView> {
    const row = await this.getRow(id);
    this.assertPermission(user, row.module, 'read');
    return toView(row);
  }

  /** Signed URL 60s — checagem de permissao + posse pelo tenant ANTES de assinar. */
  async signedUrl(user: TenantAccessClaims, id: string, ip: string): Promise<{ url: string }> {
    const ctx = requireTenantContext();
    const row = await this.getRow(id);
    this.assertPermission(user, row.module, 'read');
    if (!row.file_key) {
      throw new BadRequestException('Documento sem arquivo anexado (etiqueta aguardando PDF)');
    }
    const url = await this.storage.createSignedUrl(ctx.slug, row.file_key);
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_download_url',
      resourceType: 'document',
      resourceId: id,
      ip,
    });
    return { url };
  }

  async update(
    user: TenantAccessClaims,
    id: string,
    input: UpdateDocumentInput,
    ip: string,
  ): Promise<DocumentView> {
    const ctx = requireTenantContext();
    const row = await this.getRow(id);
    this.assertPermission(user, row.module, 'update');
    const sql = this.db.tenant(ctx.schemaName);

    await sql`
      UPDATE documents SET
        doc_caixa = ${input.docCaixa ?? row.doc_caixa},
        empenho = ${input.empenho ?? row.empenho},
        credor = ${input.credor ?? row.credor},
        subtype = ${input.subtype ?? row.subtype},
        historico = ${input.historico === undefined ? row.historico : input.historico},
        descricao = ${input.descricao ?? row.descricao},
        document_date = ${input.documentDate ?? row.document_date},
        value = ${input.value === undefined ? row.value : input.value},
        competencia = ${input.competencia ?? row.competencia},
        banco = ${input.banco ?? row.banco},
        agencia = ${input.agencia ?? row.agencia},
        conta = ${input.conta ?? row.conta},
        budget_unit_id = ${input.budgetUnitId === undefined ? row.budget_unit_id : input.budgetUnitId},
        orgao_id = ${input.orgaoId === undefined ? row.orgao_id : input.orgaoId},
        document_type_id = ${input.documentTypeId ?? row.document_type_id},
        exercicio = ${input.exercicio ?? row.exercicio},
        atualizado_em = now()
      WHERE id = ${id} AND deleted_at IS NULL
    `;

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_updated',
      resourceType: 'document',
      resourceId: id,
      ip,
      metadata: { changes: input as Record<string, unknown> },
    });
    return this.get(user, id);
  }

  /** Soft delete — documento vai pra lixeira (retencao 30 dias). Arquivo permanece. */
  async softDelete(user: TenantAccessClaims, id: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const row = await this.getRow(id);
    this.assertPermission(user, row.module, 'delete');
    const sql = this.db.tenant(ctx.schemaName);
    await sql`
      UPDATE documents SET deleted_at = now(), deleted_by = ${user.sub}
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_deleted',
      resourceType: 'document',
      resourceId: id,
      ip,
      metadata: { module: row.module, originalName: row.original_name },
    });
  }

  /** Apaga (soft delete) etiquetas de um modulo de uma vez.
   *  Por padrao restringe a quem ainda esta aguardando_arquivo (sem PDF);
   *  apenasSemArquivo=false amplia para qualquer status. orgaoId/subtype
   *  restringem por orgao e por tipo (orcamentaria/extraorcamentaria). */
  async deleteAllEtiquetas(
    user: TenantAccessClaims,
    module: DocModule,
    ip: string,
    orgaoId?: string,
    subtype?: string,
    apenasSemArquivo = true,
  ): Promise<number> {
    const ctx = requireTenantContext();
    this.assertPermission(user, module, 'delete');
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ id: string }>>`
      UPDATE documents SET deleted_at = now(), deleted_by = ${user.sub}
      WHERE module = ${module} AND deleted_at IS NULL
        AND (${apenasSemArquivo} = false OR status = 'aguardando_arquivo')
        AND (${orgaoId ?? null}::uuid IS NULL OR orgao_id = ${orgaoId ?? null})
        AND (${subtype ?? null}::varchar IS NULL OR subtype = ${subtype ?? null})
      RETURNING id
    `;
    if (rows.length > 0) {
      await this.audit.logTenant({
        actorId: user.sub,
        action: 'document_deleted',
        resourceType: 'document',
        ip,
        metadata: {
          module,
          bulk: true,
          count: rows.length,
          orgaoId: orgaoId ?? null,
          subtype: subtype ?? null,
          apenasSemArquivo,
        },
      });
    }
    return rows.length;
  }

  /** Apaga (soft delete) os documentos selecionados manualmente pelo usuario. */
  async bulkDelete(user: TenantAccessClaims, ids: string[], ip: string): Promise<number> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    if (ids.length === 0) return 0;

    const rows = await sql<Array<{ id: string; module: DocModule }>>`
      SELECT id, module FROM documents WHERE id = ANY(${ids}) AND deleted_at IS NULL
    `;
    if (rows.length === 0) return 0;
    for (const module of new Set(rows.map((r) => r.module))) {
      this.assertPermission(user, module, 'delete');
    }

    await sql`
      UPDATE documents SET deleted_at = now(), deleted_by = ${user.sub}
      WHERE id = ANY(${rows.map((r) => r.id)})
    `;

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_deleted',
      resourceType: 'document',
      ip,
      metadata: { bulk: true, count: rows.length, ids: rows.map((r) => r.id) },
    });
    return rows.length;
  }

  /** Monta um ZIP em memoria com os PDFs dos documentos selecionados (ignora os sem arquivo). */
  async bulkDownloadZip(user: TenantAccessClaims, ids: string[]): Promise<Buffer> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<
      Array<{ id: string; module: DocModule; file_key: string | null; original_name: string }>
    >`
      SELECT id, module, file_key, original_name FROM documents
      WHERE id = ANY(${ids}) AND deleted_at IS NULL
    `;
    if (rows.length === 0) throw new NotFoundException('Nenhum documento encontrado para os IDs informados');
    for (const module of new Set(rows.map((r) => r.module))) {
      this.assertPermission(user, module, 'read');
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('error', (err: Error) => reject(err));
    });

    const usedNames = new Set<string>();
    let included = 0;
    for (const row of rows) {
      if (!row.file_key) continue;
      try {
        const content = await this.storage.download(ctx.slug, row.file_key);
        let name = (row.original_name || `${row.id}.pdf`).trim();
        if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
        let finalName = name;
        let i = 1;
        while (usedNames.has(finalName)) {
          finalName = name.replace(/\.pdf$/i, `-${i}.pdf`);
          i++;
        }
        usedNames.add(finalName);
        archive.append(content, { name: finalName });
        included++;
      } catch {
        // arquivo ausente/corrompido — pula e segue com os demais.
      }
    }
    if (included === 0) {
      throw new BadRequestException('Nenhum dos documentos selecionados possui PDF anexado');
    }
    archive.finalize();
    await done;
    return Buffer.concat(chunks);
  }

  async restore(user: TenantAccessClaims, id: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const row = await this.getRow(id, true);
    if (!row.deleted_at) throw new BadRequestException('Documento nao esta na lixeira');
    this.assertPermission(user, row.module, 'update');
    const sql = this.db.tenant(ctx.schemaName);
    await sql`
      UPDATE documents SET deleted_at = NULL, deleted_by = NULL, atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_restored',
      resourceType: 'document',
      resourceId: id,
      ip,
    });
  }

  /** Lixeira: purga itens alem da retencao (arquivo + linha) e lista o restante. */
  async trash(user: TenantAccessClaims, q: TrashQuery): Promise<DocumentPage> {
    const ctx = requireTenantContext();
    if (q.module) this.assertPermission(user, q.module, 'read');
    const sql = this.db.tenant(ctx.schemaName);

    // Purge: retencao de 30 dias vencida = remocao definitiva.
    const expired = await sql<Array<{ id: string; file_key: string | null }>>`
      SELECT id, file_key FROM documents
      WHERE deleted_at IS NOT NULL
        AND deleted_at < now() - make_interval(days => ${TRASH_RETENTION_DAYS})
    `;
    for (const doc of expired) {
      if (doc.file_key) await this.storage.delete(ctx.slug, doc.file_key);
      await sql`DELETE FROM documents WHERE id = ${doc.id}`;
    }

    const offset = (q.page - 1) * q.pageSize;
    const rows = await sql<DocRow[]>`
      SELECT d.id, d.module, d.subtype, d.doc_caixa, d.empenho, d.credor, d.historico, d.descricao,
             d.budget_unit_id, bu.nome AS budget_unit_nome,
             d.orgao_id, o.codigo AS orgao_codigo, o.descricao AS orgao_nome,
             d.document_type_id, dt.nome AS document_type_nome,
             d.document_date, d.value, d.competencia, d.exercicio,
             d.banco, d.agencia, d.conta,
             d.original_name, d.file_key, d.file_size, d.file_hash, d.paginas, d.status,
             d.criado_em, d.deleted_at,
             d.conferencia_status, d.conferencia_resultado, d.conferencia_erro, d.conferencia_verificada_em
      FROM documents d
      LEFT JOIN budget_units bu ON bu.id = d.budget_unit_id
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      WHERE d.deleted_at IS NOT NULL
        AND (${q.module ?? null}::varchar IS NULL OR d.module = ${q.module ?? null})
      ORDER BY d.deleted_at DESC
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM documents d
      WHERE d.deleted_at IS NOT NULL
        AND (${q.module ?? null}::varchar IS NULL OR d.module = ${q.module ?? null})
    `;
    return {
      items: rows.map(toView),
      total: Number(totalRows[0]?.total ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Esvazia a lixeira: remove definitivamente (arquivo + linha) tudo que esta excluido,
   *  sem esperar a retencao. Se module for informado, restringe a esse modulo. */
  async emptyTrash(user: TenantAccessClaims, module: DocModule | undefined, ip: string): Promise<number> {
    const ctx = requireTenantContext();
    if (module) this.assertPermission(user, module, 'delete');
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string; module: DocModule; file_key: string | null }>>`
      SELECT id, module, file_key FROM documents
      WHERE deleted_at IS NOT NULL
        AND (${module ?? null}::varchar IS NULL OR module = ${module ?? null})
    `;
    if (rows.length === 0) return 0;

    if (!module) {
      for (const mod of new Set(rows.map((r) => r.module))) {
        this.assertPermission(user, mod, 'delete');
      }
    }

    for (const doc of rows) {
      if (doc.file_key) await this.storage.delete(ctx.slug, doc.file_key);
      await sql`DELETE FROM documents WHERE id = ${doc.id}`;
    }

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'trash_emptied',
      resourceType: 'document',
      ip,
      metadata: { module: module ?? null, count: rows.length },
    });
    return rows.length;
  }
}
