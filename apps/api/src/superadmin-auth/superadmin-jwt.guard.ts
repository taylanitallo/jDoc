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
import { JWT_AUDIENCE, JWT_ISSUER, superadminAccessClaimsSchema, type PapelAdmin } from '@jdoc/shared';
import { loadEnv } from '../config/env';
import { IS_PUBLIC_KEY, SENHA_PROVISORIA_KEY } from '../auth/decorators';
import { AdminSessionsService } from './admin-sessions.service';
import { CRITICO_KEY, PAPEIS_KEY, SEM_MFA_KEY, type AdminReq } from './decorators';

/**
 * Guard do realm SUPERADMIN.
 * - issuer/audience proprios: token de orgao NUNCA passa aqui (e vice-versa).
 * - Allowlist de IP opcional via SUPERADMIN_ALLOWED_IPS (csv).
 * - Sessao validada no banco (encerrada = sem acesso em segundos).
 * - Senha provisoria: so ver a conta, trocar a senha e sair ate a troca.
 * - 2FA obrigatorio: sem ele, so as rotas de configurar o 2FA.
 * - Papel: `@Papeis(...)`; sem decorator, so o owner.
 * - `@Critico()`: exige reautenticacao recente (`reauth_required`).
 */
@Injectable()
export class SuperadminJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: AdminSessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { admin?: AdminReq; user?: unknown }>();
    const alvo = [context.getHandler(), context.getClass()];

    // Allowlist de IP vale para TODAS as rotas do superadmin, inclusive login.
    this.assertIpAllowed(req);

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, alvo)) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Não autenticado');

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7), {
        secret: loadEnv().JWT_ACCESS_SECRET,
        issuer: JWT_ISSUER.superadmin,
        audience: JWT_AUDIENCE.superadmin,
      });
    } catch {
      throw new UnauthorizedException('Não autenticado');
    }
    const claims = superadminAccessClaimsSchema.safeParse(payload);
    if (!claims.success) throw new UnauthorizedException('Não autenticado');

    const admin = await this.sessions.validar(claims.data.sid, claims.data.sub);
    req.admin = admin;
    req.user = claims.data;

    if (admin.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(SENHA_PROVISORIA_KEY, alvo)) {
      throw new ForbiddenException({ message: 'Troque a senha provisória para continuar.', code: 'trocar_senha' });
    }

    if (!admin.mfaEnabled && !this.reflector.getAllAndOverride<boolean>(SEM_MFA_KEY, alvo)) {
      throw new ForbiddenException({
        message: 'Configure a verificação em 2 etapas para continuar.',
        code: 'mfa_setup_required',
      });
    }

    const papeis = this.reflector.getAllAndOverride<PapelAdmin[] | undefined>(PAPEIS_KEY, alvo) ?? ['owner'];
    if (!papeis.includes(admin.role)) {
      throw new ForbiddenException({ message: 'Seu papel não permite esta ação.', code: 'papel_sem_acesso' });
    }

    if (this.reflector.getAllAndOverride<boolean>(CRITICO_KEY, alvo)) {
      if (!admin.reauthUntil || admin.reauthUntil.getTime() <= Date.now()) {
        throw new ForbiddenException({ message: 'Confirme sua identidade para continuar.', code: 'reauth_required' });
      }
    }
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
