import { z } from 'zod';

/**
 * Biblioteca de leis de referencia (repositorio publico ctresb/leis, MIT).
 * Cada orgao enxerga so o que vale para ele: a legislacao FEDERAL, a do ESTADO
 * dele e a do MUNICIPIO dele. Prefeitura do Ceara nunca ve lei da Bahia.
 */

export const LEIS_REPO = 'ctresb/leis';
export const LEIS_BRANCH = 'main';

export const ESFERAS_LEI = ['federal', 'estadual', 'municipal'] as const;
export type EsferaLei = (typeof ESFERAS_LEI)[number];
export const ESFERA_LEI_LABEL: Record<EsferaLei, string> = { federal: 'Federal', estadual: 'Estadual', municipal: 'Municipal' };


/** "Prefeitura de Nova Russas" / "Município de Irauçuba" -> "nova-russas" / "iraucuba" (nome da pasta no repositorio). */
export function municipioSlug(cidade: string | null | undefined): string | null {
  if (!cidade) return null;
  const s = cidade
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\s*(prefeitura|municipio|camara|fundo|secretaria)(\s+municipal)?(\s+(de|do|da|dos|das))?\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || null;
}

/** Cabecalho YAML simples (chave: "valor") dos arquivos do repositorio. */
export function lerCabecalho(texto: string): Record<string, string | boolean> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(texto);
  if (!m) return null;
  const out: Record<string, string | boolean> = {};
  for (const linha of m[1]!.split(/\r?\n/)) {
    const kv = /^([a-z_][a-z0-9_]*):\s*(.*)$/i.exec(linha);
    if (!kv) continue;
    let v = kv[2]!.trim();
    if (v.startsWith('"')) {
      // string com aspas duplas: ate a aspa que fecha (comentario "# ..." depois dela e ignorado)
      const fim = /"(?:[^"\\]|\\.)*"/.exec(v);
      if (fim) {
        try {
          out[kv[1]!] = JSON.parse(fim[0]) as string;
        } catch {
          out[kv[1]!] = fim[0].slice(1, -1);
        }
        continue;
      }
    }
    v = v.replace(/\s+#.*$/, '');
    if (v === 'true' || v === 'false') out[kv[1]!] = v === 'true';
    else out[kv[1]!] = v.replace(/^'(.*)'$/, '$1');
  }
  return out;
}

/** Texto da lei sem o cabecalho. */
export function corpoSemCabecalho(texto: string): string {
  return texto.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

export interface LocalizacaoLei {
  esfera: EsferaLei;
  uf: string | null;
  municipio: string | null;
  tipo: string;
  ano: number | null;
}

/**
 * Esfera, UF, municipio e tipo a partir do caminho no repositorio:
 *   constituicao.md | federal/<tipo>/AAAA/x.md | estaduais/UF/<tipo>/AAAA/x.md | municipais/UF/<mun>/<tipo>/AAAA/x.md
 */
export function localizarLei(path: string): LocalizacaoLei | null {
  const p = path.split('/');
  const ano = (s?: string) => (s && /^\d{4}$/.test(s) ? Number(s) : null);
  if (p.length === 1 && p[0] === 'constituicao.md') return { esfera: 'federal', uf: null, municipio: null, tipo: 'constituicao', ano: 1988 };
  if (!path.endsWith('.md') || p.length < 3) return null;
  if (p[0] === 'federal') return { esfera: 'federal', uf: null, municipio: null, tipo: p[1]!, ano: ano(p[2]) };
  if (p[0] === 'estaduais' && /^[A-Z]{2}$/.test(p[1] ?? '') && p.length >= 4) {
    return { esfera: 'estadual', uf: p[1]!, municipio: null, tipo: p[2]!, ano: ano(p[3]) };
  }
  if (p[0] === 'municipais' && /^[A-Z]{2}$/.test(p[1] ?? '') && p.length >= 5) {
    return { esfera: 'municipal', uf: p[1]!, municipio: p[2]!, tipo: p[3]!, ano: ano(p[4]) };
  }
  return null;
}

/** "leis-ordinarias" -> "Leis ordinárias" (rotulo amigavel de uma pasta de tipo). */
const TIPOS_ROTULO: Record<string, string> = {
  'leis-ordinarias': 'Leis ordinárias',
  'leis-complementares': 'Leis complementares',
  'leis-delegadas': 'Leis delegadas',
  'decretos-lei': 'Decretos-lei',
  'decretos-legislativos': 'Decretos legislativos',
  'emendas-constitucionais': 'Emendas constitucionais',
  'emendas-lei-organica': 'Emendas à Lei Orgânica',
  'lei-organica': 'Lei Orgânica',
  constituicao: 'Constituição',
  'leis-promulgadas': 'Leis promulgadas',
  'decretos-lei-complementares': 'Decretos-lei complementares',
  'leis-constitucionais': 'Leis constitucionais',
};
export function rotuloTipoLei(tipo: string): string {
  return TIPOS_ROTULO[tipo] ?? tipo.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// ---------------- API ----------------

export const leisQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    esfera: z.enum(ESFERAS_LEI).optional(),
    tipo: z.string().trim().max(60).optional(),
    ano: z.coerce.number().int().min(1500).max(2200).optional(),
    vigentes: z.enum(['sim']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type LeisQuery = z.infer<typeof leisQuerySchema>;

export interface LeiResumo {
  id: number;
  esfera: EsferaLei;
  uf: string | null;
  municipio: string | null;
  tipo: string;
  tipoRotulo: string;
  titulo: string;
  numero: string | null;
  data: string | null;
  ementa: string | null;
  situacao: string | null;
  revogada: boolean;
}

export interface LeiDetalhe extends LeiResumo {
  fonte: string | null;
  urn: string | null;
  /** Texto da lei (sem o cabecalho); null quando a origem esta fora do ar e nao ha copia. */
  texto: string | null;
  /** Link da lei no repositorio (confira sempre a fonte oficial antes de citar). */
  repositorio: string;
}

export interface EscopoLeis {
  uf: string | null;
  municipioNome: string | null;
  /** Pasta do municipio na biblioteca (null = nao deduzido). */
  municipio: string | null;
  /** O municipio tem leis na biblioteca? */
  municipioCoberto: boolean;
  esferas: Array<{ esfera: EsferaLei; rotulo: string; total: number }>;
  ultimaAtualizacao: string | null;
}

export interface LeisPage {
  items: LeiResumo[];
  total: number;
  page: number;
  pageSize: number;
  tipos: Array<{ tipo: string; rotulo: string; total: number }>;
}

export interface SincronizacaoLeisView {
  ultimaExecucao: string | null;
  totais: Array<{ esfera: EsferaLei; uf: string | null; municipio: string | null; total: number }>;
  escopo: Array<{ tenant: string; uf: string | null; municipio: string | null; municipioCoberto: boolean }>;
}

export const legislacaoMunicipioSchema = z
  .object({ municipio: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/, 'Use o nome da pasta: letras minúsculas, números e hífen').nullable() })
  .strict();
