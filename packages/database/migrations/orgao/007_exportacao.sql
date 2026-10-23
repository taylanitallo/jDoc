-- Exportacao integral do orgao (plano de saida): PDFs na estrutura padrao de
-- pastas + metadados, classificacao, auditoria, dicionario e hashes, em partes ZIP.

CREATE TABLE IF NOT EXISTS exportacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status varchar(12) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'processando', 'concluido', 'erro')),
  orgao_codigo varchar(20),
  partes jsonb NOT NULL DEFAULT '[]'::jsonb,
  documentos integer,
  arquivos integer,
  bytes bigint,
  erro text,
  solicitado_por varchar(200),
  solicitado_por_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  expira_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_exportacoes_criado ON exportacoes (criado_em DESC);
