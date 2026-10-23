-- Orgaos: cadastro completo (CNPJ, ambiente, contrato), menus desligados,
-- motivo da suspensao; perfis padrao globais e integracoes cifradas.

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS cnpj varchar(14);
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ambiente varchar(20) NOT NULL DEFAULT 'producao';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS contrato jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS menu_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS motivo_status text;
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('ativo', 'inativo', 'manutencao', 'arquivado'));
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_ambiente_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_ambiente_check CHECK (ambiente IN ('producao', 'homologacao', 'treinamento'));

-- Modelos globais dos perfis: so o que difere do padrao do codigo.
CREATE TABLE IF NOT EXISTS platform.role_templates (
  key varchar(40) PRIMARY KEY,
  name varchar(80) NOT NULL,
  description varchar(200),
  permissions text[] NOT NULL,
  updated_by uuid REFERENCES public.superadmins(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Configuracoes globais (padrao da plataforma) e por orgao.
CREATE TABLE IF NOT EXISTS platform.settings (
  key varchar(40) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_encrypted jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.tenant_integrations (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key varchar(40) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  usar_padrao boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_encrypted jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

ALTER TABLE platform.role_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_integrations ENABLE ROW LEVEL SECURITY;
