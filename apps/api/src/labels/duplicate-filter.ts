import type { Sql } from 'postgres';
import type { DocModule, ParsedRecord, ParseError } from '@jdoc/shared';

/**
 * Remove registros cuja combinacao Doc. Caixa + Empenho + Valor ja foi
 * importada antes (mesmo modulo, nao excluido) ou que se repete dentro do
 * proprio arquivo sendo importado. Um mesmo Doc. Caixa pode cobrir varios
 * empenhos (ex.: uma folha de pagamento paga varios empenhos no mesmo
 * documento), e um mesmo Doc. Caixa + Empenho pode se repetir legitimamente
 * se o Valor for diferente — so e duplicata se os tres baterem.
 */
export async function filterDuplicates(
  sql: Sql,
  module: DocModule,
  records: ParsedRecord[],
  errors: ParseError[],
): Promise<{ records: ParsedRecord[]; errors: ParseError[] }> {
  if (records.length === 0) return { records, errors };

  const chave = (docCaixa: string, empenho: string, valor: number | null) =>
    `${docCaixa}|${empenho}|${valor === null ? '' : valor.toFixed(2)}`;

  const docCaixas = [...new Set(records.map((r) => r.docCaixa))];
  const rows = await sql<Array<{ doc_caixa: string; empenho: string | null; value: string | null }>>`
    SELECT DISTINCT doc_caixa, empenho, value FROM documents
    WHERE module = ${module} AND doc_caixa = ANY(${docCaixas}) AND deleted_at IS NULL
  `;
  const jaImportados = new Set(
    rows.map((r) => chave(r.doc_caixa, r.empenho ?? '', r.value === null ? null : Number(r.value))),
  );

  const kept: ParsedRecord[] = [];
  const newErrors = [...errors];
  const vistosNoArquivo = new Set<string>();

  for (const r of records) {
    const k = chave(r.docCaixa, r.empenho, r.valor);
    const identificador = r.empenho ? `DC ${r.docCaixa} / Empenho ${r.empenho}` : `DC ${r.docCaixa}`;

    if (jaImportados.has(k)) {
      newErrors.push({
        line: 0,
        message: `${identificador} ja importado anteriormente`,
        raw: `Doc. Caixa ${r.docCaixa}`,
      });
      continue;
    }
    if (vistosNoArquivo.has(k)) {
      newErrors.push({
        line: 0,
        message: `${identificador} aparece duplicado neste arquivo/colagem`,
        raw: `Doc. Caixa ${r.docCaixa}`,
      });
      continue;
    }
    vistosNoArquivo.add(k);
    kept.push(r);
  }
  return { records: kept, errors: newErrors };
}
