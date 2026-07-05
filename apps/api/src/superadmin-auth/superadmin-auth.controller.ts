import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import {
  loginSchema,
  superadminLoginSchema,
  twoFaConfirmSchema,
  type LoginInput,
  type SuperadminAccessClaims,
  type SuperadminLoginInput,
  type TwoFaConfirmInput,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { loadEnv } from '../config/env';
import { Public } from '../auth/decorators';
import { SuperadminAuthService } from './superadmin-auth.service';
import { SuperadminJwtGuard } from './superadmin-jwt.guard';

const REFRESH_COOKIE = 'jdoc_sa_rt';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: loadEnv().NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/superadmin/auth', // NUNCA compartilha cookie com rotas de tenant
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

@Controller('superadmin/auth')
@UseGuards(SuperadminJwtGuard)
export class SuperadminAuthController {
  constructor(private readonly auth: SuperadminAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(superadminLoginSchema)) body: SuperadminLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; mustChangePassword: boolean; must2FASetup: boolean }> {
    const result = await this.auth.login(body, req.ip ?? '', req.headers['user-agent'] ?? '');
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions());
    return {
      accessToken: result.accessToken,
      mustChangePassword: result.mustChangePassword,
      must2FASetup: result.must2FASetup,
    };
  }

  /** So confirma email/senha, sem emitir token — usado pelo front pra so
   *  avancar da 1a pra 2a etapa (2FA) quando as credenciais realmente batem. */
  @Public()
  @Post('check-credentials')
  @HttpCode(200)
  async checkCredentials(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
  ): Promise<{ totpRequired: boolean }> {
    return this.auth.checkCredentials(body.email, body.senha, req.ip ?? '');
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; mustChangePassword: boolean; must2FASetup: boolean }> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Sessao invalida');
    const result = await this.auth.refresh(token, req.ip ?? '', req.headers['user-agent'] ?? '');
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions());
    return {
      accessToken: result.accessToken,
      mustChangePassword: result.mustChangePassword,
      must2FASetup: result.must2FASetup,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const user = (req as Request & { user?: SuperadminAccessClaims }).user;
    if (token) await this.auth.logout(token, user?.sub ?? null, req.ip ?? '');
    res.clearCookie(REFRESH_COOKIE, { path: '/superadmin/auth' });
  }

  /** Gera um novo secret TOTP pendente — precisa de sessao ja autenticada. */
  @Post('2fa/setup')
  @HttpCode(200)
  async setup2FA(
    @Req() req: Request,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const user = (req as Request & { user?: SuperadminAccessClaims }).user;
    if (!user) throw new UnauthorizedException('Nao autenticado');
    return this.auth.setup2FA(user.sub);
  }

  /** Confirma o codigo do secret pendente e habilita o 2FA definitivamente. */
  @Post('2fa/confirm')
  @HttpCode(204)
  async confirm2FA(
    @Body(new ZodValidationPipe(twoFaConfirmSchema)) body: TwoFaConfirmInput,
    @Req() req: Request,
  ): Promise<void> {
    const user = (req as Request & { user?: SuperadminAccessClaims }).user;
    if (!user) throw new UnauthorizedException('Nao autenticado');
    await this.auth.confirm2FA(user.sub, body.totp, req.ip ?? '');
  }
}
