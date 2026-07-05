import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { OnModuleDestroy } from '@nestjs/common';
import {
  type TenantAccessClaims,
  prestacaoContasSchema,
  midiaLegislativaSchema,
  type ReportJobView,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';
import { StorageService } from '../storage/storage.module';

export const REPORTS_QUEUE = 'reports';
const SIGNED_URL_TTL_S = 60;

const MESES_NOME = [
  '', 'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

/** Nome amigavel do arquivo baixado (sem extensao — quem chama adiciona .zip/.pdf). */
function friendlyDownloadName(tipo: string, paramsRaw: unknown): string {
  const params = (typeof paramsRaw === 'string' ? JSON.parse(paramsRaw) : paramsRaw) as Record<string, unknown>;

  if (tipo === 'midia_legislativa') {
    const competencias = Array.isArray(params.competencias) ? (params.competencias as number[]) : [];
    const nomes = competencias.map((m) => MESES_NOME[m]).filter(Boolean);
    // Um so mes: usa o nome do mes. Mais de um mes: so o exercicio (sem listar todos).
    const mesLabel = nomes.length === 1 ? nomes[0] : '';
    return `MIDIA LEGISLATIVA ${mesLabel} ${params.exercicio ?? ''}`.replace(/\s+/g, ' ').trim();
  }
  if (tipo === 'prestacao_contas') {
    return `PRESTACAO DE CONTAS ${params.periodoInicio ?? ''} A ${params.periodoFim ?? ''}`.trim();
  }
  return 'relatorio';
}

interface ReportJobRow {
  id: string;
  tipo: string;
  status: string;
  params: unknown;
  criado_por: string | null;
  criado_em: Date;
  iniciado_em: Date | null;
  concluido_em: Date | null;
  erro_mensagem: string | null;
  total_registros: number;
  file_key: string | null;
  tamanho_bytes: number | null;
}

function toView(r: ReportJobRow): ReportJobView {
  // Parse defensivo do jsonb (pode vir como string dependendo do driver)
  const params =
    typeof r.params === 'string' ? JSON.parse(r.params) : r.params;
  return {
    id: r.id,
    tipo: r.tipo as ReportJobView['tipo'],
    status: r.status as ReportJobView['status'],
    params: params as ReportJobView['params'],
    criadoPor: r.criado_por,
    criadoEm: r.criado_em.toISOString(),
    iniciadoEm: r.iniciado_em ? r.iniciado_em.toISOString() : null,
    concluidoEm: r.concluido_em ? r.concluido_em.toISOString() : null,
    erroMensagem: r.erro_mensagem,
    totalRegistros: Number(r.total_registros),
    fileSize: r.tamanho_bytes !== null ? Number(r.tamanho_bytes) : null,
  };
}

export interface ReportsJobData {
  schemaName: string;
  slug: string;
  tenantId: string;
  tenantNome: string;
  /** Cor de destaque do tenant (tenant_settings.corDestaque) — usada no banner do indice.html. */
  corDestaque: string | null;
  /** Nome customizado (tenant_settings.nomeExibido) — sobrepoe tenantNome no banner quando presente. */
  nomeExibido: string | null;
  /** Brasao ja embutido como data URI (base64) — o indice.html precisa ser autocontido/offline. */
  brasaoDataUri: string | null;
  jobId: string;
  actorId: string;
  tipo: 'prestacao_contas' | 'midia_legislativa';
  params: unknown;
}

@Injectable()
export class ReportsService implements OnModuleDestroy {
  private readonly queue: Queue<ReportsJobData>;
  private readonly queueRedis: Redis;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {
    this.queueRedis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<ReportsJobData>(REPORTS_QUEUE, { connection: this.queueRedis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.queueRedis.quit();
  }

  private assertPermission(user: TenantAccessClaims, module: string, action: string): void {
    if (user.role === 'admin') return;
    if (!user.permissions.includes(`${module}:${action}`)) {
      throw new Error('Acesso negado');
    }
  }

  async createPrestacaoContas(
    user: TenantAccessClaims,
    params: unknown,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    this.assertPermission(user, 'prestacao_contas', 'create');

    const validated = prestacaoContasSchema.parse(params);

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO report_jobs (tipo, params, criado_por, status)
      VALUES ('prestacao_contas', ${sql.json(validated as never)}, ${user.sub}, 'pendente')
      RETURNING id
    `;
    const jobId = rows[0]?.id ?? '';

    await this.queue.add('report', {
      schemaName: ctx.schemaName,
      slug: ctx.slug,
      tenantId: ctx.tenantId,
      tenantNome: ctx.nome,
      corDestaque: null,
      nomeExibido: null,
      brasaoDataUri: null,
      jobId,
      actorId: user.sub,
      tipo: 'prestacao_contas',
      params: validated,
    });

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'report_created',
      resourceType: 'report_job',
      resourceId: jobId,
      ip,
      metadata: { tipo: 'prestacao_contas' },
    });

    return { id: jobId };
  }

  async createMidiaLegislativa(
    user: TenantAccessClaims,
    params: unknown,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    this.assertPermission(user, 'midia_legislativa', 'create');

    const validated = midiaLegislativaSchema.parse(params);

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO report_jobs (tipo, params, criado_por, status)
      VALUES ('midia_legislativa', ${sql.json(validated as never)}, ${user.sub}, 'pendente')
      RETURNING id
    `;
    const jobId = rows[0]?.id ?? '';

    const settingsRows = await sql<Array<{ chave: string; valor: string | unknown }>>`
      SELECT chave, valor FROM tenant_settings WHERE chave IN ('corDestaque', 'nomeExibido', 'brasaoKey')
    `;
    const parseSetting = (chave: string): string | null => {
      const raw = settingsRows.find((r) => r.chave === chave)?.valor;
      if (raw === undefined) return null;
      return (typeof raw === 'string' ? JSON.parse(raw) : raw) as string | null;
    };
    const corDestaque = parseSetting('corDestaque');
    const nomeExibido = parseSetting('nomeExibido');
    const brasaoKey = parseSetting('brasaoKey');

    // O indice.html precisa ser autocontido (aberto offline via file://) — embute o
    // brasao como data URI em vez de referenciar uma signed URL que pode expirar.
    let brasaoDataUri: string | null = null;
    if (brasaoKey) {
      try {
        const buf = await this.storage.download(ctx.slug, brasaoKey);
        const ext = brasaoKey.slice(brasaoKey.lastIndexOf('.') + 1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
        brasaoDataUri = `data:${mime};base64,${buf.toString('base64')}`;
      } catch {
        brasaoDataUri = null;
      }
    }

    await this.queue.add('report', {
      schemaName: ctx.schemaName,
      slug: ctx.slug,
      tenantId: ctx.tenantId,
      tenantNome: ctx.nome,
      corDestaque,
      nomeExibido,
      brasaoDataUri,
      jobId,
      actorId: user.sub,
      tipo: 'midia_legislativa',
      params: validated,
    });

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'report_created',
      resourceType: 'report_job',
      resourceId: jobId,
      ip,
      metadata: { tipo: 'midia_legislativa' },
    });

    return { id: jobId };
  }

  async list(
    page: number,
    pageSize: number,
    tipo?: string,
  ): Promise<{ items: ReportJobView[]; total: number }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;

    const rows = await sql<ReportJobRow[]>`
      SELECT id, tipo, status, params, criado_por, criado_em,
             iniciado_em, concluido_em, erro_mensagem, total_registros,
             file_key, tamanho_bytes
      FROM report_jobs
      WHERE (${tipo ?? null}::varchar IS NULL OR tipo = ${tipo ?? null})
      ORDER BY criado_em DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM report_jobs
      WHERE (${tipo ?? null}::varchar IS NULL OR tipo = ${tipo ?? null})
    `;

    return {
      items: rows.map(toView),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async get(id: string): Promise<ReportJobView> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<ReportJobRow[]>`
      SELECT id, tipo, status, params, criado_por, criado_em,
             iniciado_em, concluido_em, erro_mensagem, total_registros,
             file_key, tamanho_bytes
      FROM report_jobs WHERE id = ${id} LIMIT 1
    `;

    const row = rows[0];
    if (!row) throw new NotFoundException('Job nao encontrado');

    return toView(row);
  }

  async download(id: string, user: TenantAccessClaims, ip: string): Promise<{ signedUrl: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<ReportJobRow[]>`
      SELECT tipo, params, status, file_key FROM report_jobs WHERE id = ${id} LIMIT 1
    `;

    const row = rows[0];
    if (!row) throw new NotFoundException('Job nao encontrado');

    if (!row.file_key) throw new NotFoundException('Arquivo nao disponivel');

    if (row.status !== 'concluido') {
      throw new ConflictException('Download indisponivel ate conclusao do job');
    }

    const FILE_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|zip)$/;
    if (!FILE_KEY_REGEX.test(row.file_key)) {
      throw new NotFoundException('Arquivo invalido');
    }

    const downloadName = friendlyDownloadName(row.tipo, row.params);
    const signedUrl = await this.storage.createSignedUrl(ctx.slug, row.file_key, SIGNED_URL_TTL_S, downloadName);

    // actorId = user.sub (uuid real do JWT). string vazia '' nao casa com coluna uuid.
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'report_downloaded',
      resourceType: 'report_job',
      resourceId: id,
      ip,
      metadata: { file_key: row.file_key },
    });

    return { signedUrl };
  }

  /** Remove o historico de relatorios do tenant (linhas + arquivos gerados).
   *  Se tipo for informado, restringe a esse tipo (historicos sao separados por relatorio). */
  async clearHistory(user: TenantAccessClaims, ip: string, tipo?: string): Promise<number> {
    const ctx = requireTenantContext();
    const requiredPerm = tipo ? `${tipo}:create` : null;
    const hasAccess =
      user.role === 'admin' ||
      (requiredPerm
        ? user.permissions.includes(requiredPerm)
        : user.permissions.includes('prestacao_contas:create') ||
          user.permissions.includes('midia_legislativa:create'));
    if (!hasAccess) throw new Error('Acesso negado');

    const sql = this.db.tenant(ctx.schemaName);
    const rows = await sql<Array<{ id: string; file_key: string | null }>>`
      SELECT id, file_key FROM report_jobs
      WHERE (${tipo ?? null}::varchar IS NULL OR tipo = ${tipo ?? null})
    `;
    if (rows.length === 0) return 0;

    for (const row of rows) {
      if (row.file_key) await this.storage.delete(ctx.slug, row.file_key);
    }
    await sql`
      DELETE FROM report_jobs
      WHERE (${tipo ?? null}::varchar IS NULL OR tipo = ${tipo ?? null})
    `;

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'report_history_cleared',
      resourceType: 'report_job',
      ip,
      metadata: { count: rows.length, tipo: tipo ?? null },
    });

    return rows.length;
  }

  /** Remove um unico job do historico (linha + arquivo gerado, se houver). */
  async deleteOne(id: string, user: TenantAccessClaims, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string; tipo: string; file_key: string | null }>>`
      SELECT id, tipo, file_key FROM report_jobs WHERE id = ${id} LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Job nao encontrado');

    const hasAccess = user.role === 'admin' || user.permissions.includes(`${row.tipo}:create`);
    if (!hasAccess) throw new Error('Acesso negado');

    if (row.file_key) await this.storage.delete(ctx.slug, row.file_key);
    await sql`DELETE FROM report_jobs WHERE id = ${id}`;

    await this.audit.logTenant({
      actorId: user.sub,
      action: 'report_deleted',
      resourceType: 'report_job',
      resourceId: id,
      ip,
      metadata: { tipo: row.tipo },
    });
  }
}