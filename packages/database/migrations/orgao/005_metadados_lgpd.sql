-- Metadados padrao de catalogacao, marcacao de dados pessoais (LGPD) e
-- pedidos do titular de dados no atendimento.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS numero varchar(60),
  ADD COLUMN IF NOT EXISTS assunto varchar(500),
  ADD COLUMN IF NOT EXISTS interessado varchar(300),
  ADD COLUMN IF NOT EXISTS palavras_chave varchar(60)[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dados_pessoais varchar(10) NOT NULL DEFAULT 'nao';

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_dados_pessoais_check;
ALTER TABLE documents ADD CONSTRAINT documents_dados_pessoais_check
  CHECK (dados_pessoais IN ('nao', 'comuns', 'sensiveis'));

-- Numero ja informado nos campos do tipo de documento (Acervo) vira o campo padrao.
UPDATE documents SET numero = left(metadados->>'numero', 60)
WHERE numero IS NULL AND jsonb_typeof(metadados) = 'object' AND coalesce(metadados->>'numero', '') <> '';
UPDATE documents SET assunto = left(metadados->>'ementa', 500)
WHERE assunto IS NULL AND jsonb_typeof(metadados) = 'object' AND coalesce(metadados->>'ementa', '') <> '';

CREATE INDEX IF NOT EXISTS idx_documents_numero ON documents (numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_palavras_chave ON documents USING gin (palavras_chave);
CREATE INDEX IF NOT EXISTS idx_documents_dados_pessoais ON documents (dados_pessoais) WHERE dados_pessoais <> 'nao';

-- Atendimento: pedido pela LAI ou pelo titular de dados (LGPD art. 18).
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS tipo varchar(10) NOT NULL DEFAULT 'lai',
  ADD COLUMN IF NOT EXISTS direito_lgpd varchar(20);
ALTER TABLE atendimentos DROP CONSTRAINT IF EXISTS atendimentos_tipo_check;
ALTER TABLE atendimentos ADD CONSTRAINT atendimentos_tipo_check CHECK (tipo IN ('lai', 'lgpd'));
