import { z } from 'zod';

/**
 * Papeis por tenant. RBAC deny-by-default.
 * - admin: acesso total dentro do tenant
 * - operador: leitura e escrita nos modulos permitidos
 * - consulta: somente leitura
 */
export const TENANT_ROLES = ['admin', 'operador', 'consulta'] as const;
export const tenantRoleSchema = z.enum(TENANT_ROLES);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

/**
 * Modulos do sistema, base para permissoes granulares.
 */
export const MODULES = [
  'receitas',
  'despesas',
  'balancete',
  'extrato',
  'outros',
  'configuracoes',
  'prestacao_contas',
  // Arquivo Municipal / gestao arquivistica
  'acervo',
  /** So a acao read importa: ver documentos com nivel de acesso restrito (RH/LGPD). */
  'acervo_restrito',
  'classificacao',
  'temporalidade',
  'arquivo_fisico',
  /** Verificacao periodica de integridade dos arquivos (preservacao digital). */
  'integridade',
  /** Registro de atendimento/consultas ao acervo (LAI). */
  'atendimento',
  /** Classificacao de sigilo (LAI): termos de classificacao e desclassificacao. */
  'sigilo',
  /** Dossies e processos (juntada, encerramento, apensacao). */
  'dossies',
  /** Descricao arquivistica (NOBRADE) e instrumentos de pesquisa. */
  'descricao',
  /** Legislacao compilada (texto por dispositivo, alteracoes, portal publico). */
  'legislacao',
  /** Midia legislativa (pacotes mensais para a Camara). */
  'midia_legislativa',
  // Cadastros de Configuracoes (ja usados pelas rotas; antes ficavam fora da matriz).
  'orgaos',
  'unidades_orcamentarias',
  'projetos_atividades',
  'elementos_despesa',
  'tipos_documento',
  'usuarios',
  'layout',
  /** Trilha de auditoria do orgao (quem fez o que, quando e de onde). */
  'auditoria',
] as const;
export const moduleSchema = z.enum(MODULES);
export type ModuleName = z.infer<typeof moduleSchema>;

/**
 * Acoes possiveis por modulo.
 */
export const MODULE_ACTIONS = ['read', 'create', 'update', 'delete', 'export'] as const;
export const moduleActionSchema = z.enum(MODULE_ACTIONS);
export type ModuleAction = z.infer<typeof moduleActionSchema>;

/**
 * Permissao granular = modulo:acao (ex.: "despesas:create").
 */
export const permissionSchema = z
  .string()
  .regex(/^[a-z_]+:[a-z]+$/, 'Formato de permissao invalido (esperado modulo:acao)');
export type Permission = z.infer<typeof permissionSchema>;

export function buildPermission(module: ModuleName, action: ModuleAction): string {
  return `${module}:${action}`;
}

/**
 * Realms de autenticacao — isolamento total entre tenant e superadmin.
 */
export const AUTH_REALMS = ['tenant', 'superadmin'] as const;
export const authRealmSchema = z.enum(AUTH_REALMS);
export type AuthRealm = z.infer<typeof authRealmSchema>;

/**
 * Issuer/audience distintos por realm (JWT). Um token de tenant jamais
 * e aceito em /superadmin e vice-versa.
 */
export const JWT_ISSUER = {
  tenant: 'jdoc-tenant',
  superadmin: 'jdoc-superadmin',
} as const;

export const JWT_AUDIENCE = {
  tenant: 'jdoc-tenant-api',
  superadmin: 'jdoc-superadmin-api',
} as const;

/** Fuso dos orgaos atendidos: "hoje" (prazos, datas padrao, nomes de arquivo) nunca em UTC. */
export const FUSO_ORGAO = 'America/Fortaleza';

/** Data de hoje (YYYY-MM-DD) no fuso do orgao. Em UTC, a partir das 21h ja seria o dia seguinte. */
export function hojeIso(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_ORGAO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}
