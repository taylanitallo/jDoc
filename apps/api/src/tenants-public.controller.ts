import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { Public } from './auth/decorators';

export interface PublicTenantListItem {
  slug: string;
  nome: string;
  brasaoUrl: string | null;
}

/**
 * Lista publica de orgaos ativos — usada na tela inicial (sem tenant na URL
 * ainda) pra escolher o orgao clicando, em vez de digitar o slug de cor.
 * So expoe campos ja publicos por natureza (slug, nome, brasao).
 */
@Controller('tenants')
export class TenantsPublicController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async list(): Promise<PublicTenantListItem[]> {
    const sql = this.db.catalog();
    const rows = await sql<PublicTenantListItem[]>`
      SELECT slug, nome, brasao_url AS "brasaoUrl"
      FROM public.tenants
      WHERE status = 'ativo'
      ORDER BY nome
    `;
    return rows;
  }
}
