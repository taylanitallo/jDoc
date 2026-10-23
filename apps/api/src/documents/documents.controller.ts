import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  docModuleSchema,
  docSubtypeSchema,
  documentFieldsSchema,
  etiquetasByDocCaixaQuerySchema,
  etiquetasPendentesQuerySchema,
  searchDocumentsSchema,
  trashQuerySchema,
  updateDocumentSchema,
  type AnalisarConferenciaResult,
  type ConferenciaStatusItem,
  type DocumentPage,
  type DocumentView,
  type EtiquetaCandidate,
  type EtiquetasByDocCaixaQuery,
  type EtiquetasPendentesQuery,
  type EtiquetasPendentesResult,
  type SearchDocumentsQuery,
  type TenantAccessClaims,
  type TrashQuery,
  type UpdateDocumentInput,
  camposMetadadosSchema,
  type DocumentTypeLookup,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { DocumentsService } from './documents.service';
import { DatabaseService } from '../database/database.service';
import { requireTenantContext } from '../tenancy/tenant-context';
import { Throttle } from '@nestjs/throttler';

const uuidSchema = z.string().uuid();
const documentTypesQuerySchema = z.object({ modulo: z.enum(['outros', 'acervo']).optional() }).strict();
const bulkIdsSchema = z.object({ ids: z.array(uuidSchema).min(1).max(200) }).strict();

/**
 * Boolean vindo de query string ("true"/"false"). NAO usar z.coerce.boolean()
 * aqui — ele faz Boolean(valor), e Boolean("false") e' true (string nao-vazia),
 * entao QUALQUER valor presente (inclusive "false") coagia para true.
 */
const queryBooleanSchema = z.enum(['true', 'false']).transform((v) => v === 'true');

/**
 * Documentos do tenant. Permissao por MODULO e dinamica (service.assertPermission)
 * — por isso as rotas usam @Permissions() (autenticacao) + checagem no service.
 */
@Controller('t/:slug/documents')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Permissions()
  @Get()
  search(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(searchDocumentsSchema)) q: SearchDocumentsQuery,
    @Req() req: Request,
  ): Promise<DocumentPage> {
    return this.docs.search(user, q, req.ip ?? '');
  }

  @Permissions()
  @Post('relatorio-etiquetas')
  @HttpCode(200)
  async relatorioEtiquetas(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(searchDocumentsSchema)) q: SearchDocumentsQuery,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.docs.gerarRelatorioEtiquetas(user, q);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="etiquetas.pdf"');
    res.send(pdf);
  }

  @Permissions()
  @Get('usage')
  async usage(): Promise<{ usoBytes: number; quotaBytes: number; usoPercent: number }> {
    const ctx = requireTenantContext();
    const usoBytes = await this.docs.usageBytes();
    const quotaBytes = ctx.quotaDiscoMb * 1024 * 1024;
    return {
      usoBytes,
      quotaBytes,
      usoPercent: quotaBytes > 0 ? Math.round((usoBytes / quotaBytes) * 1000) / 10 : 0,
    };
  }

  @Permissions()
  @Get('trash')
  trash(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(trashQuerySchema)) q: TrashQuery,
  ): Promise<DocumentPage> {
    return this.docs.trash(user, q);
  }

  @Permissions()
  @Delete('trash')
  async emptyTrash(
    @CurrentUser() user: TenantAccessClaims,
    @Query('module', new ZodValidationPipe(docModuleSchema.optional())) module: z.infer<typeof docModuleSchema> | undefined,
    @Req() req: Request,
  ): Promise<{ count: number }> {
    const count = await this.docs.emptyTrash(user, module, req.ip ?? '');
    return { count };
  }

  @Permissions()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  create(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(documentFieldsSchema)) fields: z.infer<typeof documentFieldsSchema>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<DocumentView> {
    // PDF e opcional na inclusao manual: sem arquivo, o documento nasce como
    // etiqueta 'aguardando_arquivo' (mesmo estado de uma etiqueta importada),
    // e o PDF pode ser anexado depois (upload normal ou Pasta Monitorada).
    return this.docs.create(user, fields, file, req.ip ?? '');
  }

  // ANTES de @Get(':id') pra "etiquetas" nao ser interpretado como um :id.
  @Permissions()
  @Get('etiquetas')
  etiquetas(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(etiquetasByDocCaixaQuerySchema)) q: EtiquetasByDocCaixaQuery,
  ): Promise<EtiquetaCandidate[]> {
    return this.docs.findEtiquetasByDocCaixa(user, q.module, q.docCaixa);
  }

  @Permissions()
  @Get('etiquetas-pendentes')
  etiquetasPendentes(
    @CurrentUser() user: TenantAccessClaims,
    @Query(new ZodValidationPipe(etiquetasPendentesQuerySchema)) q: EtiquetasPendentesQuery,
  ): Promise<EtiquetasPendentesResult> {
    return this.docs.listEtiquetasPendentes(user, q.module);
  }

  @Permissions()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('conferencia/analisar')
  analisarConferencia(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
  ): Promise<AnalisarConferenciaResult> {
    return this.docs.analisarConferencia(user, body.ids);
  }

  @Permissions()
  @Post('conferencia/cancelar')
  cancelarConferencia(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
  ): Promise<{ cancelados: number }> {
    return this.docs.cancelarConferencia(user, body.ids);
  }

  @Permissions()
  @Post('conferencia/status')
  statusConferencia(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
  ): Promise<ConferenciaStatusItem[]> {
    return this.docs.statusConferencia(user, body.ids);
  }

  @Permissions()
  @Post('conferencia/relatorio')
  @HttpCode(200)
  async relatorioConferencia(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: z.infer<typeof bulkIdsSchema>,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.docs.gerarRelatorioCriticas(user, body.ids);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="criticas-conferencia.pdf"');
    res.send(pdf);
  }

  @Permissions()
  @Get(':id')
  get(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<DocumentView> {
    return this.docs.visualizar(user, id, req.ip ?? '');
  }

  @Permissions()
  @Get(':id/url')
  url(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<{ url: string }> {
    return this.docs.signedUrl(user, id, req.ip ?? '');
  }

  @Permissions()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/file')
  @UseInterceptors(FileInterceptor('file'))
  attachFile(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<DocumentView> {
    if (!file) throw new BadRequestException('Arquivo PDF obrigatorio');
    return this.docs.attachFile(user, id, file, req.ip ?? '');
  }

  @Permissions()
  @Delete(':id/file')
  removeFile(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<DocumentView> {
    return this.docs.removeFile(user, id, req.ip ?? '');
  }

  @Permissions()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/files')
  @UseInterceptors(FileInterceptor('file'))
  addExtraFile(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<DocumentView> {
    if (!file) throw new BadRequestException('Arquivo PDF obrigatorio');
    return this.docs.addExtraFile(user, id, file, req.ip ?? '');
  }

  @Permissions()
  @Delete(':id/files/:extraId')
  removeExtraFile(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('extraId', new ZodValidationPipe(uuidSchema)) extraId: string,
    @Req() req: Request,
  ): Promise<DocumentView> {
    return this.docs.removeExtraFile(user, id, extraId, req.ip ?? '');
  }

  @Permissions()
  @Get(':id/files/:extraId/url')
  extraFileUrl(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('extraId', new ZodValidationPipe(uuidSchema)) extraId: string,
    @Req() req: Request,
  ): Promise<{ url: string }> {
    return this.docs.extraFileSignedUrl(user, id, extraId, req.ip ?? '');
  }

  @Permissions()
  @Patch(':id')
  update(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateDocumentSchema)) body: UpdateDocumentInput,
    @Req() req: Request,
  ): Promise<DocumentView> {
    return this.docs.update(user, id, body, req.ip ?? '');
  }

  @Permissions()
  @Post('bulk-delete')
  @HttpCode(204)
  async bulkDelete(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: { ids: string[] },
    @Req() req: Request,
  ): Promise<void> {
    await this.docs.bulkDelete(user, body.ids, req.ip ?? '');
  }

  @Permissions()
  @Post('bulk-download')
  @HttpCode(200)
  async bulkDownload(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(bulkIdsSchema)) body: { ids: string[] },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const zip = await this.docs.bulkDownloadZip(user, body.ids, req.ip ?? '');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="documentos.zip"');
    res.send(zip);
  }

  @Permissions()
  @Delete('etiquetas')
  async removeAllEtiquetas(
    @CurrentUser() user: TenantAccessClaims,
    @Query('module', new ZodValidationPipe(docModuleSchema)) module: z.infer<typeof docModuleSchema>,
    @Query('orgaoId', new ZodValidationPipe(uuidSchema.optional())) orgaoId: string | undefined,
    @Query('subtype', new ZodValidationPipe(docSubtypeSchema.optional())) subtype: z.infer<typeof docSubtypeSchema> | undefined,
    @Query('apenasSemArquivo', new ZodValidationPipe(queryBooleanSchema.optional())) apenasSemArquivo: boolean | undefined,
    @Req() req: Request,
  ): Promise<{ count: number }> {
    const count = await this.docs.deleteAllEtiquetas(
      user,
      module,
      req.ip ?? '',
      orgaoId,
      subtype,
      apenasSemArquivo ?? true,
    );
    return { count };
  }

  @Permissions()
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.docs.softDelete(user, id, req.ip ?? '');
  }

  @Permissions()
  @Post(':id/restore')
  @HttpCode(204)
  async restore(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.docs.restore(user, id, req.ip ?? '');
  }
}

/** Cadastros de apoio para selects (CRUD completo entra na Fase 6). */
@Controller('t/:slug')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class TenantLookupsController {
  constructor(private readonly db: DatabaseService) {}

  @Permissions()
  @Get('budget-units')
  async budgetUnits(): Promise<Array<{ id: string; codigo: string | null; nome: string }>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ id: string; codigo: string | null; nome: string }>>`
      SELECT id, codigo, nome FROM budget_units WHERE ativo = true ORDER BY nome
    `;
    return rows.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome }));
  }

  @Permissions()
  @Get('document-types')
  async documentTypes(
    @Query(new ZodValidationPipe(documentTypesQuerySchema)) q: z.infer<typeof documentTypesQuerySchema>,
  ): Promise<DocumentTypeLookup[]> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    // Sem filtro = so 'outros' (compatibilidade: telas antigas e jDoc Desktop nao conhecem o Acervo).
    const modulo = q.modulo ?? 'outros';
    const rows = await sql<
      Array<{ id: string; nome: string; cor: string; campos: unknown; classificacao_id: string | null; nivel_acesso_padrao: string }>
    >`
      SELECT id, nome, cor, campos, classificacao_id, nivel_acesso_padrao FROM document_types
      WHERE ativo = true AND modulo = ${modulo}
      ORDER BY nome
    `;
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      cor: r.cor,
      campos: camposMetadadosSchema.catch([]).parse(typeof r.campos === 'string' ? JSON.parse(r.campos) : r.campos),
      classificacaoId: r.classificacao_id,
      nivelAcessoPadrao: r.nivel_acesso_padrao as DocumentTypeLookup['nivelAcessoPadrao'],
    }));
  }
}
