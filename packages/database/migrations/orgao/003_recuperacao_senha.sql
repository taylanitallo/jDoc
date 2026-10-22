-- "Esqueci a senha": link (token) e codigo de 6 digitos por e-mail. So os
-- hashes ficam no banco; o pedido vale uma vez.
CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  codigo_hash char(64) NOT NULL,
  -- Link vale 1 h; codigo vale 15 min e aceita 5 tentativas.
  expira_em timestamptz NOT NULL,
  codigo_expira_em timestamptz NOT NULL,
  tentativas smallint NOT NULL DEFAULT 0,
  usado_em timestamptz,
  ip varchar(45),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, criado_em DESC);
