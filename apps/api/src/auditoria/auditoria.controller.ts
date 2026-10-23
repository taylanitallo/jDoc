import { Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  auditoriaQuerySchema,
  type AuditoriaPagina,
  type AuditoriaQuery,
  type TenantAccessClaims,
  type VerificacaoCadeia,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { AuditoriaService } from './auditoria.service';

const exportarQuerySchema = auditoriaQuerySchema.omit({ page: true, pageSize: true });

/** Trilha de auditoria do orgao: ver = auditoria:read; exportar e verificar a cadeia = auditoria:export. */
@Controller('t/:slug/auditoria')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  @Permissions('auditoria:read')
  @Get()
  listar(@Query(new ZodValidationPipe(auditoriaQuerySchema)) q: AuditoriaQuery): Promise<AuditoriaPagina> {
    return this.service.listar(q);
  }

  @Permissions('auditoria:read')
  @Get('usuarios')
  usuarios(): Promise<Array<{ id: string; nome: string }>> {
    return this.service.usuarios();
  }

  @Permissions('auditoria:export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('exportar')
  async exportar(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(exportarQuerySchema)) q: Omit<AuditoriaQuery, 'page' | 'pageSize'>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { arquivo, nome } = await this.service.exportarCsv(user.sub, q, req.ip ?? '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(arquivo);
  }

  @Permissions('auditoria:export')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('verificar')
  @HttpCode(200)
  verificar(@CurrentUser() user: TenantAccessClaims, @Req() req: Request): Promise<VerificacaoCadeia> {
    return this.service.verificar(user.sub, req.ip ?? '');
  }
}
