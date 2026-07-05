import type { DocModule } from '../documents.js';

/** Formatos de etiqueta suportados (sistemas contabeis). */
export const LABEL_FORMATS = ['SS', 'ASPEC', 'JBS'] as const;
export type LabelFormat = (typeof LABEL_FORMATS)[number];

/** Registro normalizado extraido de um arquivo de etiquetas. */
export interface ParsedRecord {
  module: DocModule;
  docCaixa: string;
  /** Vazio para registros extraorcamentarios (nao tem numero de empenho). */
  empenho: string;
  credor: string;
  valor: number | null;
  /** ISO date (YYYY-MM-DD). */
  data: string;
  historico: string | null;
  /** Codigo do orgao (so disponivel no formato ASPEC, via linha CLASSIFICACAO). */
  orgaoCodigo: string | null;
  /** Sigla do orgao (formato ASPEC, ultimo token do cabecalho "Gov. Munic. ... Exerc AAAA ─ SIGLA").
   *  Usada como fallback quando nao ha CLASSIFICACAO (ex.: registros extraorcamentarios). */
  orgaoSigla: string | null;
  /** Extraorcamentaria = sem empenho (ex.: retencoes/repasses como INSS).
   *  Resto a pagar = despesa de exercicio anterior paga no exercicio atual (linha "REST. PG. <ano>"). */
  subtype: 'orcamentaria' | 'extraorcamentaria' | 'resto_a_pagar';
}

/** Erro de parse com referencia a linha (1-based) e conteudo bruto. */
export interface ParseError {
  line: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  format: LabelFormat;
  records: ParsedRecord[];
  errors: ParseError[];
  totalLines: number;
}

/** Valor monetario brasileiro "1.234,56" -> 1234.56. Aceita tambem "1234.56". */
export function parseValorBR(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  const normalized = /,\d{1,2}$/.test(s)
    ? s.replace(/\./g, '').replace(',', '.')
    : s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

/** Data DD/MM/YYYY -> YYYY-MM-DD (null se invalida). */
export function parseDataBR(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m as unknown as [string, string, string, string];
  const iso = `${yyyy}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Data YYYY-MM-DD validada (null se invalida). */
export function parseDataISO(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

/** Divide em linhas nao vazias preservando o numero original (1-based). */
export function nonEmptyLines(content: string): Array<{ line: number; text: string }> {
  return content
    .split(/\r?\n/)
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => text.trim() !== '');
}
