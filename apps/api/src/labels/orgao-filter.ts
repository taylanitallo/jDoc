import type { Sql } from 'postgres';
import type { ParsedRecord, ParseError } from '@jdoc/shared';

/**
 * Resolve o orgao de cada registro e remove os que estao com importa=false.
 * Identificacao, em ordem de preferencia:
 *   1) orgaoCodigo — primeiro token da CLASSIFICACAO (formato ASPEC).
 *   2) orgaoSigla — ultimo token do cabecalho ASPEC (ex.: CMI, FME), usado
 *      quando nao ha CLASSIFICACAO (ex.: registros extraorcamentarios).
 * Registros sem nenhum dos dois (SS/JBS) ou que nao batem com nenhum orgao
 * cadastrado passam sem orgao vinculado (fail-open — o catalogo pode nao
 * estar totalmente preenchido).
 */
export interface OrgaoFilterResult {
  records: ParsedRecord[];
  errors: ParseError[];
  /** id do orgao resolvido por registro (chave = referencia do objeto ParsedRecord). */
  orgaoIdPorRegistro: Map<ParsedRecord, string>;
}

export async function filterByOrgaoImporta(
  sql: Sql,
  records: ParsedRecord[],
  errors: ParseError[],
): Promise<OrgaoFilterResult> {
  const codigos = [...new Set(records.map((r) => r.orgaoCodigo).filter((c): c is string => c !== null))];
  const siglas = [
    ...new Set(
      records.map((r) => r.orgaoSigla?.trim().toUpperCase()).filter((s): s is string => !!s),
    ),
  ];
  if (codigos.length === 0 && siglas.length === 0) {
    return { records, errors, orgaoIdPorRegistro: new Map() };
  }

  const rows = await sql<
    Array<{ id: string; codigo: string; sigla: string | null; exercicio: number; importa: boolean }>
  >`
    SELECT id, codigo, sigla, exercicio, importa FROM orgaos
    WHERE deleted_at IS NULL AND (codigo = ANY(${codigos}) OR sigla = ANY(${siglas}))
  `;
  const porCodigo = new Map(rows.map((r) => [`${r.codigo}|${r.exercicio}`, r]));
  const porSigla = new Map(
    rows.filter((r) => r.sigla).map((r) => [`${r.sigla!.toUpperCase()}|${r.exercicio}`, r]),
  );

  const kept: ParsedRecord[] = [];
  const orgaoIdPorRegistro = new Map<ParsedRecord, string>();
  const newErrors = [...errors];
  for (const r of records) {
    const exercicio = Number(r.data.slice(0, 4));
    const orgao =
      (r.orgaoCodigo ? porCodigo.get(`${r.orgaoCodigo}|${exercicio}`) : undefined) ??
      (r.orgaoSigla ? porSigla.get(`${r.orgaoSigla.trim().toUpperCase()}|${exercicio}`) : undefined);

    if (orgao?.importa === false) {
      newErrors.push({
        line: 0,
        message: `Orgao ${orgao.codigo} esta com importacao desativada (exercicio ${exercicio})`,
        raw: `Doc. Caixa ${r.docCaixa}`,
      });
      continue;
    }
    if (orgao) orgaoIdPorRegistro.set(r, orgao.id);
    kept.push(r);
  }
  return { records: kept, errors: newErrors, orgaoIdPorRegistro };
}
