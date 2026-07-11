import type { Sql } from 'postgres';
import { SCHEMA_NAME_REGEX, schemaNameForSlug } from '@jdoc/shared';

/**
 * DDL de provisionamento de um schema de tenant.
 *
 * SEGURANCA CRITICA:
 * - O nome do schema NUNCA vem cru do usuario. E derivado do slug validado
 *   (schemaNameForSlug) e re-checado contra SCHEMA_NAME_REGEX aqui.
 * - Identificadores nao podem ser parametrizados por bind ($1) no Postgres,
 *   entao a unica defesa e a validacao estrita por allowlist/regex + quoting.
 *   Como o nome so contem [a-z0-9_], nao ha vetor de injecao.
 */

function assertSafeSchemaName(schemaName: string): void {
  if (!SCHEMA_NAME_REGEX.test(schemaName)) {
    throw new Error(`Nome de schema invalido: ${schemaName}`);
  }
}

/**
 * Cria o schema do tenant e todas as tabelas base (Fase 1).
 * Idempotente: usa IF NOT EXISTS. Executa dentro de uma transacao.
 */
export async function provisionTenantSchema(sql: Sql, slug: string): Promise<string> {
  const schemaName = schemaNameForSlug(slug); // valida slug + deriva + revalida
  assertSafeSchemaName(schemaName);

  // sql.unsafe e usado APENAS para o identificador ja validado por regex.
  // Nenhum dado de usuario entra aqui sem passar pela allowlist [a-z0-9_].
  await sql.begin(async (tx) => {
    await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await tx.unsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await tx.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(254) NOT NULL UNIQUE,
        nome varchar(200) NOT NULL,
        senha_hash text NOT NULL,
        role varchar(20) NOT NULL DEFAULT 'consulta',
        ativo boolean NOT NULL DEFAULT true,
        must_change_password boolean NOT NULL DEFAULT true,
        totp_secret text,
        totp_enabled boolean NOT NULL DEFAULT false,
        ultimo_acesso timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_users_email ON "${schemaName}".users (email)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_users_ativo ON "${schemaName}".users (ativo)`,
    );

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(60) NOT NULL UNIQUE,
        descricao varchar(200)
      )
    `);

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".user_permissions (
        user_id uuid NOT NULL REFERENCES "${schemaName}".users(id) ON DELETE CASCADE,
        permission_key varchar(60) NOT NULL,
        PRIMARY KEY (user_id, permission_key)
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON "${schemaName}".user_permissions (user_id)`,
    );

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid,
        action varchar(80) NOT NULL,
        resource_type varchar(60),
        resource_id varchar(80),
        ip varchar(45),
        user_agent text,
        metadata jsonb,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_audit_actor ON "${schemaName}".audit_logs (actor_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_audit_action ON "${schemaName}".audit_logs (action)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_audit_created ON "${schemaName}".audit_logs (criado_em)`,
    );

    // ---- Fase 3: cadastros de apoio + documentos ----

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".budget_units (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo varchar(20),
        nome varchar(200) NOT NULL UNIQUE,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".document_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome varchar(100) NOT NULL UNIQUE,
        descricao varchar(200),
        cor varchar(20) NOT NULL DEFAULT 'blue',
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        module varchar(20) NOT NULL,
        subtype varchar(20),
        doc_caixa varchar(60),
        empenho varchar(60),
        credor varchar(200),
        historico text,
        descricao text,
        budget_unit_id uuid REFERENCES "${schemaName}".budget_units(id),
        document_type_id uuid REFERENCES "${schemaName}".document_types(id),
        document_date date,
        value numeric(15,2),
        competencia varchar(7),
        exercicio integer NOT NULL,
        banco varchar(100),
        agencia varchar(20),
        conta varchar(30),
        original_name varchar(255) NOT NULL,
        file_key varchar(100),
        file_size bigint,
        file_hash char(64),
        status varchar(20) NOT NULL DEFAULT 'disponivel',
        assinatura_status varchar(20) NOT NULL DEFAULT 'nao_assinado',
        assinado_por varchar(300),
        assinatura_verificada_em timestamptz,
        created_by uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid
      )
    `);
    // Colunas de assinatura para schemas de tenants JA provisionados (idempotente).
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS assinatura_status varchar(20) NOT NULL DEFAULT 'nao_assinado',
         ADD COLUMN IF NOT EXISTS assinado_por varchar(300),
         ADD COLUMN IF NOT EXISTS assinatura_verificada_em timestamptz`,
    );
    // Quantidade de paginas do PDF anexado (calculada no attach/upload).
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents ADD COLUMN IF NOT EXISTS paginas integer`,
    );
    // Conferencia por IA: cruza o conteudo do PDF anexado com os dados da
    // etiqueta (valor/credor/doc caixa) e sinaliza divergencias. Assincrono
    // e opcional (so roda se ANTHROPIC_API_KEY estiver configurada). Nome
    // "conferencia" (nao "auditoria") para nao colidir com o AuditService
    // de log de auditoria (apps/api/src/audit) ja existente no sistema.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS conferencia_status varchar(20),
         ADD COLUMN IF NOT EXISTS conferencia_resultado jsonb,
         ADD COLUMN IF NOT EXISTS conferencia_verificada_em timestamptz`,
    );
    // Etiquetas importadas viram despesas pendentes SEM arquivo (status
    // 'aguardando_arquivo'); as colunas de arquivo passam a ser opcionais.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ALTER COLUMN file_key DROP NOT NULL,
         ALTER COLUMN file_size DROP NOT NULL,
         ALTER COLUMN file_hash DROP NOT NULL`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_module ON "${schemaName}".documents (module)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_exercicio ON "${schemaName}".documents (exercicio)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_competencia ON "${schemaName}".documents (competencia)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_unit ON "${schemaName}".documents (budget_unit_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_deleted ON "${schemaName}".documents (deleted_at)`,
    );
    // Busca textual (pg_trgm) em credor/historico/descricao/empenho.
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_credor_trgm
       ON "${schemaName}".documents USING gin (credor gin_trgm_ops)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_historico_trgm
       ON "${schemaName}".documents USING gin (historico gin_trgm_ops)`,
    );

    // ---- Fase 4: importacao de etiquetas ----

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".labels_imports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        formato varchar(10) NOT NULL,
        module varchar(20) NOT NULL,
        original_name varchar(255) NOT NULL,
        file_content text NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pendente',
        total_registros integer NOT NULL DEFAULT 0,
        registros_ok integer NOT NULL DEFAULT 0,
        registros_erro integer NOT NULL DEFAULT 0,
        relatorio_erros jsonb,
        created_by uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        concluido_em timestamptz
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_labels_imports_status ON "${schemaName}".labels_imports (status)`,
    );

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".labels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        import_id uuid NOT NULL REFERENCES "${schemaName}".labels_imports(id) ON DELETE CASCADE,
        module varchar(20) NOT NULL,
        doc_caixa varchar(60) NOT NULL,
        empenho varchar(60) NOT NULL,
        credor varchar(200) NOT NULL,
        valor numeric(15,2),
        data date NOT NULL,
        historico text,
        document_id uuid REFERENCES "${schemaName}".documents(id),
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_labels_import ON "${schemaName}".labels (import_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_labels_empenho ON "${schemaName}".labels (empenho)`,
    );

    // ---- Fase 5: relatorios assincronos ----

    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".report_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo varchar(30) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'pendente',
        params jsonb NOT NULL,
        criado_por uuid REFERENCES "${schemaName}".users(id),
        criado_em timestamptz NOT NULL DEFAULT now(),
        iniciado_em timestamptz,
        concluido_em timestamptz,
        erro_mensagem text,
        total_registros integer DEFAULT 0,
        file_key varchar(100),
        tamanho_bytes bigint DEFAULT 0
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_report_jobs_status_created ON "${schemaName}".report_jobs (status, criado_em)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_report_jobs_criado_por ON "${schemaName}".report_jobs (criado_por)`,
    );

    // ---- Fase 6: Configuracoes ----

    // Orgaos (Secretarias/Camara/etc.) — nivel acima das unidades orcamentarias.
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".orgaos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo varchar(20) NOT NULL,
        descricao varchar(200) NOT NULL,
        exercicio integer NOT NULL,
        importa boolean NOT NULL DEFAULT true,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid REFERENCES "${schemaName}".users(id)
      )
    `);
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orgaos_codigo_exercicio ON "${schemaName}".orgaos (codigo, exercicio) WHERE deleted_at IS NULL`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_orgaos_exercicio ON "${schemaName}".orgaos (exercicio)`,
    );
    // Sigla do cabecalho ASPEC (ex.: CMI, FME) — identifica o orgao quando nao ha CLASSIFICACAO.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".orgaos ADD COLUMN IF NOT EXISTS sigla varchar(20)`,
    );
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orgaos_sigla_exercicio ON "${schemaName}".orgaos (sigla, exercicio) WHERE deleted_at IS NULL AND sigla IS NOT NULL`,
    );

    // Vinculo dos documentos com o orgao (resolvido no import de etiquetas ASPEC
    // via codigo extraido da CLASSIFICACAO). Idempotente p/ tenants ja provisionados.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS orgao_id uuid REFERENCES "${schemaName}".orgaos(id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_orgao ON "${schemaName}".documents (orgao_id)`,
    );

    // Tabela principal de unidades orcamentarias (Secretarias), agora filhas de um orgao.
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".configuracoes_unidades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo varchar(20) UNIQUE,
        nome varchar(200) NOT NULL,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid REFERENCES "${schemaName}".users(id)
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_config_unidades_ativo ON "${schemaName}".configuracoes_unidades (ativo)`,
    );
    // Vinculo com orgaos (idempotente p/ tenants ja provisionados). codigo deixa
    // de ser globalmente unico e passa a ser unico por orgao.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".configuracoes_unidades
         ADD COLUMN IF NOT EXISTS orgao_id uuid REFERENCES "${schemaName}".orgaos(id)`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".configuracoes_unidades DROP CONSTRAINT IF EXISTS configuracoes_unidades_codigo_key`,
    );
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_config_unidades_orgao_codigo ON "${schemaName}".configuracoes_unidades (orgao_id, codigo) WHERE deleted_at IS NULL`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_config_unidades_orgao ON "${schemaName}".configuracoes_unidades (orgao_id)`,
    );

    // Projeto Atividade — catalogo unico solto por exercicio (nao vinculado a unidade,
    // sem distincao de tipo projeto/atividade — e um cadastro so).
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".projetos_atividades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo varchar(30) NOT NULL,
        descricao varchar(300) NOT NULL,
        exercicio integer NOT NULL DEFAULT extract(year from now())::int,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid REFERENCES "${schemaName}".users(id)
      )
    `);
    // Migra tenants ja provisionados: projeto/atividade deixa de pertencer a uma unidade
    // e perde a distincao de tipo (projeto x atividade).
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".projetos_atividades DROP CONSTRAINT IF EXISTS projetos_atividades_unidade_id_fkey`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".projetos_atividades DROP COLUMN IF EXISTS unidade_id`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".projetos_atividades DROP COLUMN IF EXISTS tipo`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".projetos_atividades
         ADD COLUMN IF NOT EXISTS exercicio integer NOT NULL DEFAULT extract(year from now())::int`,
    );
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_projetos_codigo_exercicio ON "${schemaName}".projetos_atividades (codigo, exercicio) WHERE deleted_at IS NULL`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_projetos_exercicio ON "${schemaName}".projetos_atividades (exercicio)`,
    );
    await tx.unsafe(
      `DROP INDEX IF EXISTS "${schemaName}".idx_projetos_tipo`,
    );

    // Dotacoes Orcamentarias vinculadas a unidades
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".dotacoes_orcamentarias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        unidade_id uuid NOT NULL REFERENCES "${schemaName}".configuracoes_unidades(id) ON DELETE CASCADE,
        exercicio integer NOT NULL,
        valor numeric(15,2) NOT NULL,
        descricao text,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid REFERENCES "${schemaName}".users(id)
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_dotacoes_unidade ON "${schemaName}".dotacoes_orcamentarias (unidade_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_dotacoes_exercicio ON "${schemaName}".dotacoes_orcamentarias (exercicio)`,
    );

    // Elementos de Despesa — catalogo solto por exercicio (nao vinculado a unidade).
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".elementos_despesa (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo varchar(20) NOT NULL,
        nome varchar(200) NOT NULL,
        descricao text,
        exercicio integer NOT NULL DEFAULT extract(year from now())::int,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid REFERENCES "${schemaName}".users(id)
      )
    `);
    // Migra tenants ja provisionados: elemento deixa de pertencer a uma unidade.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".elementos_despesa DROP CONSTRAINT IF EXISTS elementos_despesa_unidade_id_fkey`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".elementos_despesa DROP COLUMN IF EXISTS unidade_id`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".elementos_despesa
         ADD COLUMN IF NOT EXISTS exercicio integer NOT NULL DEFAULT extract(year from now())::int`,
    );
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_elementos_codigo_exercicio ON "${schemaName}".elementos_despesa (codigo, exercicio) WHERE deleted_at IS NULL`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_elementos_exercicio ON "${schemaName}".elementos_despesa (exercicio)`,
    );

    // Ordenadores de Despesa vinculados a unidades
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".ordenadores_despesa (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        unidade_id uuid NOT NULL REFERENCES "${schemaName}".configuracoes_unidades(id) ON DELETE CASCADE,
        nome varchar(200) NOT NULL,
        cpf_mascarado varchar(14), -- formato XXX.XXX.XXX-XX
        cargo varchar(200) NOT NULL,
        vigencia_inicio date NOT NULL,
        vigencia_fim date,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        deleted_by uuid REFERENCES "${schemaName}".users(id)
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_ordenadores_unidade ON "${schemaName}".ordenadores_despesa (unidade_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_ordenadores_ativo ON "${schemaName}".ordenadores_despesa (ativo)`,
    );

    // Tenant Settings (customizacao visual/layout)
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".tenant_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        chave varchar(60) NOT NULL UNIQUE,
        valor jsonb NOT NULL,
        descricao varchar(200),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_tenant_settings_chave ON "${schemaName}".tenant_settings (chave)`,
    );
  });

  return schemaName;
}

/**
 * Remove o schema do tenant (uso administrativo / rollback de provisioning).
 * Destrutivo: CASCADE. Chamador deve confirmar a intencao.
 */
export async function dropTenantSchema(sql: Sql, slug: string): Promise<void> {
  const schemaName = schemaNameForSlug(slug);
  assertSafeSchemaName(schemaName);
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
}
