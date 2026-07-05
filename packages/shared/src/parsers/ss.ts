import type { DocModule } from '../documents.js';
import {
  nonEmptyLines,
  parseDataBR,
  parseValorBR,
  type ParseError,
  type ParsedRecord,
  type ParseResult,
} from './types.js';

/**
 * Formato SS — CSV separado por ponto-e-virgula.
 * Layout: DOC_CAIXA;EMPENHO;CREDOR;VALOR;DATA;HISTORICO
 *   - VALOR: monetario brasileiro (1.234,56); pode ser vazio
 *   - DATA: DD/MM/YYYY
 *   - Primeira linha pode ser cabecalho (detectado e ignorado)
 */
export function parseSS(content: string, module: DocModule): ParseResult {
  const records: ParsedRecord[] = [];
  const errors: ParseError[] = [];
  const lines = nonEmptyLines(content);

  for (const { line, text } of lines) {
    const cols = text.split(';');
    // Cabecalho: primeira linha com nomes conhecidos.
    if (line === lines[0]?.line && /^doc[_ ]?caixa$/i.test(cols[0]?.trim() ?? '')) continue;

    if (cols.length < 5) {
      errors.push({ line, message: `Esperadas >= 5 colunas separadas por ';', encontradas ${cols.length}`, raw: text });
      continue;
    }
    const [docCaixa, empenho, credor, valorRaw, dataRaw, ...rest] = cols as [
      string, string, string, string, string, ...string[],
    ];

    const fieldErrors: string[] = [];
    if (!docCaixa.trim()) fieldErrors.push('DOC_CAIXA vazio');
    if (!empenho.trim()) fieldErrors.push('EMPENHO vazio');
    if (!credor.trim()) fieldErrors.push('CREDOR vazio');
    const valor = parseValorBR(valorRaw);
    if (Number.isNaN(valor)) fieldErrors.push(`VALOR invalido: "${valorRaw.trim()}"`);
    const data = parseDataBR(dataRaw);
    if (!data) fieldErrors.push(`DATA invalida (esperado DD/MM/YYYY): "${dataRaw.trim()}"`);

    if (fieldErrors.length > 0) {
      errors.push({ line, message: fieldErrors.join('; '), raw: text });
      continue;
    }

    records.push({
      module,
      docCaixa: docCaixa.trim(),
      empenho: empenho.trim(),
      credor: credor.trim(),
      valor: valor as number | null,
      data: data as string,
      historico: rest.join(';').trim() || null,
      orgaoCodigo: null,
      orgaoSigla: null,
      subtype: 'orcamentaria',
    });
  }

  return { format: 'SS', records, errors, totalLines: lines.length };
}
