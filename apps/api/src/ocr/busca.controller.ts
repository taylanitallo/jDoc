import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  buscaConteudoQuerySchema,
  type BuscaConteudoQuery,
  type BuscaConteudoResult,
  type IndexacaoResumo,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { BuscaService } from './busca.service';

/**
 * Busca no conteudo dos PDFs. RBAC dinamico: a rota exige so autenticacao
 * (@Permissions()) e o service restringe aos modulos com `${modulo}:read` e
 * ao nivel de acesso do usuario — mesmo padrao dos documentos (decisao #24).
 */
@Controller('t/:slug/busca')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class BuscaController {
  constructor(private readonly service: BuscaService) {}

  @Permissions()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  buscar(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(buscaConteudoQuerySchema)) q: BuscaConteudoQuery,
    @Req() req: Request,
  ): Promise<BuscaConteudoResult> {
    return this.service.buscar(user, q, req.ip ?? '');
  }

  @Permissions()
  @Get('indexacao')
  resumo(): Promise<IndexacaoResumo> {
    return this.service.resumo();
  }

  /** So admin (checado no service). Throttle baixo: cada chamada enfileira ate 2000 arquivos. */
  @Permissions()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('reindexar')
  reindexar(@CurrentUser() user: TenantAccessClaims, @Req() req: Request): Promise<{ enfileirados: number }> {
    return this.service.reindexar(user, req.ip ?? '');
  }
}
