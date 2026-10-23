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
  type DocumentFileView,
  type DocumentPage,
  type DocumentView,
  type EtiquetaCandidate,
  type EtiquetasPendentesResult,
  type FaseArquivistica,
  type Metadados,
  type OcrStatus,
  sistemaDoModulo,
  camposMetadadosSchema,
  metadadosSchemaFor,
  type NivelAcesso,
  type GrauSigilo,
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
import { ArquivisticaService } from '../arquivistica/arquivistica.service';
import { OcrService } from '../ocr/ocr.service';
import { assertSistema } from '../common/sistema.guard';

const PDF_MAGIC = Buffer.from('%PDF');

/**
 * Reconhece data digitada na busca livre ("29/05", "29/05/2026", "5/6/26")
 * pra tambem filtrar por document_date, sem precisar abrir "Mais filtros".
 * Ano com 2 digitos assume 20XX (nao ha documentos do seculo passado aqui).
 */
function parseDateQuery(q: string | undefined): { day: number; month: number; year: number | null } | null {
  if (!q) return null;
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(q.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year: number | null = null;
  if (m[3]) {
    year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  }
  return { day, month, year };
}

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
  // Gestao arquivistica — opcionais porque nem toda query (ex.: relatorios) seleciona.
  classificacao_id?: string | null;
  classificacao_codigo?: string | null;
  classificacao_descricao?: string | null;
  fase?: FaseArquivistica;
  nivel_acesso?: NivelAcesso;
  grau_sigilo?: GrauSigilo | null;
  data_inicio_contagem?: Date | null;
  data_prevista_transferencia?: Date | null;
  data_prevista_destinacao?: Date | null;
  metadados?: Metadados | string | null;
  digitalizado?: boolean;
  responsavel_digitalizacao?: string | null;
  data_digitalizacao?: Date | null;
  local_digitalizacao?: string | null;
  ocr_status?: OcrStatus | null;
  possui_original_fisico?: boolean;
  local_fisico_id?: string | null;
  local_fisico_codigo?: string | null;
}

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

interface DocumentFileRow {
  id: string;
  document_id: string;
  original_name: string;
  file_size: string;
  paginas: number | null;
  assinatura_status: string;
  assinado_por: string | null;
  conferencia_status: ConferenciaStatus | null;
  conferencia_resultado: ConferenciaResultado | string | null;
  conferencia_erro: string | null;
  criado_em: Date;
}

function toFileView(r: DocumentFileRow): DocumentFileView {
  const conferenciaResultado =
    typeof r.conferencia_resultado === 'string'
      ? (JSON.parse(r.conferencia_resultado) as ConferenciaResultado)
      : r.conferencia_resultado;
  return {
    id: r.id,
    originalName: r.original_name,
    fileSize: Number(r.file_size),
    pageCount: r.paginas,
    assinaturaStatus: r.assinatura_status,
    assinadoPor: r.assinado_por,
    conferenciaStatus: r.conferencia_status,
    conferenciaResultado,
    conferenciaErro: r.conferencia_erro,
    criadoEm: r.criado_em.toISOString(),
  };
}

/** Paginas do documento = soma do principal + todos os extras (contagem null nao entra na soma). */
function sumPageCount(primary: number | null, arquivosExtras: DocumentFileView[]): number | null {
  const known = [primary, ...arquivosExtras.map((e) => e.pageCount)].filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

function toView(r: DocRow, arquivosExtras: DocumentFileView[] = []): DocumentView {
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
    pageCount: sumPageCount(r.paginas, arquivosExtras),
    status: r.status,
    criadoEm: r.criado_em.toISOString(),
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    conferenciaStatus: r.conferencia_status,
    conferenciaResultado: conferenciaResultado,
    conferenciaErro: r.conferencia_erro,
    conferenciaVerificadaEm: r.conferencia_verificada_em ? r.conferencia_verificada_em.toISOString() : null,
    arquivosExtras,
    classificacaoId: r.classificacao_id ?? null,
    classificacaoCodigo: r.classificacao_codigo ?? null,
    classificacaoDescricao: r.classificacao_descricao ?? null,
    fase: r.fase ?? 'corrente',
    nivelAcesso: r.nivel_acesso ?? 'publico',
    grauSigilo: r.grau_sigilo ?? null,
    dataInicioContagem: isoDate(r.data_inicio_contagem),
    dataPrevistaTransferencia: isoDate(r.data_prevista_transferencia),
    dataPrevistaDestinacao: isoDate(r.data_prevista_destinacao),
    metadados: (typeof r.metadados === 'string' ? (JSON.parse(r.metadados) as Metadados) : r.metadados) ?? {},
    digitalizado: r.digitalizado ?? false,
    responsavelDigitalizacao: r.responsavel_digitalizacao ?? null,
    dataDigitalizacao: isoDate(r.data_digitalizacao),
    localDigitalizacao: r.local_digitalizacao ?? null,
    ocrStatus: r.ocr_status ?? null,
    possuiOriginalFisico: r.possui_original_fisico ?? false,
    localFisicoId: r.local_fisico_id ?? null,
    localFisicoCodigo: r.local_fisico_codigo ?? null,
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
    private readonly arquivistica: ArquivisticaService,
    private readonly ocr: OcrService,
  ) {}

  /**
   * Documento transferido/recolhido/eliminado e registro oficial da gestao
   * arquivistica: sai do acervo so pelo fluxo legal de eliminacao, nunca pela lixeira.
   */
  private assertExcluivel(rows: Array<{ fase?: string }>): void {
    if (rows.some((r) => r.fase && r.fase !== 'corrente')) {
      throw new BadRequestException(
        'Documento fora da fase corrente (transferido, recolhido ou eliminado) nao pode ser excluido. Use o fluxo de eliminacao da Temporalidade.',
      );
    }
  }

  /** Documento juntado a dossie/processo nao vai para a lixeira: primeiro o desentranhamento (com motivo). */
  private async assertForaDeDossie(ids: string[]): Promise<void> {
    const sql = this.db.tenant(requireTenantContext().schemaName);
    const em = await sql<Array<{ numero: string }>>`
      SELECT ds.numero FROM dossie_documentos dd JOIN dossies ds ON ds.id = dd.dossie_id WHERE dd.document_id = ANY(${ids}::uuid[]) LIMIT 1
    `;
    if (em[0]) {
      throw new BadRequestException(`Documento juntado ao dossiê/processo ${em[0].numero}: faça o desentranhamento antes de excluir.`);
    }
  }

  /** Documento eliminado (Termo de Eliminacao) e registro historico imutavel: so leitura dos metadados. */
  private assertNaoEliminado(row: { fase?: string }): void {
    if (row.fase === 'eliminado') {
      throw new BadRequestException('Documento eliminado pelo fluxo de temporalidade: registro somente leitura');
    }
  }

  /** Documento restrito (dados pessoais/sigilo): so admin ou quem tem acervo_restrito:read. */
  private podeVerRestrito(user: TenantAccessClaims): boolean {
    return user.role === 'admin' || user.permissions.includes('acervo_restrito:read');
  }

  /** getRow + nivel de acesso. Restrito sem permissao = 404 (nao revela que o documento existe). */
  private async getRowFor(user: TenantAccessClaims, id: string, includeDeleted = false): Promise<DocRow> {
    const row = await this.getRow(id, includeDeleted);
    if (row.nivel_acesso === 'restrito' && !this.podeVerRestrito(user)) {
      throw new NotFoundException('Documento nao encontrado');
    }
    return row;
  }

  /** Tipo documental do Acervo: valida tipo e metadados contra os campos definidos nele. */
  private async validarTipoAcervo(
    sql: Sql,
    documentTypeId: string | null,
    metadados: Metadados | undefined,
  ): Promise<{ metadados: Metadados; classificacaoId: string | null; nivelAcessoPadrao: NivelAcesso }> {
    const rows = documentTypeId
      ? await sql<
          Array<{
            campos: unknown;
            classificacao_id: string | null;
            nivel_acesso_padrao: NivelAcesso;
            modulo: string;
            ativo: boolean;
          }>
        >`SELECT campos, classificacao_id, nivel_acesso_padrao, modulo, ativo FROM document_types WHERE id = ${documentTypeId}`
      : [];
    const t = rows[0];
    if (!t || !t.ativo || t.modulo !== 'acervo') {
      throw new BadRequestException('Tipo de documento invalido para o Acervo');
    }
    const campos = camposMetadadosSchema.parse(typeof t.campos === 'string' ? JSON.parse(t.campos) : t.campos);
    const parsed = metadadosSchemaFor(campos).safeParse(metadados ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const limpos = Object.fromEntries(
      Object.entries(parsed.data as Record<string, string | undefined>).filter(([, v]) => v !== undefined),
    ) as Metadados;
    return { metadados: limpos, classificacaoId: t.classificacao_id, nivelAcessoPadrao: t.nivel_acesso_padrao };
  }

  /**
   * RBAC dinamico por modulo (rotas compartilham handler; permissao depende
   * do modulo do documento). admin passa; demais exigem `${module}:${action}`.
   */
  assertPermission(user: TenantAccessClaims, module: DocModule, action: string): void {
    // Modulo do documento precisa estar contratado pelo orgao (vale ate para admin).
    assertSistema(sistemaDoModulo(module));
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
    // Acervo: valida tipo + metadados ANTES de gravar arquivo (erro nao deixa PDF orfao no storage).
    const acervo =
      fields.module === 'acervo'
        ? await this.validarTipoAcervo(this.db.tenant(ctx.schemaName), fields.documentTypeId, fields.metadados)
        : null;

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
        original_name, file_key, file_size, file_hash, paginas, status, created_by,
        metadados, digitalizado, responsavel_digitalizacao, data_digitalizacao, local_digitalizacao
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
        ${user.sub},
        ${sql.json((acervo?.metadados ?? {}) as never)},
        ${(f.digitalizado as boolean | undefined) ?? false},
        ${(f.responsavelDigitalizacao as string | undefined) ?? null},
        ${(f.dataDigitalizacao as Date | undefined) ?? null},
        ${(f.localDigitalizacao as string | undefined) ?? null}
      )
      RETURNING id, module, subtype, doc_caixa, empenho, credor, historico, descricao,
                budget_unit_id, NULL AS budget_unit_nome,
                orgao_id, NULL AS orgao_codigo, NULL AS orgao_nome,
                document_type_id, NULL AS document_type_nome,
                document_date, value, competencia, exercicio, banco, agencia, conta,
                original_name, file_key, file_size, file_hash, paginas, status, criado_em, deleted_at,
                conferencia_status, conferencia_resultado, conferencia_erro, conferencia_verificada_em,
                classificacao_id, NULL AS classificacao_codigo, NULL AS classificacao_descricao,
                fase, nivel_acesso, grau_sigilo, data_inicio_contagem, data_prevista_transferencia, data_prevista_destinacao,
                metadados, digitalizado, responsavel_digitalizacao, data_digitalizacao, local_digitalizacao, ocr_status,
                possui_original_fisico, local_fisico_id, NULL AS local_fisico_codigo
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
        targetTable: 'documents',
        targetId: documentId,
        fileKey,
      });
    }
    // Indexa o conteudo para a busca (assincrono; no-op sem poppler no ambiente).
    if (documentId && fileKey) {
      await this.ocr.enqueue({ schemaName: ctx.schemaName, slug: ctx.slug, documentId, documentFileId: null, fileKey });
    }

    if (documentId) {
      await this.arquivistica.aplicarAoDocumento(documentId, {
        module: fields.module,
        classificacaoId: (f.classificacaoId as string | null | undefined) ?? acervo?.classificacaoId ?? undefined,
        // Acervo nasce restrito por padrao (dados pessoais/sigilo ate alguem decidir publicar);
        // os modulos financeiros seguem o default da coluna (publico).
        nivelAcesso:
          (f.nivelAcesso as NivelAcesso | undefined) ??
          acervo?.nivelAcessoPadrao ??
          (fields.module === 'acervo' ? 'restrito' : undefined),
        dataInicioContagem: f.dataInicioContagem as Date | null | undefined,
      });
      return toView(await this.getRow(documentId));
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
   * Analisa tambem os arquivos EXTRAS de cada documento selecionado (cada
   * PDF recebe seu proprio veredito) — mesmo gatilho unico (o botao), varios
   * resultados.
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

    const extras = await sql<Array<{ id: string; document_id: string; file_key: string }>>`
      SELECT id, document_id, file_key FROM document_files WHERE document_id = ANY(${ids})
    `;

    if (elegiveis.length === 0 && extras.length === 0) return { enqueued: [], skipped: rows.length };

    const enqueuedIds = [...elegiveis.map((r) => r.id), ...extras.map((e) => e.id)];
    if (elegiveis.length > 0) {
      await sql`
        UPDATE documents SET
          conferencia_status = 'pendente',
          conferencia_resultado = NULL,
          conferencia_erro = NULL,
          conferencia_verificada_em = NULL
        WHERE id = ANY(${elegiveis.map((r) => r.id)})
      `;
    }
    if (extras.length > 0) {
      await sql`
        UPDATE document_files SET
          conferencia_status = 'pendente',
          conferencia_resultado = NULL,
          conferencia_erro = NULL,
          conferencia_verificada_em = NULL
        WHERE id = ANY(${extras.map((e) => e.id)})
      `;
    }
    for (const r of elegiveis) {
      await this.conferencia.enqueueConferencia({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId: r.id,
        targetTable: 'documents',
        targetId: r.id,
        fileKey: r.file_key as string,
        docCaixa: r.doc_caixa,
        empenho: r.empenho,
        credor: r.credor,
        value: r.value === null ? null : Number(r.value),
      });
    }
    for (const e of extras) {
      // A etiqueta (doc caixa/empenho/credor/valor) e sempre a do documento
      // "dono" — compara o EXTRA contra os mesmos dados esperados.
      const dono = rows.find((r) => r.id === e.document_id);
      await this.conferencia.enqueueConferencia({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId: e.document_id,
        targetTable: 'document_files',
        targetId: e.id,
        fileKey: e.file_key,
        docCaixa: dono?.doc_caixa ?? null,
        empenho: dono?.empenho ?? null,
        credor: dono?.credor ?? null,
        value: dono?.value === null || dono?.value === undefined ? null : Number(dono.value),
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
    await sql`
      UPDATE document_files SET conferencia_status = NULL, conferencia_verificada_em = NULL
      WHERE id = ANY(${ids}) AND conferencia_status = 'pendente'
    `;
    return { cancelados };
  }

  /** Status atual da conferencia de um lote (polling da barra de progresso + lista de falhas). */
  async statusConferencia(user: TenantAccessClaims, ids: string[]): Promise<ConferenciaStatusItem[]> {
    const ctx = requireTenantContext();
    this.assertPermission(user, 'despesas', 'read');
    const sql = this.db.tenant(ctx.schemaName);
    // ids pode misturar documentos "principais" e arquivos extras (mesmo
    // lote de "Analisar Doc (IA)") — os dois espacos de UUID nao colidem,
    // entao um UNION cobre ambos sem precisar saber de antemao qual e qual.
    const rows = await sql<
      Array<{
        id: string;
        doc_caixa: string | null;
        credor: string | null;
        conferencia_status: ConferenciaStatus | null;
        conferencia_erro: string | null;
      }>
    >`
      SELECT d.id, d.doc_caixa, d.credor, d.conferencia_status, d.conferencia_erro
      FROM documents d
      WHERE d.id = ANY(${ids}) AND d.deleted_at IS NULL AND d.module = 'despesas'
      UNION ALL
      SELECT df.id, dd.doc_caixa, dd.credor, df.conferencia_status, df.conferencia_erro
      FROM document_files df
      JOIN documents dd ON dd.id = df.document_id
      WHERE df.id = ANY(${ids}) AND dd.module = 'despesas'
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

    interface CriticaEntry {
      documentId: string;
      fileLabel: string;
      docCaixa: string | null;
      empenho: string | null;
      credor: string | null;
      value: string | null;
      status: ConferenciaStatus | null;
      resultado: ConferenciaResultado | string | null;
      erro: string | null;
    }

    const primaryRows = await sql<
      Array<{
        id: string;
        original_name: string;
        doc_caixa: string | null;
        empenho: string | null;
        credor: string | null;
        value: string | null;
        conferencia_status: ConferenciaStatus | null;
        conferencia_resultado: ConferenciaResultado | string | null;
        conferencia_erro: string | null;
      }>
    >`
      SELECT id, original_name, doc_caixa, empenho, credor, value, conferencia_status, conferencia_resultado, conferencia_erro
      FROM documents
      WHERE id = ANY(${ids}) AND deleted_at IS NULL AND module = 'despesas'
        AND conferencia_status IN ('divergente', 'falha')
    `;
    const extraRows = await sql<
      Array<{
        document_id: string;
        original_name: string;
        doc_caixa: string | null;
        empenho: string | null;
        credor: string | null;
        value: string | null;
        conferencia_status: ConferenciaStatus | null;
        conferencia_resultado: ConferenciaResultado | string | null;
        conferencia_erro: string | null;
      }>
    >`
      SELECT df.document_id, df.original_name, dd.doc_caixa, dd.empenho, dd.credor, dd.value,
             df.conferencia_status, df.conferencia_resultado, df.conferencia_erro
      FROM document_files df
      JOIN documents dd ON dd.id = df.document_id
      WHERE df.id = ANY(${ids}) AND dd.deleted_at IS NULL AND dd.module = 'despesas'
        AND df.conferencia_status IN ('divergente', 'falha')
    `;

    // Um documento pode ter mais de um arquivo com problema (principal + extras)
    // — agrupa por documento pra imprimir o cabecalho uma vez so e listar cada
    // arquivo com sua propria critica embaixo, igual aparece dentro da etiqueta.
    const byDocument = new Map<string, CriticaEntry[]>();
    for (const r of primaryRows) {
      const list = byDocument.get(r.id) ?? [];
      list.push({
        documentId: r.id,
        fileLabel: r.original_name,
        docCaixa: r.doc_caixa,
        empenho: r.empenho,
        credor: r.credor,
        value: r.value,
        status: r.conferencia_status,
        resultado: r.conferencia_resultado,
        erro: r.conferencia_erro,
      });
      byDocument.set(r.id, list);
    }
    for (const r of extraRows) {
      const list = byDocument.get(r.document_id) ?? [];
      list.push({
        documentId: r.document_id,
        fileLabel: r.original_name,
        docCaixa: r.doc_caixa,
        empenho: r.empenho,
        credor: r.credor,
        value: r.value,
        status: r.conferencia_status,
        resultado: r.conferencia_resultado,
        erro: r.conferencia_erro,
      });
      byDocument.set(r.document_id, list);
    }
    const groups = [...byDocument.values()].sort((a, b) => (a[0]!.docCaixa ?? '').localeCompare(b[0]!.docCaixa ?? ''));
    const totalDivergente = [...primaryRows, ...extraRows].filter((r) => r.conferencia_status === 'divergente').length;
    const totalFalha = [...primaryRows, ...extraRows].filter((r) => r.conferencia_status === 'falha').length;

    // Paleta alinhada com os selos do site (laranja=divergente, vermelho=falha,
    // azul=nome do campo) — mesmo balao colorido que aparece no hover da tela.
    const COLOR = {
      headerFrom: '#1e3a8a',
      headerTo: '#7c3aed',
      purple: '#7c3aed',
      blue: '#2563eb',
      orange: '#ea580c',
      red: '#dc2626',
      textStrong: '#111827',
      textBody: '#374151',
      textMuted: '#6b7280',
      divider: '#e5e7eb',
    };

    return new Promise((resolve, reject) => {
      const doc = new PDFKitDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width;
      const marginX = 50;
      const contentWidth = pageWidth - marginX * 2;
      const headerHeight = 74;

      const drawPageHeader = (): void => {
        const gradient = doc.linearGradient(0, 0, pageWidth, 0);
        gradient.stop(0, COLOR.headerFrom).stop(1, COLOR.headerTo);
        doc.rect(0, 0, pageWidth, headerHeight).fill(gradient);
        doc
          .fillColor('#ffffff')
          .fontSize(17)
          .font('Helvetica-Bold')
          .text('CRÍTICAS DA CONFERÊNCIA POR IA', marginX, 24, { align: 'center', width: contentWidth });
        const resumoPartes = [`${groups.length} documento(s)`];
        if (totalDivergente > 0) resumoPartes.push(`${totalDivergente} divergência(s)`);
        if (totalFalha > 0) resumoPartes.push(`${totalFalha} falha(s)`);
        doc
          .fillColor('#e0e7ff')
          .fontSize(9)
          .font('Helvetica')
          .text(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })} — ${resumoPartes.join(' · ')}`, marginX, 48, {
            align: 'center',
            width: contentWidth,
          });
        doc.fillColor(COLOR.textStrong);
        doc.y = headerHeight + 24;
      };

      drawPageHeader();
      doc.on('pageAdded', drawPageHeader);

      if (groups.length === 0) {
        doc.fontSize(11).fillColor(COLOR.textBody).text('Nenhuma divergência ou falha encontrada neste lote.', marginX);
      }

      for (const group of groups) {
        const first = group[0]!;
        const valorFmt =
          first.value === null
            ? '—'
            : Number(first.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        if (doc.y > doc.page.height - doc.page.margins.bottom - 130) doc.addPage();

        const groupTop = doc.y;
        doc.rect(marginX, groupTop + 2, 4, 16).fill(COLOR.purple);
        doc
          .fillColor(COLOR.textStrong)
          .fontSize(12)
          .font('Helvetica-Bold')
          .text(`Doc. Caixa ${first.docCaixa ?? '—'} — ${first.credor ?? '—'}`, marginX + 12, groupTop, {
            width: contentWidth - 12,
          });
        doc
          .fillColor(COLOR.textMuted)
          .fontSize(9)
          .font('Helvetica')
          .text(`Empenho: ${first.empenho ?? '—'}    Valor: ${valorFmt}`, marginX + 12);
        doc.moveDown(0.5);

        for (const entry of group) {
          const resultado =
            typeof entry.resultado === 'string'
              ? (JSON.parse(entry.resultado) as ConferenciaResultado)
              : entry.resultado;
          const isDivergente = entry.status === 'divergente';
          const statusColor = isDivergente ? COLOR.orange : COLOR.red;
          const statusLabel = isDivergente ? 'DIVERGENTE' : 'FALHA NA ANÁLISE';

          if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();

          doc
            .fontSize(9.5)
            .font('Helvetica-Bold')
            .fillColor(COLOR.textStrong)
            .text(`Arquivo: ${entry.fileLabel}`, marginX + 12, doc.y, { continued: true })
            .fillColor(statusColor)
            .text(`  ●  ${statusLabel}`);
          doc.font('Helvetica').fillColor(COLOR.textBody);

          if (isDivergente && resultado) {
            if (resultado.resumo) {
              doc
                .fontSize(8.5)
                .fillColor(COLOR.textMuted)
                .text(resultado.resumo, marginX + 12, doc.y, { width: contentWidth - 12 });
            }
            doc.moveDown(0.15);
            for (const d of resultado.divergencias) {
              doc
                .fontSize(8.5)
                .fillColor(COLOR.blue)
                .font('Helvetica-Bold')
                .text(`•  ${d.campo}`, marginX + 22, doc.y, { continued: true })
                .font('Helvetica')
                .fillColor(COLOR.textBody)
                .text(`: esperado `, { continued: true })
                .fillColor(COLOR.textMuted)
                .text(`"${d.esperado ?? '—'}"`, { continued: true })
                .fillColor(COLOR.textBody)
                .text(`, encontrado `, { continued: true })
                .fillColor(statusColor)
                .text(`"${d.encontrado ?? '—'}"`);
            }
          } else if (entry.erro) {
            doc
              .fontSize(8.5)
              .fillColor(COLOR.red)
              .text(`Motivo: ${entry.erro}`, marginX + 12, doc.y, { width: contentWidth - 12 });
          }
          doc.fillColor(COLOR.textStrong);
          doc.moveDown(0.5);
        }

        doc.moveDown(0.2);
        doc
          .moveTo(marginX, doc.y)
          .lineTo(pageWidth - marginX, doc.y)
          .strokeColor(COLOR.divider)
          .lineWidth(1)
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
    const where = this.buildSearchWhere(sql, q, user);
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
          .text(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })} — ${rows.length} documento(s)`, {
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
        const dataFmt = r.document_date ? new Date(r.document_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
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
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'update');
    this.assertNaoEliminado(row);

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
    if (oldFileKey) {
      await this.storage.delete(ctx.slug, oldFileKey);
      // Texto do PDF substituido sai da busca ja; o novo entra quando o job indexar.
      await sql`DELETE FROM document_textos WHERE document_id = ${id} AND document_file_id IS NULL`;
    }

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
        targetTable: 'documents',
        targetId: id,
        fileKey,
      });
    }
    await this.ocr.enqueue({ schemaName: ctx.schemaName, slug: ctx.slug, documentId: id, documentFileId: null, fileKey });

    // Conferencia por IA e sob demanda (botao "Analisar Doc (IA)"), nao roda
    // automatico no anexo — controla o custo de tokens. Ver analisarConferencia().

    return this.get(user, id);
  }

  /** Remove o PDF anexado, voltando o documento para aguardando_arquivo (etiqueta). */
  async removeFile(user: TenantAccessClaims, id: string, ip: string): Promise<DocumentView> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'update');
    this.assertNaoEliminado(row);
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
        conferencia_verificada_em = NULL,
        ocr_status = NULL,
        ocr_erro = NULL
      WHERE id = ${id} AND deleted_at IS NULL
    `;
    // Texto do arquivo removido nao pode continuar achavel na busca.
    await sql`DELETE FROM document_textos WHERE document_id = ${id} AND document_file_id IS NULL`;
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

  /** Anexa mais um PDF ao documento (alem do principal), sem substituir nada. */
  async addExtraFile(
    user: TenantAccessClaims,
    id: string,
    file: { buffer: Buffer; originalname: string; size: number },
    ip: string,
  ): Promise<DocumentView> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'update');
    this.assertNaoEliminado(row);

    if (file.size < 5 || !file.buffer.subarray(0, 4).equals(PDF_MAGIC)) {
      throw new BadRequestException('Arquivo invalido: apenas PDF e aceito');
    }
    const env = loadEnv();
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(`Arquivo excede o limite de ${env.MAX_UPLOAD_MB} MB`);
    }

    const quotaBytes = ctx.quotaDiscoMb * 1024 * 1024;
    const uso = await this.usageBytes();
    if (uso + file.size > quotaBytes) {
      throw new ForbiddenException(
        'Quota de disco do orgao atingida. Contate a JEOS para ampliar o plano.',
      );
    }

    const fileKey = `${randomUUID()}.pdf`;
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const pageCount = await this.countPages(file.buffer);
    await this.storage.upload(ctx.slug, fileKey, file.buffer);

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO document_files (
        document_id, file_key, original_name, file_size, file_hash, paginas, criado_por
      ) VALUES (
        ${id}, ${fileKey}, ${file.originalname.slice(0, 255)}, ${file.size}, ${fileHash}, ${pageCount}, ${user.sub}
      )
      RETURNING id
    `;
    const extraId = rows[0]!.id;

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_extra_file_attached',
      resourceType: 'document',
      resourceId: id,
      ip,
      metadata: { module: row.module, fileKey, fileHash, size: file.size, extraId },
    });

    if (hasSignature(file.buffer)) {
      await this.signature.enqueueValidation({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId: id,
        targetTable: 'document_files',
        targetId: extraId,
        fileKey,
      });
    }
    await this.ocr.enqueue({ schemaName: ctx.schemaName, slug: ctx.slug, documentId: id, documentFileId: extraId, fileKey });

    // Conferencia por IA e sob demanda (botao "Analisar Doc (IA)"), mesma
    // regra do arquivo principal — nao dispara sozinho ao anexar.

    return this.get(user, id);
  }

  /** Remove um arquivo extra especifico (nao o principal). */
  async removeExtraFile(user: TenantAccessClaims, id: string, extraId: string, ip: string): Promise<DocumentView> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'update');
    this.assertNaoEliminado(row);

    const sql = this.db.tenant(ctx.schemaName);
    const extraRows = await sql<Array<{ file_key: string }>>`
      SELECT file_key FROM document_files WHERE id = ${extraId} AND document_id = ${id}
    `;
    const extra = extraRows[0];
    if (!extra) throw new NotFoundException('Arquivo nao encontrado');

    await sql`DELETE FROM document_files WHERE id = ${extraId} AND document_id = ${id}`;
    await this.storage.delete(ctx.slug, extra.file_key);

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_extra_file_removed',
      resourceType: 'document',
      resourceId: id,
      ip,
      metadata: { module: row.module, fileKey: extra.file_key, extraId },
    });

    return this.get(user, id);
  }

  /** Signed URL 60s de um arquivo extra especifico — mesma checagem de posse do principal. */
  async extraFileSignedUrl(user: TenantAccessClaims, id: string, extraId: string, ip: string): Promise<{ url: string }> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'read');

    const sql = this.db.tenant(ctx.schemaName);
    const extraRows = await sql<Array<{ file_key: string }>>`
      SELECT file_key FROM document_files WHERE id = ${extraId} AND document_id = ${id}
    `;
    const extra = extraRows[0];
    if (!extra) throw new NotFoundException('Arquivo nao encontrado');

    const url = await this.storage.createSignedUrl(ctx.slug, extra.file_key);
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_extra_file_download_url',
      resourceType: 'document',
      resourceId: id,
      ip,
      metadata: { extraId },
    });
    return { url };
  }

  /**
   * Arquivo (principal ou extra) para a copia autenticada — mesmas checagens do
   * download (permissao de leitura do modulo + nivel de acesso + posse pelo tenant).
   */
  async arquivoParaCopia(
    user: TenantAccessClaims,
    id: string,
    extraId: string | undefined,
  ): Promise<{ buffer: Buffer; fileHash: string; originalName: string; documentFileId: string | null }> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'read');
    let file: { file_key: string; file_hash: string; original_name: string; id: string | null } | undefined;
    if (extraId) {
      const sql = this.db.tenant(ctx.schemaName);
      const rows = await sql<Array<{ id: string; file_key: string; file_hash: string; original_name: string }>>`
        SELECT id, file_key, file_hash, original_name FROM document_files WHERE id = ${extraId} AND document_id = ${id}
      `;
      file = rows[0];
    } else if (row.file_key && row.file_hash) {
      file = { id: null, file_key: row.file_key, file_hash: row.file_hash, original_name: row.original_name };
    }
    if (!file) throw new NotFoundException('Documento sem arquivo anexado');
    return {
      buffer: await this.storage.download(ctx.slug, file.file_key),
      fileHash: file.file_hash,
      originalName: file.original_name,
      documentFileId: file.id,
    };
  }

  /**
   * WHERE compartilhado por search() e gerarRelatorioEtiquetas() — garante
   * que o relatorio impresso respeite exatamente os mesmos filtros da tela
   * (nunca duplicar essa logica).
   */
  /** Arquivos extras de um lote de documentos, agrupados por document_id (evita N+1). */
  private async fetchExtrasMap(sql: Sql, documentIds: string[]): Promise<Map<string, DocumentFileView[]>> {
    const map = new Map<string, DocumentFileView[]>();
    if (documentIds.length === 0) return map;
    const rows = await sql<DocumentFileRow[]>`
      SELECT id, document_id, original_name, file_size, paginas, assinatura_status, assinado_por,
             conferencia_status, conferencia_resultado, conferencia_erro, criado_em
      FROM document_files
      WHERE document_id = ANY(${documentIds})
      ORDER BY criado_em ASC
    `;
    for (const r of rows) {
      const list = map.get(r.document_id) ?? [];
      list.push(toFileView(r));
      map.set(r.document_id, list);
    }
    return map;
  }

  private buildSearchWhere(sql: Sql, q: SearchDocumentsQuery, user: TenantAccessClaims) {
    const text = q.q ? `%${q.q}%` : null;
    const dateQuery = parseDateQuery(q.q);
    return sql`
      d.module = ${q.module} AND d.deleted_at IS NULL
      AND (${text}::text IS NULL OR d.credor ILIKE ${text} OR d.historico ILIKE ${text}
           OR d.descricao ILIKE ${text} OR d.empenho ILIKE ${text} OR d.doc_caixa ILIKE ${text}
           OR d.original_name ILIKE ${text} OR d.metadados::text ILIKE ${text}
           OR (${dateQuery?.day ?? null}::int IS NOT NULL
               AND EXTRACT(DAY FROM d.document_date) = ${dateQuery?.day ?? null}
               AND EXTRACT(MONTH FROM d.document_date) = ${dateQuery?.month ?? null}
               AND (${dateQuery?.year ?? null}::int IS NULL OR EXTRACT(YEAR FROM d.document_date) = ${dateQuery?.year ?? null})))
      AND (${this.podeVerRestrito(user)} OR d.nivel_acesso = 'publico')
      AND (${q.documentTypeId ?? null}::uuid IS NULL OR d.document_type_id = ${q.documentTypeId ?? null})
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

    const where = this.buildSearchWhere(sql, q, user);

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
             , d.classificacao_id, cl.codigo AS classificacao_codigo, cl.descricao AS classificacao_descricao,
             d.fase, d.nivel_acesso, d.grau_sigilo, d.data_inicio_contagem, d.data_prevista_transferencia, d.data_prevista_destinacao,
             d.metadados, d.digitalizado, d.responsavel_digitalizacao, d.data_digitalizacao, d.local_digitalizacao, d.ocr_status,
             d.possui_original_fisico, d.local_fisico_id, lf.codigo AS local_fisico_codigo
      FROM documents d
      LEFT JOIN budget_units bu ON bu.id = d.budget_unit_id
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
      LEFT JOIN locais_fisicos lf ON lf.id = d.local_fisico_id
      WHERE ${where}
      ORDER BY ${sql.unsafe(orderBy)}
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM documents d WHERE ${where}
    `;
    const extrasMap = await this.fetchExtrasMap(sql, items.map((i) => i.id));

    return {
      items: items.map((r) => toView(r, extrasMap.get(r.id) ?? [])),
      total: Number(totalRows[0]?.total ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Consulta agregada usada pelo Assistente de Busca por IA — mesma linguagem
   * de filtros de search()/buildSearchWhere(), com um agregado opcional
   * (soma/contagem/media do valor) alem dos documentos que viram "fontes"
   * citadas na resposta. So-leitura: filtros sao sempre tipados, nunca SQL
   * cru vindo do modelo.
   */
  async consultarAgregado(
    user: TenantAccessClaims,
    modulo: DocModule,
    filtros: Partial<Omit<SearchDocumentsQuery, 'module' | 'page' | 'pageSize' | 'sort'>>,
    agregacao: 'soma_valor' | 'contagem' | 'media_valor' | 'nenhuma',
    limite: number,
  ): Promise<{ agregado: number | null; documentos: DocumentView[] }> {
    const ctx = requireTenantContext();
    this.assertPermission(user, modulo, 'read');
    const sql = this.db.tenant(ctx.schemaName);

    const q: SearchDocumentsQuery = { module: modulo, sort: 'data_desc', page: 1, pageSize: limite, ...filtros };
    const where = this.buildSearchWhere(sql, q, user);

    let agregado: number | null = null;
    if (agregacao !== 'nenhuma') {
      const expr = { soma_valor: 'SUM(d.value)', contagem: 'COUNT(*)', media_valor: 'AVG(d.value)' }[agregacao];
      const rows = await sql<Array<{ resultado: string | null }>>`
        SELECT ${sql.unsafe(expr)} AS resultado FROM documents d WHERE ${where}
      `;
      agregado = rows[0]?.resultado == null ? null : Number(rows[0].resultado);
    }

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
             , d.classificacao_id, cl.codigo AS classificacao_codigo, cl.descricao AS classificacao_descricao,
             d.fase, d.nivel_acesso, d.grau_sigilo, d.data_inicio_contagem, d.data_prevista_transferencia, d.data_prevista_destinacao,
             d.metadados, d.digitalizado, d.responsavel_digitalizacao, d.data_digitalizacao, d.local_digitalizacao, d.ocr_status,
             d.possui_original_fisico, d.local_fisico_id, lf.codigo AS local_fisico_codigo
      FROM documents d
      LEFT JOIN budget_units bu ON bu.id = d.budget_unit_id
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
      LEFT JOIN locais_fisicos lf ON lf.id = d.local_fisico_id
      WHERE ${where}
      ORDER BY d.document_date DESC NULLS LAST, d.doc_caixa ASC NULLS LAST
      LIMIT ${limite}
    `;
    const extrasMap = await this.fetchExtrasMap(sql, items.map((i) => i.id));

    return {
      agregado,
      documentos: items.map((r) => toView(r, extrasMap.get(r.id) ?? [])),
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
             , d.classificacao_id, cl.codigo AS classificacao_codigo, cl.descricao AS classificacao_descricao,
             d.fase, d.nivel_acesso, d.grau_sigilo, d.data_inicio_contagem, d.data_prevista_transferencia, d.data_prevista_destinacao,
             d.metadados, d.digitalizado, d.responsavel_digitalizacao, d.data_digitalizacao, d.local_digitalizacao, d.ocr_status,
             d.possui_original_fisico, d.local_fisico_id, lf.codigo AS local_fisico_codigo
      FROM documents d
      LEFT JOIN budget_units bu ON bu.id = d.budget_unit_id
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
      LEFT JOIN locais_fisicos lf ON lf.id = d.local_fisico_id
      WHERE d.id = ${id}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Documento nao encontrado');
    if (!includeDeleted && row.deleted_at) throw new NotFoundException('Documento nao encontrado');
    return row;
  }

  async get(user: TenantAccessClaims, id: string): Promise<DocumentView> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const extras = await this.fetchExtrasMap(sql, [id]);
    return toView(row, extras.get(id) ?? []);
  }

  /** Signed URL 60s — checagem de permissao + posse pelo tenant ANTES de assinar. */
  async signedUrl(user: TenantAccessClaims, id: string, ip: string): Promise<{ url: string }> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
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
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'update');
    this.assertNaoEliminado(row);
    // Documento com sigilo LAI vigente: o acesso so muda pelo termo (desclassificacao), nunca pela edicao.
    if (row.grau_sigilo && input.nivelAcesso !== undefined && input.nivelAcesso !== 'restrito') {
      throw new BadRequestException('Documento com classificação de sigilo vigente: para liberar o acesso, desclassifique pelo termo (Sigilo).');
    }
    const sql = this.db.tenant(ctx.schemaName);

    let metadadosNovo: Metadados | undefined;
    if (input.metadados !== undefined || (row.module === 'acervo' && input.documentTypeId)) {
      if (row.module !== 'acervo') throw new BadRequestException('Metadados so existem em documentos do Acervo');
      const atuais = (typeof row.metadados === 'string' ? JSON.parse(row.metadados) : row.metadados) as Metadados | null;
      metadadosNovo = (
        await this.validarTipoAcervo(sql, input.documentTypeId ?? row.document_type_id, input.metadados ?? atuais ?? {})
      ).metadados;
    }
    if (input.localFisicoId) {
      const local = await sql`SELECT 1 FROM locais_fisicos WHERE id = ${input.localFisicoId} AND ativo`;
      if (local.length === 0) throw new BadRequestException('Local fisico invalido ou inativo');
    }
    // Coluna sem alteracao = mantem o valor atual (identificador constante, nunca entrada do usuario).
    const keep = (col: string) => sql.unsafe(col);

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
        metadados = ${metadadosNovo === undefined ? keep('metadados') : sql.json(metadadosNovo as never)},
        digitalizado = ${input.digitalizado ?? keep('digitalizado')},
        responsavel_digitalizacao = ${input.responsavelDigitalizacao === undefined ? keep('responsavel_digitalizacao') : input.responsavelDigitalizacao},
        data_digitalizacao = ${input.dataDigitalizacao === undefined ? keep('data_digitalizacao') : input.dataDigitalizacao},
        local_digitalizacao = ${input.localDigitalizacao === undefined ? keep('local_digitalizacao') : input.localDigitalizacao},
        local_fisico_id = ${input.localFisicoId === undefined ? keep('local_fisico_id') : input.localFisicoId},
        -- Informar a caixa implica que existe original em papel.
        possui_original_fisico = ${input.possuiOriginalFisico ?? (input.localFisicoId ? true : keep('possui_original_fisico'))},
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
    if (
      input.classificacaoId !== undefined ||
      input.nivelAcesso !== undefined ||
      input.dataInicioContagem !== undefined
    ) {
      await this.arquivistica.aplicarAoDocumento(id, {
        module: row.module,
        // Sem classe explicita na edicao = mantem a atual (nao volta pro padrao do modulo).
        classificacaoId: input.classificacaoId === undefined ? (row.classificacao_id ?? null) : input.classificacaoId,
        nivelAcesso: input.nivelAcesso,
        dataInicioContagem: input.dataInicioContagem,
      });
    } else if (input.documentDate !== undefined || input.exercicio !== undefined) {
      await this.arquivistica.recalcularDocumento(id);
    }
    return this.get(user, id);
  }

  /** Soft delete — documento vai pra lixeira (retencao 30 dias). Arquivo permanece. */
  async softDelete(user: TenantAccessClaims, id: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const row = await this.getRowFor(user, id);
    this.assertPermission(user, row.module, 'delete');
    this.assertExcluivel([row]);
    await this.assertForaDeDossie([id]);
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
      WHERE module = ${module} AND deleted_at IS NULL AND fase = 'corrente'
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

    const rows = await sql<Array<{ id: string; module: DocModule; fase: string }>>`
      SELECT id, module, fase FROM documents WHERE id = ANY(${ids}) AND deleted_at IS NULL
        AND (${this.podeVerRestrito(user)} OR nivel_acesso = 'publico')
    `;
    if (rows.length === 0) return 0;
    for (const module of new Set(rows.map((r) => r.module))) {
      this.assertPermission(user, module, 'delete');
    }
    this.assertExcluivel(rows);
    await this.assertForaDeDossie(ids);

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
        AND (${this.podeVerRestrito(user)} OR nivel_acesso = 'publico')
    `;
    if (rows.length === 0) throw new NotFoundException('Nenhum documento encontrado para os IDs informados');
    for (const module of new Set(rows.map((r) => r.module))) {
      this.assertPermission(user, module, 'read');
    }

    const extraRows = await sql<Array<{ file_key: string; original_name: string }>>`
      SELECT file_key, original_name FROM document_files WHERE document_id = ANY(${rows.map((r) => r.id)})
    `;

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
    for (const extra of extraRows) {
      try {
        const content = await this.storage.download(ctx.slug, extra.file_key);
        let name = (extra.original_name || `${extra.file_key}.pdf`).trim();
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
    const row = await this.getRowFor(user, id, true);
    if (!row.deleted_at) throw new BadRequestException('Documento nao esta na lixeira');
    this.assertPermission(user, row.module, 'update');
    this.assertNaoEliminado(row);
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
             , d.classificacao_id, cl.codigo AS classificacao_codigo, cl.descricao AS classificacao_descricao,
             d.fase, d.nivel_acesso, d.grau_sigilo, d.data_inicio_contagem, d.data_prevista_transferencia, d.data_prevista_destinacao,
             d.metadados, d.digitalizado, d.responsavel_digitalizacao, d.data_digitalizacao, d.local_digitalizacao, d.ocr_status,
             d.possui_original_fisico, d.local_fisico_id, lf.codigo AS local_fisico_codigo
      FROM documents d
      LEFT JOIN budget_units bu ON bu.id = d.budget_unit_id
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
      LEFT JOIN locais_fisicos lf ON lf.id = d.local_fisico_id
      WHERE d.deleted_at IS NOT NULL
        AND (${q.module ?? null}::varchar IS NULL OR d.module = ${q.module ?? null})
        AND (${this.podeVerRestrito(user)} OR d.nivel_acesso = 'publico')
      ORDER BY d.deleted_at DESC
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM documents d
      WHERE d.deleted_at IS NOT NULL
        AND (${q.module ?? null}::varchar IS NULL OR d.module = ${q.module ?? null})
        AND (${this.podeVerRestrito(user)} OR d.nivel_acesso = 'publico')
    `;
    return {
      items: rows.map((r) => toView(r)),
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
