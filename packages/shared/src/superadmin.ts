import { z } from 'zod';
import { novoTenantSlugSchema, tenantStatusSchema } from './tenant.js';
import { sistemasSchema, type Sistema } from './sistemas.js';
import { emailSchema, passwordSchema } from './auth.js';
import { tenantRoleSchema, permissionSchema } from './constants.js';

/**
 * Schemas do painel superadmin (Fase 2).
 * Todos .strict(): campos extras = 400.
 */

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
] as const;
export const ufSchema = z.enum(UFS);

export const createTenantSchema = z
  .object({
    slug: novoTenantSlugSchema,
    nome: z.string().min(3).max(200),
    cidade: z.string().min(2).max(100),
    uf: ufSchema,
    responsavel: z.string().min(3).max(200),
    email: emailSchema,
    quotaDiscoMb: z.number().int().min(100).max(1048576).default(1024),
    brasaoUrl: z.string().url().max(500).nullable().optional(),
    /** Modulos contratados (Financeiro/Contabil e/ou Arquivo). */
    modulos: sistemasSchema.default(['financeiro']),
  })
  .strict();
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    nome: z.string().min(3).max(200).optional(),
    cidade: z.string().min(2).max(100).optional(),
    uf: ufSchema.optional(),
    responsavel: z.string().min(3).max(200).optional(),
    email: emailSchema.optional(),
    brasaoUrl: z.string().url().max(500).nullable().optional(),
    modulos: sistemasSchema.optional(),
  })
  .strict();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const setTenantStatusSchema = z
  .object({ status: tenantStatusSchema })
  .strict();
export type SetTenantStatusInput = z.infer<typeof setTenantStatusSchema>;

export const setQuotaSchema = z
  .object({ quotaDiscoMb: z.number().int().min(100).max(1048576) })
  .strict();
export type SetQuotaInput = z.infer<typeof setQuotaSchema>;

export const createTenantUserSchema = z
  .object({
    email: emailSchema,
    nome: z.string().min(3).max(200),
    senha: passwordSchema,
    role: tenantRoleSchema,
    /** Ignorado quando role = 'admin' (acesso total, sem necessidade de marcar). */
    permissions: z.array(permissionSchema).optional(),
  })
  .strict();
export type CreateTenantUserInput = z.infer<typeof createTenantUserSchema>;

export const resetUserPasswordSchema = z
  .object({ novaSenha: passwordSchema })
  .strict();
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;

export const setUserActiveSchema = z.object({ ativo: z.boolean() }).strict();
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;

/** Filtros de logs (query string — coerce). */
export const logsQuerySchema = z
  .object({
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    action: z.string().max(80).optional(),
    actorId: z.string().uuid().optional(),
    ip: z.string().max(45).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type LogsQuery = z.infer<typeof logsQuerySchema>;

/** Visao de tenant com uso de disco (superadmin). */
export interface TenantOverview {
  id: string;
  slug: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  responsavel: string | null;
  email: string | null;
  status: string;
  quotaDiscoMb: number;
  brasaoUrl: string | null;
  modulos: Sistema[];
  criadoEm: string;
  usoBytes: number;
  usoPercent: number;
}

export interface MasterDashboard {
  totalOrgaos: number;
  orgaosAtivos: number;
  orgaosInativos: number;
  armazenamentoTotalBytes: number;
  documentosIndexados: number;
  uploadsNoMes: number;
  crescimento: Array<{ mes: string; total: number }>;
}
