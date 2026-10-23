import type { Sql } from 'postgres';
import { SCHEMA_NAME_REGEX, schemaNameForSlug } from '@jdoc/shared';
import { aplicarMigracoesOrgao } from '../versioned.js';

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
         ADD COLUMN IF NOT EXISTS conferencia_verificada_em timestamptz,
         ADD COLUMN IF NOT EXISTS conferencia_erro varchar(500)`,
    );
    // Etiquetas importadas viram despesas pendentes SEM arquivo (status
    // 'aguardando_arquivo'); as colunas de arquivo passam a ser opcionais.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ALTER COLUMN file_key DROP NOT NULL,
         ALTER COLUMN file_size DROP NOT NULL,
         ALTER COLUMN file_hash DROP NOT NULL`,
    );
    // Arquivos EXTRAS de um documento (alem do "principal", que continua nas
    // colunas file_key/etc. de documents). Cada linha aqui e um PDF a mais,
    // com sua propria assinatura/conferencia por IA independentes.
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".document_files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES "${schemaName}".documents(id) ON DELETE CASCADE,
        file_key varchar(100) NOT NULL,
        original_name varchar(255) NOT NULL,
        file_size bigint NOT NULL,
        file_hash char(64) NOT NULL,
        paginas integer,
        assinatura_status varchar(20) NOT NULL DEFAULT 'nao_assinado',
        assinado_por varchar(300),
        assinatura_verificada_em timestamptz,
        conferencia_status varchar(20),
        conferencia_resultado jsonb,
        conferencia_erro varchar(500),
        conferencia_verificada_em timestamptz,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_document_files_document ON "${schemaName}".document_files (document_id)`,
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

    // Gestao arquivistica: Plano de Classificacao + Tabela de Temporalidade (CONARQ).
    // Classe sem prazos/destinacao = apenas agrupadora (documento usa subclasse).
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".classificacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id uuid REFERENCES "${schemaName}".classificacoes(id),
        codigo varchar(40) NOT NULL UNIQUE,
        descricao varchar(300) NOT NULL,
        nivel integer NOT NULL DEFAULT 1,
        prazo_corrente_anos integer CHECK (prazo_corrente_anos >= 0),
        prazo_intermediario_anos integer CHECK (prazo_intermediario_anos >= 0),
        destinacao varchar(20) CHECK (destinacao IN ('eliminacao', 'guarda_permanente')),
        evento_contagem varchar(20) NOT NULL DEFAULT 'data_documento'
          CHECK (evento_contagem IN ('data_documento', 'fim_exercicio', 'manual')),
        observacoes text,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_classificacoes_parent ON "${schemaName}".classificacoes (parent_id)`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS classificacao_id uuid REFERENCES "${schemaName}".classificacoes(id),
         ADD COLUMN IF NOT EXISTS fase varchar(20) NOT NULL DEFAULT 'corrente',
         ADD COLUMN IF NOT EXISTS nivel_acesso varchar(20) NOT NULL DEFAULT 'publico',
         ADD COLUMN IF NOT EXISTS data_inicio_contagem date,
         ADD COLUMN IF NOT EXISTS data_prevista_transferencia date,
         ADD COLUMN IF NOT EXISTS data_prevista_destinacao date,
         ADD COLUMN IF NOT EXISTS fase_alterada_em timestamptz`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_classificacao ON "${schemaName}".documents (classificacao_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_temporalidade
         ON "${schemaName}".documents (fase, data_prevista_transferencia, data_prevista_destinacao)
         WHERE deleted_at IS NULL`,
    );
    // Acervo (Arquivo Municipal): tipos documentais com metadados configuraveis,
    // classe e nivel de acesso padrao. Tipos existentes continuam em 'outros'.
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".document_types
         ADD COLUMN IF NOT EXISTS modulo varchar(20) NOT NULL DEFAULT 'outros',
         ADD COLUMN IF NOT EXISTS campos jsonb NOT NULL DEFAULT '[]'::jsonb,
         ADD COLUMN IF NOT EXISTS classificacao_id uuid REFERENCES "${schemaName}".classificacoes(id),
         ADD COLUMN IF NOT EXISTS nivel_acesso_padrao varchar(20) NOT NULL DEFAULT 'publico'`,
    );
    // Nome unico POR MODULO: "Contrato" pode existir em Outros Arquivos e no Acervo.
    await tx.unsafe(`ALTER TABLE "${schemaName}".document_types DROP CONSTRAINT IF EXISTS document_types_nome_key`);
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_document_types_modulo_nome ON "${schemaName}".document_types (modulo, nome)`,
    );
    // Metadados do tipo + metadados de digitalizacao (Decreto 10.278/2020, Anexo II).
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
         ADD COLUMN IF NOT EXISTS digitalizado boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS responsavel_digitalizacao varchar(200),
         ADD COLUMN IF NOT EXISTS data_digitalizacao date,
         ADD COLUMN IF NOT EXISTS local_digitalizacao varchar(200)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_metadados ON "${schemaName}".documents USING gin (metadados jsonb_path_ops)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_metadados_trgm
         ON "${schemaName}".documents USING gin ((metadados::text) gin_trgm_ops)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_nivel_acesso ON "${schemaName}".documents (nivel_acesso)`,
    );

    // Busca no conteudo: texto por pagina extraido do PDF (camada de texto ou OCR).
    // O PDF original nunca e alterado (hash e assinatura preservados). tsv e
    // calculado pela API a partir do texto ja sem acento (unaccent nao e
    // IMMUTABLE e nao fica visivel no search_path do tenant).
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".document_textos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES "${schemaName}".documents(id) ON DELETE CASCADE,
        document_file_id uuid REFERENCES "${schemaName}".document_files(id) ON DELETE CASCADE,
        pagina integer NOT NULL,
        texto text NOT NULL,
        tsv tsvector NOT NULL,
        origem varchar(10) NOT NULL DEFAULT 'texto' CHECK (origem IN ('texto', 'ocr')),
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_document_textos_tsv ON "${schemaName}".document_textos USING gin (tsv)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_document_textos_doc ON "${schemaName}".document_textos (document_id, document_file_id)`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS ocr_status varchar(20),
         ADD COLUMN IF NOT EXISTS ocr_erro varchar(500),
         ADD COLUMN IF NOT EXISTS ocr_processado_em timestamptz`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".document_files
         ADD COLUMN IF NOT EXISTS ocr_status varchar(20),
         ADD COLUMN IF NOT EXISTS ocr_erro varchar(500),
         ADD COLUMN IF NOT EXISTS ocr_processado_em timestamptz`,
    );

    // Arquivo fisico: arvore de locais (predio > sala > estante > prateleira > caixa)
    // onde fica o ORIGINAL em papel, e emprestimos de documento/caixa.
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".locais_fisicos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id uuid REFERENCES "${schemaName}".locais_fisicos(id),
        tipo varchar(20) NOT NULL CHECK (tipo IN ('predio', 'sala', 'estante', 'prateleira', 'caixa')),
        codigo varchar(40) NOT NULL,
        descricao varchar(300),
        capacidade integer,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE NULLS NOT DISTINCT (parent_id, tipo, codigo)
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_locais_fisicos_parent ON "${schemaName}".locais_fisicos (parent_id)`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS possui_original_fisico boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS local_fisico_id uuid REFERENCES "${schemaName}".locais_fisicos(id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_local_fisico ON "${schemaName}".documents (local_fisico_id)`,
    );
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".emprestimos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero integer NOT NULL,
        ano integer NOT NULL,
        document_id uuid REFERENCES "${schemaName}".documents(id),
        local_fisico_id uuid REFERENCES "${schemaName}".locais_fisicos(id),
        solicitante_nome varchar(200) NOT NULL,
        solicitante_setor varchar(200) NOT NULL,
        finalidade varchar(500),
        registrado_por uuid,
        data_saida timestamptz NOT NULL DEFAULT now(),
        prazo_devolucao date NOT NULL,
        data_devolucao timestamptz,
        recebido_por uuid,
        observacao_devolucao varchar(500),
        UNIQUE (ano, numero),
        CHECK ((document_id IS NULL) <> (local_fisico_id IS NULL))
      )
    `);
    // No maximo UM emprestimo aberto por documento e por caixa (garantido pelo banco).
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_emprestimo_aberto_doc ON "${schemaName}".emprestimos (document_id)
         WHERE data_devolucao IS NULL AND document_id IS NOT NULL`,
    );
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_emprestimo_aberto_local ON "${schemaName}".emprestimos (local_fisico_id)
         WHERE data_devolucao IS NULL AND local_fisico_id IS NOT NULL`,
    );

    // Eliminacao legal (Resolucao CONARQ n. 40): listagem -> aprovacao da CPAD ->
    // edital de ciencia publicado -> prazo -> termo de eliminacao. O arquivo digital
    // e apagado; metadados e hash de cada documento ficam para sempre (itens).
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".eliminacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero integer NOT NULL,
        ano integer NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'rascunho'
          CHECK (status IN ('rascunho', 'aprovada', 'edital_publicado', 'concluida', 'cancelada')),
        observacoes text,
        comissao jsonb NOT NULL DEFAULT '[]'::jsonb,
        ata_aprovacao varchar(100),
        data_aprovacao date,
        veiculo_publicacao varchar(200),
        data_publicacao_edital date,
        prazo_edital_dias integer NOT NULL DEFAULT 45 CHECK (prazo_edital_dias BETWEEN 30 AND 365),
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        concluida_em timestamptz,
        concluida_por uuid,
        cancelada_em timestamptz,
        cancelada_por uuid,
        motivo_cancelamento varchar(500),
        UNIQUE (ano, numero)
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".eliminacao_itens (
        eliminacao_id uuid NOT NULL REFERENCES "${schemaName}".eliminacoes(id) ON DELETE CASCADE,
        document_id uuid NOT NULL REFERENCES "${schemaName}".documents(id),
        classificacao_codigo varchar(40),
        classificacao_descricao varchar(300),
        descricao text NOT NULL,
        module varchar(20) NOT NULL,
        exercicio integer,
        document_date date,
        local_fisico varchar(500),
        arquivos jsonb NOT NULL DEFAULT '[]'::jsonb,
        PRIMARY KEY (eliminacao_id, document_id)
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_eliminacao_itens_doc ON "${schemaName}".eliminacao_itens (document_id)`,
    );
    await tx.unsafe(
      `ALTER TABLE "${schemaName}".documents
         ADD COLUMN IF NOT EXISTS eliminado_em timestamptz,
         ADD COLUMN IF NOT EXISTS eliminacao_id uuid REFERENCES "${schemaName}".eliminacoes(id)`,
    );

    // Guias de transferencia (corrente -> intermediario) e recolhimento (-> permanente):
    // registro oficial de cada movimentacao de fase, com os itens movidos.
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".guias_arquivisticas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero integer NOT NULL,
        ano integer NOT NULL,
        tipo varchar(20) NOT NULL CHECK (tipo IN ('transferencia', 'recolhimento')),
        observacoes text,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tipo, ano, numero)
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".guia_itens (
        guia_id uuid NOT NULL REFERENCES "${schemaName}".guias_arquivisticas(id) ON DELETE CASCADE,
        document_id uuid NOT NULL REFERENCES "${schemaName}".documents(id),
        PRIMARY KEY (guia_id, document_id)
      )
    `);

    // Integridade (preservacao digital): ultima conferencia do SHA-256 de cada arquivo,
    // execucoes da verificacao e ocorrencias (arquivo alterado/ausente) ate serem tratadas.
    for (const tabela of ['documents', 'document_files']) {
      await tx.unsafe(`
        ALTER TABLE "${schemaName}".${tabela}
          ADD COLUMN IF NOT EXISTS integridade_status varchar(12)
            CHECK (integridade_status IN ('ok', 'divergente', 'ausente')),
          ADD COLUMN IF NOT EXISTS integridade_verificada_em timestamptz
      `);
    }
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_integridade ON "${schemaName}".documents (integridade_verificada_em NULLS FIRST) WHERE file_key IS NOT NULL`,
    );
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".verificacoes_integridade (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        origem varchar(10) NOT NULL CHECK (origem IN ('agendada', 'manual')),
        status varchar(12) NOT NULL DEFAULT 'processando' CHECK (status IN ('processando', 'concluida', 'erro')),
        iniciada_por uuid,
        iniciada_em timestamptz NOT NULL DEFAULT now(),
        concluida_em timestamptz,
        total integer NOT NULL DEFAULT 0,
        ok integer NOT NULL DEFAULT 0,
        divergentes integer NOT NULL DEFAULT 0,
        ausentes integer NOT NULL DEFAULT 0,
        erro text
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".integridade_ocorrencias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        verificacao_id uuid REFERENCES "${schemaName}".verificacoes_integridade(id) ON DELETE SET NULL,
        document_id uuid NOT NULL REFERENCES "${schemaName}".documents(id) ON DELETE CASCADE,
        document_file_id uuid REFERENCES "${schemaName}".document_files(id) ON DELETE CASCADE,
        file_key text NOT NULL,
        tipo varchar(12) NOT NULL CHECK (tipo IN ('divergente', 'ausente')),
        hash_esperado varchar(64) NOT NULL,
        hash_encontrado varchar(64),
        detectada_em timestamptz NOT NULL DEFAULT now(),
        resolvida_em timestamptz,
        resolvida_por uuid,
        observacao text
      )
    `);
    // Uma ocorrencia aberta por arquivo: a verificacao seguinte nao duplica o alerta.
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_integridade_ocorrencia_aberta ON "${schemaName}".integridade_ocorrencias (file_key) WHERE resolvida_em IS NULL`,
    );

    // Atendimento e consultas (LAI): pedido, documentos consultados, prazo e decisao.
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".atendimentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero integer NOT NULL,
        ano integer NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'atendido', 'indeferido', 'cancelado')),
        solicitante_nome varchar(200) NOT NULL,
        solicitante_documento varchar(40),
        solicitante_contato varchar(200),
        vinculo varchar(20) NOT NULL,
        setor_orgao varchar(200),
        canal varchar(20) NOT NULL,
        finalidade text NOT NULL,
        forma_acesso varchar(20) NOT NULL,
        documentos_nao_cadastrados text,
        justificativa_restrito text,
        data_pedido timestamptz NOT NULL DEFAULT now(),
        prazo_final timestamptz NOT NULL,
        prorrogado boolean NOT NULL DEFAULT false,
        justificativa_prorrogacao text,
        resposta text,
        concluido_em timestamptz,
        concluido_por uuid,
        registrado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (ano, numero)
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".atendimento_documentos (
        atendimento_id uuid NOT NULL REFERENCES "${schemaName}".atendimentos(id) ON DELETE CASCADE,
        document_id uuid NOT NULL REFERENCES "${schemaName}".documents(id),
        PRIMARY KEY (atendimento_id, document_id)
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_atendimento_documentos_doc ON "${schemaName}".atendimento_documentos (document_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_atendimentos_abertos ON "${schemaName}".atendimentos (prazo_final) WHERE status = 'aberto'`,
    );

    // Sigilo (LAI): grau vigente no documento + Termos de Classificacao de Informacao (historico).
    await tx.unsafe(`
      ALTER TABLE "${schemaName}".documents
        ADD COLUMN IF NOT EXISTS grau_sigilo varchar(15)
          CHECK (grau_sigilo IN ('reservado', 'secreto', 'ultrassecreto', 'pessoal'))
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".termos_sigilo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero integer NOT NULL,
        ano integer NOT NULL,
        document_id uuid NOT NULL REFERENCES "${schemaName}".documents(id),
        grau varchar(15) NOT NULL CHECK (grau IN ('reservado', 'secreto', 'ultrassecreto', 'pessoal')),
        hipotese varchar(20) NOT NULL,
        fundamento_complemento text,
        razoes text NOT NULL,
        autoridade_nome varchar(200) NOT NULL,
        autoridade_cargo varchar(200) NOT NULL,
        data_producao date NOT NULL,
        data_classificacao date NOT NULL DEFAULT current_date,
        prazo_fim date NOT NULL,
        status varchar(15) NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente', 'desclassificado', 'expirado')),
        nivel_acesso_anterior varchar(20) NOT NULL DEFAULT 'publico',
        encerrado_em timestamptz,
        encerrado_por uuid,
        motivo_encerramento text,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (ano, numero)
      )
    `);
    // Um termo vigente por documento (reclassificar = desclassificar e classificar de novo).
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_termo_sigilo_vigente ON "${schemaName}".termos_sigilo (document_id) WHERE status = 'vigente'`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_termos_sigilo_prazo ON "${schemaName}".termos_sigilo (prazo_fim) WHERE status = 'vigente'`,
    );

    // Dossies e processos: conjunto de documentos com ordem de juntada, encerramento,
    // apensacao e historico de atos. A temporalidade dos documentos juntados conta do encerramento.
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".dossies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo varchar(10) NOT NULL CHECK (tipo IN ('dossie', 'processo')),
        numero varchar(60) NOT NULL,
        assunto varchar(500) NOT NULL,
        interessado varchar(300),
        classificacao_id uuid REFERENCES "${schemaName}".classificacoes(id),
        nivel_acesso varchar(20) NOT NULL DEFAULT 'restrito' CHECK (nivel_acesso IN ('publico', 'restrito')),
        data_abertura date NOT NULL DEFAULT current_date,
        data_encerramento date,
        apensado_a uuid REFERENCES "${schemaName}".dossies(id),
        local_fisico_id uuid REFERENCES "${schemaName}".locais_fisicos(id),
        observacoes text,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tipo, numero)
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".dossie_documentos (
        dossie_id uuid NOT NULL REFERENCES "${schemaName}".dossies(id) ON DELETE CASCADE,
        document_id uuid NOT NULL UNIQUE REFERENCES "${schemaName}".documents(id),
        ordem integer NOT NULL,
        juntado_em timestamptz NOT NULL DEFAULT now(),
        juntado_por uuid,
        PRIMARY KEY (dossie_id, document_id)
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".dossie_eventos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dossie_id uuid NOT NULL REFERENCES "${schemaName}".dossies(id) ON DELETE CASCADE,
        tipo varchar(20) NOT NULL,
        descricao text NOT NULL,
        usuario_id uuid,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_dossie_eventos_dossie ON "${schemaName}".dossie_eventos (dossie_id, criado_em)`,
    );

    // Descricao arquivistica (NOBRADE): arvore de unidades de descricao (acervo > fundo > secao >
    // serie > dossie > item). Os 7 elementos obrigatorios em colunas; os opcionais em jsonb.
    // Documentos e dossies apontam para a unidade que os descreve (serie, dossie, item...).
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".unidades_descricao (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id uuid REFERENCES "${schemaName}".unidades_descricao(id),
        nivel varchar(10) NOT NULL CHECK (nivel IN ('acervo', 'fundo', 'colecao', 'secao', 'subsecao', 'serie', 'subserie', 'dossie', 'item')),
        codigo varchar(40) NOT NULL,
        titulo varchar(500) NOT NULL,
        datas varchar(100),
        dimensao_suporte text,
        produtor varchar(500),
        condicoes_acesso text,
        elementos jsonb NOT NULL DEFAULT '{}'::jsonb,
        pontos_acesso text[] NOT NULL DEFAULT '{}',
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_por uuid,
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Codigo unico entre irmaos (o codigo de referencia completo sai da cadeia).
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_unidades_descricao_codigo ON "${schemaName}".unidades_descricao (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(codigo))`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_unidades_descricao_parent ON "${schemaName}".unidades_descricao (parent_id)`,
    );
    await tx.unsafe(`
      ALTER TABLE "${schemaName}".documents
        ADD COLUMN IF NOT EXISTS unidade_descricao_id uuid REFERENCES "${schemaName}".unidades_descricao(id)
    `);
    await tx.unsafe(`
      ALTER TABLE "${schemaName}".dossies
        ADD COLUMN IF NOT EXISTS unidade_descricao_id uuid REFERENCES "${schemaName}".unidades_descricao(id)
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_documents_unidade_descricao ON "${schemaName}".documents (unidade_descricao_id) WHERE unidade_descricao_id IS NOT NULL`,
    );

    // Legislacao compilada: norma estruturada dispositivo por dispositivo + historico de
    // redacoes dadas por normas posteriores (texto compilado estilo Planalto).
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".normas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL UNIQUE REFERENCES "${schemaName}".documents(id),
        tipo varchar(20) NOT NULL,
        numero varchar(20) NOT NULL,
        ano integer NOT NULL,
        data_publicacao date,
        ementa text NOT NULL,
        situacao varchar(20) NOT NULL DEFAULT 'vigente' CHECK (situacao IN ('vigente', 'alterada', 'revogada_parcial', 'revogada')),
        revogada_total boolean NOT NULL DEFAULT false,
        publicada boolean NOT NULL DEFAULT false,
        revisada_por uuid,
        revisada_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tipo, numero, ano)
      )
    `);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".norma_dispositivos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        norma_id uuid NOT NULL REFERENCES "${schemaName}".normas(id) ON DELETE CASCADE,
        parent_id uuid REFERENCES "${schemaName}".norma_dispositivos(id) ON DELETE CASCADE,
        tipo varchar(12) NOT NULL,
        rotulo varchar(60) NOT NULL,
        ordem double precision NOT NULL,
        texto_original text,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_norma_dispositivos_norma ON "${schemaName}".norma_dispositivos (norma_id, ordem)`,
    );
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".norma_redacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dispositivo_id uuid NOT NULL REFERENCES "${schemaName}".norma_dispositivos(id) ON DELETE CASCADE,
        acao varchar(12) NOT NULL CHECK (acao IN ('redacao', 'revogacao', 'inclusao')),
        texto text,
        norma_alteradora_id uuid NOT NULL REFERENCES "${schemaName}".normas(id),
        vigencia_inicio date NOT NULL,
        criado_por uuid,
        criado_em timestamptz NOT NULL DEFAULT now()
      )
    `);
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_norma_redacoes_disp ON "${schemaName}".norma_redacoes (dispositivo_id, vigencia_inicio)`,
    );
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".norma_relacoes (
        origem_id uuid NOT NULL REFERENCES "${schemaName}".normas(id) ON DELETE CASCADE,
        destino_id uuid NOT NULL REFERENCES "${schemaName}".normas(id) ON DELETE CASCADE,
        tipo varchar(20) NOT NULL CHECK (tipo IN ('altera', 'revoga', 'revoga_parcialmente')),
        criado_em timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (origem_id, destino_id, tipo)
      )
    `);

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

  // Mudancas posteriores ao bloco acima: arquivos versionados em migrations/orgao.
  await aplicarMigracoesOrgao(sql, schemaName);

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
