import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  reportsQuerySchema,
  reportTipoSchema,
  prestacaoContasSchema,
  midiaLegislativaSchema,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { ReportsService } from './reports.service';
import { Throttle } from '@nestjs/throttler';

@Controller('t/:slug/reports')
@RequerSistema('financeiro')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Permissions('prestacao_contas:read', 'midia_legislativa:read')
  @Get()
  async list(
    @Query(new ZodValidationPipe(reportsQuerySchema)) q: { tipo?: string; page: number; pageSize: number },
  ) {
    return this.reports.list(q.page, q.pageSize, q.tipo);
  }

  @Permissions()
  @Delete()
  @HttpCode(200)
  async clearHistory(
    @CurrentUser() user: TenantAccessClaims,
    @Query('tipo', new ZodValidationPipe(reportTipoSchema.optional())) tipo: z.infer<typeof reportTipoSchema> | undefined,
    @Req() req: Request,
  ): Promise<{ count: number }> {
    const count = await this.reports.clearHistory(user, req.ip ?? '', tipo);
    return { count };
  }

  @Permissions('prestacao_contas:read', 'midia_legislativa:read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.reports.get(id);
  }

  @Permissions()
  @Delete(':id')
  @HttpCode(200)
  async deleteOne(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.reports.deleteOne(id, user, req.ip ?? '');
    return { ok: true };
  }

  @Permissions('prestacao_contas:create')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('prestacao-contas')
  @HttpCode(201)
  createPrestacaoContas(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(prestacaoContasSchema)) body: unknown,
    @Req() req: Request,
  ) {
    return this.reports.createPrestacaoContas(user, body, req.ip ?? '');
  }

  @Permissions('midia_legislativa:create')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('midia-legislativa')
  @HttpCode(201)
  createMidiaLegislativa(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(midiaLegislativaSchema)) body: unknown,
    @Req() req: Request,
  ) {
    return this.reports.createMidiaLegislativa(user, body, req.ip ?? '');
  }

  @Permissions('prestacao_contas:read', 'midia_legislativa:read')
  @Get(':id/download')
  async download(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.reports.download(id, user, req.ip ?? '');
  }
}
