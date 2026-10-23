import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NestMiddleware, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import {
  FAIXAS_MS,
  indiceFaixa,
  percentilDasFaixas,
  type AmostraSaude,
  type ConsultaLenta,
  type ErroAgrupado,
  type PainelPerformance,
  type PontoHora,
  type RequisicaoLenta,
  type RotaDesempenho,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { REDIS } from '../redis/redis.module';
import { loadEnv } from '../config/env';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { JobsService } from './jobs.service';

/** Filas BullMQ acompanhadas na saude (nomes usados pelos modulos). */
const FILAS: Record<string, string> = {
  'document-ocr': 'Leitura de texto (OCR)',
  'document-conferencia': 'Conferência por IA',
  'signature-validation': 'Validação de assinaturas',
  'labels-import': 'Importação de etiquetas',
  reports: 'Relatórios',
  integridade: 'Integridade',
  sigilo: 'Sigilo',
  'jdoc-backups': 'Backups',
};

const NOVAS_FAIXAS = (): number[] => new Array(FAIXAS_MS.length + 1).fill(0) as number[];

interface Acumulado {
  qtd: number;
  e4: number;
  e5: number;
  soma: number;
  max: number;
  faixas: number[];
}

type ReqComTenant = Request & { tenant?: { tenantId: string } };

/** Rota-padrao (`/superadmin/tenants/:id`), nunca a URL com ids. */
function rotaPadrao(req: Request): string {
  const r = (req as Request & { route?: { path?: string } }).route?.path;
  if (r) return `${req.baseUrl ?? ''}${r}`.slice(0, 300) || '/';
  return '(rota inexistente)';
}

/**
 * Monitoramento de performance: tempo de cada requisicao (agregado por hora e
 * rota, com histograma para o p95), requisicoes lentas, erros 5xx agrupados e
 * a saude do servidor (memoria, CPU, banco, Redis, filas) a cada minuto.
 */
@Injectable()
export class MetricasService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricasService.name);
  private buffer = new Map<string, Acumulado>();
  private filasRedis: Redis | null = null;
  private filas: Array<{ nome: string; q: Queue }> = [];
  private ultimoCpu = process.cpuUsage();
  private ultimoTempo = Date.now();

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    AllExceptionsFilter.aoErroInterno = (req, e) => void this.registrarErro(req, e);
    this.jobs.aCadaMinuto(() => this.gravar());
    this.jobs.aCadaMinuto(() => this.amostrarSaude());
  }

  async onModuleDestroy(): Promise<void> {
    await this.gravar().catch(() => undefined);
    for (const f of this.filas) await f.q.close().catch(() => undefined);
    await this.filasRedis?.quit().catch(() => undefined);
  }

  /** Chamado ao fim de cada resposta (middleware). */
  registrar(req: ReqComTenant, status: number, ms: number): void {
    const rota = rotaPadrao(req);
    const hora = new Date();
    hora.setMinutes(0, 0, 0);
    const chave = `${hora.toISOString()}|${req.method}|${rota}`;
    const a = this.buffer.get(chave) ?? { qtd: 0, e4: 0, e5: 0, soma: 0, max: 0, faixas: NOVAS_FAIXAS() };
    a.qtd++;
    if (status >= 500) a.e5++;
    else if (status >= 400) a.e4++;
    a.soma += ms;
    a.max = Math.max(a.max, ms);
    a.faixas[indiceFaixa(ms)]!++;
    this.buffer.set(chave, a);

    if (ms >= loadEnv().SLOW_REQUEST_MS) {
      void this.db.catalog()`
        INSERT INTO platform.slow_requests (method, route, status, duration_ms, tenant_id)
        VALUES (${req.method}, ${rota}, ${status}, ${Math.round(ms)}, ${req.tenant?.tenantId ?? null})
      `.catch(() => undefined);
    }
  }

  /** Descarrega o acumulado no banco (soma ao que ja existe na hora). */
  private async gravar(): Promise<void> {
    if (this.buffer.size === 0) return;
    const lote = this.buffer;
    this.buffer = new Map();
    const sql = this.db.catalog();
    for (const [chave, a] of lote) {
      const [hora, method, route] = chave.split('|') as [string, string, string];
      await sql`
        INSERT INTO platform.route_metrics (hora, method, route, qtd, erros_4xx, erros_5xx, soma_ms, max_ms, faixas)
        VALUES (${hora}, ${method}, ${route}, ${a.qtd}, ${a.e4}, ${a.e5}, ${Math.round(a.soma)}, ${Math.round(a.max)}, ${a.faixas})
        ON CONFLICT (hora, method, route) DO UPDATE SET
          qtd = route_metrics.qtd + EXCLUDED.qtd,
          erros_4xx = route_metrics.erros_4xx + EXCLUDED.erros_4xx,
          erros_5xx = route_metrics.erros_5xx + EXCLUDED.erros_5xx,
          soma_ms = route_metrics.soma_ms + EXCLUDED.soma_ms,
          max_ms = greatest(route_metrics.max_ms, EXCLUDED.max_ms),
          faixas = (SELECT array_agg(x + y ORDER BY i) FROM unnest(route_metrics.faixas, EXCLUDED.faixas) WITH ORDINALITY AS t(x, y, i))
      `.catch((e: Error) => this.logger.warn(`Metricas nao gravadas: ${e.message}`));
    }
  }

  /** Erro 5xx (via filtro global): agrupa por rota + primeira linha da mensagem. */
  private async registrarErro(req: Request, e: unknown): Promise<void> {
    const rota = rotaPadrao(req);
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 500);
    // Numeros e ids variam a cada ocorrencia: tira para agrupar.
    const normal = msg.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\d+/g, 'N');
    const fp = createHash('sha1').update(`${req.method} ${rota} ${normal}`).digest('hex');
    const stack = e instanceof Error ? (e.stack ?? '').slice(0, 4000) : null;
    await this.db.catalog()`
      INSERT INTO platform.error_events (fingerprint, method, route, mensagem, stack)
      VALUES (${fp}, ${req.method}, ${rota}, ${msg}, ${stack})
      ON CONFLICT (fingerprint) DO UPDATE SET qtd = error_events.qtd + 1, ultima_em = now(),
        stack = EXCLUDED.stack, resolvido_em = NULL
    `.catch(() => undefined);
  }

  private async medir(fn: () => Promise<unknown>): Promise<number | null> {
    const t = performance.now();
    try {
      await fn();
      return Math.round(performance.now() - t);
    } catch {
      return null;
    }
  }

  private filasMonitoradas(): Array<{ nome: string; q: Queue }> {
    if (!this.filas.length) {
      this.filasRedis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
      this.filas = Object.keys(FILAS).map((nome) => ({ nome, q: new Queue(nome, { connection: this.filasRedis! }) }));
    }
    return this.filas;
  }

  private async amostrarSaude(): Promise<void> {
    const agora = Date.now();
    const cpu = process.cpuUsage(this.ultimoCpu);
    const cpuPct = ((cpu.user + cpu.system) / 1000 / Math.max(1, agora - this.ultimoTempo)) * 100;
    this.ultimoCpu = process.cpuUsage();
    this.ultimoTempo = agora;
    const sql = this.db.catalog();
    const dbMs = await this.medir(() => sql`SELECT 1`);
    const redisMs = await this.medir(() => this.redis.ping());
    const [db] = await sql<Array<{ conexoes: number; tamanho: number }>>`
      SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS conexoes,
        (pg_database_size(current_database()) / 1048576)::int AS tamanho
    `.catch(() => [{ conexoes: null as unknown as number, tamanho: null as unknown as number }]);
    const filas: AmostraSaude['filas'] = {};
    for (const { nome, q } of this.filasMonitoradas()) {
      try {
        const c = await q.getJobCounts('waiting', 'active', 'failed', 'delayed');
        filas[nome] = { aguardando: c.waiting ?? 0, ativos: c.active ?? 0, falhas: c.failed ?? 0, atrasados: c.delayed ?? 0 };
      } catch {
        // fila indisponivel: fica fora da amostra
      }
    }
    await sql`
      INSERT INTO platform.health_samples (memoria_mb, cpu_pct, db_ms, redis_ms, db_conexoes, db_tamanho_mb, filas)
      VALUES (${Math.round(process.memoryUsage().rss / 1048576)}, ${Math.min(999, Math.round(cpuPct * 10) / 10)}, ${dbMs}, ${redisMs},
        ${db?.conexoes ?? null}, ${db?.tamanho ?? null}, ${sql.json(filas)})
    `;
  }

  // ---------------- Leitura (painel) ----------------

  async painel(horas: number): Promise<PainelPerformance> {
    await this.gravar();
    const sql = this.db.catalog();
    const linhas = await sql<
      Array<{ hora: Date; method: string; route: string; qtd: number; erros_5xx: number; soma_ms: string; max_ms: number; faixas: number[] }>
    >`
      SELECT hora, method, route, qtd, erros_5xx, soma_ms, max_ms, faixas FROM platform.route_metrics
      WHERE hora >= date_trunc('hour', now()) - make_interval(hours => ${horas - 1})
    `;
    const somar = (a: number[], b: number[]) => a.map((x, i) => x + (b[i] ?? 0));

    // Serie por hora
    const porHora = new Map<string, { qtd: number; e5: number; soma: number; max: number; faixas: number[] }>();
    const porRota = new Map<string, { method: string; route: string; qtd: number; e5: number; soma: number; max: number; faixas: number[] }>();
    let total = { qtd: 0, e5: 0, soma: 0, max: 0, faixas: NOVAS_FAIXAS() };
    for (const l of linhas) {
      const soma = Number(l.soma_ms);
      const h = l.hora.toISOString();
      const ph = porHora.get(h) ?? { qtd: 0, e5: 0, soma: 0, max: 0, faixas: NOVAS_FAIXAS() };
      porHora.set(h, { qtd: ph.qtd + l.qtd, e5: ph.e5 + l.erros_5xx, soma: ph.soma + soma, max: Math.max(ph.max, l.max_ms), faixas: somar(ph.faixas, l.faixas) });
      const k = `${l.method} ${l.route}`;
      const pr = porRota.get(k) ?? { method: l.method, route: l.route, qtd: 0, e5: 0, soma: 0, max: 0, faixas: NOVAS_FAIXAS() };
      porRota.set(k, { ...pr, qtd: pr.qtd + l.qtd, e5: pr.e5 + l.erros_5xx, soma: pr.soma + soma, max: Math.max(pr.max, l.max_ms), faixas: somar(pr.faixas, l.faixas) });
      total = { qtd: total.qtd + l.qtd, e5: total.e5 + l.erros_5xx, soma: total.soma + soma, max: Math.max(total.max, l.max_ms), faixas: somar(total.faixas, l.faixas) };
    }

    const serie: PontoHora[] = [];
    const inicio = new Date();
    inicio.setMinutes(0, 0, 0);
    for (let i = horas - 1; i >= 0; i--) {
      const h = new Date(inicio.getTime() - i * 3_600_000).toISOString();
      const p = porHora.get(h);
      serie.push({
        hora: h,
        qtd: p?.qtd ?? 0,
        erros5xx: p?.e5 ?? 0,
        p95Ms: p ? percentilDasFaixas(p.faixas, 0.95, p.max) : 0,
        mediaMs: p?.qtd ? Math.round(p.soma / p.qtd) : 0,
      });
    }

    const rotas: RotaDesempenho[] = [...porRota.values()]
      .map((r) => ({
        method: r.method,
        route: r.route,
        qtd: r.qtd,
        mediaMs: Math.round(r.soma / Math.max(1, r.qtd)),
        p95Ms: percentilDasFaixas(r.faixas, 0.95, r.max),
        maxMs: r.max,
        erros5xx: r.e5,
      }))
      .sort((a, b) => b.p95Ms - a.p95Ms || b.mediaMs - a.mediaMs)
      .slice(0, 30);

    const erros = await this.erros(horas);
    const [lentas] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM platform.slow_requests WHERE created_at > now() - make_interval(hours => ${horas})
    `;
    const amostras = await sql<
      Array<{ created_at: Date; memoria_mb: number; cpu_pct: string; db_ms: number | null; redis_ms: number | null; db_conexoes: number | null; db_tamanho_mb: number | null; filas: AmostraSaude['filas'] }>
    >`
      SELECT created_at, memoria_mb, cpu_pct, db_ms, redis_ms, db_conexoes, db_tamanho_mb, filas FROM platform.health_samples
      WHERE created_at > now() - make_interval(hours => ${horas}) ORDER BY created_at
    `;
    const ultima = amostras.at(-1);
    const saude: AmostraSaude | null = ultima
      ? {
          em: ultima.created_at.toISOString(),
          memoriaMb: ultima.memoria_mb,
          cpuPct: Number(ultima.cpu_pct),
          dbMs: ultima.db_ms,
          redisMs: ultima.redis_ms,
          dbConexoes: ultima.db_conexoes,
          dbTamanhoMb: ultima.db_tamanho_mb,
          filas: ultima.filas ?? {},
        }
      : null;
    // No maximo ~120 pontos no grafico de saude.
    const passo = Math.max(1, Math.ceil(amostras.length / 120));
    const serieSaude = amostras
      .filter((_, i) => i % passo === 0)
      .map((a) => ({ em: a.created_at.toISOString(), memoriaMb: a.memoria_mb, cpuPct: Number(a.cpu_pct), dbMs: a.db_ms }));

    return {
      horas,
      kpis: {
        requisicoes: total.qtd,
        porMinuto: Math.round((total.qtd / (horas * 60)) * 10) / 10,
        p95Ms: percentilDasFaixas(total.faixas, 0.95, total.max),
        mediaMs: total.qtd ? Math.round(total.soma / total.qtd) : 0,
        taxaErroPct: total.qtd ? Math.round((total.e5 / total.qtd) * 1000) / 10 : 0,
        lentas: lentas?.n ?? 0,
        filasComFalha: Object.values(saude?.filas ?? {}).filter((f) => f.falhas > 0).length,
      },
      serie,
      rotas,
      erros,
      saude,
      serieSaude,
      consultas: await this.consultasLentas(),
      limiteLentaMs: loadEnv().SLOW_REQUEST_MS,
    };
  }

  /** Nome legivel de uma fila. */
  static nomeFila(nome: string): string {
    return FILAS[nome] ?? nome;
  }

  async erros(horas: number): Promise<ErroAgrupado[]> {
    const rows = await this.db.catalog()<
      Array<{ fingerprint: string; method: string; route: string; mensagem: string; qtd: number; primeira_em: Date; ultima_em: Date; resolvido_em: Date | null }>
    >`
      SELECT fingerprint, method, route, mensagem, qtd, primeira_em, ultima_em, resolvido_em FROM platform.error_events
      WHERE ultima_em > now() - make_interval(hours => ${horas}) ORDER BY resolvido_em NULLS FIRST, ultima_em DESC LIMIT 50
    `;
    return rows.map((r) => ({
      fingerprint: r.fingerprint,
      method: r.method,
      route: r.route,
      mensagem: r.mensagem,
      qtd: r.qtd,
      primeiraEm: r.primeira_em.toISOString(),
      ultimaEm: r.ultima_em.toISOString(),
      resolvido: !!r.resolvido_em,
    }));
  }

  async resolverErro(fingerprint: string): Promise<void> {
    await this.db.catalog()`UPDATE platform.error_events SET resolvido_em = now() WHERE fingerprint = ${fingerprint}`;
  }

  /** Top consultas por tempo medio (so com a extensao pg_stat_statements). */
  async consultasLentas(): Promise<ConsultaLenta[] | null> {
    const sql = this.db.catalog();
    try {
      const [ext] = await sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`;
      if (!ext) return null;
      const rows = await sql<Array<{ query: string; calls: string; mean: number; total: number }>>`
        SELECT left(query, 400) AS query, calls::text, mean_exec_time AS mean, total_exec_time AS total
        FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY mean_exec_time DESC LIMIT 10
      `;
      return rows.map((r) => ({ consulta: r.query, chamadas: Number(r.calls), mediaMs: Math.round(r.mean), totalMs: Math.round(r.total) }));
    } catch {
      return null;
    }
  }

  async lentas(limite: number): Promise<RequisicaoLenta[]> {
    const rows = await this.db.catalog()<
      Array<{ id: string; method: string; route: string; status: number; duration_ms: number; orgao: string | null; created_at: Date }>
    >`
      SELECT s.id::text, s.method, s.route, s.status, s.duration_ms, t.nome AS orgao, s.created_at
      FROM platform.slow_requests s LEFT JOIN public.tenants t ON t.id = s.tenant_id
      WHERE s.created_at > now() - interval '24 hours' ORDER BY s.duration_ms DESC LIMIT ${limite}
    `;
    return rows.map((r) => ({
      id: r.id,
      method: r.method,
      route: r.route,
      status: r.status,
      duracaoMs: r.duration_ms,
      orgao: r.orgao,
      em: r.created_at.toISOString(),
    }));
  }
}

/** Mede cada requisicao e entrega ao MetricasService quando a resposta termina. */
@Injectable()
export class MetricasMiddleware implements NestMiddleware {
  constructor(private readonly metricas: MetricasService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const inicio = performance.now();
    res.on('finish', () => this.metricas.registrar(req as ReqComTenant, res.statusCode, performance.now() - inicio));
    next();
  }
}
