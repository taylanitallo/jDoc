import { z } from 'zod';

/**
 * Continuidade do servico (TR 1.5.3.9-A e 1.5.7): exportacao integral (plano
 * de saida), copia segregada de arquivos e backups, teste periodico de
 * restauracao, disponibilidade mensal e relatorio para a medicao.
 */

/** Perda maxima de dados aceita (horas): backup diario. */
export const RPO_HORAS = 24;
/** Tempo maximo para voltar a operar depois de um desastre (horas). */
export const RTO_HORAS = 8;
/** Meta de disponibilidade mensal (%). */
export const META_DISPONIBILIDADE = 99;
/** Dias que a exportacao fica disponivel para download. */
export const EXPORTACAO_VALIDADE_DIAS = 7;

export const STATUS_EXPORTACAO = ['pendente', 'processando', 'concluido', 'erro'] as const;
export type StatusExportacao = (typeof STATUS_EXPORTACAO)[number];
export const STATUS_EXPORTACAO_LABEL: Record<StatusExportacao, string> = {
  pendente: 'Na fila',
  processando: 'Gerando',
  concluido: 'Pronta',
  erro: 'Falhou',
};

export const exportacaoCreateSchema = z
  .object({ orgaoCodigo: z.string().trim().max(20).nullable().optional() })
  .strict();
export type ExportacaoCreateInput = z.infer<typeof exportacaoCreateSchema>;

export interface ParteExportacao {
  numero: number;
  nome: string;
  bytes: number;
  sha256: string;
  arquivos: number;
}

export interface ExportacaoView {
  id: string;
  status: StatusExportacao;
  orgaoCodigo: string | null;
  partes: ParteExportacao[];
  documentos: number | null;
  arquivos: number | null;
  bytes: number | null;
  erro: string | null;
  solicitadoPor: string | null;
  criadoEm: string;
  concluidoEm: string | null;
  expiraEm: string | null;
  expirada: boolean;
}

export const aceiteMigracaoSchema = z
  .object({ observacao: z.string().trim().min(5, 'Descreva quem recebeu os dados e como foram conferidos').max(2000) })
  .strict();
export type AceiteMigracaoInput = z.infer<typeof aceiteMigracaoSchema>;

export interface RestauracaoTesteView {
  id: string;
  status: 'sucesso' | 'falha';
  backupEm: string | null;
  documentos: number | null;
  usuarios: number | null;
  auditoriaRegistros: number | null;
  auditoriaIntegra: boolean | null;
  arquivosConferidos: number | null;
  arquivosOk: number | null;
  duracaoMs: number | null;
  erro: string | null;
  criadoEm: string;
}

export interface ContinuidadeView {
  rpoHoras: number;
  rtoHoras: number;
  metaDisponibilidade: number;
  ultimoBackup: { em: string; bytes: number | null } | null;
  backupsNoMes: number;
  /** Copia segregada dos arquivos e dumps. */
  copiaSegregada: {
    configurada: boolean;
    destino: string | null;
    arquivosCopiados: number;
    arquivosPendentes: number;
    ultimaCopia: string | null;
  };
  ultimoTesteRestauracao: RestauracaoTesteView | null;
  testesRestauracao: RestauracaoTesteView[];
  /** Ultimos 30 dias, % por dia (dia de hoje parcial). */
  disponibilidade: Array<{ dia: string; percentual: number }>;
  disponibilidadeMes: number | null;
  migracao: { aceitaEm: string | null; aceitaPor: string | null; observacao: string | null };
}

export const relatorioMensalQuerySchema = z
  .object({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM') })
  .strict();
export type RelatorioMensalQuery = z.infer<typeof relatorioMensalQuerySchema>;

/** "<secretaria>/<exercicio>/<modulo>/<tipo>/<data>_<numero>.pdf" sem acento, espaco vira hifen. */
export function segmentoNome(s: string | null | undefined, padrao: string): string {
  const limpo = (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return limpo || padrao;
}
