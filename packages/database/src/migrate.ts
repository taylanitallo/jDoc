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
      // Modulos contratados: Financeiro/Contabil e/ou Arquivo. Orgaos existentes seguem so
      // com o financeiro (o Arquivo e contratado a parte pelo superadmin).
      await tx.unsafe(
        `ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS modulos varchar(20)[] NOT NULL DEFAULT '{financeiro}'`,
      );
      await tx.unsafe(`ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_modulos_check`);
      await tx.unsafe(
        `ALTER TABLE public.tenants ADD CONSTRAINT tenants_modulos_check
           CHECK (cardinality(modulos) >= 1 AND modulos <@ ARRAY['financeiro', 'arquivo']::varchar(20)[])`,
      );
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

      // Autenticidade publica: codigo (impresso com QR na copia autenticada) ->
      // tenant + documento + versao exata do arquivo (hash). Fica no catalogo
      // para a verificacao publica achar o tenant sem varrer schemas. Um
      // codigo por versao do arquivo: PDF substituido gera codigo novo e o
      // antigo passa a responder "substituido".
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.codigos_verificacao (
          codigo char(16) PRIMARY KEY,
          tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
          document_id uuid NOT NULL,
          document_file_id uuid,
          file_hash char(64) NOT NULL,
          criado_em timestamptz NOT NULL DEFAULT now(),
          UNIQUE NULLS NOT DISTINCT (tenant_id, document_id, document_file_id, file_hash)
        )
      `);
      // Hash de cada copia carimbada emitida: quem recebe a copia confere que
      // ela saiu do sistema sem alteracao (o hash da copia difere do original).
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS public.copias_autenticadas (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          codigo char(16) NOT NULL REFERENCES public.codigos_verificacao(codigo) ON DELETE CASCADE,
          copia_hash char(64) NOT NULL,
          emitida_por uuid,
          emitida_em timestamptz NOT NULL DEFAULT now()
        )
      `);
      await tx.unsafe(
        `CREATE INDEX IF NOT EXISTS idx_copias_autenticadas_codigo ON public.copias_autenticadas (codigo, copia_hash)`,
      );
    });

    const { aplicarMigracoesCatalogo } = await import('./versioned.js');
    const novas = await aplicarMigracoesCatalogo(sql);
    if (novas.length) console.warn(`[migrate] aplicadas: ${novas.join(', ')}`);

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
