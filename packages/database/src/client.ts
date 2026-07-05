import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { SCHEMA_NAME_REGEX } from '@jdoc/shared';

/**
 * Fabrica de conexoes.
 *
 * - `catalogSql` / `catalogDb`: conexao para o schema `public` (catalogo global).
 * - `withTenantConnection`: executa uma funcao com uma conexao cujo search_path
 *   esta FIXADO no schema do tenant. Isso garante que toda query de negocio
 *   so enxerga o schema daquele tenant (defesa em profundidade contra vazamento).
 *
 * NUNCA interpolar nome de schema vindo do usuario: `setSearchPath` valida
 * contra SCHEMA_NAME_REGEX antes de emitir o SET.
 */

let _catalog: Sql | null = null;

export function getCatalogSql(connectionString: string): Sql {
  if (!_catalog) {
    _catalog = postgres(connectionString, {
      max: 10,
      prepare: true,
      // search_path do catalogo e sempre public.
      connection: { search_path: 'public' },
    });
  }
  return _catalog;
}

export function getCatalogDb(connectionString: string) {
  return drizzle(getCatalogSql(connectionString));
}

/**
 * Cria uma conexao dedicada (pool proprio, max 1) com search_path fixado ao
 * schema do tenant, executa `fn` e fecha a conexao ao final.
 *
 * Usar para operacoes pontuais. Para alto volume, ver o pool cacheado na API.
 */
export async function withTenantConnection<T>(
  connectionString: string,
  schemaName: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  if (!SCHEMA_NAME_REGEX.test(schemaName)) {
    throw new Error(`Nome de schema invalido: ${schemaName}`);
  }
  const sql = postgres(connectionString, {
    max: 1,
    prepare: true,
    // Fixa o search_path na abertura da conexao. Como schemaName ja passou
    // pela regex allowlist, nao ha vetor de injecao.
    connection: { search_path: `"${schemaName}"` },
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export type { Sql };
