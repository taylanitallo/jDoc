-- Servico de digitalizacao: plano de trabalho, lotes com cadeia de custodia,
-- inventario dos itens, controle de qualidade, nao conformidades e aceite do fiscal.

CREATE TABLE IF NOT EXISTS digit_planos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orgao_codigo varchar(20),
  titulo varchar(200) NOT NULL,
  diagnostico text,
  setores text,
  volume_caixas integer,
  volume_paginas integer,
  inicio date,
  fim date,
  metas text,
  status varchar(12) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'aprovado')),
  aprovado_por uuid REFERENCES users(id),
  aprovado_em timestamptz,
  aprovado_ip varchar(45),
  criado_por uuid REFERENCES users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS digit_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero integer NOT NULL,
  ano integer NOT NULL,
  plano_id uuid REFERENCES digit_planos(id),
  orgao_codigo varchar(20),
  descricao varchar(500) NOT NULL,
  setor_origem varchar(200),
  responsavel_entrega varchar(200),
  etapa varchar(20) NOT NULL DEFAULT 'recebido' CHECK (etapa IN
    ('recebido', 'preparacao', 'digitalizacao', 'indexacao', 'controle_qualidade', 'disponibilizado', 'devolvido')),
  caixas integer NOT NULL DEFAULT 0,
  paginas_estimadas integer,
  amostragem_pct integer NOT NULL DEFAULT 10 CHECK (amostragem_pct BETWEEN 1 AND 100),
  estado_conservacao varchar(10) NOT NULL DEFAULT 'bom' CHECK (estado_conservacao IN ('bom', 'regular', 'ruim', 'pessimo')),
  sigiloso boolean NOT NULL DEFAULT false,
  fragil boolean NOT NULL DEFAULT false,
  grande_formato boolean NOT NULL DEFAULT false,
  contaminado boolean NOT NULL DEFAULT false,
  observacoes text,
  aceite_por uuid REFERENCES users(id),
  aceite_em timestamptz,
  aceite_ip varchar(45),
  aceite_observacao text,
  paginas_aceitas integer,
  criado_por uuid REFERENCES users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ano, numero)
);
CREATE INDEX IF NOT EXISTS idx_digit_lotes_etapa ON digit_lotes (etapa);
CREATE INDEX IF NOT EXISTS idx_digit_lotes_orgao ON digit_lotes (orgao_codigo);

-- Cadeia de custodia: toda mudanca de etapa, com quem, quando e de onde.
CREATE TABLE IF NOT EXISTS digit_lote_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES digit_lotes(id) ON DELETE CASCADE,
  etapa_de varchar(20),
  etapa_para varchar(20) NOT NULL,
  observacao text,
  usuario_id uuid REFERENCES users(id),
  ip varchar(45),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_digit_eventos_lote ON digit_lote_eventos (lote_id, criado_em);

-- Inventario do lote (preliminar no recebimento, conferido na devolucao).
CREATE TABLE IF NOT EXISTS digit_lote_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES digit_lotes(id) ON DELETE CASCADE,
  tipo varchar(12) NOT NULL CHECK (tipo IN ('caixa', 'pasta', 'livro', 'processo', 'mapa', 'outro')),
  identificacao varchar(300) NOT NULL,
  local_fisico_id uuid REFERENCES locais_fisicos(id),
  datas_limite varchar(60),
  folhas integer,
  estado_conservacao varchar(10) NOT NULL DEFAULT 'bom' CHECK (estado_conservacao IN ('bom', 'regular', 'ruim', 'pessimo')),
  observacao text,
  conferido_devolucao boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_digit_itens_lote ON digit_lote_itens (lote_id);

-- Controle de qualidade por amostragem.
CREATE TABLE IF NOT EXISTS digit_qc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES digit_lotes(id) ON DELETE CASCADE,
  amostra integer NOT NULL,
  checklist jsonb NOT NULL,
  aprovado boolean NOT NULL,
  observacao text,
  avaliado_por uuid REFERENCES users(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_digit_qc_lote ON digit_qc (lote_id, criado_em);

CREATE TABLE IF NOT EXISTS digit_nao_conformidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES digit_lotes(id) ON DELETE CASCADE,
  qc_id uuid REFERENCES digit_qc(id) ON DELETE SET NULL,
  document_id uuid REFERENCES documents(id),
  tipo varchar(20) NOT NULL,
  descricao text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'corrigida')),
  criado_por uuid REFERENCES users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  corrigida_por uuid REFERENCES users(id),
  corrigida_em timestamptz,
  correcao text
);
CREATE INDEX IF NOT EXISTS idx_digit_nc_lote ON digit_nao_conformidades (lote_id, status);

-- Vinculo do documento digital com o lote de origem (e, pelo lote, com as caixas do original).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS lote_digitalizacao_id uuid REFERENCES digit_lotes(id);
CREATE INDEX IF NOT EXISTS idx_documents_lote_digit ON documents (lote_digitalizacao_id) WHERE lote_digitalizacao_id IS NOT NULL;

-- Estado de conservacao tambem no local fisico (caixa) e no documento.
ALTER TABLE locais_fisicos ADD COLUMN IF NOT EXISTS estado_conservacao varchar(10);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS estado_conservacao varchar(10);
