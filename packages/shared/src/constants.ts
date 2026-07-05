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
