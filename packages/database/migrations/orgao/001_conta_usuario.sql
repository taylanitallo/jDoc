-- Minha conta: CPF (login e recuperacao de senha) e tema de cor do usuario.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf varchar(11);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_cpf ON users (cpf) WHERE cpf IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_theme jsonb;
