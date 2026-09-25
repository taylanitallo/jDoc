import { z } from 'zod';
import { metadadosInputSchema, type Metadados } from './metadados.js';
import type { OcrStatus } from './busca.js';
import type { GrauSigilo } from './sigilo.js';
import { faseArquivisticaSchema, nivelAcessoSchema, type FaseArquivistica, type NivelAcesso } from './arquivistica.js';

/**
 * Documentos (Fase 3).
 * Modulos de documento = subconjunto de MODULES (sem configuracoes/prestacao).
 */
export const DOC_MODULES = ['receitas', 'despesas', 'balancete', 'extrato', 'outros', 'acervo'] as const;
export const docModuleSchema = z.enum(DOC_MODULES);
export type DocModule = z.infer<typeof docModuleSchema>;

export const DOC_SUBTYPES = ['orcamentaria', 'extraorcamentaria', 'resto_a_pagar'] as const;
export const docSubtypeSchema = z.enum(DOC_SUBTYPES);
export type DocSubtype = z.infer<typeof docSubtypeSchema>;

export const DOC_STATUS = ['disponivel', 'processando', 'substituido'] as const;

/** Competencia no formato YYYY-MM. */
export const competenciaSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competencia deve ser YYYY-MM');

const base = {
  // Arquivo Municipal guarda documentos historicos: aceita desde 1800.
  exercicio: z.coerce.number().int().min(1800).max(2100),
  budgetUnitId: z.string().uuid().nullable().optional(),
  orgaoId: z.string().uuid().nullable().optional(),
  /** Classe do Plano de Classificacao. Omitida = classe padrao do modulo (Configuracoes). */
  classificacaoId: z.string().uuid().nullable().optional(),
  nivelAcesso: nivelAcessoSchema.optional(),
  /** Inicio da contagem da TTD quando o evento e manual (ex.: fim do contrato). */
  dataInicioContagem: z.coerce.date().nullable().optional(),
};

/** Campos por modulo (validacao espelhada no front e no back). */
export const despesaFieldsSchema = z
  .object({
    module: z.literal('despesas'),
    docCaixa: z.string().min(1).max(60),
    empenho: z.string().min(1).max(60),
    credor: z.string().min(1).max(200),
    subtype: docSubtypeSchema,
    historico: z.string().max(2000).optional(),
    documentDate: z.coerce.date(),
    value: z.coerce.number().nonnegative().optional(),
    ...base,
  })
  .strict();

export const receitaFieldsSchema = z
  .object({
    module: z.literal('receitas'),
    subtype: docSubtypeSchema,
    historico: z.string().max(2000).optional(),
    documentDate: z.coerce.date(),
    value: z.coerce.number().nonnegative().optional(),
    conta: z.string().max(30).optional(),
    ...base,
  })
  .strict();

export const balanceteFieldsSchema = z
  .object({
    module: z.literal('balancete'),
    competencia: competenciaSchema,
    documentDate: z.coerce.date(),
    descricao: z.string().max(2000).optional(),
    ...base,
  })
  .strict();

export const extratoFieldsSchema = z
  .object({
    module: z.literal('extrato'),
    banco: z.string().min(1).max(100),
    agencia: z.string().min(1).max(20),
    conta: z.string().min(1).max(30),
    competencia: competenciaSchema,
    documentDate: z.coerce.date(),
    descricao: z.string().max(2000).optional(),
    ...base,
  })
  .strict();

export const outroFieldsSchema = z
  .object({
    module: z.literal('outros'),
    documentTypeId: z.string().uuid(),
    descricao: z.string().min(1).max(2000),
    documentDate: z.coerce.date(),
    ...base,
  })
  .strict();

/** multipart manda booleano como string. */
const boolFromForm = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

/**
 * Metadados de digitalizacao exigidos pelo Decreto 10.278/2020 (Anexo II) para
 * documento digitalizado ter o mesmo valor do original.
 */
const digitalizacao = {
  digitalizado: boolFromForm.optional(),
  responsavelDigitalizacao: z.string().max(200).optional(),
  dataDigitalizacao: z.coerce.date().optional(),
  localDigitalizacao: z.string().max(200).optional(),
};

/** Acervo: qualquer documento do Arquivo Municipal, com metadados definidos pelo Tipo de Documento. */
export const acervoFieldsSchema = z
  .object({
    module: z.literal('acervo'),
    documentTypeId: z.string().uuid(),
    descricao: z.string().min(1).max(2000),
    documentDate: z.coerce.date(),
    metadados: metadadosInputSchema.optional(),
    ...digitalizacao,
    ...base,
  })
  .strict();

export const documentFieldsSchema = z.discriminatedUnion('module', [
  despesaFieldsSchema,
  receitaFieldsSchema,
  balanceteFieldsSchema,
  extratoFieldsSchema,
  outroFieldsSchema,
  acervoFieldsSchema,
]);
export type DocumentFields = z.infer<typeof documentFieldsSchema>;

/** Atualizacao de metadados (sem trocar arquivo). */
export const updateDocumentSchema = z
  .object({
    docCaixa: z.string().min(1).max(60).optional(),
    empenho: z.string().min(1).max(60).optional(),
    credor: z.string().min(1).max(200).optional(),
    subtype: docSubtypeSchema.optional(),
    historico: z.string().max(2000).nullable().optional(),
    descricao: z.string().max(2000).optional(),
    documentDate: z.coerce.date().optional(),
    value: z.coerce.number().nonnegative().nullable().optional(),
    competencia: competenciaSchema.optional(),
    banco: z.string().max(100).optional(),
    agencia: z.string().max(20).optional(),
    conta: z.string().max(30).optional(),
    budgetUnitId: z.string().uuid().nullable().optional(),
    orgaoId: z.string().uuid().nullable().optional(),
    documentTypeId: z.string().uuid().optional(),
    exercicio: z.coerce.number().int().min(1800).max(2100).optional(),
    classificacaoId: z.string().uuid().nullable().optional(),
    nivelAcesso: nivelAcessoSchema.optional(),
    dataInicioContagem: z.coerce.date().nullable().optional(),
    metadados: metadadosInputSchema.optional(),
    digitalizado: z.boolean().optional(),
    responsavelDigitalizacao: z.string().max(200).nullable().optional(),
    dataDigitalizacao: z.coerce.date().nullable().optional(),
    localDigitalizacao: z.string().max(200).nullable().optional(),
    /** Caixa (ou outro local) onde esta o original em papel. */
    localFisicoId: z.string().uuid().nullable().optional(),
    possuiOriginalFisico: z.boolean().optional(),
  })
  .strict();
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

/** Busca server-side com filtros avancados. */
export const searchDocumentsSchema = z
  .object({
    module: docModuleSchema,
    q: z.string().max(200).optional(),
    subtype: docSubtypeSchema.optional(),
    exercicio: z.coerce.number().int().min(1800).max(2100).optional(),
    competencia: competenciaSchema.optional(),
    budgetUnitId: z.string().uuid().optional(),
    orgaoId: z.string().uuid().optional(),
    credor: z.string().max(200).optional(),
    empenho: z.string().max(60).optional(),
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    valorMin: z.coerce.number().nonnegative().optional(),
    valorMax: z.coerce.number().nonnegative().optional(),
    /** Filtro "Com PDF" (disponivel) / "Sem PDF" (aguardando_arquivo). Omitido = todos. */
    comArquivo: z.enum(['sim', 'nao']).optional(),
    /** Filtro "Com Crítica" (divergente/falha na conferência) / "Sem Crítica". Omitido = todos. */
    critica: z.enum(['sim', 'nao']).optional(),
    classificacaoId: z.string().uuid().optional(),
    fase: faseArquivisticaSchema.optional(),
    documentTypeId: z.string().uuid().optional(),
    sort: z.enum(['data_desc', 'data_asc', 'valor_desc', 'valor_asc', 'criado_desc']).default('data_desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type SearchDocumentsQuery = z.infer<typeof searchDocumentsSchema>;

export const trashQuerySchema = z
  .object({
    module: docModuleSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type TrashQuery = z.infer<typeof trashQuerySchema>;

/** Visao de documento devolvida pela API. */
export interface DocumentView {
  id: string;
  module: DocModule;
  subtype: string | null;
  docCaixa: string | null;
  empenho: string | null;
  credor: string | null;
  historico: string | null;
  descricao: string | null;
  budgetUnitId: string | null;
  budgetUnitNome: string | null;
  orgaoId: string | null;
  orgaoCodigo: string | null;
  orgaoNome: string | null;
  documentTypeId: string | null;
  documentTypeNome: string | null;
  documentDate: string | null;
  value: number | null;
  competencia: string | null;
  exercicio: number;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  originalName: string;
  fileSize: number;
  fileHash: string;
  pageCount: number | null;
  status: string;
  criadoEm: string;
  deletedAt: string | null;
  conferenciaStatus: ConferenciaStatus | null;
  conferenciaResultado: ConferenciaResultado | null;
  conferenciaErro: string | null;
  conferenciaVerificadaEm: string | null;
  /** PDFs adicionais alem do principal (colunas acima) — anexados via "+ Adicionar outro PDF". */
  arquivosExtras: DocumentFileView[];
  /** Gestao arquivistica (Plano de Classificacao + TTD). */
  classificacaoId: string | null;
  classificacaoCodigo: string | null;
  classificacaoDescricao: string | null;
  fase: FaseArquivistica;
  nivelAcesso: NivelAcesso;
  /** Grau de sigilo LAI vigente (null = sem classificacao de sigilo). */
  grauSigilo: GrauSigilo | null;
  dataInicioContagem: string | null;
  dataPrevistaTransferencia: string | null;
  dataPrevistaDestinacao: string | null;
  /** Acervo: valores dos campos definidos pelo Tipo de Documento. */
  metadados: Metadados;
  digitalizado: boolean;
  responsavelDigitalizacao: string | null;
  dataDigitalizacao: string | null;
  localDigitalizacao: string | null;
  /** Indexacao do conteudo para a busca (null = arquivo nunca indexado / sem arquivo). */
  ocrStatus: OcrStatus | null;
  /** Arquivo fisico: local do original em papel. */
  possuiOriginalFisico: boolean;
  localFisicoId: string | null;
  localFisicoCodigo: string | null;
}

/** Um PDF extra anexado a um documento (alem do principal). */
export interface DocumentFileView {
  id: string;
  originalName: string;
  fileSize: number;
  pageCount: number | null;
  assinaturaStatus: string;
  assinadoPor: string | null;
  conferenciaStatus: ConferenciaStatus | null;
  conferenciaResultado: ConferenciaResultado | null;
  conferenciaErro: string | null;
  criadoEm: string;
}

/**
 * Conferencia por IA: cruza o PDF anexado com os dados da etiqueta (valor,
 * credor, doc de caixa) e sinaliza divergencias. Assincrona (roda apos o
 * anexo) e opcional — so ativa se a API tiver ANTHROPIC_API_KEY configurada.
 */
export const CONFERENCIA_STATUS = ['pendente', 'conforme', 'divergente', 'falha'] as const;
export type ConferenciaStatus = (typeof CONFERENCIA_STATUS)[number];

export interface ConferenciaDivergencia {
  campo: string;
  esperado: string | null;
  encontrado: string | null;
}

export interface ConferenciaResultado {
  valorEncontrado: number | null;
  credorEncontrado: string | null;
  docCaixaEncontrado: string | null;
  divergencias: ConferenciaDivergencia[];
  resumo: string;
}

/** Analise por IA sob demanda (botao "Analisar Doc (IA)") — controla custo, nao roda automatico. */
export const analisarConferenciaSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict();
export type AnalisarConferenciaInput = z.infer<typeof analisarConferenciaSchema>;

export interface AnalisarConferenciaResult {
  enqueued: string[];
  skipped: number;
}

export interface ConferenciaStatusItem {
  id: string;
  docCaixa: string | null;
  credor: string | null;
  conferenciaStatus: ConferenciaStatus | null;
  conferenciaErro: string | null;
}

export interface DocumentPage {
  items: DocumentView[];
  total: number;
  page: number;
  pageSize: number;
}

/** Retencao da lixeira em dias. */
export const TRASH_RETENTION_DAYS = 7;

// --- Pasta Monitorada: vinculo do PDF a etiqueta pelo doc de caixa -----------

/**
 * Extrai o numero do documento de caixa a partir do NOME do arquivo. O arquivo
 * e nomeado pelo doc de caixa (ex.: "2020001.pdf"). Quando ha mais de um PDF
 * para o mesmo doc de caixa, eles vem com sufixo "-N" ("2020001-1.pdf",
 * "2020001-2.pdf") — o sufixo e ignorado (le-se ate antes do "-"), pois ambos
 * pertencem ao mesmo numero (o usuario depois escolhe qual vai em qual etiqueta).
 */
export function docCaixaFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim(); // tira a extensao
  const m = /^(.+)-\d+$/.exec(base); // tira o sufixo "-N" (duplicados)
  return (m?.[1] ?? base).trim();
}

/** Etiqueta (despesa importada, ainda sem PDF) candidata a receber um arquivo. */
export interface EtiquetaCandidate {
  id: string;
  docCaixa: string | null;
  empenho: string | null;
  credor: string | null;
  subtype: string | null;
  documentDate: string | null;
  value: number | null;
}

/** Query do endpoint que busca etiquetas por doc de caixa. */
export const etiquetasByDocCaixaQuerySchema = z
  .object({
    module: docModuleSchema,
    docCaixa: z.string().trim().min(1).max(100),
  })
  .strict();
export type EtiquetasByDocCaixaQuery = z.infer<typeof etiquetasByDocCaixaQuerySchema>;

/** Etiquetas de um modulo ainda sem PDF (aguardando_arquivo) — painel + total. */
export const etiquetasPendentesQuerySchema = z.object({ module: docModuleSchema }).strict();
export type EtiquetasPendentesQuery = z.infer<typeof etiquetasPendentesQuerySchema>;

export interface EtiquetasPendentesResult {
  total: number;
  items: EtiquetaCandidate[];
}
