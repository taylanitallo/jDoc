import { z } from 'zod';
import { novoTenantSlugSchema, tenantStatusSchema } from './tenant.js';
import { sistemasSchema, type Sistema } from './sistemas.js';
import { cpfSchema, emailSchema, passwordSchema } from './auth.js';
import { tenantRoleSchema, permissionSchema } from './constants.js';
import { menuOverridesSchema, type MenuOverrides } from './catalogo.js';
import { HEX_COR } from './tema.js';

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

export const AMBIENTES = ['producao', 'homologacao', 'treinamento'] as const;
export type Ambiente = (typeof AMBIENTES)[number];
export const AMBIENTE_LABEL: Record<Ambiente, string> = {
  producao: 'Produção',
  homologacao: 'Homologação',
  treinamento: 'Treinamento',
};

/** CNPJ so com digitos e digitos verificadores validos. */
export function cnpjValido(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
export const cnpjSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine(cnpjValido, 'CNPJ inválido');

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
export const contratoSchema = z
  .object({
    numero: z.string().trim().max(60).nullable().optional(),
    vigenciaInicio: dataIso.nullable().optional(),
    vigenciaFim: dataIso.nullable().optional(),
    valor: z.number().nonnegative().max(1e10).nullable().optional(),
    preposto: z.string().trim().max(200).nullable().optional(),
    fiscal: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
export type Contrato = z.infer<typeof contratoSchema>;

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
    cnpj: cnpjSchema.nullable().optional(),
    ambiente: z.enum(AMBIENTES).default('producao'),
    /** Admin inicial do orgao: recebe o convite por e-mail (ou a senha volta na resposta). */
    adminInicial: z
      .object({ nome: z.string().trim().min(3).max(200), email: emailSchema })
      .strict()
      .optional(),
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
    cnpj: cnpjSchema.nullable().optional(),
    ambiente: z.enum(AMBIENTES).optional(),
    contrato: contratoSchema.optional(),
    menuOverrides: menuOverridesSchema.optional(),
    /** Cor da marca do orgao (padrao do tema dos usuarios). */
    corMarca: z.string().regex(HEX_COR).nullable().optional(),
  })
  .strict();
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/** Suspender/arquivar exige motivo (fica no cadastro e na auditoria). */
export const setTenantStatusSchema = z
  .object({ status: tenantStatusSchema, motivo: z.string().trim().max(500).optional() })
  .strict()
  .refine((v) => v.status === 'ativo' || (v.motivo?.length ?? 0) >= 5, {
    message: 'Informe o motivo (mínimo de 5 caracteres)',
    path: ['motivo'],
  });
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
  cnpj: string | null;
  ambiente: Ambiente;
  contrato: Contrato;
  menuOverrides: MenuOverrides;
  motivoStatus: string | null;
  corMarca: string | null;
  usuariosAtivos: number;
  ultimoAcesso: string | null;
}

/** Usuario de um orgao, visto pelo superadmin. */
export interface UsuarioOrgaoView {
  id: string;
  email: string;
  nome: string;
  cpf: string | null;
  role: string;
  perfilId: string | null;
  perfilNome: string | null;
  ativo: boolean;
  /** Segundos restantes de bloqueio por tentativas (0 = livre). */
  bloqueadoPor: number;
  ultimoAcesso: string | null;
  criadoEm: string;
}

export const usuarioOrgaoCreateSchema = z
  .object({
    nome: z.string().trim().min(3).max(200),
    email: emailSchema,
    cpf: cpfSchema.nullable().optional(),
    perfilId: z.string().uuid(),
  })
  .strict();
export type UsuarioOrgaoCreateInput = z.infer<typeof usuarioOrgaoCreateSchema>;

export const usuarioOrgaoUpdateSchema = z
  .object({
    nome: z.string().trim().min(3).max(200).optional(),
    email: emailSchema.optional(),
    cpf: cpfSchema.nullable().optional(),
    perfilId: z.string().uuid().optional(),
    ativo: z.boolean().optional(),
  })
  .strict();
export type UsuarioOrgaoUpdateInput = z.infer<typeof usuarioOrgaoUpdateSchema>;

export const impersonarSchema = z
  .object({
    userId: z.string().uuid(),
    motivo: z.string().trim().min(10, 'Descreva o motivo (mínimo de 10 caracteres)').max(500),
  })
  .strict();
export type ImpersonarInput = z.infer<typeof impersonarSchema>;

/** Resultado da busca global de usuarios (todos os orgaos). */
export interface UsuarioGlobalView {
  tenantId: string;
  orgao: string;
  slug: string;
  userId: string;
  nome: string;
  email: string;
  cpf: string | null;
  ativo: boolean;
  perfilNome: string | null;
  ultimoAcesso: string | null;
}

/** Login/falha de login de um orgao (aba Acessos). */
export interface AcessoView {
  id: string;
  quando: string;
  tipo: 'login' | 'falha' | 'logout';
  usuario: string | null;
  email: string | null;
  ip: string | null;
  navegador: string;
  impersonacao: string | null;
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

/** Exclusao definitiva de orgao: so com o orgao inativo e digitando o slug para confirmar. */
export const deleteTenantSchema = z.object({ confirmacao: z.string().trim().min(1) }).strict();
export type DeleteTenantInput = z.infer<typeof deleteTenantSchema>;
