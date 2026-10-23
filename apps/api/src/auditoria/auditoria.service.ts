import { Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import {
  descreverLog,
  type AuditoriaPagina,
  type AuditoriaQuery,
  type AuditoriaRegistro,
  type VerificacaoCadeia,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { gerarCsv, type ColunaExport } from '../common/exportacao';

/** Teto de linhas numa exportacao (o filtro por periodo resolve o resto). */
const MAX_EXPORTACAO = 50_000;

interface LinhaLog {
  id: string;
  seq: string;
  criado_em: Date;
  action: string;
  actor_id: string | null;
  nome: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: unknown;
  ip: string | null;
  user_agent: string | null;
  hash: string;
}

/** jsonb gravado como texto (versoes antigas) ou objeto. */
function json(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'string') return (v as Record<string, unknown>) ?? null;
  try {
    const o: unknown = JSON.parse(v);
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const fmtDataHora = (d: Date) =>
  d.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'medium' });

/**
 * Trilha de auditoria vista pelo proprio orgao. So le: gravar e papel do
 * AuditService, e o banco recusa UPDATE/DELETE (migracao 004).
 */
@Injectable()
export class AuditoriaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  private filtro(sql: Sql, q: Omit<AuditoriaQuery, 'page' | 'pageSize'>) {
    return sql`
      WHERE (${q.de ?? null}::timestamptz IS NULL OR l.criado_em >= ${q.de ?? null})
        AND (${q.ate ?? null}::timestamptz IS NULL OR l.criado_em <= ${q.ate ?? null})
        AND (${q.acao ?? null}::varchar IS NULL OR l.action = ${q.acao ?? null})
        AND (${q.usuarioId ?? null}::uuid IS NULL OR l.actor_id = ${q.usuarioId ?? null})
        AND (${q.documentoId ?? null}::varchar IS NULL OR (l.resource_type = 'document' AND l.resource_id = ${q.documentoId ?? null}))
        AND (${q.ip ?? null}::varchar IS NULL OR l.ip = ${q.ip ?? null})
    `;
  }

  private paraRegistro(r: LinhaLog, orgao: string): AuditoriaRegistro {
    return {
      id: r.id,
      seq: Number(r.seq),
      criadoEm: r.criado_em.toISOString(),
      action: r.action,
      actorType: r.actor_id ? 'usuario' : 'system',
      adminName: r.nome,
      usuarioId: r.actor_id,
      orgao,
      entity: r.resource_type,
      entityId: r.resource_id,
      changes: null,
      metadata: json(r.metadata),
      ip: r.ip,
      userAgent: r.user_agent,
      hash: r.hash,
    };
  }

  async listar(q: AuditoriaQuery): Promise<AuditoriaPagina> {
    const ctx = requireTenantContext();
    const sql = this.sql();
    const where = this.filtro(sql, q);
    const rows = await sql<LinhaLog[]>`
      SELECT l.id::text, l.seq, l.criado_em, l.action, l.actor_id, u.nome, l.resource_type, l.resource_id,
             l.metadata, l.ip, l.user_agent, l.hash
      FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
      ${where}
      ORDER BY l.seq DESC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
    `;
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM audit_logs l ${where}`;
    return { items: rows.map((r) => this.paraRegistro(r, ctx.nome)), total: t?.n ?? 0, page: q.page, pageSize: q.pageSize };
  }

  /** Usuarios que aparecem na trilha (para o filtro "Quem"). */
  async usuarios(): Promise<Array<{ id: string; nome: string }>> {
    return this.sql()<Array<{ id: string; nome: string }>>`SELECT id, nome FROM users ORDER BY nome`;
  }

  async exportarCsv(
    actorId: string,
    q: Omit<AuditoriaQuery, 'page' | 'pageSize'>,
    ip: string,
  ): Promise<{ arquivo: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const sql = this.sql();
    const rows = await sql<LinhaLog[]>`
      SELECT l.id::text, l.seq, l.criado_em, l.action, l.actor_id, u.nome, l.resource_type, l.resource_id,
             l.metadata, l.ip, l.user_agent, l.hash
      FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
      ${this.filtro(sql, q)}
      ORDER BY l.seq
      LIMIT ${MAX_EXPORTACAO}
    `;
    const registros = rows.map((r) => this.paraRegistro(r, ctx.nome));
    const colunas: Array<ColunaExport<AuditoriaRegistro>> = [
      { titulo: 'Nº', peso: 1, valor: (r) => r.seq },
      { titulo: 'Data e hora', peso: 2, valor: (r) => fmtDataHora(new Date(r.criadoEm)) },
      { titulo: 'Usuário', peso: 2, valor: (r) => r.adminName ?? (r.usuarioId ? 'Usuário excluído' : 'Sistema') },
      { titulo: 'O que aconteceu', peso: 6, valor: (r) => descreverLog(r) },
      { titulo: 'Documento/registro', peso: 2, valor: (r) => r.entityId },
      { titulo: 'IP', peso: 2, valor: (r) => r.ip },
      { titulo: 'Navegador', peso: 3, valor: (r) => r.userAgent },
      { titulo: 'Hash (SHA-256)', peso: 4, valor: (r) => r.hash },
    ];
    await this.audit.logTenant({
      actorId,
      action: 'auditoria_exportada',
      resourceType: 'auditoria',
      ip,
      metadata: { registros: registros.length },
    });
    const data = new Date().toISOString().slice(0, 10);
    return { arquivo: gerarCsv(colunas, registros), nome: `auditoria-${ctx.slug}-${data}.csv` };
  }

  /**
   * Recalcula o hash de cada registro e confere o elo com o anterior. Linha
   * alterada = hash nao bate; linha apagada no meio = elo quebrado.
   */
  async verificar(actorId: string, ip: string): Promise<VerificacaoCadeia> {
    const sql = this.sql();
    const quebras = await sql<Array<{ seq: string; criado_em: Date; motivo: 'conteudo_alterado' | 'elo_quebrado' }>>`
      SELECT seq, criado_em,
             CASE WHEN calc IS DISTINCT FROM hash THEN 'conteudo_alterado' ELSE 'elo_quebrado' END AS motivo
      FROM (
        SELECT seq, criado_em, hash, hash_anterior,
               lag(hash) OVER (ORDER BY seq) AS anterior,
               row_number() OVER (ORDER BY seq) AS posicao,
               audit_log_hash(hash_anterior, id, seq, actor_id, action, resource_type, resource_id, ip, user_agent, metadata, criado_em) AS calc
        FROM audit_logs
      ) x
      -- O primeiro registro que sobrou (apos expurgo por retencao) e a ancora: o elo dele nao e conferido.
      WHERE calc IS DISTINCT FROM hash OR (posicao > 1 AND anterior IS DISTINCT FROM hash_anterior)
      ORDER BY seq
      LIMIT 20
    `;
    const [t] = await sql<Array<{ n: number; ultimo: string | null }>>`
      SELECT count(*)::int AS n, (SELECT hash FROM audit_logs ORDER BY seq DESC LIMIT 1) AS ultimo FROM audit_logs
    `;
    const resultado: VerificacaoCadeia = {
      integra: quebras.length === 0,
      registros: t?.n ?? 0,
      quebras: quebras.map((q) => ({ seq: Number(q.seq), criadoEm: q.criado_em.toISOString(), motivo: q.motivo })),
      verificadoEm: new Date().toISOString(),
      ultimoHash: t?.ultimo ?? null,
    };
    await this.audit.logTenant({
      actorId,
      action: 'auditoria_verificada',
      resourceType: 'auditoria',
      ip,
      metadata: { integra: resultado.integra, registros: resultado.registros },
    });
    return resultado;
  }
}
