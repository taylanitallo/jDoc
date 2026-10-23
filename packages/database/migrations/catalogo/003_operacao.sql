-- Operacao: jobs com trava, monitoramento de performance e erros, backups com
-- tipo/autor e restauracao em etapas.

CREATE TABLE IF NOT EXISTS platform.job_runs (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  job varchar(60) NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  attempt int NOT NULL DEFAULT 1,
  origem varchar(12) NOT NULL DEFAULT 'agendado' CHECK (origem IN ('agendado', 'manual')),
  disparado_por varchar(200),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stats jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON platform.job_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON platform.job_runs (job, started_at DESC);

-- Trava por job: com mais de uma instancia da API, so uma roda por vez.
CREATE TABLE IF NOT EXISTS platform.job_locks (
  job varchar(60) PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  holder varchar(100)
);

-- Requisicoes acima de SLOW_REQUEST_MS (rota-padrao, nunca a URL com ids). 7 dias.
CREATE TABLE IF NOT EXISTS platform.slow_requests (
  id bigserial PRIMARY KEY,
  method varchar(10) NOT NULL,
  route varchar(300) NOT NULL,
  status int NOT NULL,
  duration_ms int NOT NULL,
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_slow_requests_created ON platform.slow_requests (created_at DESC);

-- Agregado por hora e rota: contagem, erros, tempo e histograma (para o p95).
-- Faixas do histograma (ms): <=50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, >5000.
CREATE TABLE IF NOT EXISTS platform.route_metrics (
  hora timestamptz NOT NULL,
  method varchar(10) NOT NULL,
  route varchar(300) NOT NULL,
  qtd int NOT NULL DEFAULT 0,
  erros_4xx int NOT NULL DEFAULT 0,
  erros_5xx int NOT NULL DEFAULT 0,
  soma_ms bigint NOT NULL DEFAULT 0,
  max_ms int NOT NULL DEFAULT 0,
  faixas int[] NOT NULL DEFAULT '{0,0,0,0,0,0,0,0,0,0,0,0}',
  PRIMARY KEY (hora, method, route)
);
CREATE INDEX IF NOT EXISTS idx_route_metrics_hora ON platform.route_metrics (hora DESC);

-- Erros 5xx agrupados pela "impressao digital" (rota + mensagem).
CREATE TABLE IF NOT EXISTS platform.error_events (
  fingerprint char(40) PRIMARY KEY,
  method varchar(10) NOT NULL,
  route varchar(300) NOT NULL,
  mensagem text NOT NULL,
  stack text,
  qtd int NOT NULL DEFAULT 1,
  primeira_em timestamptz NOT NULL DEFAULT now(),
  ultima_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_error_events_ultima ON platform.error_events (ultima_em DESC);

-- Saude do servidor a cada minuto (7 dias).
CREATE TABLE IF NOT EXISTS platform.health_samples (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  memoria_mb int NOT NULL,
  cpu_pct numeric(5, 1) NOT NULL,
  db_ms int,
  redis_ms int,
  db_conexoes int,
  db_tamanho_mb int,
  filas jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_health_samples_created ON platform.health_samples (created_at DESC);

-- Backups: tipo, autor, backup completo (sem orgao).
ALTER TABLE public.backups ADD COLUMN IF NOT EXISTS kind varchar(12) NOT NULL DEFAULT 'manual';
UPDATE public.backups SET kind = 'seguranca' WHERE is_safety_backup;
ALTER TABLE public.backups ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.backups ADD COLUMN IF NOT EXISTS created_by_name varchar(200);
ALTER TABLE public.backups ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.backups ALTER COLUMN size_bytes TYPE bigint;
CREATE INDEX IF NOT EXISTS idx_backups_tenant_criado ON public.backups (tenant_id, criado_em DESC);
ALTER TABLE public.tenant_backup_settings ADD COLUMN IF NOT EXISTS last_run_at timestamptz;

-- Restauracao em etapas, a partir de um backup existente ou de arquivo enviado.
ALTER TABLE public.restore_jobs ADD COLUMN IF NOT EXISTS step varchar(40);
ALTER TABLE public.restore_jobs ADD COLUMN IF NOT EXISTS backup_id uuid;
ALTER TABLE public.restore_jobs ADD COLUMN IF NOT EXISTS source varchar(10) NOT NULL DEFAULT 'upload';
ALTER TABLE public.restore_jobs ADD COLUMN IF NOT EXISTS file_name varchar(255);
ALTER TABLE public.restore_jobs ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.restore_jobs ADD COLUMN IF NOT EXISTS created_by_name varchar(200);
ALTER TABLE public.restore_jobs ADD COLUMN IF NOT EXISTS status_anterior varchar(10);

ALTER TABLE platform.job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.job_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.slow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.route_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.error_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.health_samples ENABLE ROW LEVEL SECURITY;
