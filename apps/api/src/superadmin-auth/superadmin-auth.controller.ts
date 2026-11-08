import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import {
  adminLoginSchema,
  desligarMfaSchema,
  PAPEIS_ADMIN,
  preferenciasSchema,
  reauthSchema,
  trocarSenhaAdminSchema,
  twoFaConfirmSchema,
  type AdminAtual,
  type AdminLoginInput,
  type AdminSessao,
  type PreferenciasInput,
  type ReauthInput,
  type TrocarSenhaAdminInput,
  type TwoFaConfirmInput,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { loadEnv } from '../config/env';
import { PermiteSenhaProvisoria, Public } from '../auth/decorators';
import { SuperadminAuthService } from './superadmin-auth.service';
import { SuperadminJwtGuard } from './superadmin-jwt.guard';
import { AdminSessionsService } from './admin-sessions.service';
import { CurrentAdmin, origem, Papeis, PermiteSemMfa, type AdminReq } from './decorators';

const REFRESH_COOKIE = 'jdoc_sa_rt';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: loadEnv().NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/superadmin/auth', // NUNCA compartilha cookie com rotas de tenant
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

type RespostaLogin = { accessToken: string; mustChangePassword: boolean; must2FASetup: boolean };

/** Conta, sessao e 2FA do proprio admin: qualquer papel. */
@Controller('superadmin')
@UseGuards(SuperadminJwtGuard)
@Papeis(...PAPEIS_ADMIN)
export class SuperadminAuthController {
  constructor(
    private readonly auth: SuperadminAuthService,
    private readonly sessions: AdminSessionsService,
  ) {}

  /** Login em 2 etapas: sem `totp` e com 2FA ligado, 401 `mfa_required`. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: AdminLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaLogin> {
    const result = await this.auth.login(body, req.ip ?? '', req.headers['user-agent'] ?? '');
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions());
    return {
      accessToken: result.accessToken,
      mustChangePassword: result.mustChangePassword,
      must2FASetup: result.must2FASetup,
    };
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<RespostaLogin> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Sessão inválida');
    const result = await this.auth.refresh(token, req.ip ?? '', req.headers['user-agent'] ?? '');
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions());
    return {
      accessToken: result.accessToken,
      mustChangePassword: result.mustChangePassword,
      must2FASetup: result.must2FASetup,
    };
  }

  @PermiteSenhaProvisoria()
  @PermiteSemMfa()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(token, admin, req.ip ?? '');
    res.clearCookie(REFRESH_COOKIE, { path: '/superadmin/auth' });
  }

  @PermiteSenhaProvisoria()
  @PermiteSemMfa()
  @Get('me')
  me(@CurrentAdmin() admin: AdminReq): Promise<AdminAtual> {
    return this.auth.me(admin.id);
  }

  /** "Confirme sua identidade": senha + codigo liberam acoes criticas por 5 min. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/reauth')
  @HttpCode(200)
  reauth(
    @CurrentAdmin() admin: AdminReq,
    @Body(new ZodValidationPipe(reauthSchema)) body: ReauthInput,
    @Req() req: Request,
  ): Promise<{ ate: string }> {
    return this.auth.reauth(admin, body, origem(req));
  }

  @PermiteSenhaProvisoria()
  @PermiteSemMfa()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/password')
  @HttpCode(204)
  async trocarSenha(
    @CurrentAdmin() admin: AdminReq,
    @Body(new ZodValidationPipe(trocarSenhaAdminSchema)) body: TrocarSenhaAdminInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.trocarSenha(admin, body, origem(req));
  }

  @PermiteSemMfa()
  @Put('auth/preferences')
  @HttpCode(204)
  async preferencias(
    @CurrentAdmin() admin: AdminReq,
    @Body(new ZodValidationPipe(preferenciasSchema)) body: PreferenciasInput,
  ): Promise<void> {
    await this.auth.salvarPreferencias(admin.id, body.uiTheme);
  }

  /** Gera (ou reaproveita) o segredo pendente do autenticador. */
  @PermiteSemMfa()
  @Post('auth/mfa/setup')
  @HttpCode(200)
  setupMfa(@CurrentAdmin() admin: AdminReq): Promise<{ secret: string; otpauthUrl: string }> {
    return this.auth.setup2FA(admin.id);
  }

  @PermiteSemMfa()
  @Post('auth/mfa/enable')
  @HttpCode(204)
  async enableMfa(
    @CurrentAdmin() admin: AdminReq,
    @Body(new ZodValidationPipe(twoFaConfirmSchema)) body: TwoFaConfirmInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.confirm2FA(admin, body.totp, origem(req));
  }

  @Post('auth/mfa/disable')
  @HttpCode(204)
  async disableMfa(
    @CurrentAdmin() admin: AdminReq,
    @Body(new ZodValidationPipe(desligarMfaSchema)) body: ReauthInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.desligar2FA(admin, body, origem(req));
  }

  @PermiteSemMfa()
  @Get('auth/sessions')
  sessoes(@CurrentAdmin() admin: AdminReq): Promise<AdminSessao[]> {
    return this.sessions.listar(admin.id, admin.sid);
  }

  @PermiteSemMfa()
  @Delete('auth/sessions/:id')
  @HttpCode(204)
  async encerrarSessao(@CurrentAdmin() admin: AdminReq, @Param('id') id: string): Promise<void> {
    if (!(await this.sessions.revogar(id, admin.id))) throw new NotFoundException('Sessão não encontrada');
  }
}
