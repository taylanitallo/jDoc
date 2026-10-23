import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import {
  orgaoSchema,
  unidadeOrcamentariaSchema,
  projetoAtividadeSchema,
  dotacaoOrcamentariaSchema,
  elementoDespesaSchema,
  ordenadorDespesaSchema,
  tipoDocumentoSchema,
  usuarioCreateSchema,
  usuarioUpdateSchema,
  tenantSettingsSchema,
  listQuerySchema,
  type Orgao,
  type UnidadeOrcamentaria,
  type ProjetoAtividade,
  type DotacaoOrcamentaria,
  type ElementoDespesa,
  type OrdenadorDespesa,
  type TipoDocumento,
  type UsuarioTenant,
  type TenantSettings,
  type TenantBranding,
  type TenantAccessClaims,
  type PerfilOrgaoResumo,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions, Public } from '../auth/decorators';
import { ConfiguracoesService } from './configuracoes.service';

const uuidSchema = z.string().uuid();

const orgaoCreateSchema = orgaoSchema.omit({ id: true }).strict();
const orgaoUpdateSchema = orgaoSchema.omit({ id: true }).partial().strict();
const orgaosQuerySchema = listQuerySchema.extend({
  descricao: z.string().max(200).optional(),
  exercicio: z.coerce.number().int().min(2000).max(2100).optional(),
});

const unidadeCreateSchema = unidadeOrcamentariaSchema.omit({ id: true }).strict();
const unidadeUpdateSchema = unidadeOrcamentariaSchema
  .omit({ id: true })
  .partial()
  .strict();

const projetoCreateSchema = projetoAtividadeSchema.omit({ id: true }).strict();
const projetoUpdateSchema = projetoAtividadeSchema.omit({ id: true }).partial().strict();
const projetosQuerySchema = listQuerySchema.extend({
  descricao: z.string().max(200).optional(),
  exercicio: z.coerce.number().int().min(2000).max(2100).optional(),
});

const dotacaoCreateSchema = dotacaoOrcamentariaSchema.omit({ id: true, unidadeId: true }).strict();
const dotacaoUpdateSchema = dotacaoOrcamentariaSchema
  .omit({ id: true, unidadeId: true })
  .partial()
  .strict();

const elementoCreateSchema = elementoDespesaSchema.omit({ id: true }).strict();
const elementoUpdateSchema = elementoDespesaSchema.omit({ id: true }).partial().strict();
const elementosQuerySchema = listQuerySchema.extend({
  descricao: z.string().max(200).optional(),
  exercicio: z.coerce.number().int().min(2000).max(2100).optional(),
});

const ordenadorCreateSchema = ordenadorDespesaSchema.omit({ id: true, unidadeId: true }).strict();
const ordenadorUpdateSchema = ordenadorDespesaSchema
  .omit({ id: true, unidadeId: true })
  .partial()
  .strict();

const tipoDocumentoCreateSchema = tipoDocumentoSchema.omit({ id: true }).strict();
const tipoDocumentoUpdateSchema = tipoDocumentoSchema.omit({ id: true }).partial().strict();
const tiposQuerySchema = listQuerySchema.extend({ modulo: z.enum(['outros', 'acervo']).optional() });

const resetSenhaBodySchema = z
  .object({
    novaSenha: z.string().min(6).max(128),
  })
  .strict();

const settingsUpdateSchema = tenantSettingsSchema.partial().strict();

/**
 * Configuracoes do tenant. Quatro sub-recursos:
 * - /unidades + sub-entidades (projetos, dotacoes, elementos, ordenadores)
 * - /tipos-documento
 * - /usuarios
 * - /settings (layout)
 */
@Controller('t/:slug/configuracoes')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class ConfiguracoesController {
  constructor(private readonly service: ConfiguracoesService) {}

  // ===================== Guia 1: Orgaos =====================

  @Permissions('orgaos:read')
  @Get('orgaos')
  listOrgaos(
    @Query(new ZodValidationPipe(orgaosQuerySchema))
    q: { page: number; pageSize: number; descricao?: string; exercicio?: number },
  ): Promise<{ items: Orgao[]; total: number }> {
    return this.service.listOrgaos(q.page, q.pageSize, q.descricao, q.exercicio);
  }

  @Permissions('orgaos:create')
  @Post('orgaos')
  createOrgao(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(orgaoCreateSchema)) data: Omit<Orgao, 'id'>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createOrgao(data, user.sub, req.ip ?? '');
  }

  @Permissions('orgaos:update')
  @Patch('orgaos/:id')
  @HttpCode(204)
  updateOrgao(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(orgaoUpdateSchema)) data: Partial<Omit<Orgao, 'id'>>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateOrgao(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('orgaos:delete')
  @Delete('orgaos/:id')
  @HttpCode(204)
  deleteOrgao(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteOrgao(id, user.sub, req.ip ?? '');
  }

  // ===================== Guia 1: Unidades Orcamentarias =====================

  @Permissions('unidades_orcamentarias:read')
  @Get('orgaos/:orgaoId/unidades')
  listUnidadesDoOrgao(
    @Param('orgaoId', new ZodValidationPipe(uuidSchema)) orgaoId: string,
  ): Promise<UnidadeOrcamentaria[]> {
    return this.service.listUnidadesByOrgao(orgaoId);
  }

  @Permissions('unidades_orcamentarias:read')
  @Get('unidades')
  listUnidades(
    @Query(new ZodValidationPipe(listQuerySchema)) q: { page: number; pageSize: number },
  ): Promise<{ items: UnidadeOrcamentaria[]; total: number }> {
    return this.service.listUnidades(q.page, q.pageSize);
  }

  @Permissions('unidades_orcamentarias:create')
  @Post('unidades')
  createUnidade(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(unidadeCreateSchema)) data: Omit<UnidadeOrcamentaria, 'id'>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createUnidade(data, user.sub, req.ip ?? '');
  }

  @Permissions('unidades_orcamentarias:update')
  @Patch('unidades/:id')
  @HttpCode(204)
  updateUnidade(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(unidadeUpdateSchema)) data: Partial<Omit<UnidadeOrcamentaria, 'id'>>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateUnidade(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('unidades_orcamentarias:delete')
  @Delete('unidades/:id')
  @HttpCode(204)
  deleteUnidade(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteUnidade(id, user.sub, req.ip ?? '');
  }

  // ===================== Guia 1c: Projeto/Atividade (catalogo por exercicio) =====================

  @Permissions('projetos_atividades:read')
  @Get('projetos')
  listProjetos(
    @Query(new ZodValidationPipe(projetosQuerySchema))
    q: { page: number; pageSize: number; descricao?: string; exercicio?: number },
  ): Promise<{ items: ProjetoAtividade[]; total: number }> {
    return this.service.listProjetos(q.page, q.pageSize, q.descricao, q.exercicio);
  }

  @Permissions('projetos_atividades:create')
  @Post('projetos')
  createProjeto(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(projetoCreateSchema)) data: Omit<ProjetoAtividade, 'id'>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createProjeto(data, user.sub, req.ip ?? '');
  }

  @Permissions('projetos_atividades:update')
  @Patch('projetos/:id')
  @HttpCode(204)
  updateProjeto(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(projetoUpdateSchema)) data: Partial<Omit<ProjetoAtividade, 'id'>>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateProjeto(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('projetos_atividades:delete')
  @Delete('projetos/:id')
  @HttpCode(204)
  deleteProjeto(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteProjeto(id, user.sub, req.ip ?? '');
  }

  // ---- Sub-entidades: Dotacoes ----

  @Permissions('unidades_orcamentarias:read')
  @Get('unidades/:unidadeId/dotacoes')
  listDotacoes(
    @Param('unidadeId', new ZodValidationPipe(uuidSchema)) unidadeId: string,
  ): Promise<DotacaoOrcamentaria[]> {
    return this.service.listDotacoes(unidadeId);
  }

  @Permissions('unidades_orcamentarias:create')
  @Post('unidades/:unidadeId/dotacoes')
  createDotacao(
    @CurrentUser() user: TenantAccessClaims,
    @Param('unidadeId', new ZodValidationPipe(uuidSchema)) unidadeId: string,
    @Body(new ZodValidationPipe(dotacaoCreateSchema)) data: Omit<DotacaoOrcamentaria, 'id'>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createDotacao({ ...data, unidadeId }, user.sub, req.ip ?? '');
  }

  @Permissions('unidades_orcamentarias:update')
  @Patch('dotacoes/:id')
  @HttpCode(204)
  updateDotacao(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(dotacaoUpdateSchema)) data: Partial<Omit<DotacaoOrcamentaria, 'id' | 'unidadeId'>>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateDotacao(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('unidades_orcamentarias:delete')
  @Delete('dotacoes/:id')
  @HttpCode(204)
  deleteDotacao(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteDotacao(id, user.sub, req.ip ?? '');
  }

  // ===================== Guia 1b: Elementos de Despesa (catalogo por exercicio) =====================

  @Permissions('elementos_despesa:read')
  @Get('elementos')
  listElementos(
    @Query(new ZodValidationPipe(elementosQuerySchema))
    q: { page: number; pageSize: number; descricao?: string; exercicio?: number },
  ): Promise<{ items: ElementoDespesa[]; total: number }> {
    return this.service.listElementos(q.page, q.pageSize, q.descricao, q.exercicio);
  }

  @Permissions('elementos_despesa:create')
  @Post('elementos')
  createElemento(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(elementoCreateSchema)) data: Omit<ElementoDespesa, 'id'>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createElemento(data, user.sub, req.ip ?? '');
  }

  @Permissions('elementos_despesa:update')
  @Patch('elementos/:id')
  @HttpCode(204)
  updateElemento(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(elementoUpdateSchema)) data: Partial<Omit<ElementoDespesa, 'id'>>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateElemento(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('elementos_despesa:delete')
  @Delete('elementos/:id')
  @HttpCode(204)
  deleteElemento(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteElemento(id, user.sub, req.ip ?? '');
  }

  // ---- Sub-entidades: Ordenadores de Despesa ----

  @Permissions('unidades_orcamentarias:read')
  @Get('unidades/:unidadeId/ordenadores')
  listOrdenadores(
    @Param('unidadeId', new ZodValidationPipe(uuidSchema)) unidadeId: string,
  ): Promise<OrdenadorDespesa[]> {
    return this.service.listOrdenadores(unidadeId);
  }

  @Permissions('unidades_orcamentarias:create')
  @Post('unidades/:unidadeId/ordenadores')
  createOrdenador(
    @CurrentUser() user: TenantAccessClaims,
    @Param('unidadeId', new ZodValidationPipe(uuidSchema)) unidadeId: string,
    @Body(new ZodValidationPipe(ordenadorCreateSchema)) data: Omit<OrdenadorDespesa, 'id'>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createOrdenador({ ...data, unidadeId }, user.sub, req.ip ?? '');
  }

  @Permissions('unidades_orcamentarias:update')
  @Patch('ordenadores/:id')
  @HttpCode(204)
  updateOrdenador(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(ordenadorUpdateSchema)) data: Partial<Omit<OrdenadorDespesa, 'id' | 'unidadeId'>>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateOrdenador(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('unidades_orcamentarias:delete')
  @Delete('ordenadores/:id')
  @HttpCode(204)
  deleteOrdenador(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteOrdenador(id, user.sub, req.ip ?? '');
  }

  // ===================== Guia 2: Tipos de Documento =====================

  @Permissions('tipos_documento:read')
  @Get('tipos-documento')
  listTiposDocumento(
    @Query(new ZodValidationPipe(tiposQuerySchema)) q: z.infer<typeof tiposQuerySchema>,
  ): Promise<{ items: TipoDocumento[]; total: number }> {
    return this.service.listTiposDocumento(q.page, q.pageSize, q.modulo);
  }

  @Permissions('tipos_documento:create')
  @Post('tipos-documento/modelos-acervo')
  criarModelosAcervo(
    @CurrentUser() user: TenantAccessClaims,
    @Req() req: Request,
  ): Promise<{ criados: number }> {
    return this.service.criarModelosAcervo(user.sub, req.ip ?? '');
  }

  @Permissions('tipos_documento:create')
  @Post('tipos-documento')
  createTipoDocumento(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(tipoDocumentoCreateSchema)) data: Omit<TipoDocumento, 'id'>,
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createTipoDocumento(data, user.sub, req.ip ?? '');
  }

  @Permissions('tipos_documento:update')
  @Patch('tipos-documento/:id')
  @HttpCode(204)
  updateTipoDocumento(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(tipoDocumentoUpdateSchema)) data: Partial<Omit<TipoDocumento, 'id'>>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateTipoDocumento(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('tipos_documento:delete')
  @Delete('tipos-documento/:id')
  @HttpCode(204)
  deleteTipoDocumento(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteTipoDocumento(id, user.sub, req.ip ?? '');
  }

  // ===================== Guia 3: Usuarios e Permissoes =====================

  @Permissions('usuarios:read')
  @Get('perfis')
  listPerfis(): Promise<PerfilOrgaoResumo[]> {
    return this.service.listPerfis();
  }

  @Permissions('usuarios:read')
  @Get('usuarios')
  listUsuarios(
    @Query(new ZodValidationPipe(listQuerySchema)) q: { page: number; pageSize: number },
  ): Promise<{ items: UsuarioTenant[]; total: number }> {
    return this.service.listUsuarios(q.page, q.pageSize);
  }

  @Permissions('usuarios:create')
  @Post('usuarios')
  createUsuario(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(usuarioCreateSchema)) data: { email: string; nome: string; role: 'admin' | 'operador' | 'consulta'; senha: string; permissions: string[]; unidadesIds: string[] },
    @Req() req: Request,
  ): Promise<{ id: string }> {
    return this.service.createUsuario(data, user.sub, req.ip ?? '');
  }

  @Permissions('usuarios:update')
  @Patch('usuarios/:id')
  @HttpCode(204)
  updateUsuario(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(usuarioUpdateSchema)) data: { nome: string; role: 'admin' | 'operador' | 'consulta'; ativo: boolean; permissions: string[]; unidadesIds: string[] },
    @Req() req: Request,
  ): Promise<void> {
    return this.service.updateUsuario(id, data, user.sub, req.ip ?? '');
  }

  @Permissions('usuarios:delete')
  @Delete('usuarios/:id')
  @HttpCode(204)
  deleteUsuario(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.deleteUsuario(id, user.sub, req.ip ?? '');
  }

  @Permissions('usuarios:update')
  @Post('usuarios/:id/reset-senha')
  @HttpCode(204)
  resetSenha(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(resetSenhaBodySchema)) data: { novaSenha: string },
    @Req() req: Request,
  ): Promise<void> {
    return this.service.resetSenhaUsuario(id, data.novaSenha, user.sub, req.ip ?? '');
  }

  // ===================== Guia 4: Layout / Customizacao =====================

  @Permissions('layout:read')
  @Get('settings')
  getSettings(): Promise<TenantSettings> {
    return this.service.getSettings();
  }

  @Permissions('layout:update')
  @Patch('settings')
  @HttpCode(204)
  saveSettings(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(settingsUpdateSchema)) data: Partial<TenantSettings>,
    @Req() req: Request,
  ): Promise<void> {
    return this.service.saveSettings(data, user.sub, req.ip ?? '');
  }

  /** Identidade visual (nome/cor/brasao) — qualquer usuario autenticado do tenant, sem layout:read. */
  @Permissions()
  @Get('branding')
  getBranding(): Promise<TenantBranding> {
    return this.service.getBranding();
  }

  /** Mesma identidade visual, sem autenticacao — usada na propria tela de login
   *  (mostrar o brasao/nome real do orgao antes do usuario entrar). So expoe
   *  campos ja publicos por natureza (nome, cor, imagem do brasao). */
  @Public()
  @Get('public-branding')
  getPublicBranding(): Promise<TenantBranding> {
    return this.service.getBranding();
  }

  @Permissions('layout:update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('brasao')
  @UseInterceptors(FileInterceptor('file'))
  async uploadBrasao(
    @CurrentUser() user: TenantAccessClaims,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ brasaoUrl: string }> {
    if (!file) throw new BadRequestException('Imagem obrigatória');
    return this.service.uploadBrasao(file, user.sub, req.ip ?? '');
  }

  @Permissions('layout:update')
  @Delete('brasao')
  @HttpCode(204)
  deleteBrasao(@CurrentUser() user: TenantAccessClaims, @Req() req: Request): Promise<void> {
    return this.service.deleteBrasao(user.sub, req.ip ?? '');
  }
}
