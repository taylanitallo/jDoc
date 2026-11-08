import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import {
  HEX_COR,
  JWT_AUDIENCE,
  JWT_ISSUER,
  TENANT_ROLES,
  descreverDispositivo,
  type AdminSessao,
  type ChangePasswordInput,
  type MinhaContaInput,
  type UiTheme,
  type LoginInput,
  type TenantAccessClaims,
  type TenantRole,
  type UsuarioAtual,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { cifrar, decifrar, estaCifrado } from '../common/crypto';
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
  /** O orgao exige 2 etapas deste usuario e ele ainda nao configurou. */
  mfaPendente: boolean;
}

interface UserRow {
  id: string;
  email: string;
  nome: string;
  senha_hash: string;
  role: string;
  ativo: boolean;
  must_change_password: boolean;
  totp_enabled: boolean;
  totp_secret: string | null;
  orgaos_codigos: string[] | null;
}

const USER_COLS = 'id, email, nome, senha_hash, role, ativo, must_change_password, totp_enabled, totp_secret, orgaos_codigos';

/** Configuracao do orgao: administradores precisam de verificacao em 2 etapas. */
export const CHAVE_MFA_OBRIGATORIO = 'mfaObrigatorioAdmin';

/** Segredo TOTP guardado cifrado (os antigos, em claro, continuam legiveis). */
function segredo(v: string): string {
  return estaCifrado(v) ? decifrar(v) : v;
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
      SELECT ${sql.unsafe(USER_COLS)} FROM users WHERE email = ${input.email} LIMIT 1
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

    // Segunda etapa: so depois de a senha conferir (nao revela quem tem 2FA).
    if (user.totp_enabled && user.totp_secret) {
      if (!input.totp) {
        throw new UnauthorizedException({ message: 'Informe o código do aplicativo autenticador.', code: 'mfa_required' });
      }
      if (!authenticator.verify({ token: input.totp, secret: segredo(user.totp_secret) })) {
        await this.bruteForce.registerFailure(accountKey, ip);
        await this.audit.logTenant({
          actorId: user.id,
          action: 'login_failed',
          ip,
          userAgent,
          metadata: { email: input.email, motivo: 'codigo_2fa' },
        });
        throw new UnauthorizedException({ message: 'Código inválido.', code: 'mfa_invalido' });
      }
    }

    await this.bruteForce.registerSuccess(accountKey);

    const refreshToken = await this.refreshTokens.issue('tenant', { userId: user.id, tenantId: ctx.tenantId }, { ip, userAgent });
    const claims = await this.montarClaims(ctx.schemaName, ctx.tenantId, ctx.slug, user, {
      senhaProvisoria: user.must_change_password,
      sid: this.refreshTokens.familia(refreshToken) ?? undefined,
    });

    const [accessToken] = await Promise.all([
      this.signAccess(claims),
      sql`UPDATE users SET ultimo_acesso = now() WHERE id = ${user.id}`,
    ]);

    await this.audit.logTenant({
      actorId: user.id,
      action: 'login',
      ip,
      userAgent,
      metadata: user.totp_enabled ? { duasEtapas: true } : undefined,
    });

    return {
      accessToken,
      refreshToken,
      mustChangePassword: user.must_change_password,
      mfaPendente: await this.mfaPendente(sql, user),
    };
  }

  /** Claims do token: papel, permissoes e a lotacao (so quando restringe). */
  private async montarClaims(
    schemaName: string,
    tenantId: string,
    slug: string,
    user: Pick<UserRow, 'id' | 'role' | 'orgaos_codigos'>,
    sessao: { senhaProvisoria?: boolean; sid?: string } = {},
  ): Promise<TenantAccessClaims> {
    const permissions = await this.loadPermissions(schemaName, user.id);
    const role = (TENANT_ROLES as readonly string[]).includes(user.role) ? (user.role as TenantRole) : 'consulta';
    const lot = role !== 'admin' && user.orgaos_codigos?.length ? user.orgaos_codigos : undefined;
    return {
      sub: user.id,
      tenantId,
      tenantSlug: slug,
      role,
      permissions,
      realm: 'tenant',
      ...(lot ? { lot } : {}),
      ...(sessao.sid ? { sid: sessao.sid } : {}),
      ...(sessao.senhaProvisoria ? { senhaProvisoria: true as const } : {}),
    };
  }

  private async mfaObrigatorio(sql: ReturnType<DatabaseService['tenant']>): Promise<boolean> {
    const [s] = await sql<Array<{ valor: unknown }>>`SELECT valor FROM tenant_settings WHERE chave = ${CHAVE_MFA_OBRIGATORIO}`;
    // jsonb gravado como texto JSON ("true") pelos saves antigos ou como booleano.
    return s?.valor === true || s?.valor === 'true';
  }

  private async mfaPendente(
    sql: ReturnType<DatabaseService['tenant']>,
    user: Pick<UserRow, 'role' | 'totp_enabled'>,
  ): Promise<boolean> {
    return user.role === 'admin' && !user.totp_enabled && (await this.mfaObrigatorio(sql));
  }

  /** Rotaciona refresh e emite novo access token. */
  async refresh(token: string, ip: string, userAgent: string): Promise<LoginResult> {
    const ctx = requireTenantContext();
    let rotation;
    try {
      rotation = await this.refreshTokens.rotate('tenant', token, { ip, userAgent });
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
      SELECT ${sql.unsafe(USER_COLS)} FROM users WHERE id = ${rotation.payload.userId} LIMIT 1
    `;
    const user = rows[0];
    if (!user || !user.ativo) {
      await this.refreshTokens.revoke('tenant', rotation.newToken);
      throw new UnauthorizedException('Sessao invalida');
    }

    const accessToken = await this.signAccess(
      await this.montarClaims(ctx.schemaName, ctx.tenantId, ctx.slug, user, {
        senhaProvisoria: user.must_change_password,
        sid: this.refreshTokens.familia(rotation.newToken) ?? undefined,
      }),
    );

    return {
      accessToken,
      refreshToken: rotation.newToken,
      mustChangePassword: user.must_change_password,
      mfaPendente: await this.mfaPendente(sql, user),
    };
  }

  async logout(token: string, actorId: string | null, ip: string): Promise<void> {
    await this.refreshTokens.revoke('tenant', token);
    await this.audit.logTenant({ actorId, action: 'logout', ip });
  }

  /** Perfil minimo para o shell (nome no rodape do menu). Tenant vem do contexto validado. */
  async me(userId: string, imp?: TenantAccessClaims['imp']): Promise<UsuarioAtual> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<
      Array<{
        nome: string;
        email: string;
        cpf: string | null;
        role: UsuarioAtual['role'];
        ui_theme: UiTheme | null;
        must_change_password: boolean;
        totp_enabled: boolean;
        orgaos_codigos: string[] | null;
      }>
    >`
      SELECT nome, email, cpf, role, ui_theme, must_change_password, totp_enabled, orgaos_codigos
      FROM users WHERE id = ${userId} AND ativo = true
    `;
    const u = rows[0];
    if (!u) throw new UnauthorizedException('Sessao invalida');
    const perms = u.role === 'admin' ? [] : await this.loadPermissions(ctx.schemaName, userId);
    const podeVerRestrito = u.role === 'admin' || perms.includes('acervo_restrito:read');
    const podeAuditar = u.role === 'admin' || perms.includes('auditoria:read');
    const podeFiscalizar = u.role === 'admin' || perms.includes('fiscal_contrato:update');
    const [cor] = await sql<Array<{ valor: unknown }>>`SELECT valor FROM tenant_settings WHERE chave = 'corDestaque'`;
    const [priv] = await sql<Array<{ valor: unknown }>>`SELECT valor FROM tenant_settings WHERE chave = 'privacidade'`;
    const privacidade = (typeof priv?.valor === 'string' ? JSON.parse(priv.valor) : priv?.valor) as { iaDesligada?: boolean } | undefined;
    const corOrgao = typeof cor?.valor === 'string' && HEX_COR.test(cor.valor) ? cor.valor : null;
    return {
      nome: u.nome,
      email: u.email,
      cpf: u.cpf,
      role: u.role,
      orgao: ctx.nome,
      podeVerRestrito,
      podeAuditar,
      podeFiscalizar,
      iaDesligada: privacidade?.iaDesligada === true,
      uiTheme: u.ui_theme,
      corOrgao,
      // No "entrar como" a equipe JEOS nao escolhe a senha de ninguem.
      mustChangePassword: !imp && u.must_change_password,
      mfaEnabled: u.totp_enabled,
      // Na sessao de "entrar como" a equipe JEOS nao configura 2FA de ninguem.
      mfaPendente: !imp && (await this.mfaPendente(sql, u)),
      lotacao: u.role === 'admin' ? [] : (u.orgaos_codigos ?? []),
      menusDesligados: Object.entries(ctx.menuOverrides ?? {})
        .filter(([, ligado]) => ligado === false)
        .map(([id]) => id),
      impersonacao: imp ? { adminNome: imp.adminNome, motivo: imp.motivo } : null,
    };
  }

  /** Minha conta: nome e CPF do proprio usuario. */
  async atualizarConta(userId: string, input: MinhaContaInput, ip: string): Promise<UsuarioAtual> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    if (input.cpf) {
      const [outro] = await sql`SELECT 1 FROM users WHERE cpf = ${input.cpf} AND id <> ${userId}`;
      if (outro) throw new ConflictException('Este CPF já está em uso por outro usuário');
    }
    await sql`UPDATE users SET nome = ${input.nome}, cpf = ${input.cpf}, atualizado_em = now() WHERE id = ${userId}`;
    await this.audit.logTenant({ actorId: userId, action: 'conta_atualizada', ip, resourceType: 'user', resourceId: userId });
    return this.me(userId);
  }

  /** Tema de cor/modo escolhido em Minha conta > Aparencia (null = usar a cor do orgao). */
  async salvarPreferencias(userId: string, tema: UiTheme | null): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    await sql`UPDATE users SET ui_theme = ${tema ? sql.json(tema) : null} WHERE id = ${userId}`;
  }

  /** Troca da propria senha; encerra as outras sessoes do usuario. */
  async trocarSenha(
    userId: string,
    input: ChangePasswordInput,
    ip: string,
    sessao: { impersonacao: boolean; sid: string | undefined },
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const [u] = await sql<Array<{ senha_hash: string; must_change_password: boolean }>>`
      SELECT senha_hash, must_change_password FROM users WHERE id = ${userId} AND ativo = true
    `;
    // Troca obrigatoria: a pessoa acabou de entrar com a senha provisoria, nao precisa repetir.
    const dispensaAtual = !!u?.must_change_password && !sessao.impersonacao;
    if (!u || (!dispensaAtual && !(input.senhaAtual && (await this.passwords.verify(u.senha_hash, input.senhaAtual))))) {
      throw new BadRequestException('Senha atual incorreta');
    }
    if (await this.passwords.verify(u.senha_hash, input.novaSenha)) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }
    const hash = await this.passwords.hash(input.novaSenha);
    await sql`UPDATE users SET senha_hash = ${hash}, must_change_password = false, atualizado_em = now() WHERE id = ${userId}`;
    // Quem tinha a senha antiga nao continua conectado.
    if (sessao.sid) await this.refreshTokens.revokeOutrasFamilias('tenant', userId, sessao.sid);
    await this.audit.logTenant({ actorId: userId, action: 'senha_alterada', ip, resourceType: 'user', resourceId: userId });
  }

  // ---------------- Aparelhos conectados ----------------

  async listarSessoes(userId: string, sidAtual: string | undefined): Promise<AdminSessao[]> {
    const sessoes = await this.refreshTokens.sessoes('tenant', userId);
    return sessoes.map((s) => ({
      id: s.id,
      ip: s.ip,
      dispositivo: descreverDispositivo(s.userAgent),
      criadoEm: s.criadoEm.toISOString(),
      ultimoUso: s.ultimoUso.toISOString(),
      atual: s.id === sidAtual,
    }));
  }

  async encerrarSessao(userId: string, sessaoId: string, ip: string): Promise<void> {
    if (!(await this.refreshTokens.revokeFamilyDoUsuario('tenant', sessaoId, userId))) {
      throw new NotFoundException('Sessão não encontrada');
    }
    await this.audit.logTenant({ actorId: userId, action: 'sessao_encerrada', ip, resourceType: 'user', resourceId: userId });
  }

  // ---------------- Verificacao em 2 etapas ----------------

  /**
   * Gera (ou reaproveita) o segredo pendente. Nao mexe no 2FA atual enquanto
   * o novo nao for confirmado.
   */
  async setup2FA(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const [u] = await sql<Array<{ email: string; totp_secret_pending: string | null }>>`
      SELECT email, totp_secret_pending FROM users WHERE id = ${userId} AND ativo = true
    `;
    if (!u) throw new UnauthorizedException('Sessao invalida');
    let secret = u.totp_secret_pending ? segredo(u.totp_secret_pending) : null;
    if (!secret) {
      secret = authenticator.generateSecret();
      await sql`UPDATE users SET totp_secret_pending = ${cifrar(secret)} WHERE id = ${userId}`;
    }
    return { secret, otpauthUrl: authenticator.keyuri(u.email, `jDoc ${ctx.nome}`, secret) };
  }

  async confirm2FA(userId: string, totp: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const [u] = await sql<Array<{ totp_secret_pending: string | null }>>`
      SELECT totp_secret_pending FROM users WHERE id = ${userId} AND ativo = true
    `;
    if (!u?.totp_secret_pending) throw new BadRequestException('Nenhuma configuração de 2 etapas pendente');
    if (!authenticator.verify({ token: totp, secret: segredo(u.totp_secret_pending) })) {
      throw new BadRequestException('Código inválido');
    }
    const cifrado = estaCifrado(u.totp_secret_pending) ? u.totp_secret_pending : cifrar(u.totp_secret_pending);
    await sql`
      UPDATE users SET totp_secret = ${cifrado}, totp_enabled = true, totp_secret_pending = NULL, atualizado_em = now()
      WHERE id = ${userId}
    `;
    await this.audit.logTenant({ actorId: userId, action: 'mfa_ativado', ip, resourceType: 'user', resourceId: userId });
  }

  /** Desligar pede senha e um codigo atual (quem pegou a sessao aberta nao desliga sozinho). */
  async desligar2FA(userId: string, senha: string, totp: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const [u] = await sql<Array<{ senha_hash: string; totp_secret: string | null; totp_enabled: boolean }>>`
      SELECT senha_hash, totp_secret, totp_enabled FROM users WHERE id = ${userId} AND ativo = true
    `;
    if (!u || !u.totp_enabled || !u.totp_secret) throw new BadRequestException('A verificação em 2 etapas não está ligada');
    const senhaOk = await this.passwords.verify(u.senha_hash, senha);
    if (!senhaOk || !authenticator.verify({ token: totp, secret: segredo(u.totp_secret) })) {
      throw new BadRequestException('Senha ou código incorretos');
    }
    await sql`
      UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_secret_pending = NULL, atualizado_em = now()
      WHERE id = ${userId}
    `;
    await this.audit.logTenant({ actorId: userId, action: 'mfa_desligado', ip, resourceType: 'user', resourceId: userId });
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

  /**
   * "Entrar como": token de acesso do usuario do orgao, marcado como
   * impersonacao, valido por 30 min e SEM refresh (acabou, acabou). Quem pede
   * e o superadmin (reauth + motivo), que audita do lado dele.
   */
  async emitirImpersonacao(
    alvo: { tenantId: string; slug: string; schemaName: string },
    userId: string,
    imp: NonNullable<TenantAccessClaims['imp']>,
  ): Promise<{ accessToken: string; expiraEm: string }> {
    const sql = this.db.tenant(alvo.schemaName);
    const [u] = await sql<Array<{ role: string; ativo: boolean; orgaos_codigos: string[] | null }>>`
      SELECT role, ativo, orgaos_codigos FROM users WHERE id = ${userId}
    `;
    // 404, nao 401: um 401 faria o painel achar que a sessao do admin caiu.
    if (!u) throw new NotFoundException('Usuário não encontrado neste órgão');
    if (!u.ativo) throw new BadRequestException('Usuário desativado: reative antes de entrar como ele');
    const claims = await this.montarClaims(alvo.schemaName, alvo.tenantId, alvo.slug, { id: userId, ...u });
    const accessToken = await this.jwt.signAsync(
      { ...claims, imp } satisfies TenantAccessClaims,
      { secret: loadEnv().JWT_ACCESS_SECRET, issuer: JWT_ISSUER.tenant, audience: JWT_AUDIENCE.tenant, expiresIn: '30m' },
    );
    return { accessToken, expiraEm: new Date(Date.now() + 30 * 60_000).toISOString() };
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
