import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { SCHEMA_NAME_REGEX, type Correcao, type ResultadoCorrecoes } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { loadEnv } from '../config/env';
import { BackupsService } from '../superadmin/backups/backups.service';
import { JobsService } from './jobs.service';
import { MetricasService } from './metricas.service';

type Acao = () => Promise<void>;
interface Achado extends Correcao {
  executar: Acao | null;
}

/** Erro de fila que costuma passar sozinho (vale tentar de novo). */
const TRANSITORIO = /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|429|503|overloaded|sobrecarg|temporar/i;
const FILAS = ['document-ocr', 'document-conferencia', 'signature-validation', 'labels-import', 'reports', 'integridade', 'sigilo', 'jdoc-backups'];

const ident = (s: string) => {
  if (!/^[a-z0-9_]+$/.test(s)) throw new Error(`Identificador inseguro: ${s}`);
  return `"${s}"`;
};

/**
 * Correcoes operacionais: diagnostica problemas conhecidos e aplica so
 * acoes seguras e idempotentes (nada que reescreva codigo). As criticas
 * rodam sozinhas todo dia ao meio-dia (horario de menor uso); o resto, pelo
 * botao "Executar correcoes". O que exige mudar o codigo aparece como
 * diagnostico, com a evidencia.
 */
@Injectable()
export class CorrecoesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CorrecoesService.name);
  private redis: Redis | null = null;
  private filas: Queue[] = [];

  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
    private readonly backups: BackupsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.registrar('correcoes', async (o) => {
      const r = await this.executar(undefined, o.origem === 'agendado' ? 'critica' : undefined);
      return { resumo: `${r.aplicadas.length} aplicada(s), ${r.falhas.length} falha(s)`, ...r };
    });
    this.jobs.registrar('limpeza', () => this.limpeza());
  }

  async onModuleDestroy(): Promise<void> {
    for (const q of this.filas) await q.close().catch(() => undefined);
    await this.redis?.quit().catch(() => undefined);
  }

  private queues(): Queue[] {
    if (!this.filas.length) {
      this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
      this.filas = FILAS.map((n) => new Queue(n, { connection: this.redis! }));
    }
    return this.filas;
  }

  private id(...partes: string[]): string {
    return createHash('sha1').update(partes.join('|')).digest('hex').slice(0, 16);
  }

  async diagnosticar(): Promise<Correcao[]> {
    return (await this.achados()).map(({ executar: _e, ...c }) => c);
  }

  private async achados(): Promise<Achado[]> {
    const out: Achado[] = [];
    const sql = this.db.catalog();
    const add = async (fn: () => Promise<void>, nome: string) => {
      try {
        await fn();
      } catch (e) {
        this.logger.warn(`Diagnostico "${nome}" falhou: ${(e as Error).message}`);
      }
    };

    // 1) Orgao preso em manutencao sem restauracao rodando.
    await add(async () => {
      const presos = await sql<Array<{ id: string; slug: string; nome: string; anterior: string | null }>>`
        SELECT t.id, t.slug, t.nome,
          (SELECT r.status_anterior FROM public.restore_jobs r WHERE r.tenant_id = t.id ORDER BY r.criado_em DESC LIMIT 1) AS anterior
        FROM public.tenants t
        WHERE t.status = 'manutencao'
          AND NOT EXISTS (SELECT 1 FROM public.restore_jobs r WHERE r.tenant_id = t.id AND r.status IN ('pendente', 'processando'))
      `;
      for (const t of presos) {
        const volta = t.anterior && t.anterior !== 'manutencao' ? t.anterior : 'ativo';
        out.push({
          id: this.id('manutencao', t.id),
          tipo: 'orgao_em_manutencao',
          titulo: `${t.nome} preso em manutenção`,
          descricao: 'O órgão ficou em manutenção sem restauração em andamento: ninguém consegue entrar.',
          severidade: 'critica',
          automatica: true,
          acao: `Voltar o órgão para "${volta === 'ativo' ? 'Ativo' : volta}"`,
          evidencia: null,
          executar: async () => {
            await sql`UPDATE public.tenants SET status = ${volta}, atualizado_em = now() WHERE id = ${t.id} AND status = 'manutencao'`;
            await this.tenancy.invalidate(t.slug);
          },
        });
      }
    }, 'manutencao');

    // 2) Ultimo backup agendado do orgao falhou (ou nao roda ha 2 dias).
    await add(async () => {
      const rows = await sql<Array<{ id: string; nome: string; ultimo: string | null; ultimo_em: Date | null }>>`
        SELECT t.id, t.nome,
          (SELECT b.status FROM public.backups b WHERE b.tenant_id = t.id AND b.kind <> 'seguranca' ORDER BY b.criado_em DESC LIMIT 1) AS ultimo,
          (SELECT max(b.concluido_em) FROM public.backups b WHERE b.tenant_id = t.id AND b.status = 'concluido') AS ultimo_em
        FROM public.tenants t JOIN public.tenant_backup_settings s ON s.tenant_id = t.id
        WHERE t.status = 'ativo' AND s.enabled
      `;
      for (const r of rows) {
        const velho = !r.ultimo_em || Date.now() - r.ultimo_em.getTime() > 2 * 86_400_000;
        if (r.ultimo !== 'erro' && !velho) continue;
        if (r.ultimo === 'pendente' || r.ultimo === 'processando') continue;
        out.push({
          id: this.id('backup', r.id),
          tipo: 'backup_atrasado',
          titulo: `Backup de ${r.nome} ${r.ultimo === 'erro' ? 'falhou' : 'atrasado'}`,
          descricao: r.ultimo === 'erro' ? 'O último backup terminou com erro.' : 'Nenhum backup concluído nos últimos 2 dias.',
          severidade: 'critica',
          automatica: true,
          acao: 'Fazer um backup agora',
          evidencia: r.ultimo_em ? `Último backup concluído em ${r.ultimo_em.toISOString()}` : 'Nenhum backup concluído',
          executar: async () => {
            await this.backups.trigger(r.id, { id: null, nome: 'Correções automáticas' }, 'agendado');
          },
        });
      }
    }, 'backups');

    // 3) Conexoes presas "idle in transaction" ha mais de 10 min (seguram travas).
    await add(async () => {
      const presas = await sql<Array<{ pid: number; minutos: number }>>`
        SELECT pid, (extract(epoch FROM now() - state_change) / 60)::int AS minutos FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'idle in transaction' AND state_change < now() - interval '10 minutes'
          AND pid <> pg_backend_pid()
      `;
      if (presas.length) {
        out.push({
          id: this.id('conexoes', presas.map((p) => p.pid).join(',')),
          tipo: 'conexoes_presas',
          titulo: `${presas.length} conexão(ões) presa(s) no banco`,
          descricao: 'Transações abertas e paradas seguram travas e podem deixar telas lentas.',
          severidade: 'critica',
          automatica: true,
          acao: 'Encerrar as conexões presas',
          evidencia: `Paradas há ${Math.max(...presas.map((p) => p.minutos))} min`,
          executar: async () => {
            for (const p of presas) await sql`SELECT pg_terminate_backend(${p.pid})`;
          },
        });
      }
    }, 'conexoes');

    // 4) Estatisticas velhas e tabelas com muitas linhas mortas.
    await add(async () => {
      const tabelas = await sql<Array<{ schemaname: string; relname: string; mods: number; vivas: number; mortas: number }>>`
        SELECT schemaname, relname, n_mod_since_analyze::int AS mods, n_live_tup::int AS vivas, n_dead_tup::int AS mortas
        FROM pg_stat_user_tables
        WHERE (schemaname = 'public' OR schemaname = 'platform' OR schemaname LIKE 'tenant\\_%')
          AND (n_mod_since_analyze > greatest(1000, n_live_tup * 0.2) OR (n_dead_tup > 5000 AND n_dead_tup > n_live_tup * 0.2))
        ORDER BY n_dead_tup DESC LIMIT 40
      `;
      for (const t of tabelas) {
        const nome = `${t.schemaname}.${t.relname}`;
        const vacuum = t.mortas > 5000 && t.mortas > t.vivas * 0.2;
        out.push({
          id: this.id(vacuum ? 'vacuum' : 'analyze', nome),
          tipo: vacuum ? 'vacuum' : 'analyze',
          titulo: vacuum ? `Limpar espaço morto de ${nome}` : `Atualizar estatísticas de ${nome}`,
          descricao: vacuum
            ? 'Muitas linhas apagadas/alteradas ocupam espaço e deixam as consultas mais lentas.'
            : 'As estatísticas que o banco usa para planejar consultas estão desatualizadas.',
          severidade: 'media',
          automatica: true,
          acao: vacuum ? `VACUUM (ANALYZE) em ${nome}` : `ANALYZE em ${nome}`,
          evidencia: vacuum ? `${t.mortas} linhas mortas para ${t.vivas} vivas` : `${t.mods} alterações desde a última análise`,
          executar: async () => {
            const alvo = `${ident(t.schemaname)}.${ident(t.relname)}`;
            const direct = this.db.direct();
            try {
              await direct.unsafe(vacuum ? `VACUUM (ANALYZE) ${alvo}` : `ANALYZE ${alvo}`);
            } finally {
              await direct.end({ timeout: 5 });
            }
          },
        });
      }
    }, 'estatisticas');

    // 5) Chave estrangeira sem indice nos schemas dos orgaos (joins e exclusoes lentos).
    await add(async () => {
      const fks = await sql<Array<{ schema: string; tabela: string; colunas: string[] }>>`
        SELECT n.nspname AS schema, c.relname AS tabela,
          array_agg(a.attname ORDER BY k.ord) AS colunas
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
        WHERE con.contype = 'f' AND n.nspname LIKE 'tenant\\_%'
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
            WHERE i.indrelid = con.conrelid
              AND (SELECT array_agg(x ORDER BY o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS u(x, o)
                   WHERE o <= cardinality(con.conkey)) = con.conkey
          )
        GROUP BY n.nspname, c.relname, con.conname
        LIMIT 60
      `;
      for (const f of fks) {
        if (!SCHEMA_NAME_REGEX.test(f.schema)) continue;
        const nomeIdx = `ix_auto_${createHash('sha1').update(`${f.tabela}:${f.colunas.join(',')}`).digest('hex').slice(0, 12)}`;
        out.push({
          id: this.id('fk', f.schema, f.tabela, ...f.colunas),
          tipo: 'indice_fk',
          titulo: `Índice faltando em ${f.schema}.${f.tabela} (${f.colunas.join(', ')})`,
          descricao: 'Coluna de ligação sem índice deixa buscas e exclusões lentas conforme a tabela cresce.',
          severidade: 'media',
          automatica: true,
          acao: `Criar índice ${nomeIdx} (sem travar a tabela)`,
          evidencia: null,
          executar: async () => {
            const direct = this.db.direct();
            try {
              await direct.unsafe(
                `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${ident(nomeIdx)} ON ${ident(f.schema)}.${ident(f.tabela)} (${f.colunas.map(ident).join(', ')})`,
              );
            } finally {
              await direct.end({ timeout: 5 });
            }
          },
        });
      }
    }, 'indices');

    // 6) Jobs de fila que falharam por erro passageiro.
    await add(async () => {
      for (const q of this.queues()) {
        const falhos = (await q.getFailed(0, 200)).filter((j) => TRANSITORIO.test(j.failedReason ?? ''));
        if (!falhos.length) continue;
        out.push({
          id: this.id('fila', q.name, String(falhos.length)),
          tipo: 'fila_falhas',
          titulo: `${falhos.length} tarefa(s) de "${MetricasService.nomeFila(q.name)}" falharam por erro passageiro`,
          descricao: 'Falhas como tempo esgotado ou serviço externo sobrecarregado costumam passar ao tentar de novo.',
          severidade: 'media',
          automatica: true,
          acao: 'Tentar de novo',
          evidencia: falhos[0]?.failedReason?.slice(0, 200) ?? null,
          executar: async () => {
            for (const j of falhos) await j.retry().catch(() => undefined);
          },
        });
      }
    }, 'filas');

    // 7) Registros antigos de monitoramento e sessoes vencidas.
    await add(async () => {
      const [n] = await sql<Array<{ n: number }>>`
        SELECT ((SELECT count(*) FROM platform.slow_requests WHERE created_at < now() - interval '7 days')
          + (SELECT count(*) FROM platform.health_samples WHERE created_at < now() - interval '7 days'))::int AS n
      `;
      if ((n?.n ?? 0) > 0) {
        out.push({
          id: this.id('limpeza'),
          tipo: 'limpeza',
          titulo: 'Registros de monitoramento antigos',
          descricao: 'Requisições lentas e amostras de saúde com mais de 7 dias.',
          severidade: 'baixa',
          automatica: true,
          acao: `Apagar ${n!.n} registro(s)`,
          evidencia: null,
          executar: async () => {
            await this.limpeza();
          },
        });
      }
    }, 'limpeza');

    // 8) Diagnostico que exige mudanca no codigo: rotas lentas e erros repetidos.
    await add(async () => {
      const lentas = await sql<Array<{ method: string; route: string; n: number; media: number }>>`
        SELECT method, route, count(*)::int AS n, avg(duration_ms)::int AS media FROM platform.slow_requests
        WHERE created_at > now() - interval '24 hours' GROUP BY method, route HAVING count(*) >= 5
        ORDER BY avg(duration_ms) DESC LIMIT 10
      `;
      for (const r of lentas) {
        out.push({
          id: this.id('lenta', r.method, r.route),
          tipo: 'rota_lenta',
          titulo: `Rota lenta: ${r.method} ${r.route}`,
          descricao: 'Lenta com frequência nas últimas 24 h. As correções de banco acima podem ajudar; se persistir, requer correção no código.',
          severidade: 'media',
          automatica: false,
          acao: null,
          evidencia: `${r.n} requisições lentas, média de ${r.media} ms`,
          executar: null,
        });
      }
      const erros = await sql<Array<{ fingerprint: string; method: string; route: string; mensagem: string; qtd: number }>>`
        SELECT fingerprint, method, route, mensagem, qtd FROM platform.error_events
        WHERE resolvido_em IS NULL AND ultima_em > now() - interval '24 hours' AND qtd >= 3
        ORDER BY qtd DESC LIMIT 10
      `;
      for (const e of erros) {
        out.push({
          id: this.id('erro', e.fingerprint),
          tipo: 'erro_recorrente',
          titulo: `Erro repetido em ${e.method} ${e.route}`,
          descricao: 'Erro interno que se repete: requer correção no código.',
          severidade: e.qtd >= 20 ? 'critica' : 'media',
          automatica: false,
          acao: null,
          evidencia: `${e.qtd}x: ${e.mensagem.slice(0, 200)}`,
          executar: null,
        });
      }
    }, 'codigo');

    const ordem = { critica: 0, media: 1, baixa: 2 } as const;
    return out.sort((a, b) => ordem[a.severidade] - ordem[b.severidade] || Number(b.automatica) - Number(a.automatica));
  }

  /**
   * Aplica as correcoes automaticas. `ids` limita a escolhidas; `so` limita a
   * uma severidade (a execucao agendada do meio-dia usa so as criticas).
   */
  async executar(ids?: string[], so?: Correcao['severidade']): Promise<ResultadoCorrecoes> {
    const achados = await this.achados();
    const alvo = achados.filter((a) => a.automatica && a.executar && (!ids || ids.includes(a.id)) && (!so || a.severidade === so));
    const r: ResultadoCorrecoes = { aplicadas: [], falhas: [], ignoradas: achados.length - alvo.length };
    for (const a of alvo) {
      try {
        await a.executar!();
        r.aplicadas.push({ id: a.id, titulo: a.titulo });
      } catch (e) {
        r.falhas.push({ id: a.id, titulo: a.titulo, erro: (e as Error).message.slice(0, 300) });
      }
    }
    return r;
  }

  /** Limpeza diaria: monitoramento antigo, sessoes e recuperacoes vencidas. */
  async limpeza(): Promise<{ resumo: string }> {
    const sql = this.db.catalog();
    const a = await sql`DELETE FROM platform.slow_requests WHERE created_at < now() - interval '7 days'`;
    const b = await sql`DELETE FROM platform.health_samples WHERE created_at < now() - interval '7 days'`;
    const c = await sql`DELETE FROM platform.route_metrics WHERE hora < now() - interval '90 days'`;
    const d = await sql`DELETE FROM platform.admin_sessions WHERE (revoked_at IS NOT NULL OR last_seen_at < now() - interval '12 hours') AND criado_em < now() - interval '30 days'`;
    let resets = 0;
    const orgaos = await sql<Array<{ schema_name: string }>>`SELECT schema_name FROM public.tenants`;
    for (const o of orgaos) {
      try {
        const r = await this.db.tenant(o.schema_name)`DELETE FROM password_resets WHERE criado_em < now() - interval '7 days'`;
        resets += r.count;
      } catch {
        // orgao sem a tabela ainda (migracao pendente)
      }
    }
    return { resumo: `${a.count + b.count + c.count} registro(s) de monitoramento, ${d.count} sessão(ões) e ${resets} recuperação(ões) de senha apagados` };
  }
}
