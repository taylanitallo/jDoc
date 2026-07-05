import { DOC_MODULES, DOC_SUBTYPES } from '@jdoc/shared';
import type { LookupKind } from './types';

/**
 * Configuracao dos campos MINIMOS por modulo, espelhando os schemas de
 * @jdoc/shared (documentFieldsSchema). Usada para montar o modal por arquivo.
 * A validacao real e feita com o proprio schema antes de enfileirar.
 */
export type FieldType = 'text' | 'date' | 'number' | 'subtype' | 'competencia' | 'lookup';

export interface FieldDesc {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Para type 'lookup': qual fonte carregar (selects reais, sem UUID digitado). */
  lookup?: LookupKind;
}

const exercicio: FieldDesc = { name: 'exercicio', label: 'Exercício', type: 'number', required: true };
const documentDate: FieldDesc = { name: 'documentDate', label: 'Data do documento', type: 'date', required: true };
const subtype: FieldDesc = { name: 'subtype', label: 'Subtipo', type: 'subtype', required: true };
/** Unidade orcamentaria — opcional em todos os modulos (campo `base`). */
const budgetUnit: FieldDesc = {
  name: 'budgetUnitId',
  label: 'Unidade orçamentária',
  type: 'lookup',
  lookup: 'budget-units',
  required: false,
};

export const MODULE_LABELS: Record<string, string> = {
  receitas: 'Receita',
  despesas: 'Despesa',
  balancete: 'Balancete',
  extrato: 'Extrato',
  outros: 'Outros',
};

export const SUBTYPE_OPTIONS = DOC_SUBTYPES;
export const MODULES = DOC_MODULES;

export const MODULE_FIELDS: Record<string, FieldDesc[]> = {
  receitas: [subtype, documentDate, exercicio, budgetUnit],
  despesas: [
    { name: 'docCaixa', label: 'Doc. caixa', type: 'text', required: true },
    { name: 'empenho', label: 'Empenho', type: 'text', required: true },
    { name: 'credor', label: 'Credor', type: 'text', required: true },
    subtype,
    documentDate,
    exercicio,
    budgetUnit,
  ],
  balancete: [
    { name: 'competencia', label: 'Competência', type: 'competencia', required: true },
    exercicio,
    budgetUnit,
  ],
  extrato: [
    { name: 'banco', label: 'Banco', type: 'text', required: true },
    { name: 'agencia', label: 'Agência', type: 'text', required: true },
    { name: 'conta', label: 'Conta', type: 'text', required: true },
    { name: 'competencia', label: 'Competência', type: 'competencia', required: true },
    exercicio,
    budgetUnit,
  ],
  outros: [
    { name: 'documentTypeId', label: 'Tipo de documento', type: 'lookup', lookup: 'document-types', required: true },
    { name: 'descricao', label: 'Descrição', type: 'text', required: true },
    documentDate,
    exercicio,
    budgetUnit,
  ],
};
