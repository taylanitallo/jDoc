import { Injectable } from '@nestjs/common';
import type { PainelPlataforma } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { resolveBrasaoUrl } from '../tenancy/brasao.util';

/**
 * Visao geral do painel. Cada orgao e lido no proprio schema (isolamento):
 * os numeros so sao somados aqui, nunca uma consulta cruza schemas.
 */
@Injectable()
export class PainelService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  async painel(): Promise<PainelPlataforma> {
    const sql = this.db.catalog();
    const tenants = await sql<Array<{ id: string; nome: string; slug: string; cidade: string | null; uf: string | null; status: string; schema_name: string }>>`
      SELECT id, nome, slug, cidade, uf, status, schema_name FROM public.tenants ORDER BY nome
    `;

    let usuariosAtivos = 0;
    let acessos24h = 0;
    const falhasOrgao: PainelPlataforma['falhasLogin']['porOrgao'] = [];
    const falhasIp = new Map<string, number>();
    const orgaos: PainelPlataforma['orgaos'] = [];

    for (const t of tenants) {
      let ativos = 0;
      let ultimo: Date | null = null;
      try {
        const ts = this.db.tenant(t.schema_name);
        const [u] = await ts<Array<{ ativos: number; ultimo: Date | null }>>`
          SELECT count(*) FILTER (WHERE ativo)::int AS ativos, max(ultimo_acesso) AS ultimo FROM users
        `;
        ativos = u?.ativos ?? 0;
        ultimo = u?.ultimo ?? null;
        const [a] = await ts<Array<{ logins: number; falhas: number }>>`
          SELECT count(*) FILTER (WHERE action = 'login')::int AS logins, count(*) FILTER (WHERE action = 'login_failed')::int AS falhas
          FROM audit_logs WHERE criado_em > now() - interval '24 hours' AND action IN ('login', 'login_failed')
        `;
        acessos24h += a?.logins ?? 0;
        if (a?.falhas) falhasOrgao.push({ orgao: t.nome, tenantId: t.id, qtd: a.falhas });
        const ips = await ts<Array<{ ip: string; qtd: number }>>`
          SELECT ip, count(*)::int AS qtd FROM audit_logs
          WHERE action = 'login_failed' AND criado_em > now() - interval '24 hours' AND ip IS NOT NULL GROUP BY ip
        `;
        for (const i of ips) falhasIp.set(i.ip, (falhasIp.get(i.ip) ?? 0) + i.qtd);
      } catch {
        // orgao sem schema completo: entra com zeros
      }
      usuariosAtivos += t.status === 'ativo' ? ativos : 0;
      orgaos.push({
        id: t.id,
        nome: t.nome,
        slug: t.slug,
        cidade: t.cidade,
        uf: t.uf,
        status: t.status,
        brasaoUrl: await resolveBrasaoUrl(this.db, this.storage, t.schema_name, t.slug).catch(() => null),
        usuariosAtivos: ativos,
        ultimoAcesso: ultimo?.toISOString() ?? null,
      });
    }

    // Falhas de login no proprio painel tambem contam por IP.
    const sa = await sql<Array<{ ip: string; qtd: number }>>`
      SELECT ip, count(*)::int AS qtd FROM public.global_audit_logs
      WHERE action = 'superadmin_login_failed' AND criado_em > now() - interval '24 hours' AND ip IS NOT NULL GROUP BY ip
    `;
    const saTotal = sa.reduce((s, x) => s + x.qtd, 0);
    if (saTotal) falhasOrgao.push({ orgao: 'Painel da plataforma', tenantId: null, qtd: saTotal });
    for (const i of sa) falhasIp.set(i.ip, (falhasIp.get(i.ip) ?? 0) + i.qtd);

    const [ch] = await sql<Array<{ abertos: number; atrasados: number }>>`
      SELECT count(*) FILTER (WHERE status NOT IN ('resolvido', 'fechado', 'cancelado'))::int AS abertos,
        count(*) FILTER (WHERE status NOT IN ('resolvido', 'fechado', 'cancelado') AND
          ((first_response_at IS NULL AND response_due_at < now()) OR resolution_due_at < now()))::int AS atrasados
      FROM platform.tickets
    `;
    type StatusBackup = NonNullable<PainelPlataforma['kpis']['ultimoBackup']>['status'];
    const [ub] = await sql<Array<{ status: StatusBackup; criado_em: Date; orgao: string | null }>>`
      SELECT b.status, b.criado_em, t.nome AS orgao FROM public.backups b LEFT JOIN public.tenants t ON t.id = b.tenant_id
      WHERE b.kind <> 'seguranca' ORDER BY b.criado_em DESC LIMIT 1
    `;
    const [f] = await sql<Array<{ backups: number; jobs: number }>>`
      SELECT (SELECT count(*)::int FROM public.backups WHERE status = 'erro' AND criado_em > now() - interval '24 hours') AS backups,
        (SELECT count(*)::int FROM platform.job_runs WHERE status = 'failed' AND started_at > now() - interval '24 hours') AS jobs
    `;
    const lentas = await sql<Array<{ method: string; route: string; qtd: number; media: number; max: number }>>`
      SELECT method, route, count(*)::int AS qtd, avg(duration_ms)::int AS media, max(duration_ms)::int AS max
      FROM platform.slow_requests WHERE created_at > now() - interval '24 hours'
      GROUP BY method, route ORDER BY avg(duration_ms) DESC LIMIT 8
    `;

    return {
      kpis: {
        orgaosAtivos: tenants.filter((t) => t.status === 'ativo').length,
        orgaosTotal: tenants.length,
        usuariosAtivos,
        acessos24h,
        chamadosAbertos: ch?.abertos ?? 0,
        chamadosAtrasados: ch?.atrasados ?? 0,
        ultimoBackup: ub ? { status: ub.status, em: ub.criado_em.toISOString(), orgao: ub.orgao } : null,
        backupsComFalha24h: f?.backups ?? 0,
        jobsComFalha24h: f?.jobs ?? 0,
      },
      falhasLogin: {
        porOrgao: falhasOrgao.sort((a, b) => b.qtd - a.qtd).slice(0, 10),
        porIp: [...falhasIp.entries()]
          .map(([ip, qtd]) => ({ ip, qtd }))
          .sort((a, b) => b.qtd - a.qtd)
          .slice(0, 10),
      },
      rotasLentas: lentas.map((l) => ({ method: l.method, route: l.route, qtd: l.qtd, mediaMs: l.media, maxMs: l.max })),
      orgaos,
    };
  }
}
