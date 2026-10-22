import { Injectable } from '@nestjs/common';
import type { LogRegistro, LogsQuery, MasterDashboard } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { SuperadminTenantsService } from './superadmin-tenants.service';

export interface LogPage {
  items: LogRegistro[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class SuperadminLogsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: SuperadminTenantsService,
  ) {}

  /** Auditoria da plataforma (public.global_audit_logs), ja no formato que a tela descreve. */
  async globalLogs(q: LogsQuery): Promise<LogPage> {
    const sql = this.db.catalog();
    const filtro = sql`
      WHERE (${q.de ?? null}::timestamptz IS NULL OR g.criado_em >= ${q.de ?? null})
        AND (${q.ate ?? null}::timestamptz IS NULL OR g.criado_em <= ${q.ate ?? null})
        AND (${q.action ?? null}::varchar IS NULL OR g.action = ${q.action ?? null})
        AND (${q.actorId ?? null}::uuid IS NULL OR g.actor_id = ${q.actorId ?? null})
        AND (${q.tenantId ?? null}::uuid IS NULL OR g.target_tenant_id = ${q.tenantId ?? null})
        AND (${q.ip ?? null}::varchar IS NULL OR g.ip = ${q.ip ?? null})
    `;
    const rows = await sql<
      Array<{
        id: string;
        criado_em: Date;
        action: string;
        actor_type: string;
        admin_name: string | null;
        orgao: string | null;
        entity: string | null;
        entity_id: string | null;
        changes: unknown;
        metadata: unknown;
        ip: string | null;
      }>
    >`
      SELECT g.id::text, g.criado_em, g.action, g.actor_type, coalesce(g.admin_name, a.nome) AS admin_name, t.nome AS orgao,
        g.entity, g.entity_id, g.changes, g.metadata, g.ip
      FROM public.global_audit_logs g
      LEFT JOIN public.tenants t ON t.id = g.target_tenant_id
      LEFT JOIN public.superadmins a ON a.id = g.actor_id
      ${filtro}
      ORDER BY g.criado_em DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
    `;
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM public.global_audit_logs g ${filtro}`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        criadoEm: r.criado_em.toISOString(),
        action: r.action,
        actorType: r.actor_type,
        adminName: r.admin_name,
        orgao: r.orgao,
        entity: r.entity,
        entityId: r.entity_id,
        changes: json(r.changes) as LogRegistro['changes'],
        metadata: json(r.metadata) as LogRegistro['metadata'],
        ip: r.ip,
      })),
      total: t?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Auditoria de um orgao (schema dele): o "quem" e o usuario do orgao. */
  async tenantLogs(tenantId: string, q: LogsQuery): Promise<LogPage> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);
    const filtro = sql`
      WHERE (${q.de ?? null}::timestamptz IS NULL OR l.criado_em >= ${q.de ?? null})
        AND (${q.ate ?? null}::timestamptz IS NULL OR l.criado_em <= ${q.ate ?? null})
        AND (${q.action ?? null}::varchar IS NULL OR l.action = ${q.action ?? null})
        AND (${q.actorId ?? null}::uuid IS NULL OR l.actor_id = ${q.actorId ?? null})
        AND (${q.ip ?? null}::varchar IS NULL OR l.ip = ${q.ip ?? null})
    `;
    const rows = await sql<
      Array<{ id: string; criado_em: Date; action: string; nome: string | null; resource_type: string | null; resource_id: string | null; metadata: unknown; ip: string | null }>
    >`
      SELECT l.id::text, l.criado_em, l.action, u.nome, l.resource_type, l.resource_id, l.metadata, l.ip
      FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
      ${filtro}
      ORDER BY l.criado_em DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
    `;
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM audit_logs l ${filtro}`;
    return {
      items: rows.map((r) => {
        const meta = json(r.metadata) as Record<string, unknown> | null;
        return {
          id: r.id,
          criadoEm: r.criado_em.toISOString(),
          action: r.action,
          actorType: 'usuario',
          adminName: r.nome,
          orgao: tenant.nome,
          entity: r.resource_type,
          entityId: r.resource_id,
          changes: null,
          metadata: meta,
          ip: r.ip,
        };
      }),
      total: t?.n ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}

/** jsonb gravado como texto (versoes antigas) ou objeto. */
function json(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

@Injectable()
export class SuperadminDashboardService {
  constructor(private readonly db: DatabaseService) {}

  async dashboard(): Promise<MasterDashboard> {
    const sql = this.db.catalog();

    const [counts] = await sql<
      Array<{ total: string; ativos: string; inativos: string }>
    >`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE status = 'ativo')::bigint AS ativos,
             COUNT(*) FILTER (WHERE status <> 'ativo')::bigint AS inativos
      FROM public.tenants
    `;

    const tenants = await sql<Array<{ schema_name: string }>>`
      SELECT schema_name FROM public.tenants
    `;

    // Armazenamento total + documentos (tabela documents so existe a partir da Fase 3;
    // to_regclass evita erro em schema sem a tabela).
    let armazenamentoTotalBytes = 0;
    let documentosIndexados = 0;
    let uploadsNoMes = 0;
    for (const t of tenants) {
      const [size] = await sql<Array<{ bytes: string | null }>>`
        SELECT COALESCE(SUM(pg_total_relation_size(
          format('%I.%I', schemaname, tablename)::regclass
        )), 0)::bigint AS bytes
        FROM pg_tables WHERE schemaname = ${t.schema_name}
      `;
      armazenamentoTotalBytes += Number(size?.bytes ?? 0);

      const [reg] = await sql<Array<{ exists: boolean }>>`
        SELECT to_regclass(${t.schema_name + '.documents'}) IS NOT NULL AS exists
      `;
      if (reg?.exists) {
        const tsql = this.db.tenant(t.schema_name);
        const [docs] = await tsql<Array<{ total: string; mes: string }>>`
          SELECT COUNT(*)::bigint AS total,
                 COUNT(*) FILTER (WHERE criado_em >= date_trunc('month', now()))::bigint AS mes
          FROM documents WHERE deleted_at IS NULL
        `;
        documentosIndexados += Number(docs?.total ?? 0);
        uploadsNoMes += Number(docs?.mes ?? 0);
      }
    }

    const growth = await sql<Array<{ mes: string; total: string }>>`
      SELECT to_char(date_trunc('month', criado_em), 'YYYY-MM') AS mes,
             COUNT(*)::bigint AS total
      FROM public.tenants
      WHERE criado_em >= now() - interval '12 months'
      GROUP BY 1 ORDER BY 1
    `;

    return {
      totalOrgaos: Number(counts?.total ?? 0),
      orgaosAtivos: Number(counts?.ativos ?? 0),
      orgaosInativos: Number(counts?.inativos ?? 0),
      armazenamentoTotalBytes,
      documentosIndexados,
      uploadsNoMes,
      crescimento: growth.map((g) => ({ mes: g.mes, total: Number(g.total) })),
    };
  }
}
