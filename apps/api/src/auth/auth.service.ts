import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  TENANT_ROLES,
  type LoginInput,
  type TenantAccessClaims,
  type TenantRole,
  type UsuarioAtual,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';
import { PasswordService } from './password.service';
import { BruteForceService } from './brute-force.service';
import { RefreshTokenService } from './refresh-token.service';

const ACCESS_TTL = '15m';
const LOGIN_FAIL_MSG = 'E-mail ou senha invalidos'; // generico: nao enumera usuarios

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
}

interface UserRow {
  id: string;
  email: string;
  nome: string;
  senha_hash: string;
  role: string;
  ativo: boolean;
  must_change_password: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly bruteForce: BruteForceService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, ip: string, userAgent: string): Promise<LoginResult> {
    const ctx = requireTenantContext();
    const accountKey = `${ctx.tenantId}:${input.email}`;
    await this.bruteForce.assertNotLocked(accountKey, ip);

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<UserRow[]>`
      SELECT id, email, nome, senha_hash, role, ativo, must_change_password
      FROM users WHERE email = ${input.email} LIMIT 1
    `;
    const user = rows[0];

    // Verificacao em tempo ~constante: sempre roda argon2 mesmo sem usuario.
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await this.passwords.verify(user?.senha_hash ?? dummyHash, input.senha);

    if (!user || !valid || !user.ativo) {
      await this.bruteForce.registerFailure(accountKey, ip);
      await this.audit.logTenant({
        action: 'login_failed',
        ip,
        userAgent,
        metadata: { email: input.email },
      });
      throw new UnauthorizedException(LOGIN_FAIL_MSG);
    }

    await this.bruteForce.registerSuccess(accountKey);

    const permissions = await this.loadPermissions(ctx.schemaName, user.id);
    const role = (TENANT_ROLES as readonly string[]).includes(user.role)
      ? (user.role as TenantRole)
      : 'consulta';

    const claims: TenantAccessClaims = {
      sub: user.id,
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
      role,
      permissions,
      realm: 'tenant',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.signAccess(claims),
      this.refreshTokens.issue('tenant', { userId: user.id, tenantId: ctx.tenantId }),
      sql`UPDATE users SET ultimo_acesso = now() WHERE id = ${user.id}`,
    ]);

    await this.audit.logTenant({ actorId: user.id, action: 'login', ip, userAgent });

    return { accessToken, refreshToken, mustChangePassword: user.must_change_password };
  }

  /** Rotaciona refresh e emite novo access token. */
  async refresh(token: string, ip: string, userAgent: string): Promise<LoginResult> {
    const ctx = requireTenantContext();
    let rotation;
    try {
      rotation = await this.refreshTokens.rotate('tenant', token);
    } catch (err) {
      await this.audit.logGlobal({
        actorType: 'security',
        action: 'refresh_reuse_or_invalid',
        targetTenantId: ctx.tenantId,
        ip,
        userAgent,
      });
      throw err;
    }

    // Sessao de outro tenant apresentada nesta URL = 401 + log.
    if (rotation.payload.tenantId !== ctx.tenantId) {
      await this.audit.logGlobal({
        actorType: 'security',
        action: 'cross_tenant_refresh_attempt',
        actorId: rotation.payload.userId,
        targetTenantId: ctx.tenantId,
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Sessao invalida');
    }

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<UserRow[]>`
      SELECT id, email, nome, senha_hash, role, ativo, must_change_password
      FROM users WHERE id = ${rotation.payload.userId} LIMIT 1
    `;
    const user = rows[0];
    if (!user || !user.ativo) {
      await this.refreshTokens.revoke('tenant', rotation.newToken);
      throw new UnauthorizedException('Sessao invalida');
    }

    const permissions = await this.loadPermissions(ctx.schemaName, user.id);
    const role = (TENANT_ROLES as readonly string[]).includes(user.role)
      ? (user.role as TenantRole)
      : 'consulta';

    const accessToken = await this.signAccess({
      sub: user.id,
      tenantId: ctx.tenantId,
      tenantSlug: ctx.slug,
      role,
      permissions,
      realm: 'tenant',
    });

    return {
      accessToken,
      refreshToken: rotation.newToken,
      mustChangePassword: user.must_change_password,
    };
  }

  async logout(token: string, actorId: string | null, ip: string): Promise<void> {
    await this.refreshTokens.revoke('tenant', token);
    await this.audit.logTenant({ actorId, action: 'logout', ip });
  }

  /** Perfil minimo para o shell (nome no rodape do menu). Tenant vem do contexto validado. */
  async me(userId: string): Promise<UsuarioAtual> {
    const ctx = requireTenantContext();
    const rows = await this.db.tenant(ctx.schemaName)<Array<{ nome: string; email: string; role: UsuarioAtual['role'] }>>`
      SELECT nome, email, role FROM users WHERE id = ${userId} AND ativo = true
    `;
    const u = rows[0];
    if (!u) throw new UnauthorizedException('Sessao invalida');
    const podeVerRestrito = u.role === 'admin' || (await this.loadPermissions(ctx.schemaName, userId)).includes('acervo_restrito:read');
    return { nome: u.nome, email: u.email, role: u.role, orgao: ctx.nome, podeVerRestrito };
  }

  async logoutAll(userId: string, ip: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser('tenant', userId);
    await this.audit.logTenant({ actorId: userId, action: 'logout_all', ip });
  }

  private async loadPermissions(schemaName: string, userId: string): Promise<string[]> {
    const sql = this.db.tenant(schemaName);
    const rows = await sql<Array<{ permission_key: string }>>`
      SELECT permission_key FROM user_permissions WHERE user_id = ${userId}
    `;
    return rows.map((r) => r.permission_key);
  }

  private signAccess(claims: TenantAccessClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: loadEnv().JWT_ACCESS_SECRET,
      issuer: JWT_ISSUER.tenant,
      audience: JWT_AUDIENCE.tenant,
      expiresIn: ACCESS_TTL,
    });
  }
}
