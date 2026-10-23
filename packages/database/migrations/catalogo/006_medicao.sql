-- Contrato por item (secretaria) e boletim de medicao mensal: mensalidade do
-- GED + paginas digitalizadas aceitas, sem pagar a mesma pagina duas vezes.

CREATE TABLE IF NOT EXISTS platform.contrato_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  numero integer NOT NULL,
  orgao_codigo varchar(20),
  descricao varchar(300) NOT NULL,
  valor_mensal_ged numeric(14, 2) NOT NULL DEFAULT 0,
  valor_pagina numeric(12, 4) NOT NULL DEFAULT 0,
  paginas_contratadas integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, numero)
);

-- Medicao fechada vira registro imutavel (snapshot dos itens e totais).
CREATE TABLE IF NOT EXISTS platform.medicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mes char(7) NOT NULL,
  itens jsonb NOT NULL,
  totais jsonb NOT NULL,
  disponibilidade numeric(6, 2),
  observacao text,
  fechada_por varchar(200) NOT NULL,
  fechada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mes)
);

ALTER TABLE platform.contrato_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.medicoes ENABLE ROW LEVEL SECURITY;

-- Disponibilidade: o primeiro dia medido conta a partir do primeiro minuto (e nao da meia-noite).
ALTER TABLE platform.disponibilidade_dias ADD COLUMN IF NOT EXISTS primeiro_minuto timestamptz;
-- Dias ja medidos antes desta coluna: estima o inicio supondo medicao continua.
UPDATE platform.disponibilidade_dias
SET primeiro_minuto = ultimo_minuto - make_interval(mins => greatest(minutos - 1, 0))
WHERE primeiro_minuto IS NULL AND ultimo_minuto > '-infinity';
