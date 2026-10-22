import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  minhaContaSchema,
  preferenciasSchema,
  type ChangePasswordInput,
  type LoginInput,
  type MinhaContaInput,
  type PreferenciasInput,
  type TenantAccessClaims,
  type UsuarioAtual,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { loadEnv } from '../config/env';
import { AuthService } from './auth.service';
import { CurrentUser, Permissions, Public } from './decorators';
import { TenantJwtGuard } from './tenant-jwt.guard';
import { PermissionsGuard } from './permissions.guard';
import { Throttle } from '@nestjs/throttler';

const REFRESH_COOKIE = 'jdoc_rt';

function cookieOptions(slug: string): CookieOptions {
  return {
    httpOnly: true,
    secure: loadEnv().NODE_ENV === 'production',
    sameSite: 'strict',
    // Cookie escopado ao endpoint de auth do proprio tenant.
    path: `/t/${slug}/auth`,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

@Controller('t/:slug/auth')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; mustChangePassword: boolean }> {
    const result = await this.auth.login(body, req.ip ?? '', req.headers['user-agent'] ?? '');
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(slug));
    return { accessToken: result.accessToken, mustChangePassword: result.mustChangePassword };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; mustChangePassword: boolean }> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Sessao invalida');
    const result = await this.auth.refresh(token, req.ip ?? '', req.headers['user-agent'] ?? '');
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions(slug));
    return { accessToken: result.accessToken, mustChangePassword: result.mustChangePassword };
  }

  @Permissions()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Param('slug') slug: string,
    @CurrentUser() user: TenantAccessClaims,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) await this.auth.logout(token, user.sub, req.ip ?? '');
    res.clearCookie(REFRESH_COOKIE, { path: `/t/${slug}/auth` });
  }

  @Permissions()
  @Get('me')
  me(@CurrentUser() user: TenantAccessClaims): Promise<UsuarioAtual> {
    return this.auth.me(user.sub);
  }

  @Permissions()
  @Put('conta')
  atualizarConta(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(minhaContaSchema)) body: MinhaContaInput,
    @Req() req: Request,
  ): Promise<UsuarioAtual> {
    return this.auth.atualizarConta(user.sub, body, req.ip ?? '');
  }

  @Permissions()
  @Put('preferences')
  @HttpCode(204)
  async preferencias(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(preferenciasSchema)) body: PreferenciasInput,
  ): Promise<void> {
    await this.auth.salvarPreferencias(user.sub, body.uiTheme);
  }

  @Permissions()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password')
  @HttpCode(204)
  async trocarSenha(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.trocarSenha(user.sub, body, req.ip ?? '');
  }

  @Permissions()
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @Param('slug') slug: string,
    @CurrentUser() user: TenantAccessClaims,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user.sub, req.ip ?? '');
    res.clearCookie(REFRESH_COOKIE, { path: `/t/${slug}/auth` });
  }
}
