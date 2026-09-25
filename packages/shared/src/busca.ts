import { z } from 'zod';
import { sistemaSchema } from './sistemas.js';
import { DOC_MODULES, type DocModule } from './documents.js';

/**
 * Busca no conteudo dos PDFs (texto extraido por pdftotext/OCR). Funcoes
 * puras compartilhadas: normalizacao sem acento (o indice e a consulta usam a
 * mesma), e montagem do trecho destacado — em segmentos, nunca HTML, para o
 * front renderizar sem dangerouslySetInnerHTML.
 */

export const OCR_STATUS = ['pendente', 'processando', 'concluido', 'sem_texto', 'erro'] as const;
export type OcrStatus = (typeof OCR_STATUS)[number];

/** Remove acentos preservando o comprimento (indice i do original = indice i do normalizado). */
export function semAcento(s: string): string {
  let out = '';
  for (const ch of s) {
    const n = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += n.length === ch.length ? n : ch;
  }
  return out;
}

/** Texto como vai pro to_tsvector/websearch_to_tsquery: sem acento, minusculo, sem caractere de controle. */
export function normalizarParaBusca(s: string): string {
  let out = '';
  for (const ch of semAcento(s).toLowerCase()) {
    const c = ch.charCodeAt(0);
    // Controle (exceto tab 9 e quebra de linha 10) vira espaco: \f do pdftotext, lixo de OCR.
    out += c < 32 && c !== 9 && c !== 10 ? ' ' : ch;
  }
  return out;
}

/** Termos da consulta para destaque (ignora operadores do websearch e palavras curtas). */
export function termosDaConsulta(q: string): string[] {
  const termos = normalizarParaBusca(q)
    .replace(/["()]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+/, ''))
    .filter((t) => t.length >= 3 && t !== 'or' && t !== 'and');
  return [...new Set(termos)];
}

export interface SegmentoTrecho {
  texto: string;
  destaque: boolean;
}

/**
 * Trecho do texto em volta da primeira ocorrencia de algum termo, com os
 * termos destacados. Compara por prefixo (ate 5 letras) para acompanhar o
 * stemming do Postgres: "contratos" destaca "contratacao"/"contrato".
 */
export function montarTrecho(texto: string, termos: string[], tamanho = 240): SegmentoTrecho[] {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  const norm = normalizarParaBusca(limpo);
  const prefixos = termos.map((t) => t.slice(0, 5)).filter(Boolean);
  const achar = (from: number): { i: number; p: string } | null => {
    let best: { i: number; p: string } | null = null;
    for (const p of prefixos) {
      const i = norm.indexOf(p, from);
      if (i >= 0 && (!best || i < best.i)) best = { i, p };
    }
    return best;
  };

  const primeira = achar(0);
  const inicio = primeira ? Math.max(0, primeira.i - Math.floor(tamanho / 3)) : 0;
  const fim = Math.min(limpo.length, inicio + tamanho);
  const segs: SegmentoTrecho[] = [];
  if (inicio > 0) segs.push({ texto: '…', destaque: false });

  let cursor = inicio;
  let m = achar(inicio);
  while (m && m.i < fim) {
    // Estende o destaque ate o fim da palavra.
    let fimPalavra = m.i + m.p.length;
    while (fimPalavra < fim && /[\p{L}\p{N}]/u.test(norm[fimPalavra] ?? '')) fimPalavra++;
    if (m.i > cursor) segs.push({ texto: limpo.slice(cursor, m.i), destaque: false });
    segs.push({ texto: limpo.slice(m.i, fimPalavra), destaque: true });
    cursor = fimPalavra;
    m = achar(fimPalavra);
  }
  if (cursor < fim) segs.push({ texto: limpo.slice(cursor, fim), destaque: false });
  if (fim < limpo.length) segs.push({ texto: '…', destaque: false });
  return segs;
}

export const buscaConteudoQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(200),
    module: z.enum(DOC_MODULES).optional(),
    /** Restringe ao modulo contratado em uso na tela (Financeiro/Contabil ou Arquivo Municipal). */
    sistema: sistemaSchema.optional(),
    exercicio: z.coerce.number().int().min(1800).max(2100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type BuscaConteudoQuery = z.infer<typeof buscaConteudoQuerySchema>;

export interface BuscaConteudoItem {
  documentId: string;
  module: DocModule;
  titulo: string;
  documentTypeNome: string | null;
  documentDate: string | null;
  exercicio: number;
  /** Arquivo onde o texto foi achado: principal (null) ou um PDF extra. */
  documentFileId: string | null;
  pagina: number;
  trecho: SegmentoTrecho[];
}

export interface BuscaConteudoResult {
  items: BuscaConteudoItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IndexacaoResumo {
  habilitado: boolean;
  pendentes: number;
  concluidos: number;
  semTexto: number;
  erros: number;
  semIndice: number;
}
