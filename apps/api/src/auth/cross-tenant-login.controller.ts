import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { loginSchema, type LoginInput, type ResolveLoginResponse } from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { Public } from './decorators';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { tenantContextStorage, type TenantContext } from '../tenancy/tenant-context';
import { resolveBrasaoUrl } from '../tenancy/brasao.util';

/** Mesmo hash-dummy do AuthService — verificacao ~tempo-constante quando o
 *  e-mail nao existe em NENHUM orgao (evita vazar timing sobre existencia). */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface TenantRow {
  id: string;
  slug: string;
  nome: string;
  schema_name: string;
  quota_disco_mb: number;
}

/**
 * Login "sem slug" — usado exclusivamente pelo app desktop (processo main),
 * que nao sabe de antemao a qual orgao o usuario pertence. Tenta as
 * credenciais em todos os orgaos ativos (so roda o argon2, caro, nos que
 * realmente tem esse e-mail cadastrado) e devolve uma sessao pronta pra
 * cada orgao em que baterem. O site NUNCA usa esta rota — sempre conhece
 * o slug pela propria URL.
 */
@Controller('auth')
export class CrossTenantLoginController {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly authService: AuthService,
    private readonly passwords: PasswordService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resolve-login')
  @HttpCode(200)
  async resolveLogin(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
  ): Promise<ResolveLoginResponse> {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';

    const catalogSql = this.db.catalog();
    const tenants = await catalogSql<TenantRow[]>`
      SELECT id, slug, nome, schema_name, quota_disco_mb
      FROM public.tenants WHERE status = 'ativo'
    `;

    // Pre-filtro barato (sem argon2): so os orgaos onde o e-mail existe
    // viram candidatos — evita rodar argon2 (caro) contra todo tenant a
    // cada tentativa de login conforme o numero de orgaos crescer.
    const candidates = (
      await Promise.all(
        tenants.map(async (t) => {
          try {
            const tsql = this.db.tenant(t.schema_name);
            const rows = await tsql<Array<{ id: string }>>`
              SELECT id FROM users WHERE email = ${body.email} AND ativo = true LIMIT 1
            `;
            return rows.length > 0 ? t : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((t): t is TenantRow => t !== null);

    if (candidates.length === 0) {
      await this.passwords.verify(DUMMY_HASH, body.senha);
      throw new UnauthorizedException('E-mail ou senha invalidos');
    }

    const attempts = await Promise.all(
      candidates.map(async (t) => {
        const ctx: TenantContext = {
          tenantId: t.id,
          slug: t.slug,
          schemaName: t.schema_name,
          nome: t.nome,
          quotaDiscoMb: t.quota_disco_mb,
          // Contexto so para validar credenciais (nenhuma rota de modulo roda aqui).
          modulos: [],
          menuOverrides: {},
        };
        try {
          const result = await tenantContextStorage.run(ctx, () =>
            this.authService.login(body, ip, userAgent),
          );
          const brasaoUrl = await resolveBrasaoUrl(this.db, this.storage, t.schema_name, t.slug);
          return {
            tenant: { slug: t.slug, nome: t.nome, brasaoUrl },
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            mustChangePassword: result.mustChangePassword,
          };
        } catch {
          return null;
        }
      }),
    );

    const sessions = attempts.filter((s): s is NonNullable<typeof s> => s !== null);
    if (sessions.length === 0) {
      throw new UnauthorizedException('E-mail ou senha invalidos');
    }
    return { sessions };
  }
}
