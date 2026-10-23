import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  DOC_MODULES,
  montarTrecho,
  normalizarParaBusca,
  sistemaDoModulo,
  termosDaConsulta,
  type BuscaConteudoItem,
  type BuscaConteudoQuery,
  type BuscaConteudoResult,
  type DocModule,
  type IndexacaoResumo,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { OcrService } from './ocr.service';
import { sistemaAtivo } from '../common/sistema.guard';
import { filtroLotacao, podeVerRestrito } from '../common/acesso-documento';

/** Teto de arquivos enfileirados por chamada de reindexacao (evita encher a fila de uma vez). */
const LOTE_REINDEXACAO = 2000;

interface HitRow {
  document_id: string;
  document_file_id: string | null;
  pagina: number;
  texto: string;
  module: DocModule;
  descricao: string | null;
  historico: string | null;
  credor: string | null;
  doc_caixa: string | null;
  original_name: string;
  document_date: Date | null;
  exercicio: number;
  metadados: Record<string, string> | string | null;
  document_type_nome: string | null;
}

function titulo(r: HitRow): string {
  const md = typeof r.metadados === 'string' ? (JSON.parse(r.metadados) as Record<string, string>) : r.metadados;
  if (r.module === 'acervo' && md?.numero) return `${r.document_type_nome ?? 'Documento'} nº ${md.numero}`;
  if (r.module === 'despesas' && r.doc_caixa) return `Doc. Caixa ${r.doc_caixa}${r.credor ? ` — ${r.credor}` : ''}`;
  return r.descricao || r.historico || r.document_type_nome || r.original_name;
}

@Injectable()
export class BuscaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ocr: OcrService,
    private readonly audit: AuditService,
  ) {}

  /** Modulos que o usuario pode ler (admin: todos). A busca nunca devolve documento de modulo sem read. */
  private modulosLegiveis(user: TenantAccessClaims): DocModule[] {
    const contratados = DOC_MODULES.filter((m) => sistemaAtivo(sistemaDoModulo(m)));
    if (user.role === 'admin') return contratados;
    return contratados.filter((m) => user.permissions.includes(`${m}:read`));
  }

  private podeVerRestrito(user: TenantAccessClaims): boolean {
    return podeVerRestrito(user);
  }

  async buscar(user: TenantAccessClaims, q: BuscaConteudoQuery, ip = ''): Promise<BuscaConteudoResult> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const mods = this.modulosLegiveis(user).filter(
      (m) => (!q.module || m === q.module) && (!q.sistema || sistemaDoModulo(m) === q.sistema),
    );
    const vazio = { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    if (mods.length === 0) return vazio;

    const consulta = normalizarParaBusca(q.q);
    const offset = (q.page - 1) * q.pageSize;
    const filtro = sql`
      d.deleted_at IS NULL
      AND d.module = ANY(${mods})
      AND (${this.podeVerRestrito(user)} OR d.nivel_acesso = 'publico')
      AND ${filtroLotacao(sql, user)}
      AND (${q.exercicio ?? null}::int IS NULL OR d.exercicio = ${q.exercicio ?? null})
    `;
    // Melhor pagina de cada documento (DISTINCT ON) e depois ranking entre documentos.
    const hits = sql`
      SELECT DISTINCT ON (t.document_id) t.document_id, t.document_file_id, t.pagina, t.texto,
             ts_rank(t.tsv, websearch_to_tsquery('portuguese', ${consulta})) AS rank
      FROM document_textos t
      WHERE t.tsv @@ websearch_to_tsquery('portuguese', ${consulta})
      ORDER BY t.document_id, rank DESC, t.pagina
    `;
    const rows = await sql<HitRow[]>`
      SELECT h.document_id, h.document_file_id, h.pagina, h.texto,
             d.module, d.descricao, d.historico, d.credor, d.doc_caixa, d.original_name,
             d.document_date, d.exercicio, d.metadados, dt.nome AS document_type_nome
      FROM (${hits}) h
      JOIN documents d ON d.id = h.document_id
      LEFT JOIN document_types dt ON dt.id = d.document_type_id
      WHERE ${filtro}
      ORDER BY h.rank DESC, d.document_date DESC NULLS LAST, d.id
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const total = await sql<Array<{ n: string }>>`
      SELECT COUNT(*)::bigint AS n FROM (${hits}) h JOIN documents d ON d.id = h.document_id WHERE ${filtro}
    `;

    const termos = termosDaConsulta(q.q);
    const items: BuscaConteudoItem[] = rows.map((r) => ({
      documentId: r.document_id,
      module: r.module,
      titulo: titulo(r),
      documentTypeNome: r.document_type_nome,
      documentDate: r.document_date ? r.document_date.toISOString().slice(0, 10) : null,
      exercicio: r.exercicio,
      documentFileId: r.document_file_id,
      pagina: r.pagina,
      trecho: montarTrecho(r.texto, termos),
    }));
    const totalN = Number(total[0]?.n ?? 0);
    // Pesquisas ficam na trilha (so a primeira pagina: paginar nao e nova pesquisa).
    if (q.page === 1) {
      await this.audit.logTenant({
        actorId: user.sub,
        action: 'busca_realizada',
        resourceType: 'busca',
        ip,
        metadata: { termo: q.q.slice(0, 200), resultados: totalN, modulo: q.module ?? null, sistema: q.sistema ?? null },
      });
    }
    return { items, total: totalN, page: q.page, pageSize: q.pageSize };
  }

  async resumo(): Promise<IndexacaoResumo> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ status: string | null; n: string }>>`
      SELECT ocr_status AS status, COUNT(*)::bigint AS n FROM (
        SELECT ocr_status FROM documents WHERE file_key IS NOT NULL AND deleted_at IS NULL
        UNION ALL
        SELECT f.ocr_status FROM document_files f JOIN documents d ON d.id = f.document_id WHERE d.deleted_at IS NULL
      ) x GROUP BY ocr_status
    `;
    const n = (s: string | null) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return {
      habilitado: this.ocr.isEnabled(),
      pendentes: n('pendente') + n('processando'),
      concluidos: n('concluido'),
      semTexto: n('sem_texto'),
      erros: n('erro'),
      semIndice: n(null),
    };
  }

  /** Enfileira arquivos nunca indexados (ou com erro): acervo legado anterior a esta funcao. */
  async reindexar(user: TenantAccessClaims, ip: string): Promise<{ enfileirados: number }> {
    if (user.role !== 'admin') throw new ForbiddenException('Acesso negado');
    if (!this.ocr.isEnabled()) return { enfileirados: 0 };
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const principais = await sql<Array<{ id: string; file_key: string }>>`
      SELECT id, file_key FROM documents
      WHERE file_key IS NOT NULL AND deleted_at IS NULL AND (ocr_status IS NULL OR ocr_status = 'erro')
      ORDER BY criado_em DESC
      LIMIT ${LOTE_REINDEXACAO}
    `;
    const extras = await sql<Array<{ id: string; document_id: string; file_key: string }>>`
      SELECT f.id, f.document_id, f.file_key FROM document_files f
      JOIN documents d ON d.id = f.document_id
      WHERE d.deleted_at IS NULL AND (f.ocr_status IS NULL OR f.ocr_status = 'erro')
      ORDER BY f.criado_em DESC
      LIMIT ${Math.max(0, LOTE_REINDEXACAO - principais.length)}
    `;
    for (const p of principais) {
      await this.ocr.enqueue({ schemaName: ctx.schemaName, slug: ctx.slug, documentId: p.id, documentFileId: null, fileKey: p.file_key });
    }
    for (const e of extras) {
      await this.ocr.enqueue({
        schemaName: ctx.schemaName,
        slug: ctx.slug,
        documentId: e.document_id,
        documentFileId: e.id,
        fileKey: e.file_key,
      });
    }
    const enfileirados = principais.length + extras.length;
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'conteudo_reindexado',
      resourceType: 'document',
      ip,
      metadata: { enfileirados },
    });
    return { enfileirados };
  }
}
