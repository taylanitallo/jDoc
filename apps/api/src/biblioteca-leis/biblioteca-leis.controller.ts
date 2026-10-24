import { Body, Controller, Get, HttpCode, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  leisQuerySchema,
  legislacaoMunicipioSchema,
  type EscopoLeis,
  type LeiDetalhe,
  type LeisPage,
  type LeisQuery,
  type SincronizacaoLeisView,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { Permissions } from '../auth/decorators';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { CurrentAdmin, origem, Papeis, type AdminReq } from '../superadmin-auth/decorators';
import { AuditService } from '../audit/audit.module';
import { BibliotecaLeisService } from './biblioteca-leis.service';

const idSchema = z.coerce.number().int().positive();

/** Leis de referencia do orgao: so federal + o estado + o municipio dele (filtro no servico). */
@Controller('t/:slug/leis-referencia')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class BibliotecaLeisController {
  constructor(private readonly service: BibliotecaLeisService) {}

  @Permissions('legislacao:read')
  @Get('escopo')
  escopo(): Promise<EscopoLeis> {
    return this.service.escopo();
  }

  @Permissions('legislacao:read')
  @Get()
  listar(@Query(new ZodValidationPipe(leisQuerySchema)) q: LeisQuery): Promise<LeisPage> {
    return this.service.listar(q);
  }

  @Permissions('legislacao:read')
  @Get(':id')
  detalhe(@Param('id', new ZodValidationPipe(idSchema)) id: number): Promise<LeiDetalhe> {
    return this.service.detalhe(id);
  }
}

@Controller('superadmin/leis-referencia')
@UseGuards(SuperadminJwtGuard)
export class BibliotecaLeisPlataformaController {
  constructor(
    private readonly service: BibliotecaLeisService,
    private readonly audit: AuditService,
  ) {}

  @Papeis('owner', 'support', 'implantacao')
  @Get('status')
  status(): Promise<SincronizacaoLeisView> {
    return this.service.statusPlataforma();
  }

  /** Ajusta qual pasta de municipio da biblioteca vale para o orgao (vazio = deduz da cidade). */
  @Papeis('owner', 'implantacao')
  @Put('orgaos/:id/municipio')
  @HttpCode(204)
  async municipio(
    @Param('id', new ZodValidationPipe(z.string().uuid())) id: string,
    @Body(new ZodValidationPipe(legislacaoMunicipioSchema)) body: { municipio: string | null },
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<void> {
    const { antes, depois } = await this.service.definirMunicipio(id, body.municipio);
    await this.audit.logAdmin(admin, origem(req), { action: 'leis_municipio_definido', tenantId: id, entity: 'tenant', entityId: id, antes: { municipio: antes }, depois: { municipio: depois } });
  }
}
