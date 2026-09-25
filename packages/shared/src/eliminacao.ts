import { z } from 'zod';

/**
 * Eliminacao legal de documentos (Resolucao CONARQ n. 40/2014):
 * rascunho (listagem) -> aprovada (CPAD) -> edital_publicado -> [prazo] -> concluida.
 * Cancelamento possivel ate a conclusao. Concluir e IRREVERSIVEL: apaga o PDF.
 */
export const ELIMINACAO_STATUS = ['rascunho', 'aprovada', 'edital_publicado', 'concluida', 'cancelada'] as const;
export type EliminacaoStatus = (typeof ELIMINACAO_STATUS)[number];

export const ELIMINACAO_STATUS_LABEL: Record<EliminacaoStatus, string> = {
  rascunho: 'Listagem em elaboração',
  aprovada: 'Aprovada pela CPAD',
  edital_publicado: 'Edital publicado',
  concluida: 'Eliminação concluída',
  cancelada: 'Cancelada',
};

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida');

export const eliminacaoCreateSchema = z
  .object({
    observacoes: z.string().trim().max(2000).nullable().default(null),
    prazoEditalDias: z.number().int().min(30).max(365).default(45),
  })
  .strict();

export const eliminacaoItensSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) }).strict();

export const membroComissaoSchema = z
  .object({ nome: z.string().trim().min(3).max(200), cargo: z.string().trim().min(2).max(200) })
  .strict();

/** Aprovacao pela Comissao Permanente de Avaliacao de Documentos (CPAD). */
export const eliminacaoAprovarSchema = z
  .object({
    ataAprovacao: z.string().trim().min(1).max(100),
    dataAprovacao: dataIso,
    comissao: z.array(membroComissaoSchema).min(2, 'Informe ao menos 2 membros da CPAD').max(20),
  })
  .strict();

export const eliminacaoPublicarSchema = z
  .object({
    veiculoPublicacao: z.string().trim().min(3).max(200),
    dataPublicacaoEdital: dataIso,
  })
  .strict();

/** Confirmacao digitada: "ELIMINAR 003/2026" — impede concluir por clique acidental. */
export function fraseConfirmacaoEliminacao(numero: number, ano: number): string {
  return `ELIMINAR ${String(numero).padStart(3, '0')}/${ano}`;
}
export const eliminacaoConcluirSchema = z.object({ confirmacao: z.string().trim().max(40) }).strict();
export const eliminacaoCancelarSchema = z.object({ motivo: z.string().trim().min(5).max(500) }).strict();

/** Data a partir da qual a eliminacao pode ser concluida (publicacao do edital + prazo). */
export function dataLiberacaoEliminacao(dataPublicacaoEdital: string | null, prazoDias: number): string | null {
  if (!dataPublicacaoEdital) return null;
  const [a, m, d] = dataPublicacaoEdital.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(a, m - 1, d + prazoDias));
  return dt.toISOString().slice(0, 10);
}

export interface EliminacaoView {
  id: string;
  numero: number;
  ano: number;
  status: EliminacaoStatus;
  observacoes: string | null;
  comissao: Array<{ nome: string; cargo: string }>;
  ataAprovacao: string | null;
  dataAprovacao: string | null;
  veiculoPublicacao: string | null;
  dataPublicacaoEdital: string | null;
  prazoEditalDias: number;
  /** Publicacao + prazo: antes disso nao conclui. */
  liberadaEm: string | null;
  totalItens: number;
  criadoEm: string;
  concluidaEm: string | null;
  motivoCancelamento: string | null;
}

export interface EliminacaoItemView {
  documentId: string;
  classificacaoCodigo: string | null;
  classificacaoDescricao: string | null;
  descricao: string;
  module: string;
  exercicio: number | null;
  documentDate: string | null;
  localFisico: string | null;
}
