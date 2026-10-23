-- Lotacao por secretaria, 2FA dos usuarios do orgao e trilha de auditoria imutavel.

-- Secretarias (codigo do cadastro de orgaos, estavel entre exercicios) que o
-- usuario enxerga. Vazio = todas. Administrador sempre ve todas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS orgaos_codigos varchar(20)[] NOT NULL DEFAULT '{}';

-- Segredo TOTP gerado e ainda nao confirmado (o ativo continua em totp_secret).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_pending text;

-- ---- Trilha de auditoria: encadeamento por hash + bloqueio de alteracao ----
-- Cada registro guarda o hash do anterior; alterar ou apagar qualquer linha
-- quebra a cadeia, e a verificacao aponta onde.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS seq bigint,
  ADD COLUMN IF NOT EXISTS hash_anterior char(64),
  ADD COLUMN IF NOT EXISTS hash char(64);

CREATE SEQUENCE IF NOT EXISTS audit_logs_seq;

CREATE OR REPLACE FUNCTION audit_log_hash(
  p_anterior text, p_id uuid, p_seq bigint, p_actor uuid, p_action text, p_rtype text,
  p_rid text, p_ip text, p_ua text, p_meta jsonb, p_criado timestamptz
) RETURNS char(64) LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    coalesce(p_anterior, ''), p_id::text, p_seq::text, coalesce(p_actor::text, ''), p_action,
    coalesce(p_rtype, ''), coalesce(p_rid, ''), coalesce(p_ip, ''), coalesce(p_ua, ''),
    coalesce(p_meta::text, ''), ((extract(epoch FROM p_criado) * 1000000)::bigint)::text
  ), 'UTF8')), 'hex')
$$;

-- Registros antigos entram na cadeia na ordem em que foram gravados.
DO $$
DECLARE
  r record;
  anterior text := NULL;
  n bigint := 0;
BEGIN
  FOR r IN SELECT id FROM audit_logs WHERE seq IS NULL ORDER BY criado_em, id LOOP
    n := n + 1;
    UPDATE audit_logs SET seq = n, hash_anterior = anterior,
      hash = audit_log_hash(anterior, id, n, actor_id, action, resource_type, resource_id, ip, user_agent, metadata, criado_em)
    WHERE id = r.id
    RETURNING hash INTO anterior;
  END LOOP;
  IF n > 0 THEN PERFORM setval('audit_logs_seq', n, true); END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_seq ON audit_logs (seq);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs (resource_type, resource_id);

-- O numero e o hash sao dados pelo banco, sob trava: duas gravacoes ao mesmo
-- tempo nunca apontam para o mesmo anterior.
CREATE OR REPLACE FUNCTION audit_logs_encadear() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  anterior text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_SCHEMA || '.audit_logs'));
  NEW.seq := nextval('audit_logs_seq');
  SELECT hash INTO anterior FROM audit_logs ORDER BY seq DESC LIMIT 1;
  NEW.hash_anterior := anterior;
  NEW.hash := audit_log_hash(anterior, NEW.id, NEW.seq, NEW.actor_id, NEW.action, NEW.resource_type,
    NEW.resource_id, NEW.ip, NEW.user_agent, NEW.metadata, NEW.criado_em);
  RETURN NEW;
END $$;

-- Ninguem altera nem apaga a trilha pela aplicacao. A unica excecao e o
-- expurgo por prazo de retencao, que liga a flag na propria transacao.
CREATE OR REPLACE FUNCTION audit_logs_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('jdoc.expurgo_auditoria', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A trilha de auditoria não pode ser alterada nem apagada'
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS audit_logs_encadear ON audit_logs;
CREATE TRIGGER audit_logs_encadear BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_encadear();

DROP TRIGGER IF EXISTS audit_logs_imutavel ON audit_logs;
CREATE TRIGGER audit_logs_imutavel BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_imutavel();

DROP TRIGGER IF EXISTS audit_logs_sem_truncate ON audit_logs;
CREATE TRIGGER audit_logs_sem_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_imutavel();

ALTER TABLE audit_logs ALTER COLUMN seq SET NOT NULL;
