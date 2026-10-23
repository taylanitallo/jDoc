import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { treinamentoSchema, type TenantAccessClaims, type TreinamentoInput, type TreinamentoView } from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { AjudaService } from './ajuda.service';

const uuid = () => new ZodValidationPipe(z.string().uuid());

function enviarPdf(res: Response, r: { arquivo: Buffer; nome: string }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.send(r.arquivo);
}

/** Manual (qualquer usuario logado) e treinamentos (permissao treinamentos:*). */
@Controller('t/:slug/ajuda')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class AjudaController {
  constructor(private readonly service: AjudaService) {}

  @Permissions()
  @Get('manual.pdf')
  async manual(@Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.manualPdf());
  }

  @Permissions('treinamentos:read')
  @Get('treinamentos')
  listar(): Promise<TreinamentoView[]> {
    return this.service.listar();
  }

  @Permissions('treinamentos:create')
  @Post('treinamentos')
  criar(
    @CurrentUser() u: TenantAccessClaims,
    @Body(new ZodValidationPipe(treinamentoSchema)) b: TreinamentoInput,
    @Req() req: Request,
  ): Promise<TreinamentoView> {
    return this.service.criar(u, b, req.ip ?? '');
  }

  @Permissions('treinamentos:update')
  @Patch('treinamentos/:id')
  atualizar(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(treinamentoSchema)) b: TreinamentoInput,
    @Req() req: Request,
  ): Promise<TreinamentoView> {
    return this.service.atualizar(u, id, b, req.ip ?? '');
  }

  @Permissions('treinamentos:delete')
  @Delete('treinamentos/:id')
  @HttpCode(204)
  async excluir(@CurrentUser() u: TenantAccessClaims, @Param('id', uuid()) id: string, @Req() req: Request): Promise<void> {
    await this.service.excluir(u, id, req.ip ?? '');
  }

  @Permissions('treinamentos:read')
  @Get('treinamentos/:id/lista-presenca')
  async lista(@Param('id', uuid()) id: string, @Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.listaPresenca(id));
  }
}
