import { z } from 'zod';

/**
 * Verificacao periodica de integridade (preservacao digital).
 * O SHA-256 de cada arquivo e gravado no upload; a verificacao baixa o arquivo
 * do storage, recalcula e compara. Divergencia (arquivo alterado/corrompido) ou
 * ausencia (sumiu do storage) vira ocorrencia ate alguem trata-la.
 */

/** Arquivo conferido ha mais que isso volta para a fila da verificacao rotativa. */
export const INTEGRIDADE_CICLO_DIAS = 30;
/** Arquivos por execucao (noturna ou manual): limita tempo e trafego do storage. */
export const INTEGRIDADE_LOTE_MAX = 2000;

export const INTEGRIDADE_STATUS = ['ok', 'divergente', 'ausente'] as const;
export type IntegridadeStatus = (typeof INTEGRIDADE_STATUS)[number];

export const OCORRENCIA_TIPOS = ['divergente', 'ausente'] as const;
export type OcorrenciaTipo = (typeof OCORRENCIA_TIPOS)[number];

export const VERIFICACAO_ORIGENS = ['agendada', 'manual'] as const;
export type VerificacaoOrigem = (typeof VERIFICACAO_ORIGENS)[number];

export interface VerificacaoIntegridadeView {
  id: string;
  origem: VerificacaoOrigem;
  status: 'processando' | 'concluida' | 'erro';
  iniciadaEm: string;
  concluidaEm: string | null;
  iniciadaPor: string | null;
  total: number;
  ok: number;
  divergentes: number;
  ausentes: number;
  erro: string | null;
}

export interface OcorrenciaIntegridadeView {
  id: string;
  documentId: string;
  documentFileId: string | null;
  tipo: OcorrenciaTipo;
  /** Identificacao legivel do documento (numero, doc. caixa, descricao...). */
  documento: string;
  modulo: string;
  arquivo: string;
  hashEsperado: string;
  hashEncontrado: string | null;
  detectadaEm: string;
  resolvidaEm: string | null;
  resolvidaPor: string | null;
  observacao: string | null;
}

export interface IntegridadeResumo {
  /** Arquivos com hash (universo verificavel). */
  totalArquivos: number;
  /** Conferidos dentro do ciclo (ultimos INTEGRIDADE_CICLO_DIAS dias) e integros. */
  verificadosNoCiclo: number;
  /** Nunca conferidos. */
  nuncaVerificados: number;
  ocorrenciasAbertas: number;
  ultimaVerificacao: VerificacaoIntegridadeView | null;
}

export const resolverOcorrenciaSchema = z
  .object({
    observacao: z.string().trim().min(5, 'Descreva o que foi feito (mínimo 5 caracteres)').max(1000),
  })
  .strict();
export type ResolverOcorrenciaInput = z.infer<typeof resolverOcorrenciaSchema>;

export const listarOcorrenciasQuerySchema = z
  .object({
    situacao: z.enum(['abertas', 'resolvidas', 'todas']).default('abertas'),
  })
  .strict();
