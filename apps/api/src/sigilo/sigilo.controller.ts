import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  classificarSigiloSchema,
  desclassificarSigiloSchema,
  termosSigiloQuerySchema,
  type ClassificarSigiloInput,
  type SigiloResumo,
  type TenantAccessClaims,
  type TermoSigiloView,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { SigiloService } from './sigilo.service';

const uuidSchema = z.string().uuid();

function pdf(res: Response, r: { pdf: Buffer; nome: string }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.send(r.pdf);
}

/** Sigilo (LAI). Ver: sigilo:read; classificar: sigilo:create; desclassificar: sigilo:update. */
@Controller('t/:slug/sigilo')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class SigiloController {
  constructor(private readonly service: SigiloService) {}

  @Permissions('sigilo:read')
  @Get('resumo')
  resumo(): Promise<SigiloResumo> {
    return this.service.resumo();
  }

  @Permissions('sigilo:read')
  @Get('termos')
  termos(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(termosSigiloQuerySchema)) q: z.infer<typeof termosSigiloQuerySchema>,
  ): Promise<TermoSigiloView[]> {
    return this.service.listar(user, q.situacao, q.documentId);
  }

  @Permissions('sigilo:read')
  @Get('termos/:id/tci')
  async tci(@CurrentUser() user: TenantAccessClaims, @Param('id', new ZodValidationPipe(uuidSchema)) id: string, @Res() res: Response): Promise<void> {
    pdf(res, await this.service.tci(user, id));
  }

  @Permissions('sigilo:read')
  @Get('rol')
  async rol(@CurrentUser() user: TenantAccessClaims, @Res() res: Response): Promise<void> {
    pdf(res, await this.service.rol(user));
  }

  @Permissions('sigilo:create')
  @Post('documentos/:documentId/classificar')
  classificar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('documentId', new ZodValidationPipe(uuidSchema)) documentId: string,
    @Body(new ZodValidationPipe(classificarSigiloSchema)) body: ClassificarSigiloInput,
    @Req() req: Request,
  ): Promise<TermoSigiloView> {
    return this.service.classificar(user, documentId, body, req.ip ?? '');
  }

  @Permissions('sigilo:update')
  @Post('termos/:id/desclassificar')
  desclassificar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(desclassificarSigiloSchema)) body: z.infer<typeof desclassificarSigiloSchema>,
    @Req() req: Request,
  ): Promise<TermoSigiloView> {
    return this.service.desclassificar(user, id, body.motivo, req.ip ?? '');
  }
}
