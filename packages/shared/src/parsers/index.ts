import type { DocModule } from '../documents.js';
import { parseSS } from './ss.js';
import { parseASPEC } from './aspec.js';
import { parseJBS } from './jbs.js';
import { nonEmptyLines, type LabelFormat, type ParseResult } from './types.js';

export * from './types.js';
export { parseSS } from './ss.js';
export { parseASPEC } from './aspec.js';
export { parseJBS } from './jbs.js';

/**
 * Deteccao de formato por heuristica:
 * - relatorio de etiquetas ASPEC (contem "DOCUM. CAIXA" e "VALOR PAGTO") -> ASPEC
 * - '|' em todas as primeiras linhas -> JBS
 * - ';' em todas as primeiras linhas -> SS
 * - senao: null (formato nao reconhecido)
 */
export function detectFormat(content: string): LabelFormat | null {
  const sample = nonEmptyLines(content).slice(0, 5);
  if (sample.length === 0) return null;
  if (/DOCUM.*?CAIXA/i.test(content) && /VALOR\s*PAGTO/i.test(content)) return 'ASPEC';
  if (sample.every(({ text }) => text.includes('|'))) return 'JBS';
  if (sample.every(({ text }) => text.includes(';'))) return 'SS';
  return null;
}

/** Parse com formato explicito ou deteccao automatica. */
export function parseLabels(
  content: string,
  module: DocModule,
  format?: LabelFormat,
): ParseResult | null {
  const fmt = format ?? detectFormat(content);
  if (!fmt) return null;
  switch (fmt) {
    case 'SS':
      return parseSS(content, module);
    case 'ASPEC':
      return parseASPEC(content, module);
    case 'JBS':
      return parseJBS(content, module);
  }
}
