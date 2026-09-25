import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  instrumentoQuerySchema,
  unidadeDescricaoCreateSchema,
  unidadeDescricaoUpdateSchema,
  vincularDescricaoSchema,
  type TenantAccessClaims,
  type UnidadeDescricaoCreateInput,
  type UnidadeDescricaoNo,
  type UnidadeDescricaoUpdateInput,
  type UnidadeDescricaoView,
  type VincularDescricaoInput,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { DescricaoService } from './descricao.service';

const uuid = new ZodValidationPipe(z.string().uuid());

/** Descricao arquivistica (NOBRADE). Ver/instrumentos: descricao:read; criar: create; editar/vincular: update; excluir: delete. */
@Controller('t/:slug/descricao')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class DescricaoController {
  constructor(private readonly service: DescricaoService) {}

  @Permissions('descricao:read')
  @Get()
  arvore(): Promise<UnidadeDescricaoNo[]> {
    return this.service.arvore();
  }

  @Permissions('descricao:read')
  @Get('guia')
  async guia(@CurrentUser() user: TenantAccessClaims, @Req() req: Request, @Res() res: Response): Promise<void> {
    const r = await this.service.instrumento(user, 'guia', req.ip ?? '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
    res.send(r.pdf);
  }

  @Permissions('descricao:read')
  @Get(':id')
  obter(@CurrentUser() user: TenantAccessClaims, @Param('id', uuid) id: string): Promise<UnidadeDescricaoView> {
    return this.service.obter(user, id);
  }

  @Permissions('descricao:read')
  @Get(':id/instrumento')
  async instrumento(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(instrumentoQuerySchema)) q: z.infer<typeof instrumentoQuerySchema>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const r = await this.service.instrumento(user, q.tipo, req.ip ?? '', id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
    res.send(r.pdf);
  }

  @Permissions('descricao:create')
  @Post()
  criar(@CurrentUser() user: TenantAccessClaims, @Body(new ZodValidationPipe(unidadeDescricaoCreateSchema)) body: UnidadeDescricaoCreateInput, @Req() req: Request): Promise<UnidadeDescricaoView> {
    return this.service.criar(user, body, req.ip ?? '');
  }

  @Permissions('descricao:update')
  @Patch(':id')
  atualizar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(unidadeDescricaoUpdateSchema)) body: UnidadeDescricaoUpdateInput,
    @Req() req: Request,
  ): Promise<UnidadeDescricaoView> {
    return this.service.atualizar(user, id, body, req.ip ?? '');
  }

  @Permissions('descricao:delete')
  @Delete(':id')
  excluir(@CurrentUser() user: TenantAccessClaims, @Param('id', uuid) id: string, @Req() req: Request): Promise<{ excluida: true }> {
    return this.service.excluir(user, id, req.ip ?? '');
  }

  @Permissions('descricao:update')
  @Post(':id/vincular')
  vincular(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(vincularDescricaoSchema)) body: VincularDescricaoInput,
    @Req() req: Request,
  ): Promise<UnidadeDescricaoView> {
    return this.service.vincular(user, id, body, req.ip ?? '');
  }

  @Permissions('descricao:update')
  @Post(':id/desvincular')
  desvincular(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(vincularDescricaoSchema)) body: VincularDescricaoInput,
    @Req() req: Request,
  ): Promise<UnidadeDescricaoView> {
    return this.service.desvincular(user, id, body, req.ip ?? '');
  }
}
