import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  aceiteMigracaoSchema,
  exportacaoCreateSchema,
  relatorioMensalQuerySchema,
  type AceiteMigracaoInput,
  type ContinuidadeView,
  type ExportacaoCreateInput,
  type ExportacaoView,
  type RelatorioMensalQuery,
  type RestauracaoTesteView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { Critico, CurrentAdmin, origem, Papeis, type AdminReq } from '../superadmin-auth/decorators';
import { AuditService } from '../audit/audit.module';
import { DatabaseService } from '../database/database.service';
import { requireTenantContext } from '../tenancy/tenant-context';
import { ContinuidadeService } from './continuidade.service';
import { ExportacaoService } from './exportacao.service';

const uuid = () => new ZodValidationPipe(z.string().uuid());
const parte = () => new ZodValidationPipe(z.coerce.number().int().min(1).max(10_000));

function enviarPdf(res: Response, r: { arquivo: Buffer; nome: string }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.send(r.arquivo);
}

/**
 * Continuidade vista pelo orgao: painel (RPO/RTO, backups, copia, testes,
 * disponibilidade), relatorio mensal e exportacao integral (so administrador).
 */
@Controller('t/:slug')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class ContinuidadeOrgaoController {
  constructor(
    private readonly continuidade: ContinuidadeService,
    private readonly exportacao: ExportacaoService,
    private readonly audit: AuditService,
  ) {}

  @Permissions('auditoria:read')
  @Get('continuidade')
  painel(): Promise<ContinuidadeView> {
    return this.continuidade.painel(requireTenantContext().tenantId);
  }

  @Permissions('auditoria:read')
  @Get('continuidade/relatorio-mensal')
  async relatorio(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(relatorioMensalQuerySchema)) q: RelatorioMensalQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const r = await this.continuidade.relatorioMensal(requireTenantContext().tenantId, q.mes);
    await this.audit.logTenant({ actorId: user.sub, action: 'relatorio_mensal_emitido', resourceType: 'relatorio', ip: req.ip, metadata: { mes: q.mes } });
    enviarPdf(res, r);
  }

  @Permissions()
  @Get('exportacoes')
  listar(@CurrentUser() user: TenantAccessClaims): Promise<ExportacaoView[]> {
    this.soAdmin(user);
    return this.exportacao.listar(requireTenantContext().schemaName);
  }

  @Permissions()
  @Post('exportacoes')
  async solicitar(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(exportacaoCreateSchema)) body: ExportacaoCreateInput,
    @Req() req: Request,
  ): Promise<ExportacaoView> {
    this.soAdmin(user);
    const ctx = requireTenantContext();
    const e = await this.exportacao.solicitar(
      { tenantId: ctx.tenantId, slug: ctx.slug, schemaName: ctx.schemaName, nome: ctx.nome },
      body.orgaoCodigo ?? null,
      { id: user.sub, nome: user.imp ? `Equipe JEOS (${user.imp.adminNome})` : 'Administrador do órgão' },
    );
    await this.audit.logTenant({ actorId: user.sub, action: 'exportacao_integral_solicitada', resourceType: 'exportacao', resourceId: e.id, ip: req.ip });
    return e;
  }

  @Permissions()
  @Get('exportacoes/:id/partes/:numero/url')
  async urlParte(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Param('numero', parte()) numero: number,
    @Req() req: Request,
  ): Promise<{ url: string; nome: string }> {
    this.soAdmin(user);
    const ctx = requireTenantContext();
    const r = await this.exportacao.urlParte(ctx.slug, ctx.schemaName, id, numero);
    await this.audit.logTenant({ actorId: user.sub, action: 'exportacao_integral_baixada', resourceType: 'exportacao', resourceId: id, ip: req.ip, metadata: { parte: numero } });
    return r;
  }

  private soAdmin(user: TenantAccessClaims): void {
    if (user.role !== 'admin') throw new ForbiddenException('Só administradores do órgão exportam o acervo inteiro');
  }
}

/** Painel da plataforma: continuidade de qualquer orgao, teste sob demanda, exportacao e aceite da migracao. */
@Controller('superadmin/tenants/:id')
@UseGuards(SuperadminJwtGuard)
export class ContinuidadePlataformaController {
  constructor(
    private readonly continuidade: ContinuidadeService,
    private readonly exportacao: ExportacaoService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async alvo(id: string): Promise<{ tenantId: string; slug: string; schemaName: string; nome: string }> {
    const [t] = await this.db.catalog()<Array<{ id: string; slug: string; schema_name: string; nome: string }>>`
      SELECT id, slug, schema_name, nome FROM public.tenants WHERE id = ${id}
    `;
    if (!t) throw new ForbiddenException('Órgão não encontrado');
    return { tenantId: t.id, slug: t.slug, schemaName: t.schema_name, nome: t.nome };
  }

  @Papeis('owner', 'support', 'implantacao')
  @Get('continuidade')
  painel(@Param('id', uuid()) id: string): Promise<ContinuidadeView> {
    return this.continuidade.painel(id);
  }

  @Papeis('owner', 'support')
  @Post('continuidade/teste-restauracao')
  @HttpCode(200)
  async testar(@Param('id', uuid()) id: string, @CurrentAdmin() admin: AdminReq, @Req() req: Request): Promise<RestauracaoTesteView> {
    const r = await this.continuidade.testarTenant(id);
    await this.audit.logAdmin(admin, origem(req), { action: 'teste_restauracao_executado', tenantId: id, entity: 'restauracao', metadata: { status: r.status } });
    return r;
  }

  @Papeis('owner', 'support', 'implantacao')
  @Get('continuidade/relatorio-mensal')
  async relatorio(
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(relatorioMensalQuerySchema)) q: RelatorioMensalQuery,
    @Res() res: Response,
  ): Promise<void> {
    enviarPdf(res, await this.continuidade.relatorioMensal(id, q.mes));
  }

  @Papeis('owner', 'support', 'implantacao')
  @Get('exportacoes')
  async listar(@Param('id', uuid()) id: string): Promise<ExportacaoView[]> {
    return this.exportacao.listar((await this.alvo(id)).schemaName);
  }

  @Papeis('owner', 'support')
  @Critico()
  @Post('exportacoes')
  async solicitar(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(exportacaoCreateSchema)) body: ExportacaoCreateInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<ExportacaoView> {
    const e = await this.exportacao.solicitar(await this.alvo(id), body.orgaoCodigo ?? null, { id: null, nome: `Equipe JEOS (${admin.nome})` });
    await this.audit.logAdmin(admin, origem(req), { action: 'exportacao_integral_solicitada', tenantId: id, entity: 'exportacao', entityId: e.id });
    return e;
  }

  @Papeis('owner', 'support')
  @Critico()
  @Get('exportacoes/:exportacaoId/partes/:numero/url')
  async urlParte(
    @Param('id', uuid()) id: string,
    @Param('exportacaoId', uuid()) exportacaoId: string,
    @Param('numero', parte()) numero: number,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<{ url: string; nome: string }> {
    const t = await this.alvo(id);
    const r = await this.exportacao.urlParte(t.slug, t.schemaName, exportacaoId, numero);
    await this.audit.logAdmin(admin, origem(req), { action: 'exportacao_integral_baixada', tenantId: id, entity: 'exportacao', entityId: exportacaoId, metadata: { parte: numero } });
    return r;
  }

  /** Plano de saida: o orgao recebeu os dados exportados e conferiu. Pre-requisito da exclusao. */
  @Papeis('owner')
  @Critico()
  @Post('migracao-aceite')
  @HttpCode(204)
  async aceite(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(aceiteMigracaoSchema)) body: AceiteMigracaoInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<void> {
    const t = await this.alvo(id);
    if (!(await this.exportacao.temConcluida(t.schemaName))) {
      throw new ForbiddenException('Gere a exportação integral antes de registrar o aceite da migração');
    }
    await this.db.catalog()`
      UPDATE public.tenants SET migracao_aceita_em = now(), migracao_aceita_por = ${admin.nome}, migracao_aceita_obs = ${body.observacao}
      WHERE id = ${id}
    `;
    await this.audit.logAdmin(admin, origem(req), { action: 'migracao_aceita', tenantId: id, entity: 'tenant', entityId: id, metadata: { observacao: body.observacao } });
  }
}
