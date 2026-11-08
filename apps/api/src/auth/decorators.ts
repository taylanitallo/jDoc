import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { TenantAccessClaims } from '@jdoc/shared';

export const IS_PUBLIC_KEY = 'isPublic';
/** Rota publica (sem JWT). Uso restrito: login/refresh/health. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export const SENHA_PROVISORIA_KEY = 'permiteSenhaProvisoria';
/** Rota liberada antes da troca da senha provisoria (ver a conta, trocar a senha, sair). */
export const PermiteSenhaProvisoria = (): MethodDecorator & ClassDecorator => SetMetadata(SENHA_PROVISORIA_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Permissoes exigidas (modulo:acao). Sem esta metadata, guard NEGA por padrao. */
export const Permissions = (...perms: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, perms);

/** Usuario autenticado (claims do JWT) injetado no handler. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantAccessClaims => {
    const req = ctx.switchToHttp().getRequest<{ user: TenantAccessClaims }>();
    return req.user;
  },
);
