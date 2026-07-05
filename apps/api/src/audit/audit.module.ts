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
    try {
      const sql = this.db.catalog();
      await sql`
        INSERT INTO public.global_audit_logs (actor_id, actor_type, action, target_tenant_id, ip, user_agent, metadata)
        VALUES (
          ${entry.actorId ?? null},
          ${entry.actorType},
          ${entry.action},
          ${entry.targetTenantId ?? null},
          ${entry.ip ?? null},
          ${entry.userAgent ?? null},
          ${entry.metadata ? JSON.stringify(entry.metadata) : null}
        )
      `;
    } catch (err) {
      this.logger.error(
        `Falha ao gravar global_audit_log (${entry.action}): ${(err as Error).message}`,
      );
    }
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
