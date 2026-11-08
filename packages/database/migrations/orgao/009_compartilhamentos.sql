-- Compartilhamento de documento entre usuarios do orgao. Nao concede acesso:
-- so chega a quem ja pode ler o documento (perfil, lotacao e sigilo).
CREATE TABLE IF NOT EXISTS documento_compartilhamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  de_usuario uuid NOT NULL REFERENCES users(id),
  para_usuario uuid NOT NULL REFERENCES users(id),
  mensagem varchar(500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  visto_em timestamptz,
  UNIQUE (document_id, de_usuario, para_usuario)
);
CREATE INDEX IF NOT EXISTS idx_doc_compartilhamentos_para ON documento_compartilhamentos (para_usuario, criado_em DESC);
