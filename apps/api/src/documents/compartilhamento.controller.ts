import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  compartilhadosQuerySchema,
  compartilharDocumentoSchema,
  type CompartilhadosPage,
  type CompartilhadosQuery,
  type CompartilharDocumentoInput,
  type DestinatarioCompartilhamento,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { CurrentUser, Permissions } from '../auth/decorators';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CompartilhamentoService } from './compartilhamento.service';

const uuid = new ZodValidationPipe(z.string().uuid());

/** A permissao depende do modulo do documento: o service confere (como em DocumentsController). */
@Controller('t/:slug/compartilhamentos')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class CompartilhamentoController {
  constructor(private readonly compartilhamento: CompartilhamentoService) {}

  @Permissions()
  @Get('recebidos')
  recebidos(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(compartilhadosQuerySchema)) q: CompartilhadosQuery,
  ): Promise<CompartilhadosPage> {
    return this.compartilhamento.recebidos(user, q);
  }

  @Permissions()
  @Post('recebidos/:id/visto')
  @HttpCode(204)
  async marcarVisto(@CurrentUser() user: TenantAccessClaims, @Param('id', uuid) id: string): Promise<void> {
    await this.compartilhamento.marcarVisto(user, id);
  }

  @Permissions()
  @Get('documentos/:id/destinatarios')
  destinatarios(@CurrentUser() user: TenantAccessClaims, @Param('id', uuid) id: string): Promise<DestinatarioCompartilhamento[]> {
    return this.compartilhamento.destinatarios(user, id);
  }

  @Permissions()
  @Post('documentos/:id')
  @HttpCode(204)
  async compartilhar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(compartilharDocumentoSchema)) body: CompartilharDocumentoInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.compartilhamento.compartilhar(user, id, body, req.ip ?? '');
  }
}
