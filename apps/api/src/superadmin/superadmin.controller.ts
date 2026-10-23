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
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ACAO_LABEL,
  CATALOGO_MODULOS,
  createTenantSchema,
  deleteTenantSchema,
  impersonarSchema,
  integracaoUpdateSchema,
  linhasPermissao,
  logsQuerySchema,
  modeloPerfilSchema,
  perfilCreateSchema,
  perfilUpdateSchema,
  resetUserPasswordSchema,
  setQuotaSchema,
  setTenantStatusSchema,
  setUserActiveSchema,
  ufSchema,
  updateTenantSchema,
  usuarioOrgaoCreateSchema,
  usuarioOrgaoUpdateSchema,
  type AcessoView,
  type CreateTenantInput,
  type DeleteTenantInput,
  type ImpersonarInput,
  type IntegracaoUpdateInput,
  type IntegracaoView,
  type LogsQuery,
  type MasterDashboard,
  type PainelPlataforma,
  type ModeloPerfilInput,
  type ModeloPerfilView,
  type PerfilCreateInput,
  type PerfilUpdateInput,
  type PerfilView,
  type PreviaAplicarModelo,
  type ResetUserPasswordInput,
  type SenhaProvisoriaResposta,
  type SetQuotaInput,
  type SetTenantStatusInput,
  type SetUserActiveInput,
  type TenantOverview,
  type TesteIntegracao,
  type UpdateTenantInput,
  type UsuarioGlobalView,
  type UsuarioOrgaoCreateInput,
  type UsuarioOrgaoUpdateInput,
  type UsuarioOrgaoView,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { Critico, CurrentAdmin, origem, Papeis, type AdminReq } from '../superadmin-auth/decorators';
import { AuditService } from '../audit/audit.module';
import { AuthService } from '../auth/auth.service';
import { IntegracoesService } from '../integracoes/integracoes.service';
import { SuperadminTenantsService } from './superadmin-tenants.service';
import { SuperadminUsersService } from './superadmin-users.service';
import { PerfisService } from './perfis.service';
import { IbgeService } from './ibge.service';
import { PainelService } from './painel.service';
import { SuperadminLogsService, SuperadminDashboardService, type LogPage } from './superadmin-logs.service';

const uuidSchema = z.string().uuid();
const uuid = () => new ZodValidationPipe(uuidSchema);
const chaveSchema = z.string().regex(/^[a-z0-9_]{2,40}$/);
const acessosQuerySchema = z
  .object({
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

const TODOS = ['owner', 'support', 'implantacao'] as const;
const IMPLANTA = ['owner', 'implantacao'] as const;
const OPERA = ['owner', 'support'] as const;

function actor(req: Request): { id: string; ip: string } {
  const admin = (req as Request & { admin?: AdminReq }).admin;
  return { id: admin?.id ?? '', ip: req.ip ?? '' };
}

/**
 * Painel superadmin — TODAS as rotas exigem o token do realm superadmin
 * (issuer/audience proprios) + allowlist de IP opcional. Nenhuma e publica.
 * Rota sem @Papeis e so do owner. Isolamento: tudo que le dados de um orgao
 * usa o schema do orgao da rota (`tenants/:id/...`).
 */
@Controller('superadmin')
@UseGuards(SuperadminJwtGuard)
export class SuperadminController {
  constructor(
    private readonly tenants: SuperadminTenantsService,
    private readonly users: SuperadminUsersService,
    private readonly perfis: PerfisService,
    private readonly logs: SuperadminLogsService,
    private readonly dash: SuperadminDashboardService,
    private readonly integracoes: IntegracoesService,
    private readonly ibge: IbgeService,
    private readonly painelService: PainelService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  // ---- Painel e catalogo ----

  /** Painel: KPIs, falhas de login, rotas lentas e cartoes dos orgaos. */
  @Papeis(...TODOS)
  @Get('overview')
  overview(): Promise<PainelPlataforma> {
    return this.painelService.painel();
  }

  @Papeis(...TODOS)
  @Get('dashboard')
  dashboard(): Promise<MasterDashboard> {
    return this.dash.dashboard();
  }

  /** Modulos, menus e permissoes do sistema (com descricoes). */
  @Papeis(...TODOS)
  @Get('catalog')
  catalogo() {
    return { modulos: CATALOGO_MODULOS, permissoes: linhasPermissao(), acoes: ACAO_LABEL };
  }

  @Papeis(...TODOS)
  @Get('ibge/municipios')
  municipios(@Query('uf', new ZodValidationPipe(ufSchema)) uf: string): Promise<Array<{ id: number; nome: string }>> {
    return this.ibge.municipios(uf);
  }

  // ---- Orgaos ----

  @Papeis(...TODOS)
  @Get('tenants')
  listTenants(): Promise<TenantOverview[]> {
    return this.tenants.list();
  }

  @Papeis(...TODOS)
  @Get('tenants/:id')
  getTenant(@Param('id', uuid()) id: string): Promise<TenantOverview> {
    return this.tenants.overview(id);
  }

  /** Cria o orgao (schema proprio), os perfis padrao e o admin inicial, que recebe o convite. */
  @Papeis(...IMPLANTA)
  @Post('tenants')
  @HttpCode(201)
  async createTenant(
    @Body(new ZodValidationPipe(createTenantSchema)) body: CreateTenantInput,
    @Req() req: Request,
  ): Promise<{ id: string; schemaName: string; adminInicial?: SenhaProvisoriaResposta }> {
    const a = actor(req);
    const criado = await this.tenants.create(body, a.id, a.ip);
    if (!body.adminInicial) return criado;
    const perfil = (await this.perfis.listar(criado.id)).find((p) => p.chave === 'administrador');
    const { id: _id, ...convite } = await this.users.create(
      criado.id,
      { nome: body.adminInicial.nome, email: body.adminInicial.email, perfilId: perfil!.id },
      a.id,
      a.ip,
    );
    return { ...criado, adminInicial: convite };
  }

  @Papeis(...IMPLANTA)
  @Patch('tenants/:id')
  @HttpCode(204)
  async updateTenant(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.update(id, body, a.id, a.ip);
  }

  @Papeis(...IMPLANTA)
  @Patch('tenants/:id/status')
  @HttpCode(204)
  async setTenantStatus(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(setTenantStatusSchema)) body: SetTenantStatusInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.setStatus(id, body, a.id, a.ip);
  }

  @Papeis(...IMPLANTA)
  @Patch('tenants/:id/quota')
  @HttpCode(204)
  async setTenantQuota(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(setQuotaSchema)) body: SetQuotaInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.setQuota(id, body, a.id, a.ip);
  }

  @Papeis(...IMPLANTA)
  @Post('tenants/:id/brasao')
  @UseInterceptors(FileInterceptor('file'))
  async uploadTenantBrasao(
    @Param('id', uuid()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ brasaoUrl: string }> {
    if (!file) throw new BadRequestException('Imagem obrigatória');
    const a = actor(req);
    return this.tenants.uploadBrasao(id, file, a.id, a.ip);
  }

  @Papeis(...IMPLANTA)
  @Delete('tenants/:id/brasao')
  @HttpCode(204)
  async deleteTenantBrasao(@Param('id', uuid()) id: string, @Req() req: Request): Promise<void> {
    const a = actor(req);
    await this.tenants.deleteBrasao(id, a.id, a.ip);
  }

  /** Exclusao definitiva: so owner, com reauth e o identificador digitado. */
  @Delete('tenants/:id')
  @Critico()
  @HttpCode(204)
  async deleteTenant(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(deleteTenantSchema)) body: DeleteTenantInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.tenants.remove(id, body.confirmacao, a.id, a.ip);
  }

  // ---- Perfis do orgao ----

  @Papeis(...TODOS)
  @Get('tenants/:id/roles')
  listarPerfis(@Param('id', uuid()) id: string): Promise<PerfilView[]> {
    return this.perfis.listar(id);
  }

  @Papeis(...IMPLANTA)
  @Post('tenants/:id/roles')
  async criarPerfil(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(perfilCreateSchema)) body: PerfilCreateInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<PerfilView> {
    const p = await this.perfis.criar(id, body);
    await this.audit.logAdmin(admin, origem(req), {
      action: 'perfil_criado',
      tenantId: id,
      entity: 'perfil',
      entityId: p.id,
      depois: { nome: p.nome, papel: p.papel, permissoes: p.permissoes },
    });
    return (await this.perfis.listar(id)).find((x) => x.id === p.id)!;
  }

  @Papeis(...IMPLANTA)
  @Patch('tenants/:id/roles/:roleId')
  async atualizarPerfil(
    @Param('id', uuid()) id: string,
    @Param('roleId', uuid()) roleId: string,
    @Body(new ZodValidationPipe(perfilUpdateSchema)) body: PerfilUpdateInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<PerfilView> {
    const { antes, depois } = await this.perfis.atualizar(id, roleId, body);
    await this.audit.logAdmin(admin, origem(req), {
      action: 'perfil_atualizado',
      tenantId: id,
      entity: 'perfil',
      entityId: roleId,
      antes: { nome: antes.nome, papel: antes.papel, permissoes: antes.permissoes },
      depois: { nome: depois.nome, papel: depois.papel, permissoes: depois.permissoes },
    });
    return (await this.perfis.listar(id)).find((x) => x.id === roleId)!;
  }

  @Papeis(...IMPLANTA)
  @Delete('tenants/:id/roles/:roleId')
  @HttpCode(204)
  async excluirPerfil(
    @Param('id', uuid()) id: string,
    @Param('roleId', uuid()) roleId: string,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<void> {
    const p = await this.perfis.excluir(id, roleId);
    await this.audit.logAdmin(admin, origem(req), {
      action: 'perfil_excluido',
      tenantId: id,
      entity: 'perfil',
      entityId: roleId,
      antes: { nome: p.nome, papel: p.papel, permissoes: p.permissoes },
    });
  }

  @Papeis(...IMPLANTA)
  @Post('tenants/:id/roles/:roleId/restore')
  async restaurarPerfil(
    @Param('id', uuid()) id: string,
    @Param('roleId', uuid()) roleId: string,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<PerfilView> {
    const { antes, depois } = await this.perfis.restaurar(id, roleId);
    await this.audit.logAdmin(admin, origem(req), {
      action: 'perfil_restaurado',
      tenantId: id,
      entity: 'perfil',
      entityId: roleId,
      antes: { nome: antes.nome, papel: antes.papel, permissoes: antes.permissoes },
      depois: { nome: depois.nome, papel: depois.papel, permissoes: depois.permissoes },
    });
    return (await this.perfis.listar(id)).find((x) => x.id === roleId)!;
  }

  // ---- Usuarios do orgao ----

  @Papeis(...TODOS)
  @Get('tenants/:id/users')
  listUsers(@Param('id', uuid()) id: string): Promise<UsuarioOrgaoView[]> {
    return this.users.list(id);
  }

  @Papeis(...TODOS)
  @Post('tenants/:id/users')
  @HttpCode(201)
  createUser(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(usuarioOrgaoCreateSchema)) body: UsuarioOrgaoCreateInput,
    @Req() req: Request,
  ): Promise<{ id: string } & SenhaProvisoriaResposta> {
    const a = actor(req);
    return this.users.create(id, body, a.id, a.ip);
  }

  @Papeis(...TODOS)
  @Patch('tenants/:id/users/:userId')
  updateUser(
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
    @Body(new ZodValidationPipe(usuarioOrgaoUpdateSchema)) body: UsuarioOrgaoUpdateInput,
    @Req() req: Request,
  ): Promise<UsuarioOrgaoView> {
    const a = actor(req);
    return this.users.update(id, userId, body, a.id, a.ip);
  }

  /** Nova senha provisoria por e-mail (sem SMTP, volta na resposta). */
  @Papeis(...TODOS)
  @Post('tenants/:id/users/:userId/reset-password')
  @HttpCode(200)
  redefinirSenha(@Param('id', uuid()) id: string, @Param('userId', uuid()) userId: string, @Req() req: Request): Promise<SenhaProvisoriaResposta> {
    const a = actor(req);
    return this.users.redefinirSenhaPorEmail(id, userId, a.id, a.ip);
  }

  @Papeis(...TODOS)
  @Post('tenants/:id/users/:userId/unlock')
  @HttpCode(204)
  async desbloquear(@Param('id', uuid()) id: string, @Param('userId', uuid()) userId: string, @Req() req: Request): Promise<void> {
    const a = actor(req);
    await this.users.desbloquear(id, userId, a.id, a.ip);
  }

  @Papeis(...TODOS)
  @Post('tenants/:id/users/:userId/revoke-sessions')
  @HttpCode(204)
  async encerrarSessoes(@Param('id', uuid()) id: string, @Param('userId', uuid()) userId: string, @Req() req: Request): Promise<void> {
    const a = actor(req);
    await this.users.encerrarSessoes(id, userId, a.id, a.ip);
  }

  @Papeis(...TODOS)
  @Patch('tenants/:id/users/:userId/password')
  @HttpCode(204)
  async resetUserPassword(
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
    @Body(new ZodValidationPipe(resetUserPasswordSchema)) body: ResetUserPasswordInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.users.resetPassword(id, userId, body, a.id, a.ip);
  }

  @Papeis(...TODOS)
  @Patch('tenants/:id/users/:userId/ativo')
  @HttpCode(204)
  async setUserActive(
    @Param('id', uuid()) id: string,
    @Param('userId', uuid()) userId: string,
    @Body(new ZodValidationPipe(setUserActiveSchema)) body: SetUserActiveInput,
    @Req() req: Request,
  ): Promise<void> {
    const a = actor(req);
    await this.users.setActive(id, userId, body.ativo, a.id, a.ip);
  }

  @Papeis(...IMPLANTA)
  @Delete('tenants/:id/users/:userId')
  @HttpCode(204)
  async deleteUser(@Param('id', uuid()) id: string, @Param('userId', uuid()) userId: string, @Req() req: Request): Promise<void> {
    const a = actor(req);
    await this.users.remove(id, userId, a.id, a.ip);
  }

  /**
   * "Entrar como": token do usuario marcado como impersonacao (30 min, sem
   * refresh). Reauth + motivo obrigatorio, auditado na plataforma e no orgao.
   */
  @Papeis(...OPERA)
  @Post('tenants/:id/impersonate')
  @Critico()
  @HttpCode(200)
  async impersonar(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(impersonarSchema)) body: ImpersonarInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<{ accessToken: string; expiraEm: string; slug: string }> {
    const t = await this.tenants.getById(id);
    if (t.status !== 'ativo') throw new BadRequestException('O órgão não está ativo');
    const r = await this.auth.emitirImpersonacao(
      { tenantId: t.id, slug: t.slug, schemaName: t.schema_name },
      body.userId,
      { adminId: admin.id, adminNome: admin.nome, motivo: body.motivo },
    );
    await this.audit.logAdmin(admin, origem(req), {
      action: 'impersonacao_iniciada',
      tenantId: id,
      entity: 'usuario',
      entityId: body.userId,
      metadata: { motivo: body.motivo, expiraEm: r.expiraEm },
    });
    return { ...r, slug: t.slug };
  }

  @Papeis(...OPERA)
  @Get('tenants/:id/access')
  acessos(
    @Param('id', uuid()) id: string,
    @Query(new ZodValidationPipe(acessosQuerySchema)) q: z.infer<typeof acessosQuerySchema>,
  ): Promise<{ items: AcessoView[]; total: number }> {
    return this.users.acessos(id, q.de, q.ate, q.page, q.pageSize);
  }

  /** Busca global (nome, e-mail ou CPF) em todos os orgaos. */
  @Papeis(...TODOS)
  @Get('users')
  buscarUsuarios(@Query('q') q = ''): Promise<UsuarioGlobalView[]> {
    return this.users.buscarGlobal(String(q));
  }

  // ---- Integracoes do orgao ----

  @Papeis(...TODOS)
  @Get('tenants/:id/integrations')
  async integracoesOrgao(@Param('id', uuid()) id: string): Promise<IntegracaoView[]> {
    await this.tenants.getById(id);
    return this.integracoes.listarOrgao(id);
  }

  /** Gravar chave de API e acao critica (reauth). */
  @Papeis(...IMPLANTA)
  @Put('tenants/:id/integrations/:key')
  @Critico()
  async salvarIntegracaoOrgao(
    @Param('id', uuid()) id: string,
    @Param('key') rawKey: string,
    @Body(new ZodValidationPipe(integracaoUpdateSchema)) body: IntegracaoUpdateInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<IntegracaoView> {
    const key = IntegracoesService.validarKey(rawKey);
    await this.tenants.getById(id);
    const { antes, depois } = await this.integracoes.salvarOrgao(id, key, body, admin.id);
    await this.audit.logAdmin(admin, origem(req), { action: 'integracao_atualizada', tenantId: id, entity: 'integracao', entityId: key, antes, depois });
    return (await this.integracoes.listarOrgao(id)).find((i) => i.key === key)!;
  }

  @Papeis(...TODOS)
  @Post('tenants/:id/integrations/:key/test')
  @HttpCode(200)
  async testarIntegracaoOrgao(@Param('id', uuid()) id: string, @Param('key') rawKey: string): Promise<TesteIntegracao> {
    await this.tenants.getById(id);
    return this.integracoes.testar(id, IntegracoesService.validarKey(rawKey));
  }

  // ---- Configuracoes globais (so owner) ----

  @Get('settings')
  configuracoes(): Promise<IntegracaoView[]> {
    return this.integracoes.listarPlataforma();
  }

  @Put('settings/:key')
  @Critico()
  async salvarConfiguracao(
    @Param('key') rawKey: string,
    @Body(new ZodValidationPipe(integracaoUpdateSchema)) body: IntegracaoUpdateInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<IntegracaoView> {
    const key = IntegracoesService.validarKey(rawKey);
    const { antes, depois } = await this.integracoes.salvarPlataforma(key, body, admin.id);
    await this.audit.logAdmin(admin, origem(req), { action: 'configuracao_atualizada', entity: 'integracao', entityId: key, antes, depois });
    return (await this.integracoes.listarPlataforma()).find((i) => i.key === key)!;
  }

  @Post('settings/:key/test')
  @HttpCode(200)
  testarConfiguracao(@Param('key') rawKey: string): Promise<TesteIntegracao> {
    return this.integracoes.testar(null, IntegracoesService.validarKey(rawKey));
  }

  // ---- Perfis padrao (modelos globais) ----

  @Papeis(...IMPLANTA)
  @Get('role-templates')
  modelos(): Promise<ModeloPerfilView[]> {
    return this.perfis.modelos();
  }

  @Papeis(...IMPLANTA)
  @Put('role-templates/:key')
  async salvarModelo(
    @Param('key', new ZodValidationPipe(chaveSchema)) key: string,
    @Body(new ZodValidationPipe(modeloPerfilSchema)) body: ModeloPerfilInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<ModeloPerfilView[]> {
    const { antes, depois } = await this.perfis.salvarModelo(key, body, admin.id);
    await this.audit.logAdmin(admin, origem(req), {
      action: 'modelo_perfil_atualizado',
      entity: 'modelo_perfil',
      entityId: key,
      antes: { nome: antes.nome, permissoes: antes.permissoes },
      depois: { nome: depois.nome, permissoes: depois.permissoes },
    });
    return this.perfis.modelos();
  }

  /** "Voltar ao padrao de fabrica". */
  @Papeis(...IMPLANTA)
  @Delete('role-templates/:key')
  async restaurarModelo(
    @Param('key', new ZodValidationPipe(chaveSchema)) key: string,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<ModeloPerfilView[]> {
    await this.perfis.restaurarModelo(key);
    await this.audit.logAdmin(admin, origem(req), { action: 'modelo_perfil_restaurado', entity: 'modelo_perfil', entityId: key });
    return this.perfis.modelos();
  }

  @Papeis(...IMPLANTA)
  @Get('role-templates/:key/preview')
  previa(@Param('key', new ZodValidationPipe(chaveSchema)) key: string): Promise<PreviaAplicarModelo> {
    return this.perfis.previaAplicar(key);
  }

  /** "Aplicar a todos os orgaos" (so owner: mexe em todos os clientes). */
  @Post('role-templates/:key/apply')
  @HttpCode(200)
  async aplicarModelo(
    @Param('key', new ZodValidationPipe(chaveSchema)) key: string,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<{ alterados: number }> {
    const r = await this.perfis.aplicarModelo(key);
    await this.audit.logAdmin(admin, origem(req), {
      action: 'modelo_perfil_aplicado',
      entity: 'modelo_perfil',
      entityId: key,
      metadata: { orgaosAlterados: r.alterados },
    });
    return r;
  }

  // ---- Logs ----

  @Papeis(...OPERA)
  @Get('logs/global')
  globalLogs(@Query(new ZodValidationPipe(logsQuerySchema)) q: LogsQuery): Promise<LogPage> {
    return this.logs.globalLogs(q);
  }

  @Papeis(...OPERA)
  @Get('tenants/:id/logs')
  tenantLogs(@Param('id', uuid()) id: string, @Query(new ZodValidationPipe(logsQuerySchema)) q: LogsQuery): Promise<LogPage> {
    return this.logs.tenantLogs(id, q);
  }
}
