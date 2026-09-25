import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  alteracoesSchema,
  compiladoQuerySchema,
  dispositivosPutSchema,
  estruturarSchema,
  normaCreateSchema,
  normasQuerySchema,
  normaUpdateSchema,
  type AlteracoesInput,
  type NormaCreateInput,
  type NormasPage,
  type NormasQuery,
  type NormaUpdateInput,
  type NormaView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions, Public } from '../auth/decorators';
import { LegislacaoService } from './legislacao.service';

const uuid = new ZodValidationPipe(z.string().uuid());
type CompiladoQuery = z.infer<typeof compiladoQuerySchema>;

function enviarPdf(res: Response, r: { pdf: Buffer; nome: string }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.send(r.pdf);
}

/** Legislacao compilada (area interna). Ver: legislacao:read; estruturar: create; alterar/publicar: update. */
@Controller('t/:slug/legislacao')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class LegislacaoController {
  constructor(private readonly service: LegislacaoService) {}

  @Permissions('legislacao:read')
  @Get('normas')
  listar(@CurrentUser() user: TenantAccessClaims, @Query(new ZodValidationPipe(normasQuerySchema)) q: NormasQuery): Promise<NormasPage> {
    return this.service.listar({ publico: false, user }, q);
  }

  @Permissions('legislacao:read')
  @Get('documentos/:documentId')
  porDocumento(@CurrentUser() user: TenantAccessClaims, @Param('documentId', uuid) documentId: string): Promise<{ normaId: string | null }> {
    return this.service.porDocumento(user, documentId);
  }

  @Permissions('legislacao:read')
  @Get('normas/:id')
  obter(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(compiladoQuerySchema)) q: CompiladoQuery,
  ): Promise<NormaView> {
    return this.service.obter({ publico: false, user }, id, q.data);
  }

  @Permissions('legislacao:read')
  @Get('normas/:id/compilado.pdf')
  async pdf(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(compiladoQuerySchema)) q: CompiladoQuery,
    @Res() res: Response,
  ): Promise<void> {
    enviarPdf(res, await this.service.compiladoPdf({ publico: false, user }, id, q.data));
  }

  @Permissions('legislacao:create')
  @Post('documentos/:documentId/estruturar')
  estruturar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('documentId', uuid) documentId: string,
    @Body(new ZodValidationPipe(estruturarSchema)) body: z.infer<typeof estruturarSchema>,
  ) {
    return this.service.estruturar(user, documentId, body.texto);
  }

  @Permissions('legislacao:create')
  @Post('normas')
  criar(@CurrentUser() user: TenantAccessClaims, @Body(new ZodValidationPipe(normaCreateSchema)) body: NormaCreateInput, @Req() req: Request): Promise<NormaView> {
    return this.service.criar(user, body, req.ip ?? '');
  }

  @Permissions('legislacao:update')
  @Patch('normas/:id')
  atualizar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(normaUpdateSchema)) body: NormaUpdateInput,
    @Req() req: Request,
  ): Promise<NormaView> {
    return this.service.atualizar(user, id, body, req.ip ?? '');
  }

  @Permissions('legislacao:update')
  @Put('normas/:id/dispositivos')
  reestruturar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(dispositivosPutSchema)) body: z.infer<typeof dispositivosPutSchema>,
    @Req() req: Request,
  ): Promise<NormaView> {
    return this.service.substituirDispositivos(user, id, body.dispositivos, req.ip ?? '');
  }

  @Permissions('legislacao:update')
  @Post('normas/:id/alteracoes')
  alterar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(alteracoesSchema)) body: AlteracoesInput,
    @Req() req: Request,
  ): Promise<NormaView> {
    return this.service.alterar(user, id, body, req.ip ?? '');
  }
}

/**
 * Portal publico da legislacao (sem login, como a consulta do Planalto): so normas
 * publicadas cujo documento e publico. Throttle por IP.
 */
@Controller('t/:slug/legislacao-publica')
@Public()
@RequerSistema('arquivo')
@UseGuards(SistemaGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class LegislacaoPublicaController {
  constructor(private readonly service: LegislacaoService) {}

  @Get()
  listar(@Query(new ZodValidationPipe(normasQuerySchema)) q: NormasQuery): Promise<NormasPage> {
    return this.service.listar({ publico: true }, q);
  }

  @Get(':id')
  obter(@Param('id', uuid) id: string, @Query(new ZodValidationPipe(compiladoQuerySchema)) q: CompiladoQuery): Promise<NormaView> {
    return this.service.obter({ publico: true }, id, q.data);
  }

  @Get(':id/compilado.pdf')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async pdf(@Param('id', uuid) id: string, @Query(new ZodValidationPipe(compiladoQuerySchema)) q: CompiladoQuery, @Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.compiladoPdf({ publico: true }, id, q.data));
  }
}
