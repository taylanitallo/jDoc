import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { tenantSlugSchema } from '@jdoc/shared';
import { REDIS } from '../redis/redis.module';
import { DatabaseService } from '../database/database.service';

export interface ResolvedTenant {
  id: string;
  slug: string;
  nome: string;
  status: string;
  schemaName: string;
  quotaDiscoMb: number;
  brasaoUrl: string | null;
}

const CACHE_TTL_S = 60;

/**
 * Resolve tenant por slug: cache Redis (60s) -> catalogo (public.tenants).
 * Slug SEMPRE validado por zod antes de qualquer uso.
 */
@Injectable()
export class TenancyService {
  private readonly logger = new Logger(TenancyService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly db: DatabaseService,
  ) {}

  async resolveBySlug(rawSlug: string): Promise<ResolvedTenant | null> {
    const parsed = tenantSlugSchema.safeParse(rawSlug);
    if (!parsed.success) return null;
    const slug = parsed.data;

    const cacheKey = `tenant:slug:${slug}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as ResolvedTenant;
    } catch (err) {
      // Cache indisponivel nao derruba a resolucao — segue pro banco.
      this.logger.warn(`Cache indisponivel: ${(err as Error).message}`);
    }

    const sql = this.db.catalog();
    const rows = await sql`
      SELECT id, slug, nome, status, schema_name, quota_disco_mb, brasao_url
      FROM public.tenants
      WHERE slug = ${slug}
      LIMIT 1
    `;
    if (rows.length === 0) return null;

    const row = rows[0] as Record<string, unknown>;
    const tenant: ResolvedTenant = {
      id: String(row.id),
      slug: String(row.slug),
      nome: String(row.nome),
      status: String(row.status),
      schemaName: String(row.schema_name),
      quotaDiscoMb: Number(row.quota_disco_mb),
      brasaoUrl: row.brasao_url === null ? null : String(row.brasao_url),
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(tenant), 'EX', CACHE_TTL_S);
    } catch {
      // best-effort
    }
    return tenant;
  }

  /** Invalida o cache (chamar ao ativar/desativar/editar tenant). */
  async invalidate(slug: string): Promise<void> {
    const parsed = tenantSlugSchema.safeParse(slug);
    if (!parsed.success) return;
    await this.redis.del(`tenant:slug:${parsed.data}`);
  }
}
