import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  classificacaoPadraoPorModuloSchema,
  classificacaoSchema,
  temporalidadeListaSchema,
  type Classificacao,
  type ClassificacaoPadraoPorModulo,
  type ClassificacaoView,
  type TemporalidadeItem,
  type TemporalidadeLista,
  type TemporalidadeResumo,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { ArquivisticaService } from './arquivistica.service';

const uuidSchema = z.string().uuid();
const classificacaoCreateSchema = classificacaoSchema.omit({ id: true }).strict();
const classificacaoUpdateSchema = classificacaoSchema
  .omit({ id: true })
  .partial()
  .strict();
const listClassesQuerySchema = z
  .object({ incluirInativas: z.enum(['true', 'false']).optional() })
  .strict();
const csvBodySchema = z.object({ conteudo: z.string().min(1).max(2_000_000) }).strict();
const listaQuerySchema = z
  .object({
    lista: temporalidadeListaSchema,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
const movimentarSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(1000),
    observacoes: z.string().max(1000).nullable().default(null),
  })
  .strict();

/**
 * Gestao arquivistica: Plano de Classificacao, classe padrao por modulo e
 * Tabela de Temporalidade (listas + guias de transferencia/recolhimento).
 */
@Controller('t/:slug/arquivistica')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class ArquivisticaController {
  constructor(private readonly service: ArquivisticaService) {}

  // ---------- Plano de Classificacao ----------

  /** Lista aberta a qualquer autenticado: os modais de inclusao precisam escolher a classe. */
  @Permissions()
  @Get('classificacoes')
  list(
    @Query(new ZodValidationPipe(listClassesQuerySchema)) q: z.infer<typeof listClassesQuerySchema>,
  ): Promise<ClassificacaoView[]> {
    return this.service.listClassificacoes(q.incluirInativas === 'true');
  }

  @Permissions('classificacao:create')
  @Post('classificacoes')
  create(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(classificacaoCreateSchema)) data: Classificacao,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createClassificacao(data, user.sub, req.ip ?? '');
  }

  @Permissions('classificacao:update')
  @Patch('classificacoes/:id')
  @HttpCode(204)
  update(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(classificacaoUpdateSchema)) data: Partial<Classificacao>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateClassificacao(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('classificacao:delete')
  @Delete('classificacoes/:id')
  remove(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<{ inativada: boolean }> {
    return this.service.deleteClassificacao(id, user.sub, req.ip ?? '');
  }

  @Permissions('classificacao:create')
  @Post('classificacoes/modelo')
  carregarModelo(@CurrentUser() user: TenantAccessClaims, @Req() req: Request): Promise<{ criadas: number }> {
    return this.service.carregarModelo(user.sub, req.ip ?? '');
  }

  @Permissions('classificacao:read')
  @Get('classificacoes/csv')
  async exportarCsv(@Res() res: Response): Promise<void> {
    const csv = await this.service.exportarCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="plano-classificacao.csv"');
    res.send(String.fromCharCode(0xfeff) + csv); // BOM: Excel abre acentos corretamente
  }

  @Permissions('classificacao:create', 'classificacao:update')
  @Post('classificacoes/csv')
  importarCsv(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(csvBodySchema)) body: z.infer<typeof csvBodySchema>,
    @Req() req: Request,
  ): Promise<{ criadas: number; atualizadas: number }> {
    return this.service.importarCsv(body.conteudo, user.sub, req.ip ?? '');
  }

  // ---------- Classe padrao por modulo ----------

  @Permissions()
  @Get('padroes')
  getPadroes(): Promise<ClassificacaoPadraoPorModulo> {
    return this.service.getPadroes();
  }

  @Permissions('classificacao:update')
  @Put('padroes')
  @HttpCode(204)
  setPadroes(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(classificacaoPadraoPorModuloSchema)) body: ClassificacaoPadraoPorModulo,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.setPadroes(body, user.sub, req.ip ?? '');
  }

  // ---------- Temporalidade ----------

  @Permissions('temporalidade:read')
  @Get('temporalidade/resumo')
  resumo(): Promise<TemporalidadeResumo> {
    return this.service.resumo();
  }

  @Permissions('temporalidade:read')
  @Get('temporalidade')
  lista(
    @Query(new ZodValidationPipe(listaQuerySchema)) q: { lista: TemporalidadeLista; page: number; pageSize: number },
  ): Promise<{ items: TemporalidadeItem[]; total: number }> {
    return this.service.lista(q.lista, q.page, q.pageSize);
  }

  @Permissions('temporalidade:update')
  @Post('temporalidade/aplicar-padrao')
  aplicarPadrao(@CurrentUser() user: TenantAccessClaims, @Req() req: Request): Promise<{ atualizados: number }> {
    return this.service.aplicarPadraoEmLote(user.sub, req.ip ?? '');
  }

  @Permissions('temporalidade:update')
  @Post('temporalidade/transferir')
  transferir(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(movimentarSchema)) body: z.infer<typeof movimentarSchema>,
    @Req() req: Request,
  ): Promise<{ guiaId: string; numero: number; ano: number; total: number }> {
    return this.service.movimentar('transferencia', body.ids, body.observacoes, user.sub, req.ip ?? '');
  }

  @Permissions('temporalidade:update')
  @Post('temporalidade/recolher')
  recolher(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(movimentarSchema)) body: z.infer<typeof movimentarSchema>,
    @Req() req: Request,
  ): Promise<{ guiaId: string; numero: number; ano: number; total: number }> {
    return this.service.movimentar('recolhimento', body.ids, body.observacoes, user.sub, req.ip ?? '');
  }

  @Permissions('temporalidade:read')
  @Get('guias')
  listGuias(): ReturnType<ArquivisticaService['listGuias']> {
    return this.service.listGuias();
  }

  @Permissions('temporalidade:read')
  @Get('guias/:id/pdf')
  async guiaPdf(@Param('id', new ZodValidationPipe(uuidSchema)) id: string, @Res() res: Response): Promise<void> {
    const { pdf, nome } = await this.service.guiaPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
    res.send(pdf);
  }
}
