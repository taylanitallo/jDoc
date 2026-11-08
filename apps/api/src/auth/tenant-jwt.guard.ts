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
import { JWT_AUDIENCE, JWT_ISSUER, tenantAccessClaimsSchema } from '@jdoc/shared';
import { loadEnv } from '../config/env';
import { AuditService } from '../audit/audit.module';
import type { TenantContext } from '../tenancy/tenant-context';
import { IS_PUBLIC_KEY, SENHA_PROVISORIA_KEY } from './decorators';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Guard JWT do realm TENANT.
 * - Verifica assinatura, issuer e audience do realm tenant.
 * - Valida shape dos claims com zod.
 * - REGRA DE OURO: compara tenantId do token com o tenant da URL.
 *   Divergencia = 401 imediato + log global de seguranca.
 */
@Injectable()
export class TenantJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { tenant?: TenantContext }>();
    const token = this.extractBearer(req);
    if (!token) throw new UnauthorizedException('Nao autenticado');

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: loadEnv().JWT_ACCESS_SECRET,
        issuer: JWT_ISSUER.tenant,
        audience: JWT_AUDIENCE.tenant,
      });
    } catch {
      throw new UnauthorizedException('Nao autenticado');
    }

    const claims = tenantAccessClaimsSchema.safeParse(payload);
    if (!claims.success) throw new UnauthorizedException('Nao autenticado');

    const tenant = req.tenant;
    if (!tenant) throw new UnauthorizedException('Nao autenticado');

    if (claims.data.tenantId !== tenant.tenantId) {
      // Tentativa cross-tenant: token valido de outro orgao.
      await this.audit.logGlobal({
        actorType: 'security',
        action: 'cross_tenant_attempt',
        actorId: claims.data.sub,
        targetTenantId: tenant.tenantId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        metadata: { tokenTenantId: claims.data.tenantId, urlSlug: tenant.slug },
      });
      throw new UnauthorizedException('Nao autenticado');
    }

    // Sessao encerrada (aparelhos conectados, logout, senha redefinida): acesso cai na hora.
    if (claims.data.sid && !(await this.refreshTokens.familiaAtiva('tenant', claims.data.sid))) {
      throw new UnauthorizedException('Nao autenticado');
    }

    if (
      claims.data.senhaProvisoria &&
      !this.reflector.getAllAndOverride<boolean>(SENHA_PROVISORIA_KEY, [context.getHandler(), context.getClass()])
    ) {
      throw new ForbiddenException({ message: 'Troque a senha provisória para continuar.', code: 'trocar_senha' });
    }

    (req as Request & { user?: unknown }).user = claims.data;
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice(7);
  }
}
