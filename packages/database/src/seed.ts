import postgres from 'postgres';
import argon2 from 'argon2';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  schemaNameForSlug,
  buildPermission,
  MODULES,
  MODULE_ACTIONS,
  defaultReportPermissions,
} from '@jdoc/shared';
import { provisionTenantSchema } from './tenant/provision.js';

const rootEnv = resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

/**
 * Seed de desenvolvimento:
 * - 1 superadmin (2FA desabilitado no seed; habilitar no primeiro acesso real)
 * - 1 tenant demo (schema provisionado programaticamente)
 * - usuarios de cada papel (admin, operador, consulta) + permissoes
 *
 * Senhas de dev sao fixas e conhecidas. NUNCA usar em producao.
 */

const DEV_PASSWORD = 'SenhaDemo#2026';
// TOTP fixo de DEV (2FA e obrigatorio para superadmin — login exige totp_enabled).
// NUNCA usar em producao: gerar secret por superadmin no provisionamento real.
const DEV_TOTP_SECRET = 'JDOC2FADEMOSECRETJDOC2FADEMO';

async function hash(pwd: string): Promise<string> {
  return argon2.hash(pwd, { type: argon2.argon2id });
}

function allPermissions(): string[] {
  const perms: string[] = [];
  for (const m of MODULES) {
    for (const a of MODULE_ACTIONS) {
      perms.push(buildPermission(m, a));
    }
  }
  return perms;
}

async function main(): Promise<void> {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DIRECT_URL ou DATABASE_URL nao definido');

  const sql = postgres(url, { max: 1 });

  try {
    // ---- Superadmin ----
    const superHash = await hash(DEV_PASSWORD);
    await sql`
      INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled)
      VALUES ('super@jeossistemas.com', 'Super Admin JEOS', ${superHash}, false, ${DEV_TOTP_SECRET}, true)
      ON CONFLICT (email) DO UPDATE SET totp_secret = ${DEV_TOTP_SECRET}, totp_enabled = true
    `;

    // ---- Tenant demo ----
    const slug = 'demo';
    const schemaName = schemaNameForSlug(slug);
    await sql`
      INSERT INTO public.tenants (slug, nome, status, quota_disco_mb, schema_name)
      VALUES (${slug}, 'Prefeitura Demonstracao', 'ativo', 5120, ${schemaName})
      ON CONFLICT (slug) DO NOTHING
    `;

    // Provisiona o schema do tenant (idempotente).
    await provisionTenantSchema(sql, slug);

    // ---- Usuarios do tenant demo ----
    const pwdHash = await hash(DEV_PASSWORD);
    const users: Array<{ email: string; nome: string; role: string }> = [
      { email: 'admin@demo.gov.br', nome: 'Administrador Demo', role: 'admin' },
      { email: 'operador@demo.gov.br', nome: 'Operador Demo', role: 'operador' },
      { email: 'consulta@demo.gov.br', nome: 'Consulta Demo', role: 'consulta' },
    ];

    for (const u of users) {
      await sql.unsafe(
        `INSERT INTO "${schemaName}".users (email, nome, senha_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (email) DO NOTHING`,
        [u.email, u.nome, pwdHash, u.role],
      );
    }

    // Permissoes granulares: cada papel recebe seu conjunto.
    // - admin:    todas (modulos + relatorios read/create)
    // - operador: mesmas permissoes dos modulos + relatorios read/create
    // - consulta: somente read (modulos + relatorios)
    const adminRow = await sql.unsafe(
      `SELECT id FROM "${schemaName}".users WHERE email = $1`,
      ['admin@demo.gov.br'],
    );
    if (adminRow.length > 0) {
      const adminId = (adminRow[0] as unknown as { id: string }).id;
      const basePerms = allPermissions();
      const reportPerms = defaultReportPermissions('admin');
      for (const p of [...basePerms, ...reportPerms]) {
        await sql.unsafe(
          `INSERT INTO "${schemaName}".user_permissions (user_id, permission_key)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [adminId, p],
        );
      }
    }

    const operadorRow = await sql.unsafe(
      `SELECT id FROM "${schemaName}".users WHERE email = $1`,
      ['operador@demo.gov.br'],
    );
    if (operadorRow.length > 0) {
      const operadorId = (operadorRow[0] as unknown as { id: string }).id;
      const basePerms = allPermissions();
      const reportPerms = defaultReportPermissions('operador');
      for (const p of [...basePerms, ...reportPerms]) {
        await sql.unsafe(
          `INSERT INTO "${schemaName}".user_permissions (user_id, permission_key)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [operadorId, p],
        );
      }
    }

    const consultaRow = await sql.unsafe(
      `SELECT id FROM "${schemaName}".users WHERE email = $1`,
      ['consulta@demo.gov.br'],
    );
    if (consultaRow.length > 0) {
      const consultaId = (consultaRow[0] as unknown as { id: string }).id;
      const reportReadOnly = defaultReportPermissions('consulta');
      const readPerms = MODULE_ACTIONS.filter((a) => a === 'read').map((a) =>
        MODULES.map((m) => buildPermission(m, a)),
      ).flat();
      for (const p of [...readPerms, ...reportReadOnly]) {
        await sql.unsafe(
          `INSERT INTO "${schemaName}".user_permissions (user_id, permission_key)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [consultaId, p],
        );
      }
    }

    // Cadastros de apoio (Fase 3): unidades orcamentarias + tipos de documento.
    for (const [codigo, nome] of [
      ['02.01', 'Secretaria de Administracao'],
      ['05.01', 'Secretaria de Financas'],
      ['08.01', 'Secretaria de Saude'],
    ] as const) {
      await sql.unsafe(
        `INSERT INTO "${schemaName}".budget_units (codigo, nome)
         VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING`,
        [codigo, nome],
      );
    }
    for (const [nome, cor] of [
      ['Contrato', 'blue'],
      ['Licitacao', 'green'],
      ['Oficio', 'orange'],
    ] as const) {
      await sql.unsafe(
        `INSERT INTO "${schemaName}".document_types (nome, cor)
         VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING`,
        [nome, cor],
      );
    }

    console.warn(
      `[seed] concluido.\n` +
        `  superadmin: super@jeossistemas.com / ${DEV_PASSWORD}\n` +
        `  TOTP secret (dev): ${DEV_TOTP_SECRET}\n` +
        `  otpauth://totp/jDoc:super@jeossistemas.com?secret=${DEV_TOTP_SECRET}&issuer=jDoc\n` +
        `  tenant demo (/demo):\n` +
        `    admin@demo.gov.br / ${DEV_PASSWORD}\n` +
        `    operador@demo.gov.br / ${DEV_PASSWORD}\n` +
        `    consulta@demo.gov.br / ${DEV_PASSWORD}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[seed] falhou:', err);
  process.exit(1);
});
