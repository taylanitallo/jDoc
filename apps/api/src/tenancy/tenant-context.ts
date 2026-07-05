import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto do tenant por request (AsyncLocalStorage).
 * Regra de ouro: nenhuma query de negocio roda sem este contexto.
 */
export interface TenantContext {
  tenantId: string;
  slug: string;
  schemaName: string;
  nome: string;
  quotaDiscoMb: number;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Retorna o contexto atual ou lanca. Chamar apenas em rotas sob TenancyMiddleware.
 */
export function requireTenantContext(): TenantContext {
  const ctx = tenantContextStorage.getStore();
  if (!ctx) {
    throw new Error('Contexto de tenant ausente — rota fora do TenancyMiddleware');
  }
  return ctx;
}
