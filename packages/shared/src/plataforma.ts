import { z } from 'zod';
import { emailSchema } from './auth.js';
import type { UiTheme } from './tema.js';

/**
 * Equipe da plataforma (superadmin). Papeis:
 * - owner: pode tudo.
 * - support: orgaos (leitura e usuarios), chamados, logs, jobs e performance.
 * - implantacao: criar e configurar orgaos, modulos, perfis e usuarios.
 * Equipe, configuracoes globais, restauracao e exclusao: so owner.
 */
export const PAPEIS_ADMIN = ['owner', 'support', 'implantacao'] as const;
export type PapelAdmin = (typeof PAPEIS_ADMIN)[number];

export const PAPEL_ADMIN_LABEL: Record<PapelAdmin, string> = {
  owner: 'Proprietário',
  support: 'Suporte',
  implantacao: 'Implantação',
};

export const PAPEL_ADMIN_DESCRICAO: Record<PapelAdmin, string> = {
  owner: 'Acesso total, inclusive equipe, configurações, restauração e exclusão.',
  support: 'Consulta órgãos, atende usuários, chamados, logs, jobs e performance.',
  implantacao: 'Cria e configura órgãos, módulos, perfis e usuários.',
};

/** Senha da equipe: minimo de 10 caracteres. */
export const senhaAdminSchema = z.string().min(10, 'A senha deve ter no mínimo 10 caracteres').max(200);

export const codigoMfaSchema = z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos');

/** Login em 2 etapas: sem `totp`, a API responde `mfa_required` se o 2FA estiver ligado. */
export const adminLoginSchema = z
  .object({
    email: emailSchema,
    senha: z.string().min(1).max(200),
    totp: codigoMfaSchema.optional(),
  })
  .strict();
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const reauthSchema = z.object({ senha: z.string().min(1).max(200), totp: codigoMfaSchema }).strict();
export type ReauthInput = z.infer<typeof reauthSchema>;

export const trocarSenhaAdminSchema = z
  .object({ senhaAtual: z.string().min(1).max(200), novaSenha: senhaAdminSchema })
  .strict();
export type TrocarSenhaAdminInput = z.infer<typeof trocarSenhaAdminSchema>;

export const desligarMfaSchema = reauthSchema;

export const adminConviteSchema = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome').max(200),
    email: emailSchema,
    role: z.enum(PAPEIS_ADMIN),
  })
  .strict();
export type AdminConviteInput = z.infer<typeof adminConviteSchema>;

export const adminUpdateSchema = z
  .object({
    nome: z.string().trim().min(2).max(200).optional(),
    role: z.enum(PAPEIS_ADMIN).optional(),
    ativo: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nada para alterar');
export type AdminUpdateInput = z.infer<typeof adminUpdateSchema>;

/** Claims do token de acesso do superadmin (com a sessao). */
export interface AdminAtual {
  id: string;
  nome: string;
  email: string;
  role: PapelAdmin;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  uiTheme: UiTheme | null;
}

export interface AdminSessao {
  id: string;
  ip: string | null;
  dispositivo: string;
  criadoEm: string;
  ultimoUso: string;
  atual: boolean;
}

export interface AdminEquipe {
  id: string;
  nome: string;
  email: string;
  role: PapelAdmin;
  ativo: boolean;
  mfaEnabled: boolean;
  ultimoAcesso: string | null;
  criadoEm: string;
  sessoesAtivas: number;
}

/** Resposta de convite/redefinicao: a senha so volta quando o e-mail nao pode ser enviado. */
export interface SenhaProvisoriaResposta {
  emailEnviado: boolean;
  senhaProvisoria?: string;
}

/** "Chrome no Windows" a partir do user-agent — nunca o texto cru na tela. */
export function descreverDispositivo(ua: string | null | undefined): string {
  if (!ua) return 'Dispositivo desconhecido';
  const nav = /Electron\//.test(ua)
    ? 'jDoc Desktop'
    : /Edg\//.test(ua)
      ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|node|axios|undici/i.test(ua)
              ? 'Programa'
              : 'Navegador';
  const so = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return so ? `${nav} no ${so}` : nav;
}
