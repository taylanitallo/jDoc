import { z } from 'zod';
import { tenantRoleSchema, type TenantRole } from './constants.js';
import type { UiTheme } from './tema.js';

/**
 * Politica de senha: minimo 6 caracteres (pedido do cliente).
 * Checagem contra senhas vazadas comuns fica no backend (lista/serviço).
 */
export const passwordSchema = z
  .string()
  .min(6, 'A senha deve ter no mínimo 6 caracteres')
  .max(200);

export const emailSchema = z.string().email().max(254).toLowerCase();

/**
 * Login de tenant. Campos extras rejeitados (.strict()).
 */
export const loginSchema = z
  .object({
    email: emailSchema,
    senha: z.string().min(1).max(200),
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Login de superadmin — realm separado, exige codigo TOTP.
 */
export const superadminLoginSchema = z
  .object({
    email: emailSchema,
    senha: z.string().min(1).max(200),
    totp: z
      .string()
      .regex(/^\d{6}$/, 'Codigo TOTP deve ter 6 digitos')
      .optional(),
  })
  .strict();
export type SuperadminLoginInput = z.infer<typeof superadminLoginSchema>;

/** Confirmacao de configuracao de 2FA — codigo gerado a partir do secret recem-emitido. */
export const twoFaConfirmSchema = z
  .object({
    totp: z.string().regex(/^\d{6}$/, 'Codigo TOTP deve ter 6 digitos'),
  })
  .strict();
export type TwoFaConfirmInput = z.infer<typeof twoFaConfirmSchema>;

export const changePasswordSchema = z
  .object({
    senhaAtual: z.string().min(1).max(200),
    novaSenha: passwordSchema,
  })
  .strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Claims do JWT de acesso (tenant).
 */
export const tenantAccessClaimsSchema = z.object({
  sub: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  role: tenantRoleSchema,
  permissions: z.array(z.string()),
  realm: z.literal('tenant'),
});
export type TenantAccessClaims = z.infer<typeof tenantAccessClaimsSchema>;

/**
 * Claims do JWT de acesso (superadmin).
 */
export const superadminAccessClaimsSchema = z.object({
  sub: z.string().uuid(),
  realm: z.literal('superadmin'),
});
export type SuperadminAccessClaims = z.infer<typeof superadminAccessClaimsSchema>;

/**
 * Resposta de login (o access token vai no corpo; refresh vai em cookie httpOnly).
 */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  mustChangePassword: z.boolean().optional(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Login por e-mail sem slug (desktop): tenta as credenciais em todos os
 * orgaos ativos e devolve uma sessao pronta pra cada um em que baterem —
 * o cliente (app desktop) decide sozinho se entra direto (1 sessao) ou
 * pede pra escolher o orgao (2+ sessoes). So usado pelo processo main do
 * Electron (nunca pelo site, que sempre sabe o slug pela URL).
 */
export interface ResolvedTenantSession {
  tenant: { slug: string; nome: string; brasaoUrl: string | null };
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
}
export interface ResolveLoginResponse {
  sessions: ResolvedTenantSession[];
}

/** Usuario logado, para o shell (nome/papel no rodape do menu). */
export interface UsuarioAtual {
  nome: string;
  email: string;
  cpf: string | null;
  role: TenantRole;
  orgao: string;
  /** Admin ou acervo_restrito:read: enxerga documentos de acesso restrito. */
  podeVerRestrito: boolean;
  /** Tema escolhido pelo usuario (null = nunca escolheu). */
  uiTheme: UiTheme | null;
  /** Cor da marca do orgao (Configuracoes > Aparencia), padrao dos usuarios. */
  corOrgao: string | null;
  mustChangePassword: boolean;
}

/** CPF so com digitos, 11 posicoes, com digitos verificadores validos. */
export function cpfValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export const cpfSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine(cpfValido, 'CPF inválido');

/** Minha conta: dados que o proprio usuario pode mudar. */
export const minhaContaSchema = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome').max(200),
    cpf: cpfSchema.nullable(),
  })
  .strict();
export type MinhaContaInput = z.infer<typeof minhaContaSchema>;
