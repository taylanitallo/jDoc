import { z } from 'zod';
import { tenantRoleSchema, type TenantRole } from './constants.js';
import type { UiTheme } from './tema.js';

/**
 * Politica de senha dos usuarios do orgao: minimo 6 caracteres, sem outra regra
 * (so numeros, letras, simbolos: tudo vale). Pedido do cliente; nao acrescentar
 * exigencias de composicao. A senha da equipe da plataforma e mais forte (10).
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
    /** Segunda etapa: so quando a conta tem verificacao em 2 etapas ligada. */
    totp: z
      .string()
      .regex(/^\d{6}$/, 'O código tem 6 dígitos')
      .optional(),
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
  /** "Entrar como": sessao aberta por um admin da plataforma (faixa de aviso, sem refresh). */
  imp: z
    .object({ adminId: z.string().uuid(), adminNome: z.string(), motivo: z.string() })
    .optional(),
  /** Lotacao: codigos das secretarias que o usuario enxerga (ausente = todas). */
  lot: z.array(z.string().max(20)).optional(),
});
export type TenantAccessClaims = z.infer<typeof tenantAccessClaimsSchema>;

/**
 * Claims do JWT de acesso (superadmin).
 */
export const superadminAccessClaimsSchema = z.object({
  sub: z.string().uuid(),
  realm: z.literal('superadmin'),
  /** Sessao (familia do refresh) — revogavel e com a janela de reautenticacao. */
  sid: z.string().min(1).max(64),
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
  /** Admin ou auditoria:read: ve a trilha de auditoria do orgao. */
  podeAuditar: boolean;
  /** Admin ou fiscal_contrato:update: aprova plano e da o aceite dos lotes. */
  podeFiscalizar: boolean;
  /** O orgao desligou a IA (assistente e conferencia somem). */
  iaDesligada: boolean;
  /** Tema escolhido pelo usuario (null = nunca escolheu). */
  uiTheme: UiTheme | null;
  /** Cor da marca do orgao (Configuracoes > Aparencia), padrao dos usuarios. */
  corOrgao: string | null;
  mustChangePassword: boolean;
  /** Verificacao em 2 etapas ligada na conta. */
  mfaEnabled: boolean;
  /** O orgao exige 2 etapas para este usuario e ele ainda nao configurou: so Minha conta ate ativar. */
  mfaPendente: boolean;
  /** Secretarias da lotacao (vazio = todas). */
  lotacao: string[];
  /** Telas desligadas pelo superadmin para este orgao. */
  menusDesligados: string[];
  /** Sessao de "entrar como" da equipe JEOS (faixa de aviso no topo). */
  impersonacao: { adminNome: string; motivo: string } | null;
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

// ---------------- Esqueci a senha ----------------

/** CPF (so digitos) ou e-mail. */
export const esqueciSenhaSchema = z
  .object({ identificador: z.string().trim().min(3, 'Informe o CPF ou o e-mail').max(254) })
  .strict();
export type EsqueciSenhaInput = z.infer<typeof esqueciSenhaSchema>;

/** Pelo link (token) ou pelo codigo de 6 digitos recebido por e-mail. */
export const redefinirSenhaSchema = z.union([
  z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, 'Link inválido'), novaSenha: passwordSchema }).strict(),
  z
    .object({
      identificador: z.string().trim().min(3).max(254),
      codigo: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos'),
      novaSenha: passwordSchema,
    })
    .strict(),
]);
export type RedefinirSenhaInput = z.infer<typeof redefinirSenhaSchema>;

/** Resposta sempre igual, exista ou nao a conta (nao revela quem e usuario). */
export const MENSAGEM_ESQUECI_SENHA =
  'Se houver uma conta com esses dados, enviamos um e-mail com o link e o código para criar uma nova senha.';
