import { AsyncLocalStorage } from 'node:async_hooks';
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { tenantContextStorage } from '../tenancy/tenant-context';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface GlobalAuditEntry extends AuditEntry {
  actorType: 'superadmin' | 'system' | 'security';
  targetTenantId?: string | null;
  /** Nome do admin no momento (o registro sobrevive a exclusao do admin). */
  adminName?: string | null;
  /** O que foi alterado (ex.: 'tenant', 'perfil', 'admin') e o id. */
  entity?: string | null;
  entityId?: string | null;
  /** Antes/depois, para o detalhe do log. */
  changes?: { antes?: unknown; depois?: unknown } | null;
}

/**
 * Admin da requisicao atual (o guard do superadmin preenche). Assim todo
 * log de superadmin ganha o nome do admin sem cada servico repassar.
 */
export const adminAuditContext = new AsyncLocalStorage<{ id: string; nome: string }>();

/**
 * Sessao de "entrar como" (token do orgao com `imp`): todo log do orgao
 * feito nela registra quem da plataforma estava por tras e o motivo.
 */
export const impersonacaoContext = new AsyncLocalStorage<{ adminId: string; adminNome: string; motivo: string }>();

/** Acao de um admin da equipe, com antes/depois. */
export interface AdminAuditEntry {
  action: string;
  tenantId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  antes?: unknown;
  depois?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Auditoria append-only.
 * - logTenant: audit_logs no schema do tenant do contexto atual.
 * - logGlobal: global_audit_logs no public (acoes de superadmin, eventos
 *   de seguranca cross-tenant, bloqueios).
 * Falha de auditoria e logada mas nao derruba o request (best-effort com alerta).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  async logTenant(entry: AuditEntry): Promise<void> {
    const ctx = tenantContextStorage.getStore();
    if (!ctx) {
      this.logger.error(`logTenant sem contexto de tenant: ${entry.action}`);
      return;
    }
    const imp = impersonacaoContext.getStore();
    if (imp) entry = { ...entry, metadata: { ...(entry.metadata ?? {}), impersonacao: imp } };
    try {
      const sql = this.db.tenant(ctx.schemaName);
      await sql`
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, ip, user_agent, metadata)
        VALUES (
          ${entry.actorId ?? null},
          ${entry.action},
          ${entry.resourceType ?? null},
          ${entry.resourceId ?? null},
          ${entry.ip ?? null},
          ${entry.userAgent ?? null},
          ${entry.metadata ? JSON.stringify(entry.metadata) : null}
        )
      `;
    } catch (err) {
      this.logger.error(`Falha ao gravar audit_log (${entry.action}): ${(err as Error).message}`);
    }
  }

  async logGlobal(entry: GlobalAuditEntry): Promise<void> {
    const admin = adminAuditContext.getStore();
    const adminName = entry.adminName ?? (admin && admin.id === entry.actorId ? admin.nome : null);
    try {
      const sql = this.db.catalog();
      await sql`
        INSERT INTO public.global_audit_logs
          (actor_id, actor_type, action, target_tenant_id, ip, user_agent, metadata, admin_name, entity, entity_id, changes)
        VALUES (
          ${entry.actorId ?? null},
          ${entry.actorType},
          ${entry.action},
          ${entry.targetTenantId ?? null},
          ${entry.ip ?? null},
          ${entry.userAgent ?? null},
          ${entry.metadata ? JSON.stringify(entry.metadata) : null},
          ${adminName ?? null},
          ${entry.entity ?? null},
          ${entry.entityId ?? null},
          ${entry.changes ? JSON.stringify(entry.changes) : null}
        )
      `;
    } catch (err) {
      this.logger.error(
        `Falha ao gravar global_audit_log (${entry.action}): ${(err as Error).message}`,
      );
    }
  }

  /** Escrita feita por um admin da equipe (Padrao JEOS: toda escrita auditada com antes/depois). */
  logAdmin(
    admin: { id: string; nome: string },
    origem: { ip: string; userAgent: string },
    e: AdminAuditEntry,
  ): Promise<void> {
    const temMudanca = e.antes !== undefined || e.depois !== undefined;
    return this.logGlobal({
      actorType: 'superadmin',
      actorId: admin.id,
      adminName: admin.nome,
      action: e.action,
      targetTenantId: e.tenantId ?? null,
      entity: e.entity ?? null,
      entityId: e.entityId ?? null,
      changes: temMudanca ? { antes: e.antes ?? null, depois: e.depois ?? null } : null,
      metadata: e.metadata,
      ip: origem.ip,
      userAgent: origem.userAgent,
    });
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
