-- Perfis do orgao: conjunto nomeado de permissoes. O usuario com perfil herda
-- papel e permissoes dele (user_permissions e sincronizada pela API); sem
-- perfil, as permissoes sao individuais ("Personalizado").
CREATE TABLE IF NOT EXISTS perfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave varchar(40) NOT NULL UNIQUE,
  nome varchar(80) NOT NULL,
  descricao varchar(200),
  papel varchar(20) NOT NULL DEFAULT 'consulta' CHECK (papel IN ('admin', 'operador', 'consulta')),
  permissoes text[] NOT NULL DEFAULT '{}',
  sistema boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS perfil_id uuid REFERENCES perfis(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_perfil ON users (perfil_id);
