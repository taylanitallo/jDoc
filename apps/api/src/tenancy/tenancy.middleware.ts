import { ForbiddenException, Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenancyService } from './tenancy.service';
import { tenantContextStorage, type TenantContext } from './tenant-context';

/**
 * Middleware de resolucao de tenant.
 * Rotas: /t/:slug/...
 * - slug -> catalogo (cache 60s) -> valida status ativo -> injeta contexto ALS.
 * - Tenant inexistente: 404 generico (nao vaza existencia).
 * - Tenant inativo: 403 com mensagem amigavel.
 */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(private readonly tenancy: TenancyService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const match = /^\/t\/([^/]+)/.exec(req.baseUrl + req.path);
    const slug = match?.[1] ?? '';

    const tenant = await this.tenancy.resolveBySlug(slug);
    if (!tenant) {
      throw new NotFoundException('Recurso nao encontrado');
    }
    if (tenant.status !== 'ativo') {
      throw new ForbiddenException('Orgao suspenso, contate a JEOS');
    }

    const ctx: TenantContext = {
      tenantId: tenant.id,
      slug: tenant.slug,
      schemaName: tenant.schemaName,
      nome: tenant.nome,
      quotaDiscoMb: tenant.quotaDiscoMb,
    };

    // Disponibiliza tambem via req para guards/controllers.
    (req as Request & { tenant?: TenantContext }).tenant = ctx;
    tenantContextStorage.run(ctx, () => next());
  }
}
