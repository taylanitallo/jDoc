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

/**
 * ativo; inativo (suspenso: ninguem do orgao entra); manutencao (durante uma
 * restauracao de backup); arquivado (contrato encerrado, dados preservados).
 */
export const TENANT_STATUS = ['ativo', 'inativo', 'manutencao', 'arquivado'] as const;
export const tenantStatusSchema = z.enum(TENANT_STATUS);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  ativo: 'Ativo',
  inativo: 'Suspenso',
  manutencao: 'Em manutenção',
  arquivado: 'Arquivado',
};

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
/**
 * Slug de orgao NOVO: vira o endereco (doc.jeossistemas.com/<slug>), entao so letras
 * minusculas sem acento e numeros — sem espaco, "_", "-", "ç", "~" etc. Slugs antigos
 * com "_" continuam validos (tenantSlugSchema), so nao se cria mais nenhum.
 */
export const novoTenantSlugSchema = z
  .string()
  .min(3, 'O endereço precisa ter ao menos 3 caracteres')
  .max(30, 'O endereço pode ter no máximo 30 caracteres')
  .regex(/^[a-z0-9]+$/, 'Use só letras minúsculas sem acento e números (sem espaço, ç, _, - ou símbolos)')
  .refine((s) => !(RESERVED_TENANT_SLUGS as readonly string[]).includes(s), 'Endereço reservado pelo sistema — escolha outro');

/** Converte um texto (ex.: "Irauçuba", "São Gonçalo do Amarante") em slug valido: "iraucuba", "saogoncalodoamarante". */
export function slugDeTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
}
