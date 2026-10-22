import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  adminConviteSchema,
  adminUpdateSchema,
  type AdminConviteInput,
  type AdminEquipe,
  type AdminSessao,
  type AdminUpdateInput,
  type SenhaProvisoriaResposta,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SuperadminJwtGuard } from './superadmin-jwt.guard';
import { EquipeService } from './equipe.service';
import { Critico, CurrentAdmin, origem, type AdminReq } from './decorators';

/** Equipe da plataforma: so o owner (padrao do guard sem @Papeis). */
@Controller('superadmin/admins')
@UseGuards(SuperadminJwtGuard)
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}

  @Get()
  listar(): Promise<AdminEquipe[]> {
    return this.equipe.listar();
  }

  @Post()
  convidar(
    @CurrentAdmin() admin: AdminReq,
    @Body(new ZodValidationPipe(adminConviteSchema)) body: AdminConviteInput,
    @Req() req: Request,
  ): Promise<SenhaProvisoriaResposta> {
    return this.equipe.convidar(admin, body, origem(req));
  }

  /** Alterar papel ou desativar e acao critica (reauth). */
  @Patch(':aid')
  @Critico()
  atualizar(
    @CurrentAdmin() admin: AdminReq,
    @Param('aid', ParseUUIDPipe) aid: string,
    @Body(new ZodValidationPipe(adminUpdateSchema)) body: AdminUpdateInput,
    @Req() req: Request,
  ): Promise<AdminEquipe> {
    return this.equipe.atualizar(admin, aid, body, origem(req));
  }

  @Post(':aid/password')
  @Critico()
  @HttpCode(200)
  redefinirSenha(
    @CurrentAdmin() admin: AdminReq,
    @Param('aid', ParseUUIDPipe) aid: string,
    @Req() req: Request,
  ): Promise<SenhaProvisoriaResposta> {
    return this.equipe.redefinirSenha(admin, aid, origem(req));
  }

  @Post(':aid/reset-mfa')
  @Critico()
  @HttpCode(204)
  async resetarMfa(@CurrentAdmin() admin: AdminReq, @Param('aid', ParseUUIDPipe) aid: string, @Req() req: Request): Promise<void> {
    await this.equipe.resetarMfa(admin, aid, origem(req));
  }

  @Post(':aid/revoke-sessions')
  @Critico()
  @HttpCode(200)
  encerrarSessoes(
    @CurrentAdmin() admin: AdminReq,
    @Param('aid', ParseUUIDPipe) aid: string,
    @Req() req: Request,
  ): Promise<{ encerradas: number }> {
    return this.equipe.encerrarSessoes(admin, aid, origem(req));
  }

  @Get(':aid/sessions')
  sessoes(@Param('aid', ParseUUIDPipe) aid: string): Promise<AdminSessao[]> {
    return this.equipe.sessoes(aid);
  }
}
