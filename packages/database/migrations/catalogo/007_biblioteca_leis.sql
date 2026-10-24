-- Biblioteca de leis de referencia (repositorio publico ctresb/leis, licenca MIT).
-- Guarda so os METADADOS (titulo, ementa, tipo, data, situacao...) e a busca; o
-- texto integral e baixado da origem quando alguem abre a lei (e fica em cache).
-- So entram as esferas que algum orgao cadastrado precisa: federal, o estado e o
-- municipio de cada orgao.

CREATE TABLE IF NOT EXISTS platform.leis_ref (
  id bigserial PRIMARY KEY,
  path text NOT NULL UNIQUE,
  esfera varchar(10) NOT NULL CHECK (esfera IN ('federal', 'estadual', 'municipal')),
  uf char(2),
  municipio varchar(80),
  municipio_nome varchar(120),
  codigo_ibge varchar(7),
  tipo varchar(60) NOT NULL,
  titulo text NOT NULL,
  numero varchar(40),
  data date,
  ano integer,
  ementa text,
  situacao varchar(60),
  revogada boolean NOT NULL DEFAULT false,
  fonte text,
  urn text,
  blob_sha char(40) NOT NULL,
  tsv tsvector NOT NULL,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  -- Federal nao tem UF; estadual tem UF; municipal tem UF e municipio.
  CONSTRAINT leis_ref_escopo CHECK (
    (esfera = 'federal' AND uf IS NULL AND municipio IS NULL) OR
    (esfera = 'estadual' AND uf IS NOT NULL AND municipio IS NULL) OR
    (esfera = 'municipal' AND uf IS NOT NULL AND municipio IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_leis_ref_escopo ON platform.leis_ref (esfera, uf, municipio);
CREATE INDEX IF NOT EXISTS idx_leis_ref_data ON platform.leis_ref (data DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS idx_leis_ref_tipo ON platform.leis_ref (esfera, uf, tipo);
CREATE INDEX IF NOT EXISTS idx_leis_ref_tsv ON platform.leis_ref USING gin (tsv);

-- Hash de cada pasta da origem: pasta que nao mudou desde a ultima vez e pulada inteira.
CREATE TABLE IF NOT EXISTS platform.leis_pastas (
  path text PRIMARY KEY,
  sha char(40) NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Texto integral das leis que ja foram abertas (a origem so e consultada uma vez).
CREATE TABLE IF NOT EXISTS platform.leis_texto (
  path text PRIMARY KEY,
  blob_sha char(40) NOT NULL,
  texto text NOT NULL,
  baixado_em timestamptz NOT NULL DEFAULT now()
);

-- Municipio do orgao na biblioteca (nome da pasta em municipais/UF/<municipio>); vazio = deduz da cidade.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS legislacao_municipio varchar(80);

ALTER TABLE platform.leis_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.leis_pastas ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.leis_texto ENABLE ROW LEVEL SECURITY;
