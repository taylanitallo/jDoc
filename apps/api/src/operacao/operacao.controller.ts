import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Correcao, JobRunView, PainelPerformance, RequisicaoLenta, ResultadoCorrecoes } from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SuperadminJwtGuard } from '../superadmin-auth/superadmin-jwt.guard';
import { CurrentAdmin, origem, Papeis, type AdminReq } from '../superadmin-auth/decorators';
import { AuditService } from '../audit/audit.module';
import { JobsService } from './jobs.service';
import { MetricasService } from './metricas.service';
import { CorrecoesService } from './correcoes.service';

const jobsQuery = z
  .object({
    job: z.string().max(60).optional(),
    status: z.enum(['running', 'success', 'failed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const horasQuery = z.object({ horas: z.coerce.number().int().min(1).max(24 * 30).default(24) }).strict();
const executarBody = z.object({ ids: z.array(z.string().max(40)).max(200).optional() }).strict();

/** Jobs, performance e correcoes (owner e suporte; executar correcoes: owner). */
@Controller('superadmin')
@UseGuards(SuperadminJwtGuard)
export class OperacaoController {
  constructor(
    private readonly jobs: JobsService,
    private readonly metricas: MetricasService,
    private readonly correcoes: CorrecoesService,
    private readonly audit: AuditService,
  ) {}

  @Papeis('owner', 'support')
  @Get('jobs')
  listarJobs(@Query(new ZodValidationPipe(jobsQuery)) q: z.infer<typeof jobsQuery>): Promise<{ items: JobRunView[]; total: number }> {
    return this.jobs.listar(q);
  }

  @Papeis('owner', 'support')
  @Post('jobs/run')
  @HttpCode(200)
  async executarJob(
    @Body(new ZodValidationPipe(z.object({ job: z.string().max(60) }).strict())) body: { job: string },
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<{ iniciado: boolean }> {
    const r = await this.jobs.executarAgora(body.job, admin.nome);
    if (r.iniciado) await this.audit.logAdmin(admin, origem(req), { action: 'job_executado', entity: 'job', entityId: body.job, metadata: { nome: body.job } });
    return r;
  }

  @Delete('jobs')
  @HttpCode(200)
  async limparJobs(): Promise<{ apagados: number }> {
    return { apagados: await this.jobs.limparHistorico() };
  }

  @Papeis('owner', 'support')
  @Get('performance')
  painel(@Query(new ZodValidationPipe(horasQuery)) q: { horas: number }): Promise<PainelPerformance> {
    return this.metricas.painel(q.horas);
  }

  @Papeis('owner', 'support')
  @Get('slow-requests')
  lentas(@Query('limite') limite = '100'): Promise<RequisicaoLenta[]> {
    return this.metricas.lentas(Math.min(500, Math.max(1, Number(limite) || 100)));
  }

  @Papeis('owner', 'support')
  @Patch('performance/erros/:fp/resolver')
  @HttpCode(204)
  async resolverErro(@Param('fp', new ZodValidationPipe(z.string().regex(/^[0-9a-f]{40}$/))) fp: string): Promise<void> {
    await this.metricas.resolverErro(fp);
  }

  @Papeis('owner', 'support')
  @Get('correcoes')
  diagnostico(): Promise<Correcao[]> {
    return this.correcoes.diagnosticar();
  }

  /** "Executar correcoes" (todas as automaticas, ou as escolhidas). */
  @Post('correcoes/executar')
  @HttpCode(200)
  async executar(
    @Body(new ZodValidationPipe(executarBody)) body: { ids?: string[] },
    @CurrentAdmin() admin: AdminReq,
    @Req() req: Request,
  ): Promise<ResultadoCorrecoes> {
    let resultado: ResultadoCorrecoes = { aplicadas: [], falhas: [], ignoradas: 0 };
    const id = await this.jobs.executar(
      'correcoes',
      async () => {
        resultado = await this.correcoes.executar(body.ids);
        return { resumo: `${resultado.aplicadas.length} aplicada(s), ${resultado.falhas.length} falha(s)`, ...resultado };
      },
      { origem: 'manual', disparadoPor: admin.nome, travaMin: 60 },
    );
    if (!id) return { aplicadas: [], falhas: [{ id: '-', titulo: 'Correções', erro: 'Já há uma execução em andamento' }], ignoradas: 0 };
    await this.audit.logAdmin(admin, origem(req), {
      action: 'correcoes_executadas',
      entity: 'correcoes',
      metadata: { aplicadas: resultado.aplicadas.length, falhas: resultado.falhas.length },
    });
    return resultado;
  }
}
