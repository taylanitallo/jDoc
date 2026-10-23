-- Continuidade (TR): copia dos arquivos e backups em destino segregado, testes
-- automaticos de restauracao, disponibilidade diaria e aceite da migracao
-- (plano de saida) antes de excluir um orgao.

-- O que ja foi copiado para o destino segregado (incremental por chave).
CREATE TABLE IF NOT EXISTS platform.arquivos_copia (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  file_key varchar(120) NOT NULL,
  bytes bigint NOT NULL,
  sha256 char(64) NOT NULL,
  copiado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, file_key)
);

-- Teste de restauracao: o backup e restaurado num schema temporario, conferido e descartado.
CREATE TABLE IF NOT EXISTS platform.restauracao_testes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  backup_id uuid,
  backup_em timestamptz,
  status varchar(10) NOT NULL CHECK (status IN ('sucesso', 'falha')),
  documentos integer,
  usuarios integer,
  auditoria_registros integer,
  auditoria_integra boolean,
  arquivos_conferidos integer,
  arquivos_ok integer,
  duracao_ms integer,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_restauracao_testes_tenant ON platform.restauracao_testes (tenant_id, criado_em DESC);

-- Disponibilidade: minutos do dia em que a API respondeu (amostra a cada minuto).
CREATE TABLE IF NOT EXISTS platform.disponibilidade_dias (
  dia date PRIMARY KEY,
  minutos integer NOT NULL DEFAULT 0,
  -- Com varias instancias da API, cada minuto conta uma vez so.
  ultimo_minuto timestamptz NOT NULL DEFAULT '-infinity'
);

-- Plano de saida: o orgao so e excluido depois de exportar e aceitar a migracao.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS migracao_aceita_em timestamptz,
  ADD COLUMN IF NOT EXISTS migracao_aceita_por varchar(200),
  ADD COLUMN IF NOT EXISTS migracao_aceita_obs text;

ALTER TABLE platform.arquivos_copia ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.restauracao_testes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.disponibilidade_dias ENABLE ROW LEVEL SECURITY;
