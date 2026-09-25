import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  emprestimoCreateSchema,
  localFisicoSchema,
  type ArquivoFisicoResumo,
  type ConteudoLocal,
  type EmprestimoCreateInput,
  type EmprestimoView,
  type LocalFisicoInput,
  type LocalFisicoView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequerSistema, SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { ArquivoFisicoService } from './arquivo-fisico.service';

const uuidSchema = z.string().uuid();
const localUpdateSchema = localFisicoSchema.partial().strict();
const vincularSchema = z.object({ ids: z.array(uuidSchema).min(1).max(500) }).strict();
const emprestimosQuerySchema = z.object({ status: z.enum(['abertos', 'atrasados', 'todos']).default('abertos') }).strict();
const devolverSchema = z.object({ observacao: z.string().trim().max(500).nullable().default(null) }).strict();

function enviarPdf(res: Response, r: { pdf: Buffer; nome: string }): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
  res.send(r.pdf);
}

@Controller('t/:slug/arquivo-fisico')
@RequerSistema('arquivo')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class ArquivoFisicoController {
  constructor(private readonly service: ArquivoFisicoService) {}

  @Permissions('arquivo_fisico:read')
  @Get('resumo')
  resumo(): Promise<ArquivoFisicoResumo> {
    return this.service.resumo();
  }

  /** Lista aberta a autenticados: o modal de edicao de documento escolhe a caixa. */
  @Permissions()
  @Get('locais')
  listLocais(): Promise<LocalFisicoView[]> {
    return this.service.listLocais();
  }

  @Permissions('arquivo_fisico:create')
  @Post('locais')
  createLocal(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(localFisicoSchema)) data: LocalFisicoInput,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createLocal(data, user.sub, req.ip ?? '');
  }

  @Permissions('arquivo_fisico:update')
  @Patch('locais/:id')
  @HttpCode(204)
  updateLocal(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(localUpdateSchema)) data: Partial<LocalFisicoInput>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateLocal(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('arquivo_fisico:delete')
  @Delete('locais/:id')
  deleteLocal(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<{ inativado: boolean }> {
    return this.service.deleteLocal(id, user.sub, req.ip ?? '');
  }

  @Permissions('arquivo_fisico:read')
  @Get('locais/:id/conteudo')
  conteudo(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<ConteudoLocal> {
    return this.service.conteudo(user, id);
  }

  @Permissions('arquivo_fisico:update')
  @Post('locais/:id/documentos')
  vincular(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(vincularSchema)) body: z.infer<typeof vincularSchema>,
    @Req() req: Request,
  ): Promise<{ vinculados: number }> {
    return this.service.vincular(user, id, body.ids, req.ip ?? '');
  }

  @Permissions('arquivo_fisico:read')
  @Get('locais/:id/etiqueta')
  async etiqueta(@Param('id', new ZodValidationPipe(uuidSchema)) id: string, @Res() res: Response): Promise<void> {
    enviarPdf(res, await this.service.etiquetaPdf(id));
  }

  @Permissions('arquivo_fisico:read')
  @Get('locais/:id/espelho')
  async espelho(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    enviarPdf(res, await this.service.espelhoPdf(user, id));
  }

  @Permissions('arquivo_fisico:read')
  @Get('emprestimos')
  listEmprestimos(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(emprestimosQuerySchema)) q: z.infer<typeof emprestimosQuerySchema>,
  ): Promise<EmprestimoView[]> {
    return this.service.listEmprestimos(user, q.status);
  }

  @Permissions('arquivo_fisico:create')
  @Post('emprestimos')
  emprestar(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(emprestimoCreateSchema)) data: EmprestimoCreateInput,
    @Req() req: Request,
  ): Promise<EmprestimoView> {
    return this.service.emprestar(user, data, req.ip ?? '');
  }

  @Permissions('arquivo_fisico:update')
  @Post('emprestimos/:id/devolucao')
  @HttpCode(200)
  devolver(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(devolverSchema)) body: z.infer<typeof devolverSchema>,
    @Req() req: Request,
  ): Promise<EmprestimoView> {
    return this.service.devolver(user, id, body.observacao, req.ip ?? '');
  }

  @Permissions('arquivo_fisico:read')
  @Get('emprestimos/:id/termo')
  async termo(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Res() res: Response,
  ): Promise<void> {
    enviarPdf(res, await this.service.termoPdf(user, id));
  }
}
