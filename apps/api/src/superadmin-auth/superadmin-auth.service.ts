import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  type SuperadminAccessClaims,
  type SuperadminLoginInput,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { PasswordService } from '../auth/password.service';
import { BruteForceService } from '../auth/brute-force.service';
import { RefreshTokenService } from '../auth/refresh-token.service';

const ACCESS_TTL = '15m';
const FAIL_MSG = 'Credenciais invalidas'; // generico

// Default do otplib e window:0 (zero tolerancia) — qualquer diferenca de
// relogio entre o celular e o servidor, por menor que seja, invalida todo
// codigo. window:1 aceita o passo anterior/seguinte (+-30s de folga).
authenticator.options = { window: 1 };

interface SuperadminRow {
  id: string;
  email: string;
  nome: string;
  senha_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  ativo: boolean;
  must_change_password: boolean;
}

export interface SuperadminLoginResult {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  must2FASetup: boolean;
}

/**
 * Realm SUPERADMIN — totalmente separado do realm tenant:
 * tabela propria (public.superadmins), issuer/audience proprios,
 * cookie proprio com path /superadmin. 2FA TOTP OBRIGATORIO.
 */
@Injectable()
export class SuperadminAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly bruteForce: BruteForceService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checagem de email/senha ANTES de avancar pra tela de 2FA no login em 2
   * etapas do front — nao emite token nenhum, so confirma se da pra seguir.
   * Usa a MESMA protecao de brute-force do login de verdade (senao vira uma
   * segunda porta pra tentar senha sem limite de tentativas).
   */
  async checkCredentials(
    email: string,
    senha: string,
    ip: string,
  ): Promise<{ totpRequired: boolean }> {
    const accountKey = `sa:${email}`;
    await this.bruteForce.assertNotLocked(accountKey, ip);

    const sql = this.db.catalog();
    const rows = await sql<SuperadminRow[]>`
      SELECT senha_hash, totp_secret, totp_enabled, ativo
      FROM public.superadmins WHERE email = ${email} LIMIT 1
    `;
    const admin = rows[0];
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await this.passwords.verify(admin?.senha_hash ?? dummyHash, senha);

    if (!admin || !valid || !admin.ativo) {
      await this.bruteForce.registerFailure(accountKey, ip);
      throw new UnauthorizedException(FAIL_MSG);
    }
    return { totpRequired: admin.totp_enabled && !!admin.totp_secret };
  }

  async login(
    input: SuperadminLoginInput,
    ip: string,
    userAgent: string,
  ): Promise<SuperadminLoginResult> {
    const accountKey = `sa:${input.email}`;
    await this.bruteForce.assertNotLocked(accountKey, ip);

    const sql = this.db.catalog();
    const rows = await sql<SuperadminRow[]>`
      SELECT id, email, nome, senha_hash, totp_secret, totp_enabled, ativo, must_change_password
      FROM public.superadmins WHERE email = ${input.email} LIMIT 1
    `;
    const admin = rows[0];

    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await this.passwords.verify(admin?.senha_hash ?? dummyHash, input.senha);

    const fail = async (reason: string): Promise<never> => {
      await this.bruteForce.registerFailure(accountKey, ip);
      await this.audit.logGlobal({
        actorType: 'security',
        action: 'superadmin_login_failed',
        ip,
        userAgent,
        metadata: { email: input.email, reason },
      });
      throw new UnauthorizedException(FAIL_MSG);
    };

    if (!admin || !valid || !admin.ativo) return fail('credentials');

    // 2FA ainda nao configurado: deixa entrar (mustSetup=true faz o front
    // redirecionar para a configuracao) em vez de travar o acesso antes de
    // existir qualquer forma de configurar o 2FA. Uma vez habilitado, o
    // codigo passa a ser obrigatorio em todo login (branch abaixo).
    if (admin.totp_enabled && admin.totp_secret) {
      if (!input.totp) return fail('totp_missing');
      if (!authenticator.verify({ token: input.totp, secret: admin.totp_secret })) {
        return fail('totp_invalid');
      }
    }

    await this.bruteForce.registerSuccess(accountKey);

    const claims: SuperadminAccessClaims = { sub: admin.id, realm: 'superadmin' };
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccess(claims),
      this.refreshTokens.issue('superadmin', { userId: admin.id }),
      sql`UPDATE public.superadmins SET ultimo_acesso = now() WHERE id = ${admin.id}`,
    ]);

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId: admin.id,
      action: 'superadmin_login',
      ip,
      userAgent,
    });

    return {
      accessToken,
      refreshToken,
      mustChangePassword: admin.must_change_password,
      must2FASetup: !admin.totp_enabled,
    };
  }

  async refresh(token: string, ip: string, userAgent: string): Promise<SuperadminLoginResult> {
    let rotation;
    try {
      rotation = await this.refreshTokens.rotate('superadmin', token);
    } catch (err) {
      await this.audit.logGlobal({
        actorType: 'security',
        action: 'superadmin_refresh_reuse_or_invalid',
        ip,
        userAgent,
      });
      throw err;
    }

    const sql = this.db.catalog();
    const rows = await sql<SuperadminRow[]>`
      SELECT id, email, nome, senha_hash, totp_secret, totp_enabled, ativo, must_change_password
      FROM public.superadmins WHERE id = ${rotation.payload.userId} LIMIT 1
    `;
    const admin = rows[0];
    if (!admin || !admin.ativo) {
      await this.refreshTokens.revoke('superadmin', rotation.newToken);
      throw new UnauthorizedException('Sessao invalida');
    }

    const accessToken = await this.signAccess({ sub: admin.id, realm: 'superadmin' });
    return {
      accessToken,
      refreshToken: rotation.newToken,
      mustChangePassword: admin.must_change_password,
      must2FASetup: !admin.totp_enabled,
    };
  }

  async logout(token: string, actorId: string | null, ip: string): Promise<void> {
    await this.refreshTokens.revoke('superadmin', token);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId: actorId ?? undefined,
      action: 'superadmin_logout',
      ip,
    });
  }

  /**
   * Gera um secret TOTP pendente ate confirmar. Reaproveita um pendente ja
   * existente (nao gera outro a cada chamada) — senao recarregar a pagina de
   * setup depois de ja ter escaneado o QR troca o secret por baixo do tapete
   * e nenhum codigo do autenticador (que ficou com o QR antigo) bate mais.
   * Sobrescrever um secret ja habilitado tambem so troca ao confirmar — nao
   * desliga o 2FA atual enquanto o novo nao for confirmado com sucesso.
   */
  async setup2FA(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const sql = this.db.catalog();
    const rows = await sql<Array<{ email: string; totp_secret_pending: string | null }>>`
      SELECT email, totp_secret_pending FROM public.superadmins WHERE id = ${userId} LIMIT 1
    `;
    const admin = rows[0];
    if (!admin) throw new UnauthorizedException('Sessao invalida');

    let secret = admin.totp_secret_pending;
    if (!secret) {
      secret = authenticator.generateSecret();
      await sql`
        UPDATE public.superadmins SET totp_secret_pending = ${secret} WHERE id = ${userId}
      `;
    }
    const otpauthUrl = authenticator.keyuri(admin.email, 'jDoc', secret);
    return { secret, otpauthUrl };
  }

  /** Confirma o secret pendente (gerado em setup2FA) e habilita o 2FA. */
  async confirm2FA(userId: string, totp: string, ip: string): Promise<void> {
    const sql = this.db.catalog();
    const rows = await sql<Array<{ totp_secret_pending: string | null }>>`
      SELECT totp_secret_pending FROM public.superadmins WHERE id = ${userId} LIMIT 1
    `;
    const pending = rows[0]?.totp_secret_pending;
    if (!pending) throw new BadRequestException('Nenhuma configuracao de 2FA pendente');
    if (!authenticator.verify({ token: totp, secret: pending })) {
      throw new BadRequestException('Codigo invalido');
    }

    await sql`
      UPDATE public.superadmins SET
        totp_secret = ${pending},
        totp_enabled = true,
        totp_secret_pending = NULL
      WHERE id = ${userId}
    `;
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId: userId,
      action: 'superadmin_2fa_enabled',
      ip,
    });
  }

  private signAccess(claims: SuperadminAccessClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: loadEnv().JWT_ACCESS_SECRET,
      issuer: JWT_ISSUER.superadmin,
      audience: JWT_AUDIENCE.superadmin,
      expiresIn: ACCESS_TTL,
    });
  }
}
