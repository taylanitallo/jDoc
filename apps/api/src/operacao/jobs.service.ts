import { hostname } from 'node:os';
import { BadRequestException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { FUSO_ORGAO, JOBS, type JobNome, type JobRunView } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';

export interface OpcoesJob {
  origem?: 'agendado' | 'manual';
  disparadoPor?: string | null;
  tenantId?: string | null;
  /** Por quanto tempo a trava vale (o job precisa terminar antes). */
  travaMin?: number;
}

/** Resumo legivel de um job (aparece na tela de Jobs). */
export type ResultadoJob = { resumo: string; [k: string]: unknown } | void;

interface Agenda {
  job: JobNome;
  /** HH:MM em Fortaleza. */
  hora: string;
}

const AGENDA: Agenda[] = [
  { job: 'limpeza', hora: '03:30' },
  // Correcoes criticas no horario de menor uso (meio-dia).
  { job: 'correcoes', hora: '12:00' },
  // Continuidade: copia segregada de madrugada; teste de restauracao depois dela.
  { job: 'copia_segregada', hora: '02:30' },
  { job: 'teste_restauracao', hora: '04:30' },
];

const TICK_MS = 60_000;
const HOLDER = `${hostname()}:${process.pid}`;

/**
 * Execucao de jobs com trava no banco (platform.job_locks: com varias
 * instancias da API, so uma roda cada job) e registro em platform.job_runs.
 * Tambem dispara os jobs agendados (hora de Fortaleza) e os "tiques" de
 * minuto que outros servicos registram (metricas, saude).
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, (o: OpcoesJob) => Promise<ResultadoJob>>();
  private readonly tiques: Array<() => Promise<void>> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tique(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Registra o que roda quando o job e chamado (agenda ou "Executar agora"). */
  registrar(job: JobNome, fn: (o: OpcoesJob) => Promise<ResultadoJob>): void {
    this.handlers.set(job, fn);
  }

  /** Algo para rodar a cada minuto (sem trava nem registro). */
  aCadaMinuto(fn: () => Promise<void>): void {
    this.tiques.push(fn);
  }

  private async tique(): Promise<void> {
    for (const fn of this.tiques) await fn().catch((e: Error) => this.logger.warn(`Tique falhou: ${e.message}`));
    for (const a of AGENDA) {
      if (!this.handlers.has(a.job)) continue;
      try {
        if (await this.devidoHoje(a)) await this.executar(a.job, this.handlers.get(a.job)!, { origem: 'agendado' });
      } catch (e) {
        this.logger.warn(`Agenda de ${a.job}: ${(e as Error).message}`);
      }
    }
  }

  /** Ja passou da hora de hoje (Fortaleza) e ainda nao rodou depois dela? */
  private async devidoHoje(a: Agenda): Promise<boolean> {
    const [r] = await this.db.catalog()<Array<{ devido: boolean }>>`
      WITH alvo AS (
        SELECT ((now() AT TIME ZONE ${FUSO_ORGAO})::date + ${a.hora}::time) AT TIME ZONE ${FUSO_ORGAO} AS em
      )
      SELECT now() >= alvo.em AND NOT EXISTS (
        SELECT 1 FROM platform.job_runs j WHERE j.job = ${a.job} AND j.origem = 'agendado' AND j.started_at >= alvo.em
      ) AS devido FROM alvo
    `;
    return !!r?.devido;
  }

  private async travar(job: string, minutos: number): Promise<boolean> {
    const r = await this.db.catalog()`
      INSERT INTO platform.job_locks (job, locked_until, holder)
      VALUES (${job}, now() + make_interval(mins => ${minutos}), ${HOLDER})
      ON CONFLICT (job) DO UPDATE SET locked_until = EXCLUDED.locked_until, holder = EXCLUDED.holder
      WHERE platform.job_locks.locked_until < now()
      RETURNING job
    `;
    return r.length > 0;
  }

  private async destravar(job: string): Promise<void> {
    await this.db.catalog()`DELETE FROM platform.job_locks WHERE job = ${job} AND holder = ${HOLDER}`;
  }

  /**
   * Roda `fn` com trava e registro. Devolve o id da execucao, ou null se o job
   * ja estava rodando em outro lugar.
   */
  async executar(job: string, fn: (o: OpcoesJob) => Promise<ResultadoJob>, o: OpcoesJob = {}): Promise<string | null> {
    const chave = o.tenantId ? `${job}:${o.tenantId}` : job;
    if (!(await this.travar(chave, o.travaMin ?? 30))) return null;
    const [run] = await this.db.catalog()<Array<{ id: string }>>`
      INSERT INTO platform.job_runs (tenant_id, job, status, origem, disparado_por)
      VALUES (${o.tenantId ?? null}, ${job}, 'running', ${o.origem ?? 'agendado'}, ${o.disparadoPor ?? null})
      RETURNING id::text
    `;
    try {
      const r = await fn(o);
      await this.db.catalog()`
        UPDATE platform.job_runs SET status = 'success', finished_at = now(), stats = ${r ? this.db.catalog().json(r as never) : null}
        WHERE id = ${run!.id}
      `;
    } catch (e) {
      this.logger.error(`Job ${job} falhou: ${(e as Error).message}`);
      await this.db.catalog()`
        UPDATE platform.job_runs SET status = 'failed', finished_at = now(), error = ${(e as Error).message.slice(0, 2000)}
        WHERE id = ${run!.id}
      `;
    } finally {
      await this.destravar(chave).catch(() => undefined);
    }
    return run!.id;
  }

  /** "Executar agora" (tela de Jobs). Roda em segundo plano. */
  async executarAgora(job: string, disparadoPor: string): Promise<{ iniciado: boolean }> {
    const fn = this.handlers.get(job);
    if (!fn || !(job in JOBS) || !JOBS[job as JobNome].manual) throw new BadRequestException('Este job não pode ser executado manualmente');
    const [rodando] = await this.db.catalog()`SELECT 1 FROM platform.job_locks WHERE job = ${job} AND locked_until > now()`;
    if (rodando) return { iniciado: false };
    void this.executar(job, fn, { origem: 'manual', disparadoPor });
    return { iniciado: true };
  }

  /** Registra o inicio/fim de algo que roda fora daqui (ex.: worker de backup). */
  async iniciarRegistro(job: string, o: OpcoesJob, tentativa = 1): Promise<string> {
    const [run] = await this.db.catalog()<Array<{ id: string }>>`
      INSERT INTO platform.job_runs (tenant_id, job, status, origem, disparado_por, attempt)
      VALUES (${o.tenantId ?? null}, ${job}, 'running', ${o.origem ?? 'agendado'}, ${o.disparadoPor ?? null}, ${tentativa})
      RETURNING id::text
    `;
    return run!.id;
  }

  async concluirRegistro(id: string, erro: string | null, stats?: ResultadoJob): Promise<void> {
    await this.db.catalog()`
      UPDATE platform.job_runs SET status = ${erro ? 'failed' : 'success'}, finished_at = now(),
        error = ${erro ? erro.slice(0, 2000) : null}, stats = ${stats ? this.db.catalog().json(stats as never) : null}
      WHERE id = ${id}
    `;
  }

  async listar(f: { job?: string; status?: string; page: number; pageSize: number }): Promise<{ items: JobRunView[]; total: number }> {
    const sql = this.db.catalog();
    const filtro = sql`
      WHERE (${f.job ?? null}::text IS NULL OR j.job = ${f.job ?? null})
        AND (${f.status ?? null}::text IS NULL OR j.status = ${f.status ?? null})
    `;
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM platform.job_runs j ${filtro}`;
    const rows = await sql<
      Array<{
        id: string;
        job: string;
        tenant_id: string | null;
        orgao: string | null;
        status: JobRunView['status'];
        origem: JobRunView['origem'];
        disparado_por: string | null;
        started_at: Date;
        finished_at: Date | null;
        attempt: number;
        stats: { resumo?: string } | null;
        error: string | null;
      }>
    >`
      SELECT j.id::text, j.job, j.tenant_id, t.nome AS orgao, j.status, j.origem, j.disparado_por, j.started_at, j.finished_at,
        j.attempt, j.stats, j.error
      FROM platform.job_runs j LEFT JOIN public.tenants t ON t.id = j.tenant_id
      ${filtro}
      ORDER BY j.started_at DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}
    `;
    return {
      total: t?.n ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        job: r.job,
        nome: JOBS[r.job as JobNome]?.nome ?? r.job.replace(/_/g, ' '),
        tenantId: r.tenant_id,
        orgao: r.orgao,
        status: r.status,
        origem: r.origem,
        disparadoPor: r.disparado_por,
        inicio: r.started_at.toISOString(),
        fim: r.finished_at?.toISOString() ?? null,
        duracaoMs: r.finished_at ? r.finished_at.getTime() - r.started_at.getTime() : null,
        tentativa: r.attempt,
        resumo: typeof r.stats?.resumo === 'string' ? r.stats.resumo : null,
        erro: r.error,
      })),
    };
  }

  /** "Limpar historico": apaga as execucoes ja terminadas. */
  async limparHistorico(): Promise<number> {
    const r = await this.db.catalog()`DELETE FROM platform.job_runs WHERE status <> 'running'`;
    return r.count;
  }
}
