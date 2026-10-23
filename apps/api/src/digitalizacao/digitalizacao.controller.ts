import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  TERMOS_LOTE,
  aceiteSchema,
  avancarEtapaSchema,
  corrigirNcSchema,
  itemLoteSchema,
  itemLoteUpdateSchema,
  loteCreateSchema,
  loteUpdateSchema,
  lotesQuerySchema,
  planoSchema,
  producaoQuerySchema,
  qcSchema,
  vincularDocumentosSchema,
  type AvancarEtapaInput,
  type ItemLoteInput,
  type ItemLoteUpdateInput,
  type LoteCreateInput,
  type LoteDetalheView,
  type LoteResumoView,
  type LotesQuery,
  type LoteUpdateInput,
  type PlanoInput,
  type PlanoView,
  type ProducaoQuery,
  type ProducaoResumo,
  type QcInput,
  type TenantAccessClaims,
  type TermoLote,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { DigitalizacaoService } from './digitalizacao.service';
import { producaoExport, termoLotePdf } from './digitalizacao-docs';

const uuid = () => new ZodValidationPipe(z.string().uuid());
const formatoSchema = z.enum(['pdf', 'csv']);

function enviar(res: Response, r: { arquivo: Buffer; nome: string }): void {
  const csv = r.nome.endsWith('.csv');
  res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : 'application/pdf');
  res.setHeader('Content-Disposition', `${csv ? 'attachment' : 'inline'}; filename="${r.nome}"`);
  res.send(r.arquivo);
}

/**
 * Digitalizacao: ver = digitalizacao:read; registrar lote/inventario = :create;
 * andar etapas, QC e vincular documentos = :update; aprovar plano e aceite =
 * fiscal_contrato:update (checado no service); relatorios = :export.
 */
@Controller('t/:slug/digitalizacao')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class DigitalizacaoController {
  constructor(
    private readonly service: DigitalizacaoService,
    private readonly audit: AuditService,
  ) {}

  // ---- Planos ----

  @Permissions('digitalizacao:read')
  @Get('planos')
  planos(): Promise<PlanoView[]> {
    return this.service.listarPlanos();
  }

  @Permissions('digitalizacao:create')
  @Post('planos')
  criarPlano(@CurrentUser() u: TenantAccessClaims, @Body(new ZodValidationPipe(planoSchema)) b: PlanoInput, @Req() req: Request): Promise<{ id: string }> {
    return this.service.criarPlano(u, b, req.ip ?? '');
  }

  @Permissions('digitalizacao:update')
  @Patch('planos/:id')
  @HttpCode(204)
  async atualizarPlano(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(planoSchema)) b: PlanoInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.atualizarPlano(u, id, b, req.ip ?? '');
  }

  @Permissions('fiscal_contrato:update')
  @Post('planos/:id/aprovar')
  @HttpCode(204)
  async aprovarPlano(@CurrentUser() u: TenantAccessClaims, @Param('id', uuid()) id: string, @Req() req: Request): Promise<void> {
    await this.service.aprovarPlano(u, id, req.ip ?? '');
  }

  // ---- Lotes ----

  @Permissions('digitalizacao:read')
  @Get('lotes')
  lotes(@CurrentUser() u: TenantAccessClaims, @Query(new ZodValidationPipe(lotesQuerySchema)) q: LotesQuery): Promise<{ items: LoteResumoView[]; total: number }> {
    return this.service.listarLotes(u, q);
  }

  @Permissions('digitalizacao:create')
  @Post('lotes')
  criarLote(@CurrentUser() u: TenantAccessClaims, @Body(new ZodValidationPipe(loteCreateSchema)) b: LoteCreateInput, @Req() req: Request): Promise<{ id: string }> {
    return this.service.criarLote(u, b, req.ip ?? '');
  }

  @Permissions('digitalizacao:read')
  @Get('lotes/:id')
  lote(@CurrentUser() u: TenantAccessClaims, @Param('id', uuid()) id: string): Promise<LoteDetalheView> {
    return this.service.detalhe(u, id);
  }

  @Permissions('digitalizacao:update')
  @Patch('lotes/:id')
  @HttpCode(204)
  async atualizarLote(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(loteUpdateSchema)) b: LoteUpdateInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.atualizarLote(u, id, b, req.ip ?? '');
  }

  @Permissions('digitalizacao:update')
  @Post('lotes/:id/etapa')
  @HttpCode(204)
  async avancar(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(avancarEtapaSchema)) b: AvancarEtapaInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.avancar(u, id, b, req.ip ?? '');
  }

  @Permissions('digitalizacao:create')
  @Post('lotes/:id/itens')
  @HttpCode(204)
  async adicionarItem(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(itemLoteSchema)) b: ItemLoteInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.adicionarItem(u, id, b, req.ip ?? '');
  }

  @Permissions('digitalizacao:update')
  @Patch('lotes/:id/itens/:itemId')
  @HttpCode(204)
  async atualizarItem(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Param('itemId', uuid()) itemId: string,
    @Body(new ZodValidationPipe(itemLoteUpdateSchema)) b: ItemLoteUpdateInput,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.atualizarItem(u, id, itemId, b, req.ip ?? '');
  }

  @Permissions('digitalizacao:delete')
  @Delete('lotes/:id/itens/:itemId')
  @HttpCode(204)
  async removerItem(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Param('itemId', uuid()) itemId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.removerItem(u, id, itemId, req.ip ?? '');
  }

  @Permissions('digitalizacao:read')
  @Get('lotes/:id/documentos')
  documentos(@CurrentUser() u: TenantAccessClaims, @Param('id', uuid()) id: string) {
    return this.service.documentosDoLote(u, id);
  }

  @Permissions('digitalizacao:update')
  @Post('lotes/:id/documentos')
  vincular(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(vincularDocumentosSchema)) b: { ids: string[] },
    @Req() req: Request,
  ): Promise<{ vinculados: number }> {
    return this.service.vincularDocumentos(u, id, b.ids, req.ip ?? '');
  }

  @Permissions('digitalizacao:update')
  @Delete('lotes/:id/documentos/:documentId')
  @HttpCode(204)
  async desvincular(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Param('documentId', uuid()) documentId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.desvincularDocumento(u, id, documentId, req.ip ?? '');
  }

  @Permissions('digitalizacao:update')
  @Post('lotes/:id/qc')
  registrarQc(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(qcSchema)) b: QcInput,
    @Req() req: Request,
  ): Promise<{ aprovado: boolean }> {
    return this.service.registrarQc(u, id, b, req.ip ?? '');
  }

  @Permissions('digitalizacao:update')
  @Post('lotes/:id/nao-conformidades/:ncId/corrigir')
  @HttpCode(204)
  async corrigirNc(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Param('ncId', uuid()) ncId: string,
    @Body(new ZodValidationPipe(corrigirNcSchema)) b: { correcao: string },
    @Req() req: Request,
  ): Promise<void> {
    await this.service.corrigirNc(u, id, ncId, b.correcao, req.ip ?? '');
  }

  @Permissions('fiscal_contrato:update')
  @Post('lotes/:id/aceite')
  @HttpCode(204)
  async aceitar(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(aceiteSchema)) b: { observacao?: string },
    @Req() req: Request,
  ): Promise<void> {
    await this.service.aceitar(u, id, b.observacao, req.ip ?? '');
  }

  @Permissions('digitalizacao:read')
  @Get('lotes/:id/termo/:tipo')
  async termo(
    @CurrentUser() u: TenantAccessClaims,
    @Param('id', uuid()) id: string,
    @Param('tipo', new ZodValidationPipe(z.enum(TERMOS_LOTE))) tipo: TermoLote,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const l = await this.service.detalhe(u, id);
    const ctx = requireTenantContext();
    const arquivo = await termoLotePdf(ctx.nome, l, tipo);
    await this.audit.logTenant({ actorId: u.sub, action: 'digit_termo_emitido', resourceType: 'digit_lote', resourceId: id, ip: req.ip, metadata: { tipo } });
    enviar(res, { arquivo, nome: `termo-${tipo}-${l.protocolo.replace(/\W+/g, '-')}.pdf` });
  }

  // ---- Producao ----

  @Permissions('digitalizacao:read')
  @Get('producao')
  producao(@CurrentUser() u: TenantAccessClaims, @Query(new ZodValidationPipe(producaoQuerySchema)) q: ProducaoQuery): Promise<ProducaoResumo> {
    return this.service.producao(u, q);
  }

  @Permissions('digitalizacao:export')
  @Get('producao/:formato')
  async producaoExportar(
    @CurrentUser() u: TenantAccessClaims,
    @Param('formato', new ZodValidationPipe(formatoSchema)) formato: 'pdf' | 'csv',
    @Query(new ZodValidationPipe(producaoQuerySchema)) q: ProducaoQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const p = await this.service.producao(u, q);
    const periodo = q.de || q.ate ? `Período: ${q.de ?? '…'} a ${q.ate ?? '…'}` : 'Todo o período';
    await this.audit.logTenant({ actorId: u.sub, action: 'digit_producao_exportada', resourceType: 'relatorio', ip: req.ip, metadata: { formato, ...q } });
    enviar(res, await producaoExport(requireTenantContext().nome, p, formato, periodo, null));
  }
}
