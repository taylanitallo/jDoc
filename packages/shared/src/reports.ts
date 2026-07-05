import { z } from 'zod';

/**
 * Modulos proprios de relatorios. NAO entram em MODULES/MODULE_ACTIONS porque
 * o controle de acesso dos relatorios e separado (grant granular via seed):
 * - prestacao_contas:    admin + operador (criacao), todos (leitura/historico)
 * - midia_legislativa:   admin + operador (criacao), todos (leitura/historico)
 * - consulta:            somente read
 */
export const REPORT_MODULES = ['prestacao_contas', 'midia_legislativa'] as const;
export const reportModuleSchema = z.enum(REPORT_MODULES);
export type ReportModule = z.infer<typeof reportModuleSchema>;

/** Acoes de relatorio (subconjunto das acoes de modulo, sem update/delete). */
export const REPORT_ACTIONS = ['read', 'create'] as const;
export const reportActionSchema = z.enum(REPORT_ACTIONS);
export type ReportAction = z.infer<typeof reportActionSchema>;

/** Constroi permissao granular `relatorio:acao` (ex.: `prestacao_contas:create`). */
export function buildReportPermission(
  module: ReportModule,
  action: ReportAction,
): string {
  return `${module}:${action}`;
}

/** Mapa default para grants no seed. */
export function defaultReportPermissions(role: 'admin' | 'operador' | 'consulta'): string[] {
  if (role === 'admin' || role === 'operador') {
    return [
      buildReportPermission('prestacao_contas', 'read'),
      buildReportPermission('prestacao_contas', 'create'),
      buildReportPermission('midia_legislativa', 'read'),
      buildReportPermission('midia_legislativa', 'create'),
    ];
  }
  // consulta: somente leitura
  return [
    buildReportPermission('prestacao_contas', 'read'),
    buildReportPermission('midia_legislativa', 'read'),
  ];
}

/** Status possíveis de um job de relatório. */
export const REPORT_JOB_STATUS = ['pendente', 'processando', 'concluido', 'erro'] as const;
export const reportJobStatusSchema = z.enum(REPORT_JOB_STATUS);
export type ReportJobStatus = z.infer<typeof reportJobStatusSchema>;

/** Tipos de relatório suportados. */
export const REPORT_TIPO = ['prestacao_contas', 'midia_legislativa'] as const;
export const reportTipoSchema = z.enum(REPORT_TIPO);
export type ReportTipo = z.infer<typeof reportTipoSchema>;

/** Schema para criação de job de Prestação de Contas. */
export const prestacaoContasSchema = z
  .object({
    periodoInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodoFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tipoData: z.enum(['documento']),
    ordenacao: z.enum(['alfabetica', 'data']),
    relatorio: z.enum(['resumido_categoria']),
  })
  .strict();
export type PrestacaoContasInput = z.infer<typeof prestacaoContasSchema>;

/** Schema para criação de job de Mídia Legislativa. */
export const midiaLegislativaSchema = z
  .object({
    exercicio: z.number().int().min(2000).max(2100),
    competencias: z.array(z.number().int().min(1).max(12)).nonempty(),
    midias: z.array(z.enum(['balancete', 'extrato', 'receita', 'despesa', 'outros'])).nonempty(),
  })
  .strict();
export type MidiaLegislativaInput = z.infer<typeof midiaLegislativaSchema>;

/** Query para listagem de jobs de relatório. */
export const reportsQuerySchema = z
  .object({
    tipo: reportTipoSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

/** View de um job de relatório. */
export interface ReportJobView {
  id: string;
  tipo: ReportTipo;
  status: ReportJobStatus;
  params: PrestacaoContasInput | MidiaLegislativaInput;
  criadoPor: string | null;
  criadoEm: string;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  erroMensagem: string | null;
  totalRegistros: number;
  fileSize: number | null;
}
