import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  lgpdPlataformaSchema,
  privacidadeOrgaoSchema,
  type LgpdPlataforma,
  type PrivacidadeOrgao,
  type PrivacidadePublica,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions, Public } from '../auth/decorators';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { CurrentAdmin, origem, Papeis, type AdminReq } from '../superadmin-auth/decorators';
import { AuditService } from '../audit/audit.module';
import { PrivacidadeService } from './privacidade.service';

/** Orgao: pagina publica de privacidade + configuracao do controlador (encarregado, IA). */
@Controller('t/:slug/privacidade')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class PrivacidadeController {
  constructor(private readonly service: PrivacidadeService) {}

  @Public()
  @Get('publica')
  publica(): Promise<PrivacidadePublica> {
    return this.service.publica();
  }

  @Permissions('layout:read')
  @Get()
  obter(): Promise<PrivacidadeOrgao> {
    return this.service.orgao();
  }

  @Permissions('layout:update')
  @Put()
  salvar(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(privacidadeOrgaoSchema)) body: PrivacidadeOrgao,
    @Req() req: Request,
  ): Promise<PrivacidadeOrgao> {
    return this.service.salvarOrgao(body, user.sub, req.ip ?? '');
  }
}

/** Plataforma: o que a JEOS publica como operadora (suboperadores, hospedagem, compromissos). */
@Controller('superadmin/lgpd')
@UseGuards(SuperadminJwtGuard)
export class PrivacidadePlataformaController {
  constructor(
    private readonly service: PrivacidadeService,
    private readonly audit: AuditService,
  ) {}

  @Papeis('owner', 'support', 'implantacao')
  @Get()
  obter(): Promise<LgpdPlataforma> {
    return this.service.plataforma();
  }

  @Papeis('owner')
  @Put()
  async salvar(
    @Body(new ZodValidationPipe(lgpdPlataformaSchema)) body: LgpdPlataforma,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<LgpdPlataforma> {
    const { antes, depois } = await this.service.salvarPlataforma(body, admin.id);
    await this.audit.logAdmin(admin, origem(req), { action: 'lgpd_atualizada', entity: 'lgpd', antes, depois });
    return depois;
  }
}
