import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ESFERA_LEI_LABEL,
  ESFERAS_LEI,
  corpoSemCabecalho,
  municipioSlug,
  normalizarParaBusca,
  rotuloTipoLei,
  type EscopoLeis,
  type EsferaLei,
  type LeiDetalhe,
  type LeiResumo,
  type LeisPage,
  type LeisQuery,
  type SincronizacaoLeisView,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { requireTenantContext } from '../tenancy/tenant-context';
import { linkDoRepositorio, textoDoArquivo } from './leis-github';

interface Linha {
  id: string;
  esfera: EsferaLei;
  uf: string | null;
  municipio: string | null;
  tipo: string;
  titulo: string;
  numero: string | null;
  data: Date | null;
  ementa: string | null;
  situacao: string | null;
  revogada: boolean;
}

/** Texto maior que isso nao fica em cache (e baixado de novo quando abrirem). */
const MAX_CACHE_BYTES = 3 * 1024 * 1024;

const resumo = (r: Linha): LeiResumo => ({
  id: Number(r.id),
  esfera: r.esfera,
  uf: r.uf,
  municipio: r.municipio,
  tipo: r.tipo,
  tipoRotulo: rotuloTipoLei(r.tipo),
  titulo: r.titulo,
  numero: r.numero,
  data: r.data ? r.data.toISOString().slice(0, 10) : null,
  ementa: r.ementa,
  situacao: r.situacao,
  revogada: r.revogada,
});

/**
 * Biblioteca de leis de referencia. A regra de ouro: o orgao so ve o que vale
 * para ele (federal + o estado dele + o municipio dele). O filtro e aplicado
 * aqui, no servidor, em toda consulta e na abertura de cada lei.
 */
@Injectable()
export class BibliotecaLeisService {
  constructor(private readonly db: DatabaseService) {}

  /** UF e municipio (pasta na biblioteca) do orgao do contexto. */
  async escopoDoOrgao(tenantId = requireTenantContext().tenantId): Promise<{ uf: string | null; municipio: string | null; cidade: string | null }> {
    const [t] = await this.db.catalog()<Array<{ uf: string | null; cidade: string | null; legislacao_municipio: string | null }>>`
      SELECT uf, cidade, legislacao_municipio FROM public.tenants WHERE id = ${tenantId}
    `;
    if (!t) throw new NotFoundException('Órgão não encontrado');
    const uf = /^[A-Za-z]{2}$/.test(t.uf ?? '') ? t.uf!.toUpperCase() : null;
    return { uf, municipio: uf ? t.legislacao_municipio || municipioSlug(t.cidade) : null, cidade: t.cidade };
  }

  /** WHERE que limita as leis ao que o orgao pode ver. */
  private filtroEscopo(e: { uf: string | null; municipio: string | null }) {
    const sql = this.db.catalog();
    return sql`(
      l.esfera = 'federal'
      OR (${e.uf}::text IS NOT NULL AND l.uf = ${e.uf}::text AND (
            l.esfera = 'estadual'
            OR (l.esfera = 'municipal' AND ${e.municipio}::text IS NOT NULL AND l.municipio = ${e.municipio}::text)))
    )`;
  }

  async escopo(): Promise<EscopoLeis> {
    const e = await this.escopoDoOrgao();
    const sql = this.db.catalog();
    const rows = await sql<Array<{ esfera: EsferaLei; total: string; ultima: Date | null }>>`
      SELECT l.esfera, count(*)::text AS total, max(l.sincronizado_em) AS ultima FROM platform.leis_ref l
      WHERE ${this.filtroEscopo(e)} GROUP BY l.esfera
    `;
    const total = (x: EsferaLei) => Number(rows.find((r) => r.esfera === x)?.total ?? 0);
    const esferas: EscopoLeis['esferas'] = [{ esfera: 'federal', rotulo: 'Federal', total: total('federal') }];
    if (e.uf) esferas.push({ esfera: 'estadual', rotulo: `Estadual — ${e.uf}`, total: total('estadual') });
    if (e.uf && e.municipio) esferas.push({ esfera: 'municipal', rotulo: 'Municipal', total: total('municipal') });
    const ultima = rows.reduce<Date | null>((m, r) => (r.ultima && (!m || r.ultima > m) ? r.ultima : m), null);
    const [nome] = e.uf && e.municipio
      ? await sql<Array<{ nome: string | null }>>`SELECT municipio_nome AS nome FROM platform.leis_ref WHERE esfera = 'municipal' AND uf = ${e.uf} AND municipio = ${e.municipio} AND municipio_nome IS NOT NULL LIMIT 1`
      : [];
    return {
      uf: e.uf,
      municipioNome: nome?.nome ?? e.cidade,
      municipio: e.municipio,
      municipioCoberto: total('municipal') > 0,
      esferas,
      ultimaAtualizacao: ultima?.toISOString() ?? null,
    };
  }

  async listar(q: LeisQuery): Promise<LeisPage> {
    const e = await this.escopoDoOrgao();
    const sql = this.db.catalog();
    const busca = q.q ? normalizarParaBusca(q.q) : null;
    const numero = q.q && /^[\d.\s/-]+$/.test(q.q) ? q.q.replace(/\D/g, '') : null;
    const base = sql`
      ${this.filtroEscopo(e)}
      AND (${q.esfera ?? null}::text IS NULL OR l.esfera = ${q.esfera ?? null})
      AND (${q.ano ?? null}::int IS NULL OR l.ano = ${q.ano ?? null})
      AND (${q.vigentes ?? null}::text IS NULL OR NOT l.revogada)
      AND (${busca}::text IS NULL OR l.tsv @@ websearch_to_tsquery('portuguese', ${busca}) OR (${numero}::text IS NOT NULL AND l.numero = ${numero}))
    `;
    const filtroTipo = sql`(${q.tipo ?? null}::text IS NULL OR l.tipo = ${q.tipo ?? null})`;
    const ordem = busca
      ? sql`ts_rank(l.tsv, websearch_to_tsquery('portuguese', ${busca})) DESC, l.data DESC NULLS LAST, l.id DESC`
      : sql`l.data DESC NULLS LAST, l.id DESC`;
    const rows = await sql<Linha[]>`
      SELECT l.id::text, l.esfera, l.uf, l.municipio, l.tipo, l.titulo, l.numero, l.data, l.ementa, l.situacao, l.revogada
      FROM platform.leis_ref l WHERE ${base} AND ${filtroTipo}
      ORDER BY ${ordem} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
    `;
    const [t] = await sql<Array<{ n: string }>>`SELECT count(*)::text AS n FROM platform.leis_ref l WHERE ${base} AND ${filtroTipo}`;
    const tipos = await sql<Array<{ tipo: string; n: string }>>`
      SELECT l.tipo, count(*)::text AS n FROM platform.leis_ref l WHERE ${base} GROUP BY l.tipo ORDER BY count(*) DESC LIMIT 30
    `;
    return {
      items: rows.map(resumo),
      total: Number(t?.n ?? 0),
      page: q.page,
      pageSize: q.pageSize,
      tipos: tipos.map((x) => ({ tipo: x.tipo, rotulo: rotuloTipoLei(x.tipo), total: Number(x.n) })),
    };
  }

  async detalhe(id: number): Promise<LeiDetalhe> {
    const e = await this.escopoDoOrgao();
    const sql = this.db.catalog();
    // Lei fora do escopo do orgao = 404 (nao revela que existe).
    const [r] = await sql<Array<Linha & { path: string; fonte: string | null; urn: string | null; blob_sha: string }>>`
      SELECT l.id::text, l.esfera, l.uf, l.municipio, l.tipo, l.titulo, l.numero, l.data, l.ementa, l.situacao, l.revogada,
             l.path, l.fonte, l.urn, l.blob_sha
      FROM platform.leis_ref l WHERE l.id = ${id} AND ${this.filtroEscopo(e)}
    `;
    if (!r) throw new NotFoundException('Lei não encontrada');
    let texto: string | null = null;
    const [cache] = await sql<Array<{ texto: string }>>`SELECT texto FROM platform.leis_texto WHERE path = ${r.path} AND blob_sha = ${r.blob_sha}`;
    if (cache) texto = cache.texto;
    else {
      try {
        const bruto = await textoDoArquivo(r.path);
        if (bruto) {
          texto = corpoSemCabecalho(bruto);
          if (Buffer.byteLength(texto) <= MAX_CACHE_BYTES) {
            await sql`
              INSERT INTO platform.leis_texto (path, blob_sha, texto) VALUES (${r.path}, ${r.blob_sha}, ${texto})
              ON CONFLICT (path) DO UPDATE SET blob_sha = EXCLUDED.blob_sha, texto = EXCLUDED.texto, baixado_em = now()
            `;
          }
        }
      } catch {
        texto = null; // origem fora do ar e sem copia: a tela mostra o link
      }
    }
    return { ...resumo(r), fonte: r.fonte, urn: r.urn, texto, repositorio: linkDoRepositorio(r.path) };
  }

  // ---------------- Plataforma ----------------

  async statusPlataforma(): Promise<SincronizacaoLeisView> {
    const sql = this.db.catalog();
    const totais = await sql<Array<{ esfera: EsferaLei; uf: string | null; municipio: string | null; n: string; ultima: Date | null }>>`
      SELECT esfera, uf, municipio, count(*)::text AS n, max(sincronizado_em) AS ultima FROM platform.leis_ref
      GROUP BY esfera, uf, municipio ORDER BY esfera, uf NULLS FIRST, municipio NULLS FIRST
    `;
    const orgaos = await sql<Array<{ nome: string; uf: string | null; cidade: string | null; legislacao_municipio: string | null }>>`
      SELECT nome, uf, cidade, legislacao_municipio FROM public.tenants WHERE status <> 'arquivado' ORDER BY nome
    `;
    return {
      ultimaExecucao: totais.reduce<Date | null>((m, r) => (r.ultima && (!m || r.ultima > m) ? r.ultima : m), null)?.toISOString() ?? null,
      totais: totais.map((t) => ({ esfera: t.esfera, uf: t.uf, municipio: t.municipio, total: Number(t.n) })),
      escopo: orgaos.map((o) => {
        const uf = /^[A-Za-z]{2}$/.test(o.uf ?? '') ? o.uf!.toUpperCase() : null;
        const municipio = uf ? o.legislacao_municipio || municipioSlug(o.cidade) : null;
        return {
          tenant: o.nome,
          uf,
          municipio,
          municipioCoberto: totais.some((t) => t.esfera === 'municipal' && t.uf === uf && t.municipio === municipio),
        };
      }),
    };
  }

  async definirMunicipio(tenantId: string, municipio: string | null): Promise<{ antes: string | null; depois: string | null }> {
    const sql = this.db.catalog();
    const [antes] = await sql<Array<{ legislacao_municipio: string | null }>>`SELECT legislacao_municipio FROM public.tenants WHERE id = ${tenantId}`;
    if (!antes) throw new NotFoundException('Órgão não encontrado');
    await sql`UPDATE public.tenants SET legislacao_municipio = ${municipio} WHERE id = ${tenantId}`;
    return { antes: antes.legislacao_municipio, depois: municipio };
  }
}

export { ESFERAS_LEI, ESFERA_LEI_LABEL };
