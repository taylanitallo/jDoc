import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  listarOcorrenciasQuerySchema,
  resolverOcorrenciaSchema,
  type IntegridadeResumo,
  type OcorrenciaIntegridadeView,
  type ResolverOcorrenciaInput,
  type TenantAccessClaims,
  type VerificacaoIntegridadeView,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { IntegridadeService } from './integridade.service';

const uuidSchema = z.string().uuid();

/** Preservacao digital: ver = integridade:read; verificar agora = integridade:create; tratar ocorrencia = integridade:update. */
@Controller('t/:slug/integridade')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class IntegridadeController {
  constructor(private readonly service: IntegridadeService) {}

  @Permissions('integridade:read')
  @Get('resumo')
  resumo(): Promise<IntegridadeResumo> {
    return this.service.resumo();
  }

  @Permissions('integridade:read')
  @Get('verificacoes')
  verificacoes(): Promise<VerificacaoIntegridadeView[]> {
    return this.service.listarVerificacoes(20);
  }

  @Permissions('integridade:read')
  @Get('ocorrencias')
  ocorrencias(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(listarOcorrenciasQuerySchema)) q: z.infer<typeof listarOcorrenciasQuerySchema>,
  ): Promise<OcorrenciaIntegridadeView[]> {
    return this.service.listarOcorrencias(user, q.situacao);
  }

  // Baixa o acervo do storage: poucas por hora.
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Permissions('integridade:create')
  @Post('verificar')
  verificar(@CurrentUser() user: TenantAccessClaims, @Req() req: Request): Promise<VerificacaoIntegridadeView> {
    return this.service.iniciarManual(user, req.ip ?? '');
  }

  @Permissions('integridade:update')
  @Post('ocorrencias/:id/resolver')
  @HttpCode(204)
  resolver(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(resolverOcorrenciaSchema)) body: ResolverOcorrenciaInput,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.resolverOcorrencia(user, id, body.observacao, req.ip ?? '');
  }
}
