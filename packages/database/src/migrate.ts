import postgres from 'postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carrega .env da raiz do monorepo quando rodando local.
const rootEnv = resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

/**
 * Migra o catalogo global (schema public).
 * Idempotente. Usa CREATE ... IF NOT EXISTS.
 *
 * Para os schemas de tenant, a criacao e programatica (provisionTenantSchema),
 * disparada ao cadastrar um orgao no superadmin.
 */
async function main(): Promise<void> {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DIRECT_URL ou DATABASE_URL nao definido');
  }

  const sql = postgres(url, { max: 1 });

  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.tenants (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          slug varchar(30) NOT NULL UNIQUE,
          nome varchar(200) NOT NULL,
          brasao_url text,
          status varchar(10) NOT NULL DEFAULT 'ativo',
          quota_disco_mb integer NOT NULL DEFAULT 1024,
          schema_name varchar(40) NOT NULL UNIQUE,
          criado_em timestamptz NOT NULL DEFAULT now(),
          atualizado_em timestamptz NOT NULL DEFAULT now()
        )
      `);
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants (status)`,
      );

      // Fase 2 — dados cadastrais do orgao (idempotente).
      await tx.unsafe(`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cidade varchar(100)`);
      await tx.unsafe(`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS uf char(2)`);
      await tx.unsafe(
        `ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS responsavel varchar(200)`,
      );
      await tx.unsafe(`ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS email varchar(254)`);

      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.superadmins (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email varchar(254) NOT NULL UNIQUE,
          nome varchar(200) NOT NULL,
          senha_hash text NOT NULL,
          totp_secret text,
          totp_enabled boolean NOT NULL DEFAULT false,
          ativo boolean NOT NULL DEFAULT true,
          must_change_password boolean NOT NULL DEFAULT true,
          ultimo_acesso timestamptz,
          criado_em timestamptz NOT NULL DEFAULT now()
        )
      `);
      // Secret gerado em setup2FA, aguardando confirmacao do primeiro codigo
      // (so vira totp_secret/totp_enabled apos confirm2FA validar).
      await tx.unsafe(
        `ALTER TABLE public.superadmins ADD COLUMN IF NOT EXISTS totp_secret_pending text`,
      );

      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.global_audit_logs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          actor_id uuid,
          actor_type varchar(20) NOT NULL,
          action varchar(80) NOT NULL,
          target_tenant_id uuid,
          ip varchar(45),
          user_agent text,
          metadata jsonb,
          criado_em timestamptz NOT NULL DEFAULT now()
        )
      `);
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_global_audit_actor ON public.global_audit_logs (actor_id)`,
      );
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_global_audit_action ON public.global_audit_logs (action)`,
      );
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_global_audit_created ON public.global_audit_logs (criado_em)`,
      );

      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.backups (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL,
          status varchar(20) NOT NULL DEFAULT 'pendente',
          file_key text,
          size_bytes integer,
          erro_mensagem text,
          criado_em timestamptz NOT NULL DEFAULT now(),
          iniciado_em timestamptz,
          concluido_em timestamptz
        )
      `);
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_backups_tenant ON public.backups (tenant_id)`,
      );
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_backups_status ON public.backups (status)`,
      );
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_backups_criado ON public.backups (criado_em DESC)`,
      );
      // Backup de seguranca automatico, gerado antes de um restore (Fase 7b).
      await tx.unsafe(
        `ALTER TABLE public.backups ADD COLUMN IF NOT EXISTS is_safety_backup boolean NOT NULL DEFAULT false`,
      );

      // Config de agendamento/retencao de backup por tenant (Fase 7b).
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.tenant_backup_settings (
          tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
          enabled boolean NOT NULL DEFAULT true,
          frequencia varchar(10) NOT NULL DEFAULT 'diario',
          hora smallint NOT NULL DEFAULT 3,
          retencao smallint NOT NULL DEFAULT 7,
          atualizado_em timestamptz NOT NULL DEFAULT now()
        )
      `);

      // Restauracao de backup a partir de arquivo enviado (Fase 7b).
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.restore_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL,
          status varchar(20) NOT NULL DEFAULT 'pendente',
          safety_backup_id uuid,
          erro_mensagem text,
          criado_em timestamptz NOT NULL DEFAULT now(),
          concluido_em timestamptz
        )
      `);
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_restore_jobs_tenant ON public.restore_jobs (tenant_id)`,
      );
    });

    // Re-provisiona schemas de tenants existentes (idempotente) —
    // garante que tabelas novas (Fase 3+) existam em todos.
    const { provisionTenantSchema } = await import('./tenant/provision.js');
    const tenants = await sql<Array<{ slug: string }>>`SELECT slug FROM public.tenants`;
    for (const t of tenants) {
      await provisionTenantSchema(sql, t.slug);
    }

    console.warn('[migrate] catalogo global migrado com sucesso');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[migrate] falhou:', err);
  process.exit(1);
});
