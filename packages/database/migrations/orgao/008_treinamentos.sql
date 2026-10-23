-- Registro dos treinamentos dados aos servidores (TR: capacitacao com lista de presenca).

CREATE TABLE IF NOT EXISTS treinamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo varchar(200) NOT NULL,
  data date NOT NULL,
  carga_horaria numeric(5, 1),
  instrutor varchar(200),
  local varchar(200),
  conteudo text,
  modalidade varchar(12) NOT NULL DEFAULT 'presencial' CHECK (modalidade IN ('presencial', 'remoto')),
  participantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_por uuid REFERENCES users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_treinamentos_data ON treinamentos (data DESC);
