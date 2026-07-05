import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { JWT_AUDIENCE, JWT_ISSUER, superadminAccessClaimsSchema } from '@jdoc/shared';
import { loadEnv } from '../config/env';
import { IS_PUBLIC_KEY } from '../auth/decorators';

/**
 * Guard JWT do realm SUPERADMIN.
 * - issuer/audience proprios: token de tenant NUNCA passa aqui.
 * - Allowlist de IP opcional via SUPERADMIN_ALLOWED_IPS (csv).
 */
@Injectable()
export class SuperadminJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // Allowlist de IP vale para TODAS as rotas do superadmin, inclusive login.
    this.assertIpAllowed(req);

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Nao autenticado');

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), {
        secret: loadEnv().JWT_ACCESS_SECRET,
        issuer: JWT_ISSUER.superadmin,
        audience: JWT_AUDIENCE.superadmin,
      });
    } catch {
      throw new UnauthorizedException('Nao autenticado');
    }

    const claims = superadminAccessClaimsSchema.safeParse(payload);
    if (!claims.success) throw new UnauthorizedException('Nao autenticado');

    (req as Request & { user?: unknown }).user = claims.data;
    return true;
  }

  private assertIpAllowed(req: Request): void {
    const raw = loadEnv().SUPERADMIN_ALLOWED_IPS.trim();
    if (!raw) return; // allowlist desativada
    const allowed = raw.split(',').map((s) => s.trim());
    const ip = req.ip ?? '';
    if (!allowed.includes(ip)) {
      throw new ForbiddenException('Acesso negado');
    }
  }
}
