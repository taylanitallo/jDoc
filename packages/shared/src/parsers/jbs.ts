import type { DocModule } from '../documents.js';
import {
  nonEmptyLines,
  parseDataISO,
  type ParseError,
  type ParsedRecord,
  type ParseResult,
} from './types.js';

/**
 * Formato JBS — CSV separado por pipe.
 * Layout: EMPENHO|DATA|CREDOR|VALOR|DOC_CAIXA|HISTORICO
 *   - DATA: ISO (YYYY-MM-DD)
 *   - VALOR: decimal com ponto (1234.56); pode ser vazio
 *   - Primeira linha pode ser cabecalho (detectado e ignorado)
 */
export function parseJBS(content: string, module: DocModule): ParseResult {
  const records: ParsedRecord[] = [];
  const errors: ParseError[] = [];
  const lines = nonEmptyLines(content);

  for (const { line, text } of lines) {
    const cols = text.split('|');
    if (line === lines[0]?.line && /^empenho$/i.test(cols[0]?.trim() ?? '')) continue;

    if (cols.length < 5) {
      errors.push({ line, message: `Esperadas >= 5 colunas separadas por '|', encontradas ${cols.length}`, raw: text });
      continue;
    }
    const [empenho, dataRaw, credor, valorRaw, docCaixa, ...rest] = cols as [
      string, string, string, string, string, ...string[],
    ];

    const fieldErrors: string[] = [];
    if (!empenho.trim()) fieldErrors.push('EMPENHO vazio');
    if (!credor.trim()) fieldErrors.push('CREDOR vazio');
    if (!docCaixa.trim()) fieldErrors.push('DOC_CAIXA vazio');
    const data = parseDataISO(dataRaw);
    if (!data) fieldErrors.push(`DATA invalida (esperado YYYY-MM-DD): "${dataRaw.trim()}"`);
    let valor: number | null = null;
    const v = valorRaw.trim();
    if (v !== '') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) fieldErrors.push(`VALOR invalido: "${v}"`);
      else valor = Math.round(n * 100) / 100;
    }

    if (fieldErrors.length > 0) {
      errors.push({ line, message: fieldErrors.join('; '), raw: text });
      continue;
    }

    records.push({
      module,
      docCaixa: docCaixa.trim(),
      empenho: empenho.trim(),
      credor: credor.trim(),
      valor,
      data: data as string,
      historico: rest.join('|').trim() || null,
      orgaoCodigo: null,
      orgaoSigla: null,
      subtype: 'orcamentaria',
    });
  }

  return { format: 'JBS', records, errors, totalLines: lines.length };
}
