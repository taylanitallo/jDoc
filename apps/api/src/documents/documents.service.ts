import { createHash, randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  TRASH_RETENTION_DAYS,
  type DocModule,
  type DocumentFields,
  type DocumentPage,
  type DocumentView,
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
}

function toView(r: DocRow): DocumentView {
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
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly signature: SignatureService,
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
    file: { buffer: Buffer; originalname: string; size: number },
    ip: string,
  ): Promise<DocumentView> {
    const ctx = requireTenantContext();
    this.assertPermission(user, fields.module, 'create');

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

    // 3) Nome no storage = UUID gerado pelo servidor (anti path-traversal).
    const fileKey = `${randomUUID()}.pdf`;
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const pageCount = await this.countPages(file.buffer);
    await this.storage.upload(ctx.slug, fileKey, file.buffer);

    const sql = this.db.tenant(ctx.schemaName);
    const f = fields as Record<string, unknown>;
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
        ${file.originalname.slice(0, 255)},
        ${fileKey},
        ${file.size},
        ${fileHash},
        ${pageCount},
        'disponivel',
        ${user.sub}
      )
      RETURNING id, module, subtype, doc_caixa, empenho, credor, historico, descricao,
                budget_unit_id, NULL AS budget_unit_nome,
                orgao_id, NULL AS orgao_codigo, NULL AS orgao_nome,
                document_type_id, NULL AS document_type_nome,
                document_date, value, competencia, exercicio, banco, agencia, conta,
                original_name, file_key, file_size, file_hash, paginas, status, criado_em, deleted_at
    `;

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'document_created',
      resourceType: 'document',
      resourceId: rows[0]?.id,
      ip,
      metadata: { module: fields.module, fileKey, fileHash, size: file.size },
    });

    // Se o PDF contem assinatura, valida em background (integridade + cadeia + revogacao).
    const documentId = rows[0]?.id;
    if (documentId && hasSignature(file.buffer)) {
      await this.signature.enqueueValidation({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId,
        fileKey,
      });
    }

    return toView(rows[0] as DocRow);
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
        atualizado_em = now()
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
        atualizado_em = now()
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

  async search(user: TenantAccessClaims, q: SearchDocumentsQuery): Promise<DocumentPage> {
    const ctx = requireTenantContext();
    this.assertPermission(user, q.module, 'read');
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (q.page - 1) * q.pageSize;
    const text = q.q ? `%${q.q}%` : null;

    // Ordem estavel: data (ou valor) como chave primaria + doc_caixa como desempate,
    // para que anexar um PDF (que nao altera data/doc_caixa) nunca mude a posicao da linha.
    const orderBy = {
      data_desc: 'd.document_date DESC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      data_asc: 'd.document_date ASC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      valor_desc: 'd.value DESC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      valor_asc: 'd.value ASC NULLS LAST, d.doc_caixa ASC NULLS LAST',
      criado_desc: 'd.criado_em DESC',
    }[q.sort];

    const where = sql`
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
    `;

    const items = await sql<DocRow[]>`
      SELECT d.id, d.module, d.subtype, d.doc_caixa, d.empenho, d.credor, d.historico, d.descricao,
             d.budget_unit_id, bu.nome AS budget_unit_nome,
             d.orgao_id, o.codigo AS orgao_codigo, o.descricao AS orgao_nome,
             d.document_type_id, dt.nome AS document_type_nome,
             d.document_date, d.value, d.competencia, d.exercicio,
             d.banco, d.agencia, d.conta,
             d.original_name, d.file_key, d.file_size, d.file_hash, d.paginas, d.status,
             d.criado_em, d.deleted_at
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
             d.criado_em, d.deleted_at
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
             d.criado_em, d.deleted_at
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
