-- Equipe da plataforma (superadmins): papel, tema, sessoes e auditoria detalhada.

ALTER TABLE public.superadmins ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'support';
-- Quem ja existia antes dos papeis era dono da plataforma.
UPDATE public.superadmins SET role = 'owner';
ALTER TABLE public.superadmins DROP CONSTRAINT IF EXISTS superadmins_role_check;
ALTER TABLE public.superadmins ADD CONSTRAINT superadmins_role_check CHECK (role IN ('owner', 'support', 'implantacao'));
ALTER TABLE public.superadmins ADD COLUMN IF NOT EXISTS ui_theme jsonb;

-- Uma linha por familia de refresh token (uma sessao = um navegador/dispositivo).
CREATE TABLE IF NOT EXISTS platform.admin_sessions (
  id varchar(64) PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES public.superadmins(id) ON DELETE CASCADE,
  ip varchar(45),
  user_agent text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  -- Reautenticacao para acoes criticas (5 min).
  reauth_until timestamptz
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON platform.admin_sessions (admin_id, last_seen_at DESC);

-- Auditoria: nome do admin no momento (sobrevive a exclusao) e antes/depois.
ALTER TABLE public.global_audit_logs ADD COLUMN IF NOT EXISTS admin_name varchar(200);
ALTER TABLE public.global_audit_logs ADD COLUMN IF NOT EXISTS entity varchar(60);
ALTER TABLE public.global_audit_logs ADD COLUMN IF NOT EXISTS entity_id varchar(80);
ALTER TABLE public.global_audit_logs ADD COLUMN IF NOT EXISTS changes jsonb;
CREATE INDEX IF NOT EXISTS idx_global_audit_created_desc ON public.global_audit_logs (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_global_audit_tenant_created ON public.global_audit_logs (target_tenant_id, criado_em DESC);

-- O schema platform so e acessado pela API (conexao direta ao banco): sem
-- acesso pelos papeis expostos do Supabase.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA platform FROM anon, authenticated';
  END IF;
END $$;
ALTER TABLE platform.admin_sessions ENABLE ROW LEVEL SECURITY;
