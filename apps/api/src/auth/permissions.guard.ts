import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantAccessClaims } from '@jdoc/shared';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from './decorators';

/**
 * RBAC deny-by-default.
 * - Rota sem @Permissions e sem @Public = NEGADA (obriga declaracao explicita).
 * - admin do tenant passa em qualquer permissao.
 * - Demais papeis: precisa de TODAS as permissoes declaradas.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Deny by default: rota autenticada sem declaracao explicita de permissao e negada.
    if (required === undefined) {
      throw new ForbiddenException('Acesso negado');
    }
    if (required.length === 0) return true; // @Permissions() = so exige autenticacao

    const req = context.switchToHttp().getRequest<{ user?: TenantAccessClaims }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Acesso negado');
    if (user.role === 'admin') return true;

    const granted = new Set(user.permissions);
    const ok = required.every((p) => granted.has(p));
    if (!ok) throw new ForbiddenException('Acesso negado');
    return true;
  }
}
