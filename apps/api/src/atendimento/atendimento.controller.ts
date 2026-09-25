import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  atendimentoConcluirSchema,
  atendimentoCreateSchema,
  atendimentoProrrogarSchema,
  atendimentosQuerySchema,
  type AtendimentoConcluirInput,
  type AtendimentoCreateInput,
  type AtendimentoResumo,
  type AtendimentosPage,
  type AtendimentosQuery,
  type AtendimentoView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { AtendimentoService } from './atendimento.service';

const uuidSchema = z.string().uuid();

/** Atendimento e consultas (LAI). Ver: atendimento:read; registrar: :create; prorrogar/concluir: :update. */
@Controller('t/:slug/atendimentos')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class AtendimentoController {
  constructor(private readonly service: AtendimentoService) {}

  @Permissions('atendimento:read')
  @Get()
  listar(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(atendimentosQuerySchema)) q: AtendimentosQuery,
  ): Promise<AtendimentosPage> {
    return this.service.listar(user, q);
  }

  @Permissions('atendimento:read')
  @Get('resumo')
  resumo(): Promise<AtendimentoResumo> {
    return this.service.resumo();
  }

  @Permissions('atendimento:read')
  @Get(':id')
  obter(@CurrentUser() user: TenantAccessClaims, @Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<AtendimentoView> {
    return this.service.obter(user, id);
  }

  @Permissions('atendimento:read')
  @Get(':id/comprovante')
  async comprovante(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const r = await this.service.comprovante(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
    res.send(r.pdf);
  }

  @Permissions('atendimento:create')
  @Post()
  criar(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(atendimentoCreateSchema)) body: AtendimentoCreateInput,
    @Req() req: Request,
  ): Promise<AtendimentoView> {
    return this.service.criar(user, body, req.ip ?? '');
  }

  @Permissions('atendimento:update')
  @Post(':id/concluir')
  concluir(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(atendimentoConcluirSchema)) body: AtendimentoConcluirInput,
    @Req() req: Request,
  ): Promise<AtendimentoView> {
    return this.service.concluir(user, id, body, req.ip ?? '');
  }

  @Permissions('atendimento:update')
  @Post(':id/prorrogar')
  prorrogar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(atendimentoProrrogarSchema)) body: z.infer<typeof atendimentoProrrogarSchema>,
    @Req() req: Request,
  ): Promise<AtendimentoView> {
    return this.service.prorrogar(user, id, body.justificativa, req.ip ?? '');
  }
}
