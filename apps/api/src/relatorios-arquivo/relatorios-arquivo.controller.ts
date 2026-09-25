import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  inventarioFiltroSchema,
  inventarioQuerySchema,
  type InventarioFiltro,
  type InventarioPage,
  type InventarioQuery,
  type QuantitativoArquivo,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { RelatoriosArquivoService } from './relatorios-arquivo.service';

const formatoSchema = z.enum(['pdf', 'csv']);

function enviar(res: Response, r: { arquivo: Buffer; nome: string }): void {
  const csv = r.nome.endsWith('.csv');
  res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : 'application/pdf');
  res.setHeader('Content-Disposition', `${csv ? 'attachment' : 'inline'}; filename="${r.nome}"`);
  res.send(r.arquivo);
}

/**
 * Relatorios do Arquivo Municipal. Ver na tela: acervo:read. Baixar PDF/planilha:
 * acervo:export (auditado). Dentro deles, so os modulos que o usuario le.
 */
@Controller('t/:slug/relatorios-arquivo')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class RelatoriosArquivoController {
  constructor(private readonly service: RelatoriosArquivoService) {}

  @Permissions('acervo:read')
  @Get('inventario')
  inventario(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(inventarioQuerySchema)) q: InventarioQuery,
  ): Promise<InventarioPage> {
    const { page, pageSize, ...filtro } = q;
    return this.service.inventario(user, filtro, page, pageSize);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Permissions('acervo:export')
  @Get('inventario/:formato')
  async exportarInventario(
    @CurrentUser() user: TenantAccessClaims,
    @Param('formato', new ZodValidationPipe(formatoSchema)) formato: 'pdf' | 'csv',
    @Query(new ZodValidationPipe(inventarioFiltroSchema)) filtro: InventarioFiltro,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    enviar(res, await this.service.exportarInventario(user, filtro, formato, req.ip ?? ''));
  }

  @Permissions('acervo:read')
  @Get('quantitativo')
  quantitativo(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(inventarioFiltroSchema)) filtro: InventarioFiltro,
  ): Promise<QuantitativoArquivo> {
    return this.service.quantitativo(user, filtro);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Permissions('acervo:export')
  @Get('quantitativo/:formato')
  async exportarQuantitativo(
    @CurrentUser() user: TenantAccessClaims,
    @Param('formato', new ZodValidationPipe(formatoSchema)) formato: 'pdf' | 'csv',
    @Query(new ZodValidationPipe(inventarioFiltroSchema)) filtro: InventarioFiltro,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    enviar(res, await this.service.exportarQuantitativo(user, filtro, formato, req.ip ?? ''));
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Permissions('arquivo_fisico:read')
  @Get('topografico/pdf')
  async topografico(@CurrentUser() user: TenantAccessClaims, @Req() req: Request, @Res() res: Response): Promise<void> {
    enviar(res, await this.service.topografico(user, req.ip ?? ''));
  }
}
