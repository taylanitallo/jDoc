import { Body, Controller, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  contratoItensSchema,
  fecharMedicaoSchema,
  mesSchema,
  type ContratoItemInput,
  type ContratoItemView,
  type MedicaoView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { Critico, CurrentAdmin, origem, Papeis, type AdminReq } from '../superadmin-auth/decorators';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { MedicaoService } from './medicao.service';

const uuid = () => new ZodValidationPipe(z.string().uuid());
const mes = () => new ZodValidationPipe(mesSchema);

function enviarPdf(res: Response, r: { arquivo: Buffer; nome: string }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.send(r.arquivo);
}

/** Equipe JEOS: itens do contrato, previa e fechamento da medicao mensal. */
@Controller('superadmin/tenants/:id')
@UseGuards(SuperadminJwtGuard)
export class MedicaoPlataformaController {
  constructor(
    private readonly service: MedicaoService,
    private readonly audit: AuditService,
  ) {}

  @Papeis('owner', 'support', 'implantacao')
  @Get('contrato-itens')
  itens(@Param('id', uuid()) id: string): Promise<ContratoItemView[]> {
    return this.service.itens(id);
  }

  @Papeis('owner', 'implantacao')
  @Put('contrato-itens')
  async salvarItens(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(contratoItensSchema)) body: { itens: ContratoItemInput[] },
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<ContratoItemView[]> {
    const { antes, depois } = await this.service.salvarItens(id, body.itens);
    await this.audit.logAdmin(admin, origem(req), { action: 'contrato_itens_atualizados', tenantId: id, entity: 'contrato', antes, depois });
    return depois;
  }

  @Papeis('owner', 'support', 'implantacao')
  @Get('medicoes')
  medicoes(@Param('id', uuid()) id: string) {
    return this.service.listar(id);
  }

  @Papeis('owner', 'support', 'implantacao')
  @Get('medicoes/:mes')
  medicao(@Param('id', uuid()) id: string, @Param('mes', mes()) m: string): Promise<MedicaoView> {
    return this.service.medicao(id, m);
  }

  @Papeis('owner')
  @Critico()
  @Post('medicoes/:mes/fechar')
  async fechar(
    @Param('id', uuid()) id: string,
    @Param('mes', mes()) m: string,
    @Body(new ZodValidationPipe(fecharMedicaoSchema)) body: { observacao?: string },
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<MedicaoView> {
    const r = await this.service.fechar(id, m, admin.nome, body.observacao);
    await this.audit.logAdmin(admin, origem(req), { action: 'medicao_fechada', tenantId: id, entity: 'medicao', entityId: m, metadata: { total: r.totais.total } });
    return r;
  }

  @Papeis('owner', 'support', 'implantacao')
  @Get('medicoes/:mes/boletim.pdf')
  async boletim(@Param('id', uuid()) id: string, @Param('mes', mes()) m: string, @Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.boletimPdf(id, m));
  }
}

/** Fiscal do contrato no orgao: confere o boletim (so leitura). */
@Controller('t/:slug/medicoes')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class MedicaoOrgaoController {
  constructor(
    private readonly service: MedicaoService,
    private readonly audit: AuditService,
  ) {}

  @Permissions('fiscal_contrato:read')
  @Get()
  listar() {
    return this.service.listar(requireTenantContext().tenantId);
  }

  @Permissions('fiscal_contrato:read')
  @Get(':mes')
  medicao(@Param('mes', mes()) m: string): Promise<MedicaoView> {
    return this.service.medicao(requireTenantContext().tenantId, m);
  }

  @Permissions('fiscal_contrato:read')
  @Get(':mes/boletim.pdf')
  async boletim(@CurrentUser() user: TenantAccessClaims, @Param('mes', mes()) m: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const r = await this.service.boletimPdf(requireTenantContext().tenantId, m);
    await this.audit.logTenant({ actorId: user.sub, action: 'boletim_medicao_emitido', resourceType: 'medicao', resourceId: m, ip: req.ip });
    enviarPdf(res, r);
  }
}
