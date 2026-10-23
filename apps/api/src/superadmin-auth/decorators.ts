import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PapelAdmin } from '@jdoc/shared';

export const PAPEIS_KEY = 'superadmin:papeis';
export const CRITICO_KEY = 'superadmin:critico';
export const SEM_MFA_KEY = 'superadmin:sem-mfa';

/**
 * Papeis que podem usar a rota (metodo vence a classe). Sem o decorator, so o
 * owner passa: rota nova nasce fechada.
 */
export const Papeis = (...papeis: PapelAdmin[]) => SetMetadata(PAPEIS_KEY, papeis);

/**
 * Acao critica: exige reautenticacao recente (senha + codigo, vale 5 min).
 * Sem ela a API responde `403 { code: "reauth_required" }` e o front abre o
 * "Confirme sua identidade" e repete a acao.
 */
export const Critico = () => SetMetadata(CRITICO_KEY, true);

/** Rota liberada antes de o admin configurar o 2FA (me, configurar 2FA, sair, tema). */
export const PermiteSemMfa = () => SetMetadata(SEM_MFA_KEY, true);

/** Admin autenticado, com a sessao validada no banco pelo guard. */
export interface AdminReq {
  id: string;
  nome: string;
  email: string;
  role: PapelAdmin;
  mfaEnabled: boolean;
  sid: string;
  reauthUntil: Date | null;
}

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminReq => {
  const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminReq }>();
  if (!req.admin) throw new Error('CurrentAdmin fora de rota autenticada do superadmin');
  return req.admin;
});

/** IP e navegador da requisicao, para auditoria. */
export function origem(req: Request): { ip: string; userAgent: string } {
  return { ip: req.ip ?? '', userAgent: req.headers['user-agent'] ?? '' };
}
