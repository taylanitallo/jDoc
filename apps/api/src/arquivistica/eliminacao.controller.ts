import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  eliminacaoAprovarSchema,
  eliminacaoCancelarSchema,
  eliminacaoConcluirSchema,
  eliminacaoCreateSchema,
  eliminacaoItensSchema,
  eliminacaoPublicarSchema,
  type EliminacaoItemView,
  type EliminacaoView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { EliminacaoService } from './eliminacao.service';

const uuidSchema = z.string().uuid();

function enviarPdf(res: Response, r: { pdf: Buffer; nome: string }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.send(r.pdf);
}

/**
 * Eliminacao legal. Montar/editar a listagem: temporalidade:update.
 * Aprovar, publicar edital, cancelar e concluir: temporalidade:delete —
 * concluir exige ainda papel admin (checado no service) e frase de confirmacao.
 */
@Controller('t/:slug/arquivistica/eliminacoes')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class EliminacaoController {
  constructor(private readonly service: EliminacaoService) {}

  @Permissions('temporalidade:read')
  @Get()
  list(): Promise<EliminacaoView[]> {
    return this.service.list();
  }

  @Permissions('temporalidade:read')
  @Get('candidatos')
  candidatos(): ReturnType<EliminacaoService['candidatos']> {
    return this.service.candidatos();
  }

  @Permissions('temporalidade:read')
  @Get(':id')
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<EliminacaoView> {
    return this.service.get(id);
  }

  @Permissions('temporalidade:read')
  @Get(':id/itens')
  itens(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<EliminacaoItemView[]> {
    return this.service.itens(id);
  }

  @Permissions('temporalidade:update')
  @Post()
  criar(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(eliminacaoCreateSchema)) body: z.infer<typeof eliminacaoCreateSchema>,
    @Req() req: Request,
  ): Promise<EliminacaoView> {
    return this.service.criar(user, body.observacoes, body.prazoEditalDias, req.ip ?? '');
  }

  @Permissions('temporalidade:update')
  @Post(':id/itens')
  adicionar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(eliminacaoItensSchema)) body: z.infer<typeof eliminacaoItensSchema>,
    @Req() req: Request,
  ): Promise<{ adicionados: number }> {
    return this.service.adicionarItens(user, id, body.ids, req.ip ?? '');
  }

  @Permissions('temporalidade:update')
  @Delete(':id/itens')
  remover(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(eliminacaoItensSchema)) body: z.infer<typeof eliminacaoItensSchema>,
    @Req() req: Request,
  ): Promise<{ removidos: number }> {
    return this.service.removerItens(user, id, body.ids, req.ip ?? '');
  }

  @Permissions('temporalidade:delete')
  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(eliminacaoAprovarSchema)) body: z.infer<typeof eliminacaoAprovarSchema>,
    @Req() req: Request,
  ): Promise<EliminacaoView> {
    return this.service.aprovar(user, id, body, req.ip ?? '');
  }

  @Permissions('temporalidade:delete')
  @Post(':id/edital')
  @HttpCode(200)
  publicar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(eliminacaoPublicarSchema)) body: z.infer<typeof eliminacaoPublicarSchema>,
    @Req() req: Request,
  ): Promise<EliminacaoView> {
    return this.service.publicarEdital(user, id, body, req.ip ?? '');
  }

  @Permissions('temporalidade:delete')
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(eliminacaoCancelarSchema)) body: z.infer<typeof eliminacaoCancelarSchema>,
    @Req() req: Request,
  ): Promise<EliminacaoView> {
    return this.service.cancelar(user, id, body.motivo, req.ip ?? '');
  }

  @Permissions('temporalidade:delete')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post(':id/concluir')
  @HttpCode(200)
  concluir(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(eliminacaoConcluirSchema)) body: z.infer<typeof eliminacaoConcluirSchema>,
    @Req() req: Request,
  ): Promise<EliminacaoView> {
    return this.service.concluir(user, id, body.confirmacao, req.ip ?? '');
  }

  @Permissions('temporalidade:read')
  @Get(':id/listagem.pdf')
  async listagem(@Param('id', new ZodValidationPipe(uuidSchema)) id: string, @Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.listagemPdf(id));
  }

  @Permissions('temporalidade:read')
  @Get(':id/edital.pdf')
  async edital(@Param('id', new ZodValidationPipe(uuidSchema)) id: string, @Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.editalPdf(id));
  }

  @Permissions('temporalidade:read')
  @Get(':id/termo.pdf')
  async termo(@Param('id', new ZodValidationPipe(uuidSchema)) id: string, @Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.termoPdf(id));
  }
}
