import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { provisionTenantSchema } from '@jdoc/database';
import { schemaNameForSlug, tenantSlugSchema, type Sistema } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { TenancyService } from '../tenancy/tenancy.service';

export interface ProvisionInput {
  slug: string;
  nome: string;
  cidade?: string;
  uf?: string;
  responsavel?: string;
  email?: string;
  quotaDiscoMb?: number;
  brasaoUrl?: string | null;
  /** Modulos contratados; padrao so financeiro. */
  modulos?: Sistema[];
}

/**
 * Provisionamento de tenant: insere no catalogo + cria schema dedicado.
 * Nome de schema SEMPRE derivado do slug validado (nunca cru do usuario).
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tenancy: TenancyService,
  ) {}

  async provisionTenant(input: ProvisionInput): Promise<{ id: string; schemaName: string }> {
    const slug = tenantSlugSchema.parse(input.slug);
    const schemaName = schemaNameForSlug(slug);

    const sql = this.db.catalog();
    const existing = await sql`SELECT id FROM public.tenants WHERE slug = ${slug} LIMIT 1`;
    if (existing.length > 0) {
      throw new ConflictException('Slug ja cadastrado');
    }

    // 1) Cria schema + tabelas (idempotente, transacional) via conexao direta.
    const direct = this.db.direct();
    try {
      await provisionTenantSchema(direct, slug);
    } finally {
      await direct.end({ timeout: 5 });
    }

    // 2) Registra no catalogo.
    const rows = await sql`
      INSERT INTO public.tenants
        (slug, nome, schema_name, quota_disco_mb, brasao_url, cidade, uf, responsavel, email, status, modulos)
      VALUES (
        ${slug},
        ${input.nome},
        ${schemaName},
        ${input.quotaDiscoMb ?? 1024},
        ${input.brasaoUrl ?? null},
        ${input.cidade ?? null},
        ${input.uf ?? null},
        ${input.responsavel ?? null},
        ${input.email ?? null},
        'ativo',
        ${input.modulos ?? ['financeiro']}
      )
      RETURNING id
    `;
    const id = String((rows[0] as Record<string, unknown>).id);

    await this.tenancy.invalidate(slug);
    this.logger.log(`Tenant provisionado: ${slug} -> ${schemaName}`);
    return { id, schemaName };
  }
}
