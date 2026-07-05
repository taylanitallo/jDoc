import { Injectable } from '@nestjs/common';
import type { LogsQuery, MasterDashboard } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { SuperadminTenantsService } from './superadmin-tenants.service';

export interface LogPage {
  items: Array<Record<string, unknown>>;
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

  /** Logs globais (public.global_audit_logs) com filtros parametrizados. */
  async globalLogs(q: LogsQuery): Promise<LogPage> {
    const sql = this.db.catalog();
    const offset = (q.page - 1) * q.pageSize;

    const items = await sql`
      SELECT id, actor_id, actor_type, action, target_tenant_id, ip, user_agent, metadata, criado_em
      FROM public.global_audit_logs
      WHERE (${q.de ?? null}::timestamptz IS NULL OR criado_em >= ${q.de ?? null})
        AND (${q.ate ?? null}::timestamptz IS NULL OR criado_em <= ${q.ate ?? null})
        AND (${q.action ?? null}::varchar IS NULL OR action = ${q.action ?? null})
        AND (${q.actorId ?? null}::uuid IS NULL OR actor_id = ${q.actorId ?? null})
        AND (${q.ip ?? null}::varchar IS NULL OR ip = ${q.ip ?? null})
      ORDER BY criado_em DESC
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total
      FROM public.global_audit_logs
      WHERE (${q.de ?? null}::timestamptz IS NULL OR criado_em >= ${q.de ?? null})
        AND (${q.ate ?? null}::timestamptz IS NULL OR criado_em <= ${q.ate ?? null})
        AND (${q.action ?? null}::varchar IS NULL OR action = ${q.action ?? null})
        AND (${q.actorId ?? null}::uuid IS NULL OR actor_id = ${q.actorId ?? null})
        AND (${q.ip ?? null}::varchar IS NULL OR ip = ${q.ip ?? null})
    `;
    return {
      items: items as unknown as Array<Record<string, unknown>>,
      total: Number(totalRows[0]?.total ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Logs de um tenant especifico (schema do tenant). */
  async tenantLogs(tenantId: string, q: LogsQuery): Promise<LogPage> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);
    const offset = (q.page - 1) * q.pageSize;

    const items = await sql`
      SELECT id, actor_id, action, resource_type, resource_id, ip, user_agent, metadata, criado_em
      FROM audit_logs
      WHERE (${q.de ?? null}::timestamptz IS NULL OR criado_em >= ${q.de ?? null})
        AND (${q.ate ?? null}::timestamptz IS NULL OR criado_em <= ${q.ate ?? null})
        AND (${q.action ?? null}::varchar IS NULL OR action = ${q.action ?? null})
        AND (${q.actorId ?? null}::uuid IS NULL OR actor_id = ${q.actorId ?? null})
        AND (${q.ip ?? null}::varchar IS NULL OR ip = ${q.ip ?? null})
      ORDER BY criado_em DESC
      LIMIT ${q.pageSize} OFFSET ${offset}
    `;
    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total
      FROM audit_logs
      WHERE (${q.de ?? null}::timestamptz IS NULL OR criado_em >= ${q.de ?? null})
        AND (${q.ate ?? null}::timestamptz IS NULL OR criado_em <= ${q.ate ?? null})
        AND (${q.action ?? null}::varchar IS NULL OR action = ${q.action ?? null})
        AND (${q.actorId ?? null}::uuid IS NULL OR actor_id = ${q.actorId ?? null})
        AND (${q.ip ?? null}::varchar IS NULL OR ip = ${q.ip ?? null})
    `;
    return {
      items: items as unknown as Array<Record<string, unknown>>,
      total: Number(totalRows[0]?.total ?? 0),
      page: q.page,
      pageSize: q.pageSize,
    };
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
