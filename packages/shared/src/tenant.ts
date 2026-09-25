import { z } from 'zod';

/**
 * Slug de tenant. Usado para derivar o nome do schema (tenant_<slug>).
 * Regra de ouro: valida contra este formato antes de qualquer uso.
 */
export const tenantSlugSchema = z
  .string()
  .min(2)
  .max(30)
  .regex(/^[a-z0-9_]+$/, 'Slug deve conter apenas letras minusculas, numeros e underscore');
export type TenantSlug = z.infer<typeof tenantSlugSchema>;

/**
 * Nome do schema no Postgres. NUNCA interpolar nome vindo do usuario:
 * sempre derivar do slug validado e re-validar com esta regex.
 */
export const SCHEMA_NAME_REGEX = /^tenant_[a-z0-9_]{2,30}$/;
export const schemaNameSchema = z.string().regex(SCHEMA_NAME_REGEX, 'Nome de schema invalido');

export function schemaNameForSlug(slug: string): string {
  const parsed = tenantSlugSchema.parse(slug);
  const name = `tenant_${parsed}`;
  // Re-valida a forma final antes de devolver (defesa em profundidade).
  return schemaNameSchema.parse(name);
}

export const TENANT_STATUS = ['ativo', 'inativo'] as const;
export const tenantStatusSchema = z.enum(TENANT_STATUS);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const tenantSchema = z.object({
  id: z.string().uuid(),
  slug: tenantSlugSchema,
  nome: z.string().min(1).max(200),
  brasaoUrl: z.string().url().nullable(),
  status: tenantStatusSchema,
  quotaDiscoMb: z.number().int().nonnegative(),
  criadoEm: z.string().datetime(),
});
export type Tenant = z.infer<typeof tenantSchema>;

/**
 * Slugs que colidem com rotas publicas/fixas do front (jdoc.../<slug>) — nao
 * podem virar orgao. Checado so na CRIACAO (slug existente continua valido).
 */
export const RESERVED_TENANT_SLUGS = ['verificar', 'superadmin', 'public', 'api', 't', 'login', 'files'] as const;
export const novoTenantSlugSchema = tenantSlugSchema.refine(
  (s) => !(RESERVED_TENANT_SLUGS as readonly string[]).includes(s),
  'Slug reservado pelo sistema — escolha outro',
);
