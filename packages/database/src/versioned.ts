import type { Sql } from 'postgres';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCHEMA_NAME_REGEX } from '@jdoc/shared';

/**
 * Migracoes versionadas (`NNN_nome.sql`), aplicadas uma unica vez cada e
 * registradas numa tabela de controle.
 *
 * - `migrations/catalogo/`: catalogo global e schema `platform`. Controle em
 *   `platform.schema_migrations`.
 * - `migrations/orgao/`: rodam dentro do schema de cada orgao (search_path
 *   fixado na transacao), entao o SQL usa nomes sem schema. Controle em
 *   `<schema>.schema_migrations`.
 *
 * O bloco idempotente antigo (migrate.ts / provisionTenantSchema) continua
 * rodando antes; daqui em diante toda mudanca de banco entra como arquivo novo.
 * Cada arquivo roda numa transacao: se falhar, nada dele fica aplicado.
 *
 * `src/` e `dist/` ficam no mesmo nivel, entao `../migrations` resolve igual
 * rodando com tsx ou compilado.
 */
const RAIZ = resolve(__dirname, '../migrations');
const NOME_ARQUIVO = /^\d{3}_[a-z0-9_]+\.sql$/;

function arquivos(pasta: 'catalogo' | 'orgao'): Array<{ nome: string; sql: string }> {
  const dir = join(RAIZ, pasta);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => NOME_ARQUIVO.test(f))
    .sort()
    .map((nome) => ({ nome, sql: readFileSync(join(dir, nome), 'utf8') }));
}

export async function aplicarMigracoesCatalogo(sql: Sql): Promise<string[]> {
  await sql.unsafe(`
    CREATE SCHEMA IF NOT EXISTS platform;
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      nome text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    );
  `);
  const feitas = new Set(
    (await sql<Array<{ nome: string }>>`SELECT nome FROM platform.schema_migrations`).map((r) => r.nome),
  );
  const aplicadas: string[] = [];
  for (const m of arquivos('catalogo')) {
    if (feitas.has(m.nome)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx`INSERT INTO platform.schema_migrations (nome) VALUES (${m.nome})`;
    });
    aplicadas.push(m.nome);
  }
  return aplicadas;
}

export async function aplicarMigracoesOrgao(sql: Sql, schemaName: string): Promise<string[]> {
  if (!SCHEMA_NAME_REGEX.test(schemaName)) throw new Error(`Nome de schema invalido: ${schemaName}`);
  const lista = arquivos('orgao');
  if (lista.length === 0) return [];
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "${schemaName}".schema_migrations (
      nome text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )
  `);
  const feitas = new Set(
    (await sql.unsafe<Array<{ nome: string }>>(`SELECT nome FROM "${schemaName}".schema_migrations`)).map(
      (r) => r.nome,
    ),
  );
  const aplicadas: string[] = [];
  for (const m of lista) {
    if (feitas.has(m.nome)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public`);
      await tx.unsafe(m.sql);
      await tx.unsafe(`INSERT INTO "${schemaName}".schema_migrations (nome) VALUES ('${m.nome}')`);
    });
    aplicadas.push(m.nome);
  }
  return aplicadas;
}
