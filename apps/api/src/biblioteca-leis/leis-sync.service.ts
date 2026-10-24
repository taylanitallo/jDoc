import { Injectable, Logger } from '@nestjs/common';
import { UFS, localizarLei, municipioSlug, normalizarParaBusca } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { arvore, arvorePorSha, cabecalhoDoArquivo, type Arvore } from './leis-github';

export interface ResumoSync {
  novos: number;
  atualizados: number;
  removidos: number;
  pastasPuladas: number;
  falhas: number;
  /** Ficou arquivo para a proxima execucao (limite por execucao ou falha). */
  incompleto: boolean;
  prefixos: string[];
}

interface Contexto {
  restante: number;
  resumo: ResumoSync;
  existentes: Map<string, string>;
  pastas: Map<string, string>;
  onProgresso?: (r: ResumoSync) => void;
}

const SIMULTANEOS = 8;
const pai = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
const nomeBase = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function dataValida(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Mantem a biblioteca de leis em dia com o repositorio de origem, so para o
 * que os orgaos cadastrados precisam: federal, o estado e o municipio de cada um.
 *
 * A comparacao e por hash de pasta (como o git): pasta igual a da ultima vez e
 * pulada inteira, entao a execucao diaria baixa apenas as leis novas ou
 * alteradas. Execucao interrompida (limite, rede) continua de onde parou.
 */
@Injectable()
export class LeisSyncService {
  private readonly logger = new Logger(LeisSyncService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Estados e municipios que os orgaos ativos precisam. */
  async escopo(): Promise<{ ufs: string[]; municipios: Array<{ uf: string; municipio: string }> }> {
    const rows = await this.db.catalog()<Array<{ uf: string | null; cidade: string | null; legislacao_municipio: string | null }>>`
      SELECT uf, cidade, legislacao_municipio FROM public.tenants WHERE status <> 'arquivado'
    `;
    const ufs = new Set<string>();
    const municipios = new Map<string, { uf: string; municipio: string }>();
    for (const r of rows) {
      const uf = (r.uf ?? '').toUpperCase();
      if (!(UFS as readonly string[]).includes(uf)) continue;
      ufs.add(uf);
      const mun = r.legislacao_municipio || municipioSlug(r.cidade);
      if (mun) municipios.set(`${uf}/${mun}`, { uf, municipio: mun });
    }
    return { ufs: [...ufs].sort(), municipios: [...municipios.values()] };
  }

  /**
   * Sincroniza. `limite` = quantas leis baixar nesta execucao (o resto fica
   * para a proxima); a carga inicial usa um limite grande.
   */
  async sincronizar(opcoes: { limite?: number; onProgresso?: (r: ResumoSync) => void } = {}): Promise<ResumoSync> {
    const { ufs, municipios } = await this.escopo();
    const resumo: ResumoSync = { novos: 0, atualizados: 0, removidos: 0, pastasPuladas: 0, falhas: 0, incompleto: false, prefixos: [] };
    const ctx: Contexto = { restante: opcoes.limite ?? 5_000, resumo, existentes: new Map(), pastas: new Map(), onProgresso: opcoes.onProgresso };

    const prefixos = ['federal', ...ufs.map((u) => `estaduais/${u}`), ...municipios.map((m) => `municipais/${m.uf}/${m.municipio}`)];
    for (const prefixo of prefixos) {
      if (ctx.restante <= 0) {
        resumo.incompleto = true;
        break;
      }
      resumo.prefixos.push(prefixo);
      await this.sincronizarPrefixo(prefixo, ctx);
    }
    await this.sincronizarConstituicao(ctx);
    return resumo;
  }

  private async carregar(prefixo: string, ctx: Contexto): Promise<void> {
    const sql = this.db.catalog();
    ctx.existentes = new Map(
      (await sql<Array<{ path: string; blob_sha: string }>>`SELECT path, blob_sha FROM platform.leis_ref WHERE starts_with(path, ${prefixo + '/'})`).map((r) => [r.path, r.blob_sha]),
    );
    ctx.pastas = new Map(
      (await sql<Array<{ path: string; sha: string }>>`SELECT path, sha FROM platform.leis_pastas WHERE path = ${prefixo} OR starts_with(path, ${prefixo + '/'})`).map((r) => [r.path, r.sha]),
    );
  }

  private async sincronizarPrefixo(prefixo: string, ctx: Contexto): Promise<void> {
    const raiz = await arvore(prefixo);
    if (!raiz) return; // municipio (ou estado) ainda sem pasta na origem
    await this.carregar(prefixo, ctx);
    if (ctx.pastas.get(prefixo) === raiz.sha) {
      ctx.resumo.pastasPuladas++;
      return;
    }
    const completo = await this.descer(prefixo, raiz, ctx);
    if (!completo) ctx.resumo.incompleto = true;
  }

  /** Constituicao Federal: unico arquivo na raiz do repositorio. */
  private async sincronizarConstituicao(ctx: Contexto): Promise<void> {
    const raiz = await arvore('');
    const arq = raiz?.tree.find((e) => e.type === 'blob' && e.path === 'constituicao.md');
    if (!arq) return;
    const [atual] = await this.db.catalog()<Array<{ blob_sha: string }>>`SELECT blob_sha FROM platform.leis_ref WHERE path = 'constituicao.md'`;
    if (atual?.blob_sha === arq.sha) return;
    await this.baixarEGravar('constituicao.md', arq.sha, ctx, !!atual);
  }

  private async descer(dir: string, arv: Arvore, ctx: Contexto): Promise<boolean> {
    const sql = this.db.catalog();
    let completo = true;
    // Pastas que comecam com "_" sao material de trabalho do autor da origem (auditorias, lotes, fontes): nao sao leis.
    const pastas = arv.tree.filter((e) => e.type === 'tree' && !e.path.startsWith('_'));
    const arquivos = arv.tree.filter((e) => e.type === 'blob' && e.path.endsWith('.md'));

    // Sumiu da origem: sai da biblioteca.
    const nomesPastas = new Set(pastas.map((p) => `${dir}/${p.path}`));
    for (const conhecida of [...ctx.pastas.keys()]) {
      if (pai(conhecida) === dir && !nomesPastas.has(conhecida)) {
        const r = await sql`DELETE FROM platform.leis_ref WHERE starts_with(path, ${conhecida + '/'})`;
        await sql`DELETE FROM platform.leis_pastas WHERE path = ${conhecida} OR starts_with(path, ${conhecida + '/'})`;
        ctx.resumo.removidos += r.count;
        ctx.pastas.delete(conhecida);
      }
    }
    const nomesArquivos = new Set(arquivos.map((a) => `${dir}/${a.path}`));
    const sumidos = [...ctx.existentes.keys()].filter((p) => pai(p) === dir && !nomesArquivos.has(p));
    if (sumidos.length) {
      const r = await sql`DELETE FROM platform.leis_ref WHERE path = ANY(${sumidos})`;
      ctx.resumo.removidos += r.count;
      for (const p of sumidos) ctx.existentes.delete(p);
    }

    for (const p of pastas) {
      const caminho = `${dir}/${p.path}`;
      if (ctx.pastas.get(caminho) === p.sha) {
        ctx.resumo.pastasPuladas++;
        continue;
      }
      if (ctx.restante <= 0) {
        completo = false;
        continue;
      }
      const ok = await this.descer(caminho, await arvorePorSha(p.sha), ctx);
      completo = completo && ok;
    }

    const pendentes = arquivos.filter((a) => ctx.existentes.get(`${dir}/${a.path}`) !== a.sha && localizarLei(`${dir}/${a.path}`));
    const lote = pendentes.slice(0, Math.max(0, ctx.restante));
    if (lote.length < pendentes.length) completo = false;
    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < lote.length) {
        const a = lote[proximo++]!;
        const caminho = `${dir}/${a.path}`;
        const ok = await this.baixarEGravar(caminho, a.sha, ctx, ctx.existentes.has(caminho));
        if (!ok) completo = false;
      }
    };
    await Promise.all(Array.from({ length: Math.min(SIMULTANEOS, lote.length) }, trabalhador));

    if (completo) {
      await sql`
        INSERT INTO platform.leis_pastas (path, sha) VALUES (${dir}, ${arv.sha})
        ON CONFLICT (path) DO UPDATE SET sha = EXCLUDED.sha, atualizado_em = now()
      `;
      ctx.pastas.set(dir, arv.sha);
    }
    return completo;
  }

  private async baixarEGravar(path: string, sha: string, ctx: Contexto, jaExistia: boolean): Promise<boolean> {
    ctx.restante--;
    try {
      const h = await cabecalhoDoArquivo(path);
      await this.gravar(path, sha, h ?? {});
      ctx.existentes.set(path, sha);
      if (jaExistia) ctx.resumo.atualizados++;
      else ctx.resumo.novos++;
      if (ctx.onProgresso && (ctx.resumo.novos + ctx.resumo.atualizados) % 500 === 0) ctx.onProgresso(ctx.resumo);
      return true;
    } catch (e) {
      ctx.resumo.falhas++;
      this.logger.warn(`Lei ${path}: ${(e as Error).message}`);
      return false;
    }
  }

  private async gravar(path: string, sha: string, h: Record<string, string | boolean>): Promise<void> {
    const loc = localizarLei(path)!;
    const titulo = texto(h.titulo, 500) ?? nomeBase(path).replace(/\.md$/, '').replace(/[-_]+/g, ' ');
    const ementa = texto(h.ementa, 3000);
    const data = dataValida(h.data);
    const situacao = texto(h.situacao, 60);
    const revogada = h.revogada === true || /revogad/i.test(situacao ?? '');
    const ano = data ? Number(data.slice(0, 4)) : loc.ano;
    const sql = this.db.catalog();
    await sql`
      INSERT INTO platform.leis_ref
        (path, esfera, uf, municipio, municipio_nome, codigo_ibge, tipo, titulo, numero, data, ano, ementa, situacao, revogada, fonte, urn, blob_sha, tsv)
      VALUES (${path}, ${loc.esfera}, ${loc.uf}, ${loc.municipio}, ${loc.esfera === 'municipal' ? texto(h.municipio, 120) : null},
              ${loc.esfera === 'municipal' ? texto(h.codigo_ibge, 7) : null}, ${loc.tipo}, ${titulo}, ${texto(h.numero, 40)}, ${data}, ${ano},
              ${ementa}, ${situacao}, ${revogada}, ${texto(h.fonte, 1000)}, ${texto(h.urn, 300)}, ${sha},
              setweight(to_tsvector('portuguese', ${normalizarParaBusca(titulo)}), 'A') || setweight(to_tsvector('portuguese', ${normalizarParaBusca(ementa ?? '')}), 'B'))
      ON CONFLICT (path) DO UPDATE SET
        esfera = EXCLUDED.esfera, uf = EXCLUDED.uf, municipio = EXCLUDED.municipio, municipio_nome = EXCLUDED.municipio_nome,
        codigo_ibge = EXCLUDED.codigo_ibge, tipo = EXCLUDED.tipo, titulo = EXCLUDED.titulo, numero = EXCLUDED.numero, data = EXCLUDED.data,
        ano = EXCLUDED.ano, ementa = EXCLUDED.ementa, situacao = EXCLUDED.situacao, revogada = EXCLUDED.revogada, fonte = EXCLUDED.fonte,
        urn = EXCLUDED.urn, blob_sha = EXCLUDED.blob_sha, tsv = EXCLUDED.tsv, sincronizado_em = now()
    `;
    // Texto em cache de versao antiga nao vale mais.
    await sql`DELETE FROM platform.leis_texto WHERE path = ${path} AND blob_sha <> ${sha}`;
  }
}
