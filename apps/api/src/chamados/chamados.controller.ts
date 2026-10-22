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
  CRITICIDADES,
  STATUS_CHAMADO,
  avaliacaoChamadoSchema,
  chamadoCreateAdminSchema,
  chamadoCreateSchema,
  chamadoUpdateSchema,
  feriadoSchema,
  mensagemChamadoSchema,
  releaseSchema,
  type AnexoChamado,
  type ChamadoCreateAdminInput,
  type ChamadoCreateInput,
  type ChamadoDetalhe,
  type ChamadoResumo,
  type ChamadoUpdateInput,
  type FeriadoInput,
  type MensagemChamadoInput,
  type RelatorioSla,
  type ReleaseInput,
  type ReleaseView,
  type TenantAccessClaims,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { CurrentAdmin, origem, Papeis, type AdminReq } from '../superadmin-auth/decorators';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { AuditService } from '../audit/audit.module';
import { DatabaseService } from '../database/database.service';
import { requireTenantContext } from '../tenancy/tenant-context';
import { ChamadosService } from './chamados.service';

const uuid = () => new ZodValidationPipe(z.string().uuid());
const listaSchema = z
  .object({
    tenantId: z.string().uuid().optional(),
    status: z.enum(STATUS_CHAMADO).optional(),
    criticidade: z.enum(CRITICIDADES).optional(),
    responsavelId: z.string().uuid().optional(),
    atrasados: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    abertos: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    q: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const slaSchema = z.object({ de: z.coerce.date(), ate: z.coerce.date(), tenantId: z.string().uuid().optional() }).strict();
const chaveAnexo = new ZodValidationPipe(z.string().regex(/^[0-9a-f-]{36}\.(pdf|png|jpg)$/));
const OPERA = ['owner', 'support'] as const;

/** Atendimento no painel: fila, conversa, SLA, notas de versao e feriados. */
@Controller('superadmin')
@UseGuards(SuperadminJwtGuard)
@Papeis(...OPERA)
export class ChamadosAdminController {
  constructor(
    private readonly chamados: ChamadosService,
    private readonly audit: AuditService,
  ) {}

  @Get('tickets')
  listar(@Query(new ZodValidationPipe(listaSchema)) q: z.infer<typeof listaSchema>): Promise<{ items: ChamadoResumo[]; total: number }> {
    return this.chamados.listar(q);
  }

  @Post('tickets')
  abrir(@Body(new ZodValidationPipe(chamadoCreateAdminSchema)) body: ChamadoCreateAdminInput, @CurrentAdmin() admin: AdminReq): Promise<ChamadoDetalhe> {
    return this.chamados.abrirPelaEquipe(body, admin);
  }

  @Get('tickets/:id')
  detalhe(@Param('id', uuid()) id: string): Promise<ChamadoDetalhe> {
    return this.chamados.detalhe(id, { comInternas: true });
  }

  @Patch('tickets/:id')
  async atualizar(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(chamadoUpdateSchema)) body: ChamadoUpdateInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<ChamadoDetalhe> {
    const { antes, depois } = await this.chamados.atualizar(id, body, admin);
    await this.audit.logAdmin(admin, origem(req), {
      action: 'chamado_atualizado',
      tenantId: depois.tenantId,
      entity: 'chamado',
      entityId: id,
      antes: { status: antes.status, criticidade: antes.criticidade, responsavelChamado: antes.responsavel },
      depois: { status: depois.status, criticidade: depois.criticidade, responsavelChamado: depois.responsavel },
      metadata: { numero: depois.numero },
    });
    return depois;
  }

  @Post('tickets/:id/messages')
  async responder(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(mensagemChamadoSchema)) body: MensagemChamadoInput,
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<ChamadoDetalhe> {
    const d = await this.chamados.mensagem(id, { tipo: 'admin', id: admin.id, nome: admin.nome }, body);
    if (!body.interna) {
      await this.audit.logAdmin(admin, origem(req), { action: 'chamado_respondido', tenantId: d.tenantId, entity: 'chamado', entityId: id, metadata: { numero: d.numero } });
    }
    return d;
  }

  @Post('tickets/:id/anexos')
  @UseInterceptors(FileInterceptor('file'))
  async anexar(@Param('id', uuid()) id: string, @UploadedFile() file: Express.Multer.File | undefined): Promise<AnexoChamado> {
    if (!file) throw new BadRequestException('Envie o arquivo');
    const d = await this.chamados.detalhe(id, { comInternas: true });
    return this.chamados.enviarAnexo(d.tenantId, file);
  }

  @Get('tickets/:id/anexos/:key')
  anexo(@Param('id', uuid()) id: string, @Param('key', chaveAnexo) key: string): Promise<{ url: string }> {
    return this.chamados.urlAnexo(id, key, { comInternas: true });
  }

  @Get('sla-report')
  sla(@Query(new ZodValidationPipe(slaSchema)) q: z.infer<typeof slaSchema>): Promise<RelatorioSla> {
    return this.chamados.relatorio(q.de, q.ate, q.tenantId);
  }

  @Get('releases')
  releases(): Promise<ReleaseView[]> {
    return this.chamados.releases();
  }

  @Post('releases')
  async publicar(@Body(new ZodValidationPipe(releaseSchema)) body: ReleaseInput, @CurrentAdmin() admin: AdminReq, @Req() req: Request): Promise<ReleaseView> {
    const r = await this.chamados.publicarRelease(body);
    await this.audit.logAdmin(admin, origem(req), { action: 'release_publicada', entity: 'release', entityId: r.id, metadata: { versao: r.versao } });
    return r;
  }

  @Put('releases/:id')
  editar(@Param('id', uuid()) id: string, @Body(new ZodValidationPipe(releaseSchema)) body: ReleaseInput): Promise<ReleaseView> {
    return this.chamados.editarRelease(id, body);
  }

  @Delete('releases/:id')
  @HttpCode(204)
  async excluir(@Param('id', uuid()) id: string): Promise<void> {
    await this.chamados.excluirRelease(id);
  }

  @Get('feriados')
  feriados(): Promise<FeriadoInput[]> {
    return this.chamados.listarFeriados();
  }

  @Post('feriados')
  @HttpCode(204)
  async salvarFeriado(@Body(new ZodValidationPipe(feriadoSchema)) body: FeriadoInput): Promise<void> {
    await this.chamados.salvarFeriado(body);
  }

  @Delete('feriados/:data')
  @HttpCode(204)
  async excluirFeriado(@Param('data', new ZodValidationPipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))) data: string): Promise<void> {
    await this.chamados.excluirFeriado(data);
  }
}

/** Lado do orgao: Suporte (chamados do proprio orgao) e Novidades. */
@Controller('t/:slug')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class SuporteController {
  constructor(
    private readonly chamados: ChamadosService,
    private readonly db: DatabaseService,
  ) {}

  @Permissions()
  @Get('suporte/chamados')
  listar(@Query(new ZodValidationPipe(listaSchema.pick({ status: true, page: true, pageSize: true }))) q: { status?: string; page: number; pageSize: number }) {
    return this.chamados.listar({ ...q, tenantId: requireTenantContext().tenantId });
  }

  @Permissions()
  @Post('suporte/chamados')
  async abrir(@Body(new ZodValidationPipe(chamadoCreateSchema)) body: ChamadoCreateInput, @CurrentUser() user: TenantAccessClaims): Promise<ChamadoDetalhe> {
    const ctx = requireTenantContext();
    const [u] = await this.db.tenant(ctx.schemaName)<Array<{ nome: string; email: string }>>`SELECT nome, email FROM users WHERE id = ${user.sub}`;
    return this.chamados.abrirPeloOrgao(ctx.tenantId, { id: user.sub, nome: u?.nome ?? 'Usuário', email: u?.email ?? '' }, body);
  }

  @Permissions()
  @Get('suporte/chamados/:id')
  detalhe(@Param('id', uuid()) id: string): Promise<ChamadoDetalhe> {
    return this.chamados.detalhe(id, { tenantId: requireTenantContext().tenantId, comInternas: false });
  }

  @Permissions()
  @Post('suporte/chamados/:id/mensagens')
  async responder(
    @Param('id', uuid()) id: string,
    @Body(new ZodValidationPipe(mensagemChamadoSchema)) body: MensagemChamadoInput,
    @CurrentUser() user: TenantAccessClaims,
  ): Promise<ChamadoDetalhe> {
    const ctx = requireTenantContext();
    const [u] = await this.db.tenant(ctx.schemaName)<Array<{ nome: string }>>`SELECT nome FROM users WHERE id = ${user.sub}`;
    return this.chamados.mensagem(id, { tipo: 'user', id: user.sub, nome: u?.nome ?? 'Usuário' }, { ...body, interna: false }, ctx.tenantId);
  }

  @Permissions()
  @Post('suporte/chamados/:id/avaliacao')
  avaliar(@Param('id', uuid()) id: string, @Body(new ZodValidationPipe(avaliacaoChamadoSchema)) body: { nota: number; comentario?: string }): Promise<ChamadoDetalhe> {
    return this.chamados.avaliar(id, requireTenantContext().tenantId, body.nota, body.comentario);
  }

  @Permissions()
  @Post('suporte/anexos')
  @UseInterceptors(FileInterceptor('file'))
  anexar(@UploadedFile() file: Express.Multer.File | undefined): Promise<AnexoChamado> {
    if (!file) throw new BadRequestException('Envie o arquivo');
    return this.chamados.enviarAnexo(requireTenantContext().tenantId, file);
  }

  @Permissions()
  @Get('suporte/chamados/:id/anexos/:key')
  anexo(@Param('id', uuid()) id: string, @Param('key', chaveAnexo) key: string): Promise<{ url: string }> {
    return this.chamados.urlAnexo(id, key, { tenantId: requireTenantContext().tenantId, comInternas: false });
  }

  @Permissions()
  @Get('novidades')
  novidades(): Promise<ReleaseView[]> {
    return this.chamados.releases(50);
  }
}
