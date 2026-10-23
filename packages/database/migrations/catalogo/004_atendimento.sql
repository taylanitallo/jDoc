-- Atendimento: chamados dos orgaos com SLA em horas uteis, conversa, notas de
-- versao ("Novidades") e feriados extras (municipais/estaduais).

CREATE SEQUENCE IF NOT EXISTS platform.ticket_number_seq;

CREATE TABLE IF NOT EXISTS platform.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint NOT NULL DEFAULT nextval('platform.ticket_number_seq') UNIQUE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opened_by_user_id uuid,
  opened_by_name varchar(200) NOT NULL,
  opened_by_email varchar(254),
  channel varchar(12) NOT NULL DEFAULT 'portal' CHECK (channel IN ('portal', 'email', 'telefone', 'whatsapp', 'presencial')),
  category varchar(20) NOT NULL DEFAULT 'duvida',
  criticality varchar(10) NOT NULL DEFAULT 'media' CHECK (criticality IN ('critica', 'alta', 'media', 'baixa')),
  title varchar(160) NOT NULL,
  description text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'fechado', 'cancelado')),
  assignee_admin_id uuid REFERENCES public.superadmins(id) ON DELETE SET NULL,
  response_due_at timestamptz NOT NULL,
  resolution_due_at timestamptz NOT NULL,
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  justification text,
  contingency text,
  satisfaction smallint CHECK (satisfaction BETWEEN 1 AND 5),
  satisfaction_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_tenant ON platform.tickets (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON platform.tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS platform.ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES platform.tickets(id) ON DELETE CASCADE,
  author_type varchar(10) NOT NULL CHECK (author_type IN ('user', 'admin', 'system')),
  author_id uuid,
  author_name varchar(200) NOT NULL,
  body text NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON platform.ticket_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS platform.releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version varchar(20) NOT NULL,
  title varchar(160) NOT NULL,
  body text NOT NULL,
  kind varchar(12) NOT NULL DEFAULT 'evolutiva' CHECK (kind IN ('corretiva', 'evolutiva', 'seguranca', 'manutencao')),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_releases_published ON platform.releases (published_at DESC);

CREATE TABLE IF NOT EXISTS platform.holidays (
  data date PRIMARY KEY,
  nome varchar(120) NOT NULL
);

ALTER TABLE platform.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.holidays ENABLE ROW LEVEL SECURITY;
