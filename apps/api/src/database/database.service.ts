import { Global, Module, Injectable, type OnModuleDestroy } from '@nestjs/common';
import postgres, { type Sql } from 'postgres';
import { SCHEMA_NAME_REGEX } from '@jdoc/shared';
import { loadEnv } from '../config/env';

/**
 * Gerencia conexoes com o Postgres.
 *
 * - `catalog()`: pool do schema public (catalogo global).
 * - `tenant(schemaName)`: pool DEDICADO por tenant, com search_path FIXADO
 *   ao schema daquele tenant. Pools ficam cacheados por schema.
 *
 * Regra de ouro: search_path e fixado na criacao da conexao e o nome do
 * schema e validado contra SCHEMA_NAME_REGEX. Nenhuma query de negocio
 * consegue enxergar outro schema.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly connString: string;
  private readonly directString: string;
  private catalogPool: Sql | null = null;
  private readonly tenantPools = new Map<string, Sql>();

  constructor() {
    const env = loadEnv();
    this.connString = env.DATABASE_URL;
    this.directString = env.DIRECT_URL ?? env.DATABASE_URL;
  }

  catalog(): Sql {
    if (!this.catalogPool) {
      this.catalogPool = postgres(this.connString, {
        max: 10,
        prepare: true,
        connection: { search_path: 'public' },
      });
    }
    return this.catalogPool;
  }

  /**
   * Conexao direta (sem pooler) para DDL / provisioning de schema.
   */
  direct(): Sql {
    return postgres(this.directString, { max: 1 });
  }

  /**
   * Pool dedicado ao schema do tenant, com search_path fixado.
   */
  tenant(schemaName: string): Sql {
    if (!SCHEMA_NAME_REGEX.test(schemaName)) {
      throw new Error(`Nome de schema invalido: ${schemaName}`);
    }
    const existing = this.tenantPools.get(schemaName);
    if (existing) return existing;

    const pool = postgres(this.connString, {
      max: 5,
      prepare: true,
      // schemaName ja validado por regex allowlist [a-z0-9_].
      connection: { search_path: `"${schemaName}"` },
    });
    this.tenantPools.set(schemaName, pool);
    return pool;
  }

  async onModuleDestroy(): Promise<void> {
    const closers: Array<Promise<void>> = [];
    if (this.catalogPool) closers.push(this.catalogPool.end({ timeout: 5 }));
    for (const pool of this.tenantPools.values()) {
      closers.push(pool.end({ timeout: 5 }));
    }
    await Promise.allSettled(closers);
  }
}

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
