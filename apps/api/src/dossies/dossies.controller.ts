import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  apensarSchema,
  desapensarSchema,
  desentranharSchema,
  dossieCreateSchema,
  dossiesQuerySchema,
  dossieUpdateSchema,
  encerrarDossieSchema,
  juntarDocumentosSchema,
  reabrirDossieSchema,
  type DossieCreateInput,
  type DossiesPage,
  type DossiesQuery,
  type DossieUpdateInput,
  type DossieView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { DossiesService } from './dossies.service';

const uuid = new ZodValidationPipe(z.string().uuid());

/** Dossies e processos. Ver: dossies:read; abrir: dossies:create; demais atos: dossies:update. */
@Controller('t/:slug/dossies')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class DossiesController {
  constructor(private readonly service: DossiesService) {}

  @Permissions('dossies:read')
  @Get()
  listar(@CurrentUser() user: TenantAccessClaims, @Query(new ZodValidationPipe(dossiesQuerySchema)) q: DossiesQuery): Promise<DossiesPage> {
    return this.service.listar(user, q);
  }

  @Permissions('dossies:read')
  @Get(':id')
  obter(@CurrentUser() user: TenantAccessClaims, @Param('id', uuid) id: string): Promise<DossieView> {
    return this.service.obter(user, id);
  }

  @Permissions('dossies:read')
  @Get(':id/capa')
  async capa(@CurrentUser() user: TenantAccessClaims, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    const r = await this.service.capa(user, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
    res.send(r.pdf);
  }

  @Permissions('dossies:create')
  @Post()
  criar(@CurrentUser() user: TenantAccessClaims, @Body(new ZodValidationPipe(dossieCreateSchema)) body: DossieCreateInput, @Req() req: Request): Promise<DossieView> {
    return this.service.criar(user, body, req.ip ?? '');
  }

  @Permissions('dossies:update')
  @Patch(':id')
  atualizar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(dossieUpdateSchema)) body: DossieUpdateInput,
    @Req() req: Request,
  ): Promise<DossieView> {
    return this.service.atualizar(user, id, body, req.ip ?? '');
  }

  @Permissions('dossies:update')
  @Post(':id/juntar')
  juntar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(juntarDocumentosSchema)) body: z.infer<typeof juntarDocumentosSchema>,
    @Req() req: Request,
  ): Promise<DossieView> {
    return this.service.juntar(user, id, body.documentIds, req.ip ?? '');
  }

  @Permissions('dossies:update')
  @Post(':id/desentranhar')
  desentranhar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(desentranharSchema)) body: z.infer<typeof desentranharSchema>,
    @Req() req: Request,
  ): Promise<DossieView> {
    return this.service.desentranhar(user, id, body.documentId, body.motivo, req.ip ?? '');
  }

  @Permissions('dossies:update')
  @Post(':id/encerrar')
  encerrar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(encerrarDossieSchema)) body: z.infer<typeof encerrarDossieSchema>,
    @Req() req: Request,
  ): Promise<DossieView> {
    return this.service.encerrar(user, id, body.dataEncerramento, req.ip ?? '');
  }

  @Permissions('dossies:update')
  @Post(':id/reabrir')
  reabrir(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(reabrirDossieSchema)) body: z.infer<typeof reabrirDossieSchema>,
    @Req() req: Request,
  ): Promise<DossieView> {
    return this.service.reabrir(user, id, body.motivo, req.ip ?? '');
  }

  @Permissions('dossies:update')
  @Post(':id/apensar')
  apensar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(apensarSchema)) body: z.infer<typeof apensarSchema>,
    @Req() req: Request,
  ): Promise<DossieView> {
    return this.service.apensar(user, id, body.principalId, req.ip ?? '');
  }

  @Permissions('dossies:update')
  @Post(':id/desapensar')
  desapensar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(desapensarSchema)) body: z.infer<typeof desapensarSchema>,
    @Req() req: Request,
  ): Promise<DossieView> {
    return this.service.desapensar(user, id, body.motivo, req.ip ?? '');
  }
}
