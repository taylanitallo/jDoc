import { z } from 'zod';

/**
 * Gestao arquivistica (CONARQ / e-ARQ Brasil): Plano de Classificacao +
 * Tabela de Temporalidade e Destinacao (TTD). Funcoes puras — rodam no front
 * (preview de prazos no modal) e no back (gravacao + job diario).
 */

export const DESTINACOES = ['eliminacao', 'guarda_permanente'] as const;
export const destinacaoSchema = z.enum(DESTINACOES);
export type Destinacao = z.infer<typeof destinacaoSchema>;

/**
 * Evento que dispara a contagem dos prazos de guarda.
 * - data_documento: a partir da data do documento
 * - fim_exercicio: a partir de 31/12 do exercicio (padrao para documentos contabeis)
 * - manual: evento externo (ex.: encerramento do contrato, aprovacao das contas
 *   pelo TCE) — a data de inicio e informada pelo usuario; sem ela, prazos ficam pendentes.
 */
export const EVENTOS_CONTAGEM = ['data_documento', 'fim_exercicio', 'manual'] as const;
export const eventoContagemSchema = z.enum(EVENTOS_CONTAGEM);
export type EventoContagem = z.infer<typeof eventoContagemSchema>;

export const FASES_ARQUIVISTICAS = ['corrente', 'intermediaria', 'permanente', 'eliminado'] as const;
export const faseArquivisticaSchema = z.enum(FASES_ARQUIVISTICAS);
export type FaseArquivistica = z.infer<typeof faseArquivisticaSchema>;
export const FASE_LABEL: Record<FaseArquivistica, string> = { corrente: 'Corrente', intermediaria: 'Intermediária', permanente: 'Permanente', eliminado: 'Eliminado' };

export const NIVEIS_ACESSO = ['publico', 'restrito'] as const;
export const nivelAcessoSchema = z.enum(NIVEIS_ACESSO);
export type NivelAcesso = z.infer<typeof nivelAcessoSchema>;

/** Codigo de classe no padrao CONARQ: grupos numericos separados por ponto (ex.: 052.21). */
export const CLASSIFICACAO_CODIGO_REGEX = /^\d{1,4}(\.\d{1,4}){0,5}$/;

export const classificacaoSchema = z.object({
  id: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().default(null),
  codigo: z.string().regex(CLASSIFICACAO_CODIGO_REGEX, 'Codigo invalido (ex.: 052.21)'),
  descricao: z.string().min(1).max(300),
  /** null = classe apenas agrupadora (sem TTD propria; documentos devem usar subclasse). */
  prazoCorrenteAnos: z.number().int().min(0).max(200).nullable().default(null),
  prazoIntermediarioAnos: z.number().int().min(0).max(200).nullable().default(null),
  destinacao: destinacaoSchema.nullable().default(null),
  eventoContagem: eventoContagemSchema.default('data_documento'),
  observacoes: z.string().max(1000).nullable().default(null),
  ativo: z.boolean().default(true),
});
export type Classificacao = z.infer<typeof classificacaoSchema>;

export interface ClassificacaoView extends Required<Omit<Classificacao, 'id'>> {
  id: string;
  nivel: number;
  totalDocumentos: number;
}

/** Nivel hierarquico derivado do codigo: "050" = 1, "052.2" = 2, "052.21" = 2 (ponto conta nivel). */
export function nivelDoCodigo(codigo: string): number {
  return codigo.split('.').length;
}

/** Classe tem TTD completa (pode receber documento). */
export function classeTemTemporalidade(
  c: Pick<Classificacao, 'prazoCorrenteAnos' | 'prazoIntermediarioAnos' | 'destinacao'>,
): boolean {
  return c.prazoCorrenteAnos !== null && c.prazoIntermediarioAnos !== null && c.destinacao !== null;
}

export interface PrazosCalculados {
  /** ISO YYYY-MM-DD ou null quando o evento de contagem ainda nao ocorreu. */
  dataInicioContagem: string | null;
  dataPrevistaTransferencia: string | null;
  dataPrevistaDestinacao: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Soma anos a uma data ISO. 29/02 em ano nao bissexto vira 28/02 (nunca "pula" pra marco). */
export function somarAnos(iso: string, anos: number): string {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Data invalida: ${iso}`);
  const ano = Number(m[1]) + anos;
  const mes = Number(m[2]);
  let dia = Number(m[3]);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimoDia) dia = ultimoDia;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Calcula as datas da TTD para um documento. Classe sem TTD completa = tudo null.
 */
export function calcularPrazos(
  classe: Pick<
    Classificacao,
    'prazoCorrenteAnos' | 'prazoIntermediarioAnos' | 'destinacao' | 'eventoContagem'
  >,
  doc: { documentDate: string | null; exercicio: number | null; dataInicioManual?: string | null },
): PrazosCalculados {
  const vazio: PrazosCalculados = {
    dataInicioContagem: null,
    dataPrevistaTransferencia: null,
    dataPrevistaDestinacao: null,
  };
  if (!classeTemTemporalidade(classe)) return vazio;

  let inicio: string | null = null;
  switch (classe.eventoContagem) {
    case 'data_documento':
      inicio = doc.documentDate ?? (doc.exercicio ? `${doc.exercicio}-12-31` : null);
      break;
    case 'fim_exercicio': {
      const ano = doc.exercicio ?? (doc.documentDate ? Number(doc.documentDate.slice(0, 4)) : null);
      inicio = ano ? `${ano}-12-31` : null;
      break;
    }
    case 'manual':
      inicio = doc.dataInicioManual ?? null;
      break;
  }
  if (!inicio) return vazio;
  if (!ISO_DATE.test(inicio)) throw new Error(`Data invalida: ${inicio}`);

  const transferencia = somarAnos(inicio, classe.prazoCorrenteAnos as number);
  const destinacao = somarAnos(transferencia, classe.prazoIntermediarioAnos as number);
  return {
    dataInicioContagem: inicio,
    dataPrevistaTransferencia: transferencia,
    dataPrevistaDestinacao: destinacao,
  };
}

export const SITUACOES_TEMPORALIDADE = [
  'sem_classificacao',
  'prazo_pendente',
  'em_prazo',
  'a_transferir',
  'a_eliminar',
  'a_recolher',
  'permanente',
  'eliminado',
] as const;
export type SituacaoTemporalidade = (typeof SITUACOES_TEMPORALIDADE)[number];

/**
 * Situacao do documento na TTD em uma data de referencia (hoje, por padrao).
 * - a_transferir: fase corrente e prazo corrente vencido
 * - a_eliminar / a_recolher: prazo total vencido, conforme destinacao
 */
export function situacaoTemporalidade(
  doc: {
    fase: FaseArquivistica;
    classificacaoId: string | null;
    destinacao: Destinacao | null;
    dataPrevistaTransferencia: string | null;
    dataPrevistaDestinacao: string | null;
  },
  hojeIso: string,
): SituacaoTemporalidade {
  if (doc.fase === 'eliminado') return 'eliminado';
  if (doc.fase === 'permanente') return 'permanente';
  if (!doc.classificacaoId) return 'sem_classificacao';
  if (!doc.dataPrevistaDestinacao || !doc.dataPrevistaTransferencia || !doc.destinacao) {
    return 'prazo_pendente';
  }
  if (doc.dataPrevistaDestinacao <= hojeIso) {
    return doc.destinacao === 'eliminacao' ? 'a_eliminar' : 'a_recolher';
  }
  if (doc.fase === 'corrente' && doc.dataPrevistaTransferencia <= hojeIso) return 'a_transferir';
  return 'em_prazo';
}

/** Chave em tenant_settings com a classe padrao por modulo financeiro. */
export const SETTING_CLASSIFICACAO_PADRAO = 'classificacao_padrao_por_modulo';
export const classificacaoPadraoPorModuloSchema = z
  .object({
    receitas: z.string().uuid().nullable().optional(),
    despesas: z.string().uuid().nullable().optional(),
    balancete: z.string().uuid().nullable().optional(),
    extrato: z.string().uuid().nullable().optional(),
    outros: z.string().uuid().nullable().optional(),
  })
  .strict();
export type ClassificacaoPadraoPorModulo = z.infer<typeof classificacaoPadraoPorModuloSchema>;

export const temporalidadeListaSchema = z.enum(['a_transferir', 'a_eliminar', 'a_recolher', 'sem_classificacao']);
export type TemporalidadeLista = z.infer<typeof temporalidadeListaSchema>;

export interface TemporalidadeItem {
  id: string;
  module: string;
  descricao: string;
  classificacaoCodigo: string | null;
  classificacaoDescricao: string | null;
  documentDate: string | null;
  exercicio: number;
  fase: FaseArquivistica;
  dataPrevistaTransferencia: string | null;
  dataPrevistaDestinacao: string | null;
}

export interface TemporalidadeResumo {
  aTransferir: number;
  aEliminar: number;
  aRecolher: number;
  semClassificacao: number;
  totalAtivos: number;
}

/** Linha do CSV de import/export da TTD (separador ';', cabecalho fixo). */
export const TTD_CSV_HEADER = [
  'codigo',
  'descricao',
  'prazo_corrente_anos',
  'prazo_intermediario_anos',
  'destinacao',
  'evento_contagem',
  'observacoes',
] as const;
