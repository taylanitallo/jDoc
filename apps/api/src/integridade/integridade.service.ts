import { ConflictException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import {
  INTEGRIDADE_CICLO_DIAS,
  INTEGRIDADE_LOTE_MAX,
  type IntegridadeResumo,
  type OcorrenciaIntegridadeView,
  type TenantAccessClaims,
  type VerificacaoIntegridadeView,
} from '@jdoc/shared';
import { loadEnv } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';

export const INTEGRIDADE_QUEUE = 'integridade';
/** Chave estavel do job repetivel global (reagendar nao duplica). */
const JOB_DIARIO = 'integridade-diaria';
/** Todo dia as 03:30 (horario do servidor): fora do expediente das prefeituras. */
const CRON_DIARIO = '30 3 * * *';

export type IntegridadeJobData =
  | { tipo: 'diaria' }
  | { tipo: 'manual'; schemaName: string; slug: string; verificacaoId: string };

interface ArquivoAlvo {
  document_id: string;
  document_file_id: string | null;
  file_key: string;
  file_hash: string;
}

interface VerificacaoRow {
  id: string;
  origem: 'agendada' | 'manual';
  status: 'processando' | 'concluida' | 'erro';
  iniciada_em: Date;
  concluida_em: Date | null;
  iniciada_por_nome: string | null;
  total: number;
  ok: number;
  divergentes: number;
  ausentes: number;
  erro: string | null;
}

const toVerificacao = (r: VerificacaoRow): VerificacaoIntegridadeView => ({
  id: r.id,
  origem: r.origem,
  status: r.status,
  iniciadaEm: r.iniciada_em.toISOString(),
  concluidaEm: r.concluida_em?.toISOString() ?? null,
  iniciadaPor: r.iniciada_por_nome,
  total: r.total,
  ok: r.ok,
  divergentes: r.divergentes,
  ausentes: r.ausentes,
  erro: r.erro,
});

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Verificacao periodica de integridade (preservacao digital).
 * - Rotativa: todo dia confere ate INTEGRIDADE_LOTE_MAX arquivos cuja ultima
 *   conferencia tem mais de INTEGRIDADE_CICLO_DIAS dias (nunca conferidos primeiro).
 * - Manual ("Verificar agora"): confere os mais antigos, ignorando o ciclo.
 * - Problema vira ocorrencia aberta (uma por arquivo) ate alguem registrar o tratamento;
 *   se o arquivo voltar a conferir (restaurado do backup), a ocorrencia fecha sozinha.
 * So roda para orgaos com o modulo Arquivo, mas confere todos os documentos do orgao.
 */
@Injectable()
export class IntegridadeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegridadeService.name);
  private queue: Queue<IntegridadeJobData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<IntegridadeJobData>(INTEGRIDADE_QUEUE, { connection: this.redis });
    if (env.NODE_ENV !== 'test') {
      await this.queue.add(
        JOB_DIARIO,
        { tipo: 'diaria' },
        { repeat: { pattern: CRON_DIARIO, key: JOB_DIARIO }, jobId: JOB_DIARIO, removeOnComplete: 50, removeOnFail: 50 },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
    await this.redis?.quit();
  }

  // ---------------------------------------------------------------- API (tenant)

  async resumo(): Promise<IntegridadeResumo> {
    const sql = this.sqlTenant();
    const [a] = await sql<Array<{ total: number; no_ciclo: number; nunca: number }>>`
      WITH arquivos AS (
        SELECT integridade_status, integridade_verificada_em FROM documents WHERE file_key IS NOT NULL AND file_hash IS NOT NULL
        UNION ALL
        SELECT integridade_status, integridade_verificada_em FROM document_files
      )
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE integridade_status = 'ok'
                 AND integridade_verificada_em > now() - make_interval(days => ${INTEGRIDADE_CICLO_DIAS})
             )::int AS no_ciclo,
             count(*) FILTER (WHERE integridade_verificada_em IS NULL)::int AS nunca
      FROM arquivos
    `;
    const [o] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM integridade_ocorrencias WHERE resolvida_em IS NULL
    `;
    const ultima = await this.listarVerificacoes(1);
    return {
      totalArquivos: a?.total ?? 0,
      verificadosNoCiclo: a?.no_ciclo ?? 0,
      nuncaVerificados: a?.nunca ?? 0,
      ocorrenciasAbertas: o?.n ?? 0,
      ultimaVerificacao: ultima[0] ?? null,
    };
  }

  async listarVerificacoes(limite = 20): Promise<VerificacaoIntegridadeView[]> {
    const sql = this.sqlTenant();
    const rows = await sql<VerificacaoRow[]>`
      SELECT v.id, v.origem, v.status, v.iniciada_em, v.concluida_em, u.nome AS iniciada_por_nome,
             v.total, v.ok, v.divergentes, v.ausentes, v.erro
      FROM verificacoes_integridade v
      LEFT JOIN users u ON u.id = v.iniciada_por
      ORDER BY v.iniciada_em DESC
      LIMIT ${limite}
    `;
    return rows.map(toVerificacao);
  }

  async listarOcorrencias(
    user: TenantAccessClaims,
    situacao: 'abertas' | 'resolvidas' | 'todas',
  ): Promise<OcorrenciaIntegridadeView[]> {
    const sql = this.sqlTenant();
    const podeVerRestrito = user.role === 'admin' || user.permissions.includes('acervo_restrito:read');
    const filtro =
      situacao === 'abertas' ? sql`o.resolvida_em IS NULL` : situacao === 'resolvidas' ? sql`o.resolvida_em IS NOT NULL` : sql`true`;
    const rows = await sql<
      Array<{
        id: string;
        document_id: string;
        document_file_id: string | null;
        tipo: 'divergente' | 'ausente';
        documento: string;
        nivel_acesso: string | null;
        modulo: string;
        arquivo: string;
        hash_esperado: string;
        hash_encontrado: string | null;
        detectada_em: Date;
        resolvida_em: Date | null;
        resolvida_por_nome: string | null;
        observacao: string | null;
      }>
    >`
      SELECT o.id, o.document_id, o.document_file_id, o.tipo,
             COALESCE(NULLIF(d.descricao, ''), NULLIF(d.historico, ''),
                      CASE WHEN d.doc_caixa IS NOT NULL THEN 'Doc. Caixa ' || d.doc_caixa END, d.original_name) AS documento,
             d.nivel_acesso, d.module AS modulo,
             COALESCE(f.original_name, d.original_name) AS arquivo,
             o.hash_esperado, o.hash_encontrado, o.detectada_em, o.resolvida_em, u.nome AS resolvida_por_nome, o.observacao
      FROM integridade_ocorrencias o
      JOIN documents d ON d.id = o.document_id
      LEFT JOIN document_files f ON f.id = o.document_file_id
      LEFT JOIN users u ON u.id = o.resolvida_por
      WHERE ${filtro}
      ORDER BY o.resolvida_em IS NULL DESC, o.detectada_em DESC
      LIMIT 500
    `;
    return rows.map((r) => {
      // Documento restrito: o alerta aparece (e preciso agir), mas sem revelar o conteudo.
      const oculto = r.nivel_acesso === 'restrito' && !podeVerRestrito;
      return {
        id: r.id,
        documentId: r.document_id,
        documentFileId: r.document_file_id,
        tipo: r.tipo,
        documento: oculto ? 'Documento restrito' : r.documento,
        modulo: r.modulo,
        arquivo: oculto ? '—' : r.arquivo,
        hashEsperado: r.hash_esperado,
        hashEncontrado: r.hash_encontrado,
        detectadaEm: r.detectada_em.toISOString(),
        resolvidaEm: r.resolvida_em?.toISOString() ?? null,
        resolvidaPor: r.resolvida_por_nome,
        observacao: r.observacao,
      };
    });
  }

  /** "Verificar agora": uma execucao por vez por orgao. */
  async iniciarManual(user: TenantAccessClaims, ip: string): Promise<VerificacaoIntegridadeView> {
    const ctx = requireTenantContext();
    const sql = this.sqlTenant();
    const emAndamento = await sql`
      SELECT 1 FROM verificacoes_integridade
      WHERE status = 'processando' AND iniciada_em > now() - interval '6 hours'
    `;
    if (emAndamento.length > 0) throw new ConflictException('Já existe uma verificação em andamento. Aguarde ela terminar.');
    const [v] = await sql<Array<{ id: string }>>`
      INSERT INTO verificacoes_integridade (origem, iniciada_por) VALUES ('manual', ${user.sub}) RETURNING id
    `;
    await this.requireQueue().add(
      'manual',
      { tipo: 'manual', schemaName: ctx.schemaName, slug: ctx.slug, verificacaoId: v!.id },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    await this.audit.logTenant({ actorId: user.sub, action: 'integridade_verificacao_iniciada', resourceType: 'verificacao_integridade', resourceId: v!.id, ip });
    return (await this.listarVerificacoes(1))[0]!;
  }

  async resolverOcorrencia(user: TenantAccessClaims, id: string, observacao: string, ip: string): Promise<void> {
    const sql = this.sqlTenant();
    const rows = await sql`
      UPDATE integridade_ocorrencias
      SET resolvida_em = now(), resolvida_por = ${user.sub}, observacao = ${observacao}
      WHERE id = ${id} AND resolvida_em IS NULL
      RETURNING id
    `;
    if (rows.length === 0) throw new NotFoundException('Ocorrência não encontrada ou já resolvida');
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'integridade_ocorrencia_resolvida',
      resourceType: 'integridade_ocorrencia',
      resourceId: id,
      ip,
      metadata: { observacao },
    });
  }

  // ---------------------------------------------------------------- worker

  /** Job diario: rotativa em cada orgao ativo com o modulo Arquivo. */
  async executarDiaria(): Promise<void> {
    const tenants = await this.db.catalog()<Array<{ slug: string; schema_name: string }>>`
      SELECT slug, schema_name FROM public.tenants
      WHERE status = 'ativo' AND 'arquivo' = ANY(modulos)
    `;
    for (const t of tenants) {
      const sql = this.db.tenant(t.schema_name);
      const [v] = await sql<Array<{ id: string }>>`
        INSERT INTO verificacoes_integridade (origem) VALUES ('agendada') RETURNING id
      `;
      try {
        await this.executar(t.schema_name, t.slug, v!.id, true);
      } catch (e) {
        this.logger.error(`Integridade ${t.slug}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Confere os arquivos e fecha a execucao. `respeitarCiclo`: so os que passaram do ciclo
   * (agendada); senao os mais antigos, qualquer idade (manual).
   */
  async executar(schemaName: string, slug: string, verificacaoId: string, respeitarCiclo: boolean): Promise<void> {
    const sql = this.db.tenant(schemaName);
    const cont = { total: 0, ok: 0, divergentes: 0, ausentes: 0 };
    try {
      const corte = respeitarCiclo ? sql`AND (integridade_verificada_em IS NULL OR integridade_verificada_em < now() - make_interval(days => ${INTEGRIDADE_CICLO_DIAS}))` : sql``;
      const alvos = await sql<ArquivoAlvo[]>`
        SELECT * FROM (
          SELECT id AS document_id, NULL::uuid AS document_file_id, file_key, file_hash, integridade_verificada_em
          FROM documents WHERE file_key IS NOT NULL AND file_hash IS NOT NULL ${corte}
          UNION ALL
          SELECT document_id, id, file_key, file_hash, integridade_verificada_em
          FROM document_files WHERE true ${corte}
        ) a
        ORDER BY integridade_verificada_em NULLS FIRST
        LIMIT ${INTEGRIDADE_LOTE_MAX}
      `;
      for (const alvo of alvos) {
        const status = await this.conferir(slug, alvo);
        cont.total++;
        if (status.tipo === 'ok') cont.ok++;
        else if (status.tipo === 'divergente') cont.divergentes++;
        else cont.ausentes++;
        await this.registrar(sql, verificacaoId, alvo, status);
      }
      await sql`
        UPDATE verificacoes_integridade
        SET status = 'concluida', concluida_em = now(),
            total = ${cont.total}, ok = ${cont.ok}, divergentes = ${cont.divergentes}, ausentes = ${cont.ausentes}
        WHERE id = ${verificacaoId}
      `;
      if (cont.divergentes + cont.ausentes > 0) {
        await sql`
          INSERT INTO audit_logs (action, resource_type, resource_id, metadata)
          VALUES ('integridade_problemas_detectados', 'verificacao_integridade', ${verificacaoId},
                  ${sql.json({ divergentes: cont.divergentes, ausentes: cont.ausentes })})
        `;
      }
    } catch (e) {
      await sql`
        UPDATE verificacoes_integridade
        SET status = 'erro', concluida_em = now(), erro = ${(e as Error).message.slice(0, 500)},
            total = ${cont.total}, ok = ${cont.ok}, divergentes = ${cont.divergentes}, ausentes = ${cont.ausentes}
        WHERE id = ${verificacaoId}
      `;
      throw e;
    }
  }

  /** Baixa e compara. "Ausente" so depois de uma segunda tentativa (evita alarme por falha de rede). */
  private async conferir(slug: string, alvo: ArquivoAlvo): Promise<{ tipo: 'ok' | 'divergente' | 'ausente'; hash: string | null }> {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        const buf = await this.storage.download(slug, alvo.file_key);
        const hash = sha256(buf);
        return { tipo: hash === alvo.file_hash.trim() ? 'ok' : 'divergente', hash };
      } catch (e) {
        if (!(e instanceof NotFoundException) || tentativa === 2) {
          if (e instanceof NotFoundException) return { tipo: 'ausente', hash: null };
          throw e;
        }
        await esperar(1500);
      }
    }
    return { tipo: 'ausente', hash: null };
  }

  private async registrar(
    sql: Sql,
    verificacaoId: string,
    alvo: ArquivoAlvo,
    r: { tipo: 'ok' | 'divergente' | 'ausente'; hash: string | null },
  ): Promise<void> {
    const tabela = alvo.document_file_id ? 'document_files' : 'documents';
    const id = alvo.document_file_id ?? alvo.document_id;
    await sql`
      UPDATE ${sql(tabela)} SET integridade_status = ${r.tipo}, integridade_verificada_em = now() WHERE id = ${id}
    `;
    if (r.tipo === 'ok') {
      // Voltou a conferir (ex.: restaurado do backup): fecha o alerta aberto.
      await sql`
        UPDATE integridade_ocorrencias
        SET resolvida_em = now(), observacao = 'Arquivo voltou a conferir com o hash original na verificação seguinte.'
        WHERE file_key = ${alvo.file_key} AND resolvida_em IS NULL
      `;
      return;
    }
    await sql`
      INSERT INTO integridade_ocorrencias
        (verificacao_id, document_id, document_file_id, file_key, tipo, hash_esperado, hash_encontrado)
      VALUES (${verificacaoId}, ${alvo.document_id}, ${alvo.document_file_id}, ${alvo.file_key}, ${r.tipo},
              ${alvo.file_hash.trim()}, ${r.hash})
      ON CONFLICT (file_key) WHERE resolvida_em IS NULL DO NOTHING
    `;
  }

  private sqlTenant() {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  private requireQueue(): Queue<IntegridadeJobData> {
    if (!this.queue) throw new Error('Fila de integridade indisponivel');
    return this.queue;
  }
}
