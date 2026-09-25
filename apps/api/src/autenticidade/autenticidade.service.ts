import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  CODIGO_ALFABETO,
  CODIGO_REGEX,
  formatarCodigo,
  schemaNameForSlug,
  type ConferenciaHashPublica,
  type SituacaoVerificacao,
  type TenantAccessClaims,
  type VerificacaoPublica,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { DocumentsService } from '../documents/documents.service';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';
import { PdfNaoCarimbavelError, carimbarPdf } from './carimbo';

const MODULO_LABEL: Record<string, string> = {
  receitas: 'Receita',
  despesas: 'Despesa',
  balancete: 'Balancete orçamentário',
  extrato: 'Extrato bancário',
  outros: 'Documento',
  acervo: 'Documento do acervo',
};

/** 80 bits aleatorios em 16 caracteres Crockford base32 — nao sequencial, nao enumeravel. */
export function gerarCodigo(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let valor = 0;
  let out = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CODIGO_ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

@Injectable()
export class AutenticidadeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  /** Um codigo por versao do arquivo (tenant, documento, arquivo, hash). Reemitir a copia reutiliza o codigo. */
  private async codigoPara(tenantId: string, documentId: string, documentFileId: string | null, fileHash: string): Promise<string> {
    const sql = this.db.catalog();
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      await sql`
        INSERT INTO public.codigos_verificacao (codigo, tenant_id, document_id, document_file_id, file_hash)
        VALUES (${gerarCodigo()}, ${tenantId}, ${documentId}, ${documentFileId}, ${fileHash})
        ON CONFLICT DO NOTHING
      `;
      const rows = await sql<Array<{ codigo: string }>>`
        SELECT codigo FROM public.codigos_verificacao
        WHERE tenant_id = ${tenantId} AND document_id = ${documentId}
          AND document_file_id IS NOT DISTINCT FROM ${documentFileId}::uuid AND file_hash = ${fileHash}
      `;
      if (rows[0]) return rows[0].codigo;
      // Nenhuma linha = colisao do codigo aleatorio com outro documento (2^-80): tenta de novo.
    }
    throw new Error('Nao foi possivel gerar codigo de verificacao');
  }

  async emitirCopia(
    user: TenantAccessClaims,
    documentId: string,
    extraId: string | undefined,
    ip: string,
  ): Promise<{ pdf: Buffer; nome: string; codigo: string }> {
    const ctx = requireTenantContext();
    const arquivo = await this.documents.arquivoParaCopia(user, documentId, extraId);
    const doc = await this.documents.get(user, documentId);
    const codigo = await this.codigoPara(ctx.tenantId, documentId, arquivo.documentFileId, arquivo.fileHash);
    const url = `${loadEnv().FRONTEND_URL.replace(/\/+$/, '')}/verificar/${codigo}`;

    let pdf: Buffer;
    try {
      pdf = await carimbarPdf(arquivo.buffer, {
        orgao: ctx.nome,
        codigoFormatado: formatarCodigo(codigo),
        urlVerificacao: url,
        arquivadoEm: new Date(doc.criadoEm),
        hashOriginal: arquivo.fileHash,
        emitidaEm: new Date(),
      });
    } catch (e) {
      if (e instanceof PdfNaoCarimbavelError) throw new UnprocessableEntityException(e.message);
      throw e;
    }
    const copiaHash = createHash('sha256').update(pdf).digest('hex');
    await this.db.catalog()`
      INSERT INTO public.copias_autenticadas (codigo, copia_hash, emitida_por)
      VALUES (${codigo}, ${copiaHash}, ${user.sub})
    `;
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'copia_autenticada_emitida',
      resourceType: 'document',
      resourceId: documentId,
      ip,
      metadata: { codigo, extraId: extraId ?? null, hashOriginal: arquivo.fileHash, copiaHash },
    });
    const base = arquivo.originalName.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'documento';
    return { pdf, nome: `${base}-autenticada-${codigo}.pdf`, codigo };
  }

  // ===================== Publico (sem autenticacao) =====================

  private async buscarCodigo(codigo: string) {
    if (!CODIGO_REGEX.test(codigo)) throw new NotFoundException('Codigo nao encontrado');
    const rows = await this.db.catalog()<
      Array<{
        codigo: string;
        document_id: string;
        document_file_id: string | null;
        file_hash: string;
        criado_em: Date;
        slug: string;
        nome: string;
        cidade: string | null;
        uf: string | null;
      }>
    >`
      SELECT c.codigo, c.document_id, c.document_file_id, c.file_hash, c.criado_em,
             t.slug, t.nome, t.cidade, t.uf
      FROM public.codigos_verificacao c JOIN public.tenants t ON t.id = c.tenant_id
      WHERE c.codigo = ${codigo}
    `;
    // Mesma resposta para codigo inexistente e invalido: nao da pista para enumeracao.
    if (!rows[0]) throw new NotFoundException('Codigo nao encontrado');
    return rows[0];
  }

  async verificar(codigo: string): Promise<VerificacaoPublica> {
    const c = await this.buscarCodigo(codigo);
    // Schema derivado do slug do catalogo (validado), nunca da URL.
    const sql = this.db.tenant(schemaNameForSlug(c.slug));
    const docs = await sql<
      Array<{
        module: string;
        document_date: Date | null;
        criado_em: Date;
        deleted_at: Date | null;
        fase: string;
        file_hash: string | null;
        assinatura_status: string;
        assinado_por: string | null;
        tipo_nome: string | null;
      }>
    >`
      SELECT d.module, d.document_date, d.criado_em, d.deleted_at, d.fase, d.file_hash,
             d.assinatura_status, d.assinado_por, dt.nome AS tipo_nome
      FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
      WHERE d.id = ${c.document_id}
    `;
    const d = docs[0];
    let hashAtual = d?.file_hash ?? null;
    let assinatura = { status: d?.assinatura_status ?? 'nao_assinado', assinadoPor: d?.assinado_por ?? null };
    if (d && c.document_file_id) {
      const extras = await sql<Array<{ file_hash: string; assinatura_status: string; assinado_por: string | null }>>`
        SELECT file_hash, assinatura_status, assinado_por FROM document_files WHERE id = ${c.document_file_id}
      `;
      hashAtual = extras[0]?.file_hash ?? null;
      assinatura = { status: extras[0]?.assinatura_status ?? 'nao_assinado', assinadoPor: extras[0]?.assinado_por ?? null };
    }

    let situacao: SituacaoVerificacao = 'vigente';
    if (!d || d.deleted_at) situacao = 'excluido';
    else if (d.fase === 'eliminado') situacao = 'eliminado';
    else if (hashAtual !== c.file_hash) situacao = 'substituido';

    const copias = await this.db.catalog()<Array<{ n: string }>>`
      SELECT COUNT(*)::bigint AS n FROM public.copias_autenticadas WHERE codigo = ${c.codigo}
    `;
    return {
      codigo: c.codigo,
      orgao: { nome: c.nome, cidade: c.cidade, uf: c.uf },
      tipoDocumental: d ? (d.tipo_nome ?? MODULO_LABEL[d.module] ?? 'Documento') : 'Documento',
      dataDocumento: d?.document_date ? d.document_date.toISOString().slice(0, 10) : null,
      arquivadoEm: (d?.criado_em ?? c.criado_em).toISOString(),
      hashOriginal: c.file_hash,
      situacao,
      assinatura,
      copiasEmitidas: Number(copias[0]?.n ?? 0),
    };
  }

  /** Recebe so o HASH (calculado no navegador) — o arquivo nunca sai da maquina de quem confere. */
  async conferirHash(codigo: string, sha256: string): Promise<ConferenciaHashPublica> {
    const c = await this.buscarCodigo(codigo);
    if (sha256 === c.file_hash) return { resultado: 'original', emitidaEm: null };
    const rows = await this.db.catalog()<Array<{ emitida_em: Date }>>`
      SELECT emitida_em FROM public.copias_autenticadas WHERE codigo = ${c.codigo} AND copia_hash = ${sha256}
      ORDER BY emitida_em LIMIT 1
    `;
    if (rows[0]) return { resultado: 'copia', emitidaEm: rows[0].emitida_em.toISOString() };
    return { resultado: 'nao_confere', emitidaEm: null };
  }
}
