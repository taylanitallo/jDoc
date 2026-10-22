import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  type AdminAtual,
  type AdminLoginInput,
  type PapelAdmin,
  type ReauthInput,
  type SuperadminAccessClaims,
  type TrocarSenhaAdminInput,
  type UiTheme,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { cifrar, decifrar, estaCifrado } from '../common/crypto';
import { PasswordService } from '../auth/password.service';
import { BruteForceService } from '../auth/brute-force.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { AdminSessionsService } from './admin-sessions.service';
import type { AdminReq } from './decorators';

const ACCESS_TTL = '15m';
/** Generica: nao diz se o e-mail existe nem qual dos dois errou. */
const FAIL_MSG = 'E-mail ou senha incorretos.';
/** 5 erros seguidos bloqueiam a conta por 15 minutos (423). */
const BLOQUEIO_S = 15 * 60;
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
  role: PapelAdmin;
  ui_theme: UiTheme | null;
}

export interface SuperadminLoginResult {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  must2FASetup: boolean;
}

/** Segredo TOTP guardado cifrado; os antigos (em claro) continuam legiveis. */
function segredo(v: string): string {
  return estaCifrado(v) ? decifrar(v) : v;
}

/**
 * Realm SUPERADMIN — separado do realm do orgao: tabela propria
 * (public.superadmins), issuer/audience proprios, cookie proprio com path
 * /superadmin, sessoes em platform.admin_sessions.
 */
@Injectable()
export class SuperadminAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly bruteForce: BruteForceService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly sessions: AdminSessionsService,
    private readonly audit: AuditService,
  ) {}

  private buscar(campo: 'email' | 'id', valor: string): Promise<SuperadminRow | undefined> {
    const sql = this.db.catalog();
    const filtro = campo === 'email' ? sql`email = ${valor}` : sql`id = ${valor}`;
    return sql<SuperadminRow[]>`
      SELECT id, email, nome, senha_hash, totp_secret, totp_enabled, ativo, must_change_password, role, ui_theme
      FROM public.superadmins WHERE ${filtro} LIMIT 1
    `.then((r) => r[0]);
  }

  /**
   * Login em 2 etapas no mesmo endpoint. Etapa 1 (e-mail e senha): com 2FA
   * ligado e sem codigo, responde 401 `mfa_required` (so depois de a senha
   * conferir). Etapa 2: o mesmo corpo com `totp`.
   */
  async login(input: AdminLoginInput, ip: string, userAgent: string): Promise<SuperadminLoginResult> {
    const accountKey = `sa:${input.email}`;
    await this.bruteForce.assertNotLocked(accountKey, ip, { contaBloqueada423: true });

    const admin = await this.buscar('email', input.email);
    const valid = await this.passwords.verify(admin?.senha_hash ?? DUMMY_HASH, input.senha);

    const fail = async (reason: string, message = FAIL_MSG, code = 'credenciais_invalidas'): Promise<never> => {
      await this.bruteForce.registerFailure(accountKey, ip, { lockFixoS: BLOQUEIO_S });
      await this.audit.logGlobal({
        actorType: 'security',
        actorId: admin?.id,
        adminName: admin?.nome,
        action: 'superadmin_login_failed',
        ip,
        userAgent,
        metadata: { email: input.email, reason },
      });
      throw new UnauthorizedException({ message, code });
    };

    if (!admin || !valid || !admin.ativo) return fail('credentials');

    if (admin.totp_enabled && admin.totp_secret) {
      if (!input.totp) {
        throw new UnauthorizedException({ message: 'Informe o código do autenticador.', code: 'mfa_required' });
      }
      if (!authenticator.verify({ token: input.totp, secret: segredo(admin.totp_secret) })) {
        return fail('totp_invalid', 'Código inválido.', 'mfa_invalido');
      }
    }

    await this.bruteForce.registerSuccess(accountKey);

    const refreshToken = await this.refreshTokens.issue('superadmin', { userId: admin.id });
    const sid = this.refreshTokens.familia(refreshToken) as string;
    await this.sessions.criar(sid, admin.id, ip, userAgent);
    const [accessToken] = await Promise.all([
      this.signAccess({ sub: admin.id, realm: 'superadmin', sid }),
      this.db.catalog()`UPDATE public.superadmins SET ultimo_acesso = now() WHERE id = ${admin.id}`,
    ]);

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId: admin.id,
      adminName: admin.nome,
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

    const admin = await this.buscar('id', rotation.payload.userId);
    const sid = this.refreshTokens.familia(rotation.newToken) as string;
    if (!admin || !admin.ativo) {
      await this.sessions.revogar(sid, rotation.payload.userId);
      throw new UnauthorizedException('Sessão inválida');
    }
    await this.sessions.renovar(sid, admin.id, ip, userAgent);

    const accessToken = await this.signAccess({ sub: admin.id, realm: 'superadmin', sid });
    return {
      accessToken,
      refreshToken: rotation.newToken,
      mustChangePassword: admin.must_change_password,
      must2FASetup: !admin.totp_enabled,
    };
  }

  async logout(token: string | undefined, admin: AdminReq | undefined, ip: string): Promise<void> {
    const sid = admin?.sid ?? (token ? this.refreshTokens.familia(token) : null);
    if (sid && admin) await this.sessions.revogar(sid, admin.id);
    else if (token) await this.refreshTokens.revoke('superadmin', token);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId: admin?.id,
      adminName: admin?.nome,
      action: 'superadmin_logout',
      ip,
    });
  }

  async me(adminId: string): Promise<AdminAtual> {
    const a = await this.buscar('id', adminId);
    if (!a) throw new UnauthorizedException('Sessão inválida');
    return {
      id: a.id,
      nome: a.nome,
      email: a.email,
      role: a.role,
      mfaEnabled: a.totp_enabled,
      mustChangePassword: a.must_change_password,
      uiTheme: a.ui_theme,
    };
  }

  /** Confere senha (e codigo, com 2FA ligado) sem emitir sessao. */
  private async conferirIdentidade(admin: AdminReq, senha: string, totp: string | undefined, ip: string): Promise<SuperadminRow> {
    const accountKey = `sa:${admin.email}`;
    await this.bruteForce.assertNotLocked(accountKey, ip, { contaBloqueada423: true });
    const a = await this.buscar('id', admin.id);
    const ok =
      !!a &&
      (await this.passwords.verify(a.senha_hash, senha)) &&
      (!a.totp_enabled || (!!a.totp_secret && !!totp && authenticator.verify({ token: totp, secret: segredo(a.totp_secret) })));
    if (!a || !ok) {
      await this.bruteForce.registerFailure(accountKey, ip, { lockFixoS: BLOQUEIO_S });
      throw new BadRequestException({ message: 'Senha ou código incorretos.', code: 'identidade_invalida' });
    }
    await this.bruteForce.registerSuccess(accountKey);
    return a;
  }

  /** "Confirme sua identidade": libera acoes criticas por 5 minutos nesta sessao. */
  async reauth(admin: AdminReq, input: ReauthInput, origem: { ip: string; userAgent: string }): Promise<{ ate: string }> {
    await this.conferirIdentidade(admin, input.senha, input.totp, origem.ip);
    const ate = await this.sessions.marcarReauth(admin.sid);
    await this.audit.logAdmin(admin, origem, { action: 'superadmin_reauth' });
    return { ate: ate.toISOString() };
  }

  async trocarSenha(admin: AdminReq, input: TrocarSenhaAdminInput, origem: { ip: string; userAgent: string }): Promise<void> {
    const a = await this.buscar('id', admin.id);
    if (!a || !(await this.passwords.verify(a.senha_hash, input.senhaAtual))) {
      throw new BadRequestException('Senha atual incorreta');
    }
    if (input.senhaAtual === input.novaSenha) throw new BadRequestException('A nova senha deve ser diferente da atual');
    const hash = await this.passwords.hash(input.novaSenha);
    await this.db.catalog()`
      UPDATE public.superadmins SET senha_hash = ${hash}, must_change_password = false WHERE id = ${admin.id}
    `;
    const encerradas = await this.sessions.revogarTodas(admin.id, admin.sid);
    await this.audit.logAdmin(admin, origem, {
      action: 'superadmin_senha_alterada',
      entity: 'admin',
      entityId: admin.id,
      metadata: { sessoesEncerradas: encerradas },
    });
  }

  async salvarPreferencias(adminId: string, tema: UiTheme | null): Promise<void> {
    const sql = this.db.catalog();
    await sql`UPDATE public.superadmins SET ui_theme = ${tema ? sql.json(tema) : null} WHERE id = ${adminId}`;
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
    if (!admin) throw new UnauthorizedException('Sessão inválida');

    let secret = admin.totp_secret_pending ? segredo(admin.totp_secret_pending) : null;
    if (!secret) {
      secret = authenticator.generateSecret();
      await sql`
        UPDATE public.superadmins SET totp_secret_pending = ${cifrar(secret)} WHERE id = ${userId}
      `;
    }
    const otpauthUrl = authenticator.keyuri(admin.email, 'jDoc', secret);
    return { secret, otpauthUrl };
  }

  /** Confirma o secret pendente (gerado em setup2FA) e habilita o 2FA. */
  async confirm2FA(admin: AdminReq, totp: string, origem: { ip: string; userAgent: string }): Promise<void> {
    const sql = this.db.catalog();
    const rows = await sql<Array<{ totp_secret_pending: string | null }>>`
      SELECT totp_secret_pending FROM public.superadmins WHERE id = ${admin.id} LIMIT 1
    `;
    const pending = rows[0]?.totp_secret_pending;
    if (!pending) throw new BadRequestException('Nenhuma configuração de 2FA pendente');
    if (!authenticator.verify({ token: totp, secret: segredo(pending) })) {
      throw new BadRequestException('Código inválido');
    }

    await sql`
      UPDATE public.superadmins SET
        totp_secret = ${estaCifrado(pending) ? pending : cifrar(pending)},
        totp_enabled = true,
        totp_secret_pending = NULL
      WHERE id = ${admin.id}
    `;
    this.sessions.esquecerAdmin(admin.id);
    await this.audit.logAdmin(admin, origem, { action: 'superadmin_2fa_enabled', entity: 'admin', entityId: admin.id });
  }

  /** Desliga o proprio 2FA (senha + codigo). Ate configurar de novo, so as rotas de 2FA. */
  async desligar2FA(admin: AdminReq, input: ReauthInput, origem: { ip: string; userAgent: string }): Promise<void> {
    await this.conferirIdentidade(admin, input.senha, input.totp, origem.ip);
    await this.db.catalog()`
      UPDATE public.superadmins SET totp_enabled = false, totp_secret = NULL, totp_secret_pending = NULL WHERE id = ${admin.id}
    `;
    this.sessions.esquecerAdmin(admin.id);
    await this.audit.logAdmin(admin, origem, { action: 'superadmin_2fa_disabled', entity: 'admin', entityId: admin.id });
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
