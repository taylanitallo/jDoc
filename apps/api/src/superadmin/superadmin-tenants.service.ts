import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTenantInput,
  SetQuotaInput,
  SetTenantStatusInput,
  TenantOverview,
  UpdateTenantInput,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { ProvisioningService } from '../provisioning/provisioning.service';
import { AuditService } from '../audit/audit.module';
import { StorageService } from '../storage/storage.module';

interface TenantRow {
  id: string;
  slug: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  responsavel: string | null;
  email: string | null;
  status: string;
  quota_disco_mb: number;
  brasao_url: string | null;
  schema_name: string;
  criado_em: Date;
}

@Injectable()
export class SuperadminTenantsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private toOverview(row: TenantRow, usoBytes: number): TenantOverview {
    const quotaBytes = row.quota_disco_mb * 1024 * 1024;
    return {
      id: row.id,
      slug: row.slug,
      nome: row.nome,
      cidade: row.cidade,
      uf: row.uf,
      responsavel: row.responsavel,
      email: row.email,
      status: row.status,
      quotaDiscoMb: row.quota_disco_mb,
      brasaoUrl: row.brasao_url,
      criadoEm: row.criado_em.toISOString(),
      usoBytes,
      usoPercent: quotaBytes > 0 ? Math.round((usoBytes / quotaBytes) * 1000) / 10 : 0,
    };
  }

  async list(): Promise<TenantOverview[]> {
    const sql = this.db.catalog();
    const rows = await sql<TenantRow[]>`
      SELECT id, slug, nome, cidade, uf, responsavel, email, status,
             quota_disco_mb, brasao_url, schema_name, criado_em
      FROM public.tenants ORDER BY nome
    `;
    return Promise.all(
      rows.map(async (r) => this.toOverview(r, await this.storage.usageBytes(r.slug))),
    );
  }

  async getById(id: string): Promise<TenantRow> {
    const sql = this.db.catalog();
    const rows = await sql<TenantRow[]>`
      SELECT id, slug, nome, cidade, uf, responsavel, email, status,
             quota_disco_mb, brasao_url, schema_name, criado_em
      FROM public.tenants WHERE id = ${id} LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Orgao nao encontrado');
    return row;
  }

  async overview(id: string): Promise<TenantOverview> {
    const row = await this.getById(id);
    return this.toOverview(row, await this.storage.usageBytes(row.slug));
  }

  async create(
    input: CreateTenantInput,
    actorId: string,
    ip: string,
  ): Promise<{ id: string; schemaName: string }> {
    const result = await this.provisioning.provisionTenant(input);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_created',
      targetTenantId: result.id,
      ip,
      metadata: { slug: input.slug, nome: input.nome },
    });
    return result;
  }

  async update(id: string, input: UpdateTenantInput, actorId: string, ip: string): Promise<void> {
    const row = await this.getById(id);
    const sql = this.db.catalog();
    await sql`
      UPDATE public.tenants SET
        nome = ${input.nome ?? row.nome},
        cidade = ${input.cidade ?? row.cidade},
        uf = ${input.uf ?? row.uf},
        responsavel = ${input.responsavel ?? row.responsavel},
        email = ${input.email ?? row.email},
        brasao_url = ${input.brasaoUrl === undefined ? row.brasao_url : input.brasaoUrl},
        atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.tenancy.invalidate(row.slug);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_updated',
      targetTenantId: id,
      ip,
      metadata: { changes: input as Record<string, unknown> },
    });
  }

  /** Ativar/desativar com invalidacao IMEDIATA do cache — bloqueio na hora. */
  async setStatus(
    id: string,
    input: SetTenantStatusInput,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const row = await this.getById(id);
    const sql = this.db.catalog();
    await sql`
      UPDATE public.tenants SET status = ${input.status}, atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.tenancy.invalidate(row.slug);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: input.status === 'ativo' ? 'tenant_activated' : 'tenant_deactivated',
      targetTenantId: id,
      ip,
      metadata: { slug: row.slug },
    });
  }

  async setQuota(id: string, input: SetQuotaInput, actorId: string, ip: string): Promise<void> {
    const row = await this.getById(id);
    const sql = this.db.catalog();
    await sql`
      UPDATE public.tenants SET quota_disco_mb = ${input.quotaDiscoMb}, atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.tenancy.invalidate(row.slug);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_quota_changed',
      targetTenantId: id,
      ip,
      metadata: { de: row.quota_disco_mb, para: input.quotaDiscoMb },
    });
  }
}
