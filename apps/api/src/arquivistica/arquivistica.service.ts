import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  MODELO_CLASSIFICACAO,
  MODELO_PADRAO_POR_MODULO,
  SETTING_CLASSIFICACAO_PADRAO,
  TTD_CSV_HEADER,
  classeTemTemporalidade,
  classificacaoPadraoPorModuloSchema,
  classificacaoSchema,
  codigoPai,
  type Classificacao,
  type ClassificacaoPadraoPorModulo,
  type ClassificacaoView,
  type DocModule,
  type NivelAcesso,
  type TemporalidadeItem,
  type TemporalidadeLista,
  type TemporalidadeResumo,
  hojeIso,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { sistemaAtivo } from '../common/sistema.guard';

interface ClassificacaoRow {
  id: string;
  parent_id: string | null;
  codigo: string;
  descricao: string;
  nivel: number;
  prazo_corrente_anos: number | null;
  prazo_intermediario_anos: number | null;
  destinacao: Classificacao['destinacao'];
  evento_contagem: Classificacao['eventoContagem'];
  observacoes: string | null;
  ativo: boolean;
  total_documentos: string;
}

function toClassificacaoView(r: ClassificacaoRow): ClassificacaoView {
  return {
    id: r.id,
    parentId: r.parent_id,
    codigo: r.codigo,
    descricao: r.descricao,
    nivel: r.nivel,
    prazoCorrenteAnos: r.prazo_corrente_anos,
    prazoIntermediarioAnos: r.prazo_intermediario_anos,
    destinacao: r.destinacao,
    eventoContagem: r.evento_contagem,
    observacoes: r.observacoes,
    ativo: r.ativo,
    totalDocumentos: Number(r.total_documentos),
  };
}

/** Descricao legivel do documento para listas/guias (cada modulo guarda o "assunto" num campo diferente). */
export const DESCRICAO_DOC_SQL = `COALESCE(NULLIF(d.descricao, ''), NULLIF(d.historico, ''), d.credor, dt.nome, d.original_name)`;

/** Filtro SQL de cada lista da TTD (comparacao com a data de hoje em Brasilia — sempre atual, sem job de recalculo; o servidor roda em UTC). */
export const LISTA_WHERE: Record<TemporalidadeLista, string> = {
  a_transferir: `d.fase = 'corrente' AND d.data_prevista_transferencia <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
                 AND d.data_prevista_destinacao > (now() AT TIME ZONE 'America/Sao_Paulo')::date`,
  a_eliminar: `d.fase IN ('corrente', 'intermediaria') AND d.data_prevista_destinacao <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
               AND cl.destinacao = 'eliminacao'`,
  a_recolher: `d.fase IN ('corrente', 'intermediaria') AND d.data_prevista_destinacao <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
               AND cl.destinacao = 'guarda_permanente'`,
  sem_classificacao: `d.classificacao_id IS NULL AND d.fase <> 'eliminado'`,
};

/**
 * Dossie/processo se move inteiro: documento que pertence a um conjunto arrasta os
 * demais documentos dele e dos processos apensados (ou ao qual esta apensado).
 */
export async function expandirDossies(tx: Sql, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids;
  const rows = await tx<Array<{ document_id: string }>>`
    WITH raizes AS (
      SELECT DISTINCT COALESCE(ds.apensado_a, ds.id) AS raiz
      FROM dossie_documentos dd JOIN dossies ds ON ds.id = dd.dossie_id
      WHERE dd.document_id = ANY(${ids}::uuid[])
    ), grupo AS (
      SELECT id FROM dossies WHERE id IN (SELECT raiz FROM raizes) OR apensado_a IN (SELECT raiz FROM raizes)
    )
    SELECT document_id FROM dossie_documentos WHERE dossie_id IN (SELECT id FROM grupo)
  `;
  return [...new Set([...ids, ...rows.map((r) => r.document_id)])];
}

export interface AplicarClassificacaoInput {
  module: DocModule;
  /** undefined = classe padrao do modulo; null = sem classe. */
  classificacaoId?: string | null;
  nivelAcesso?: NivelAcesso;
  dataInicioContagem?: Date | null;
}

@Injectable()
export class ArquivisticaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  // ===================== Plano de Classificacao =====================

  async listClassificacoes(incluirInativas: boolean): Promise<ClassificacaoView[]> {
    const sql = this.sql();
    const rows = await sql<ClassificacaoRow[]>`
      SELECT c.id, c.parent_id, c.codigo, c.descricao, c.nivel, c.prazo_corrente_anos,
             c.prazo_intermediario_anos, c.destinacao, c.evento_contagem, c.observacoes, c.ativo,
             (SELECT COUNT(*) FROM documents d WHERE d.classificacao_id = c.id AND d.deleted_at IS NULL)::bigint
               AS total_documentos
      FROM classificacoes c
      WHERE (${incluirInativas} OR c.ativo = true)
      ORDER BY c.codigo ASC
    `;
    return rows.map(toClassificacaoView);
  }

  private async nivelDoPai(sql: Sql, parentId: string | null): Promise<number> {
    if (!parentId) return 1;
    const rows = await sql<Array<{ nivel: number }>>`SELECT nivel FROM classificacoes WHERE id = ${parentId}`;
    if (!rows[0]) throw new BadRequestException('Classe superior nao encontrada');
    return rows[0].nivel + 1;
  }

  async createClassificacao(data: Classificacao, actorId: string, ip: string): Promise<{ id: string }> {
    const sql = this.sql();
    const nivel = await this.nivelDoPai(sql, data.parentId);
    const dup = await sql`SELECT 1 FROM classificacoes WHERE codigo = ${data.codigo}`;
    if (dup.length > 0) throw new ConflictException(`Ja existe classe com o codigo ${data.codigo}`);
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO classificacoes (parent_id, codigo, descricao, nivel, prazo_corrente_anos,
        prazo_intermediario_anos, destinacao, evento_contagem, observacoes, ativo)
      VALUES (${data.parentId}, ${data.codigo}, ${data.descricao}, ${nivel}, ${data.prazoCorrenteAnos},
        ${data.prazoIntermediarioAnos}, ${data.destinacao}, ${data.eventoContagem}, ${data.observacoes},
        ${data.ativo})
      RETURNING id
    `;
    const id = rows[0]!.id;
    await this.audit.logTenant({
      actorId,
      action: 'classificacao_created',
      resourceType: 'classificacao',
      resourceId: id,
      ip,
      metadata: { codigo: data.codigo },
    });
    return { id };
  }

  async updateClassificacao(
    id: string,
    data: Partial<Classificacao>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const sql = this.sql();
    const atual = await sql<ClassificacaoRow[]>`
      SELECT *, 0::bigint AS total_documentos FROM classificacoes WHERE id = ${id}
    `;
    const row = atual[0];
    if (!row) throw new NotFoundException('Classe nao encontrada');
    if (data.parentId === id) throw new BadRequestException('Classe nao pode ser superior de si mesma');
    if (data.codigo && data.codigo !== row.codigo) {
      const dup = await sql`SELECT 1 FROM classificacoes WHERE codigo = ${data.codigo} AND id <> ${id}`;
      if (dup.length > 0) throw new ConflictException(`Ja existe classe com o codigo ${data.codigo}`);
    }
    const parentId = data.parentId === undefined ? row.parent_id : data.parentId;
    const nivel = await this.nivelDoPai(sql, parentId);
    const merged = {
      codigo: data.codigo ?? row.codigo,
      descricao: data.descricao ?? row.descricao,
      prazoCorrenteAnos: data.prazoCorrenteAnos === undefined ? row.prazo_corrente_anos : data.prazoCorrenteAnos,
      prazoIntermediarioAnos:
        data.prazoIntermediarioAnos === undefined ? row.prazo_intermediario_anos : data.prazoIntermediarioAnos,
      destinacao: data.destinacao === undefined ? row.destinacao : data.destinacao,
      eventoContagem: data.eventoContagem ?? row.evento_contagem,
      observacoes: data.observacoes === undefined ? row.observacoes : data.observacoes,
      ativo: data.ativo ?? row.ativo,
    };

    await sql.begin(async (tx) => {
      await tx`
        UPDATE classificacoes SET
          parent_id = ${parentId}, codigo = ${merged.codigo}, descricao = ${merged.descricao},
          nivel = ${nivel}, prazo_corrente_anos = ${merged.prazoCorrenteAnos},
          prazo_intermediario_anos = ${merged.prazoIntermediarioAnos}, destinacao = ${merged.destinacao},
          evento_contagem = ${merged.eventoContagem}, observacoes = ${merged.observacoes},
          ativo = ${merged.ativo}, atualizado_em = now()
        WHERE id = ${id}
      `;
      // Mudou a TTD da classe = recalcula os prazos de todos os documentos dela.
      await this.recalcularPrazos(tx as unknown as Sql, tx`d.classificacao_id = ${id}`);
    });

    await this.audit.logTenant({
      actorId,
      action: 'classificacao_updated',
      resourceType: 'classificacao',
      resourceId: id,
      ip,
      metadata: {
        antes: {
          codigo: row.codigo,
          prazoCorrenteAnos: row.prazo_corrente_anos,
          prazoIntermediarioAnos: row.prazo_intermediario_anos,
          destinacao: row.destinacao,
          eventoContagem: row.evento_contagem,
        },
        depois: merged,
      },
    });
  }

  /** Classe com documentos ou subclasses nunca e apagada — so inativada (preserva historico). */
  async deleteClassificacao(id: string, actorId: string, ip: string): Promise<{ inativada: boolean }> {
    const sql = this.sql();
    const uso = await sql<Array<{ docs: string; filhos: string }>>`
      SELECT (SELECT COUNT(*) FROM documents WHERE classificacao_id = ${id})::bigint AS docs,
             (SELECT COUNT(*) FROM classificacoes WHERE parent_id = ${id})::bigint AS filhos
    `;
    const emUso = Number(uso[0]?.docs ?? 0) > 0 || Number(uso[0]?.filhos ?? 0) > 0;
    if (emUso) {
      await sql`UPDATE classificacoes SET ativo = false, atualizado_em = now() WHERE id = ${id}`;
    } else {
      const del = await sql`DELETE FROM classificacoes WHERE id = ${id} RETURNING id`;
      if (del.length === 0) throw new NotFoundException('Classe nao encontrada');
    }
    await this.audit.logTenant({
      actorId,
      action: emUso ? 'classificacao_inativada' : 'classificacao_deleted',
      resourceType: 'classificacao',
      resourceId: id,
      ip,
    });
    return { inativada: emUso };
  }

  /**
   * Upsert por codigo de uma lista de classes (modelo base ou CSV). Pais sao
   * resolvidos pelo codigo, na ordem hierarquica. Classes existentes tem so a
   * TTD atualizada; nada e apagado.
   */
  private async upsertClasses(
    sql: Sql,
    classes: ReadonlyArray<Omit<Classificacao, 'id' | 'parentId' | 'ativo'>>,
  ): Promise<{ criadas: number; atualizadas: number }> {
    // Codigos tem grupos com zeros a esquerda: ordem textual poe todo pai antes dos filhos.
    const ordenadas = [...classes].sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
    let criadas = 0;
    let atualizadas = 0;
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const existentes = await tx<Array<{ id: string; codigo: string; nivel: number }>>`
        SELECT id, codigo, nivel FROM classificacoes
      `;
      const porCodigo = new Map(existentes.map((e) => [e.codigo, e]));
      for (const c of ordenadas) {
        const paiCodigo = codigoPai(c.codigo, new Set(porCodigo.keys()));
        const pai = paiCodigo ? porCodigo.get(paiCodigo) : undefined;
        const nivel = pai ? pai.nivel + 1 : 1;
        const atual = porCodigo.get(c.codigo);
        if (atual) {
          await tx`
            UPDATE classificacoes SET descricao = ${c.descricao}, prazo_corrente_anos = ${c.prazoCorrenteAnos},
              prazo_intermediario_anos = ${c.prazoIntermediarioAnos}, destinacao = ${c.destinacao},
              evento_contagem = ${c.eventoContagem}, observacoes = ${c.observacoes}, atualizado_em = now()
            WHERE id = ${atual.id}
          `;
          atualizadas++;
        } else {
          const rows = await tx<Array<{ id: string }>>`
            INSERT INTO classificacoes (parent_id, codigo, descricao, nivel, prazo_corrente_anos,
              prazo_intermediario_anos, destinacao, evento_contagem, observacoes)
            VALUES (${pai?.id ?? null}, ${c.codigo}, ${c.descricao}, ${nivel}, ${c.prazoCorrenteAnos},
              ${c.prazoIntermediarioAnos}, ${c.destinacao}, ${c.eventoContagem}, ${c.observacoes})
            RETURNING id
          `;
          porCodigo.set(c.codigo, { id: rows[0]!.id, codigo: c.codigo, nivel });
          criadas++;
        }
      }
      await this.recalcularPrazos(tx, tx`d.classificacao_id IS NOT NULL`);
    });
    return { criadas, atualizadas };
  }

  /** Carrega o modelo base (so se o plano estiver vazio) e define as classes padrao dos modulos financeiros. */
  async carregarModelo(actorId: string, ip: string): Promise<{ criadas: number }> {
    const sql = this.sql();
    const count = await sql<Array<{ n: string }>>`SELECT COUNT(*)::bigint AS n FROM classificacoes`;
    if (Number(count[0]?.n ?? 0) > 0) {
      throw new ConflictException('O plano de classificacao ja possui classes. Use a importacao CSV para complementar.');
    }
    const { criadas } = await this.upsertClasses(sql, MODELO_CLASSIFICACAO);
    const ids = await sql<Array<{ id: string; codigo: string }>>`SELECT id, codigo FROM classificacoes`;
    const porCodigo = new Map(ids.map((r) => [r.codigo, r.id]));
    const padroes: ClassificacaoPadraoPorModulo = {};
    for (const [mod, codigo] of Object.entries(MODELO_PADRAO_POR_MODULO)) {
      (padroes as Record<string, string | null>)[mod] = porCodigo.get(codigo) ?? null;
    }
    await this.salvarPadroes(sql, padroes);
    await this.audit.logTenant({
      actorId,
      action: 'classificacao_modelo_carregado',
      resourceType: 'classificacao',
      ip,
      metadata: { criadas },
    });
    return { criadas };
  }

  async exportarCsv(): Promise<string> {
    const classes = await this.listClassificacoes(false);
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v);
      // Neutraliza injecao de formula em planilha (=, +, -, @) e escapa aspas/separador.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[;"\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const linhas = classes.map((c) =>
      [c.codigo, c.descricao, c.prazoCorrenteAnos, c.prazoIntermediarioAnos, c.destinacao, c.eventoContagem, c.observacoes]
        .map(esc)
        .join(';'),
    );
    return [TTD_CSV_HEADER.join(';'), ...linhas].join('\n');
  }

  /** Importa CSV (mesmo layout do export). Valida TUDO antes de gravar — qualquer linha invalida aborta. */
  async importarCsv(conteudo: string, actorId: string, ip: string): Promise<{ criadas: number; atualizadas: number }> {
    const linhas = (conteudo.charCodeAt(0) === 0xfeff ? conteudo.slice(1) : conteudo).split(/\r?\n/).filter((l) => l.trim() !== '');
    if (linhas.length < 2) throw new BadRequestException('CSV vazio');
    const header = parseCsvLine(linhas[0]!).map((h) => h.trim().toLowerCase());
    if (header.join(';') !== TTD_CSV_HEADER.join(';')) {
      throw new BadRequestException(`Cabecalho invalido. Esperado: ${TTD_CSV_HEADER.join(';')}`);
    }
    const erros: string[] = [];
    const classes: Array<Omit<Classificacao, 'id' | 'parentId' | 'ativo'>> = [];
    const vistos = new Set<string>();
    linhas.slice(1).forEach((linha, i) => {
      const [codigo, descricao, pc, pi, destinacao, evento, obs] = parseCsvLine(linha).map((v) => v.trim());
      const num = (v: string | undefined): number | null => (v ? Number(v) : null);
      const parsed = classificacaoSchema.safeParse({
        codigo,
        descricao,
        prazoCorrenteAnos: num(pc),
        prazoIntermediarioAnos: num(pi),
        destinacao: destinacao || null,
        eventoContagem: evento || 'data_documento',
        observacoes: obs || null,
      });
      if (!parsed.success) {
        erros.push(`Linha ${i + 2}: ${parsed.error.issues.map((x) => x.message).join(', ')}`);
        return;
      }
      if (vistos.has(parsed.data.codigo)) {
        erros.push(`Linha ${i + 2}: codigo ${parsed.data.codigo} repetido`);
        return;
      }
      vistos.add(parsed.data.codigo);
      const { id: _id, parentId: _p, ativo: _a, ...resto } = parsed.data;
      classes.push(resto);
    });
    if (erros.length > 0) throw new BadRequestException(erros.slice(0, 20).join(' | '));
    const r = await this.upsertClasses(this.sql(), classes);
    await this.audit.logTenant({
      actorId,
      action: 'classificacao_csv_importado',
      resourceType: 'classificacao',
      ip,
      metadata: r,
    });
    return r;
  }

  // ===================== Classe padrao por modulo =====================

  private async salvarPadroes(sql: Sql, padroes: ClassificacaoPadraoPorModulo): Promise<void> {
    await sql`
      INSERT INTO tenant_settings (chave, valor) VALUES (${SETTING_CLASSIFICACAO_PADRAO}, ${sql.json(padroes as never)})
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()
    `;
  }

  async getPadroes(): Promise<ClassificacaoPadraoPorModulo> {
    const sql = this.sql();
    const rows = await sql<Array<{ valor: unknown }>>`
      SELECT valor FROM tenant_settings WHERE chave = ${SETTING_CLASSIFICACAO_PADRAO}
    `;
    const raw = rows[0]?.valor;
    const val = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    const parsed = classificacaoPadraoPorModuloSchema.safeParse(val ?? {});
    return parsed.success ? parsed.data : {};
  }

  async setPadroes(padroes: ClassificacaoPadraoPorModulo, actorId: string, ip: string): Promise<void> {
    const sql = this.sql();
    for (const id of Object.values(padroes)) {
      if (id) await this.assertClasseUtilizavel(sql, id);
    }
    await this.salvarPadroes(sql, padroes);
    await this.audit.logTenant({
      actorId,
      action: 'classificacao_padroes_updated',
      resourceType: 'tenant_settings',
      ip,
      metadata: padroes as Record<string, unknown>,
    });
  }

  private async assertClasseUtilizavel(sql: Sql, id: string): Promise<void> {
    const rows = await sql<
      Array<Pick<ClassificacaoRow, 'ativo' | 'prazo_corrente_anos' | 'prazo_intermediario_anos' | 'destinacao'>>
    >`SELECT ativo, prazo_corrente_anos, prazo_intermediario_anos, destinacao FROM classificacoes WHERE id = ${id}`;
    const c = rows[0];
    if (!c || !c.ativo) throw new BadRequestException('Classe de classificacao invalida ou inativa');
    if (
      !classeTemTemporalidade({
        prazoCorrenteAnos: c.prazo_corrente_anos,
        prazoIntermediarioAnos: c.prazo_intermediario_anos,
        destinacao: c.destinacao,
      })
    ) {
      throw new BadRequestException('Classe apenas agrupadora — escolha uma subclasse com temporalidade definida');
    }
  }

  // ===================== Aplicacao aos documentos =====================

  /**
   * Recalcula os prazos da TTD em SQL (equivalente a calcularPrazos() de
   * @jdoc/shared, que roda no front para preview). Soma de anos em duas etapas
   * (corrente, depois intermediario) para bater com a funcao JS em 29/02.
   * Evento manual preserva a data de inicio informada.
   */
  async recalcularPrazos(sql: Sql, filtro: ReturnType<Sql>): Promise<void> {
    await sql`
      WITH calc AS (
        SELECT d.id,
               CASE
                 -- Juntado a dossie/processo: conta do encerramento do conjunto (do principal, se apensado);
                 -- aberto = sem prazo (nao entra nas listas de transferencia/eliminacao).
                 WHEN ds.id IS NOT NULL THEN CASE WHEN ds.apensado_a IS NOT NULL THEN dp.data_encerramento ELSE ds.data_encerramento END
                 ELSE CASE cl.evento_contagem
                   WHEN 'data_documento' THEN COALESCE(d.document_date, make_date(d.exercicio, 12, 31))
                   WHEN 'fim_exercicio' THEN make_date(d.exercicio, 12, 31)
                   ELSE d.data_inicio_contagem
                 END
               END AS inicio,
               (cl.prazo_corrente_anos IS NOT NULL AND cl.prazo_intermediario_anos IS NOT NULL
                AND cl.destinacao IS NOT NULL) AS tem_ttd,
               cl.prazo_corrente_anos AS pc, cl.prazo_intermediario_anos AS pi
        FROM documents d
        JOIN classificacoes cl ON cl.id = d.classificacao_id
        LEFT JOIN dossie_documentos dd ON dd.document_id = d.id
        LEFT JOIN dossies ds ON ds.id = dd.dossie_id
        LEFT JOIN dossies dp ON dp.id = ds.apensado_a
        WHERE ${filtro}
      )
      UPDATE documents d SET
        data_inicio_contagem = c.inicio,
        data_prevista_transferencia = CASE WHEN c.tem_ttd AND c.inicio IS NOT NULL
          THEN (c.inicio + make_interval(years => c.pc))::date END,
        data_prevista_destinacao = CASE WHEN c.tem_ttd AND c.inicio IS NOT NULL
          THEN ((c.inicio + make_interval(years => c.pc))::date + make_interval(years => c.pi))::date END
      FROM calc c
      WHERE d.id = c.id
    `;
  }

  /** Chamado pelo DocumentsService apos criar/editar: resolve a classe e grava prazos. */
  async aplicarAoDocumento(documentId: string, input: AplicarClassificacaoInput): Promise<void> {
    // So com o modulo Arquivo contratado ha gestao arquivistica (integracao com o financeiro).
    if (!sistemaAtivo('arquivo')) return;
    const sql = this.sql();
    let classeId: string | null;
    if (input.classificacaoId === undefined) {
      const padroes = await this.getPadroes();
      classeId = (padroes as Record<string, string | null | undefined>)[input.module] ?? null;
    } else {
      classeId = input.classificacaoId;
    }
    if (classeId && input.classificacaoId !== undefined) {
      // So valida quando a classe MUDA — classe inativada depois nao trava edicao de outros campos.
      const atual = await sql<Array<{ classificacao_id: string | null }>>`
        SELECT classificacao_id FROM documents WHERE id = ${documentId}
      `;
      if (atual[0]?.classificacao_id !== classeId) await this.assertClasseUtilizavel(sql, classeId);
    }

    await sql`
      UPDATE documents SET
        classificacao_id = ${classeId},
        nivel_acesso = COALESCE(${input.nivelAcesso ?? null}, nivel_acesso),
        data_inicio_contagem = ${input.dataInicioContagem === undefined ? sql`data_inicio_contagem` : input.dataInicioContagem},
        data_prevista_transferencia = NULL,
        data_prevista_destinacao = NULL
      WHERE id = ${documentId}
    `;
    if (classeId) await this.recalcularPrazos(sql, sql`d.id = ${documentId}`);
  }

  /** Recalcula so os prazos (ex.: data do documento/exercicio mudou), mantendo a classe. */
  async recalcularDocumento(documentId: string): Promise<void> {
    if (!sistemaAtivo('arquivo')) return;
    const sql = this.sql();
    await this.recalcularPrazos(sql, sql`d.id = ${documentId}`);
  }

  /** Aplica a classe padrao do modulo a todos os documentos ainda sem classificacao (legado/etiquetas importadas). */
  async aplicarPadraoEmLote(actorId: string, ip: string): Promise<{ atualizados: number }> {
    const sql = this.sql();
    const padroes = await this.getPadroes();
    let atualizados = 0;
    for (const [module, classeId] of Object.entries(padroes)) {
      if (!classeId) continue;
      const rows = await sql<Array<{ id: string }>>`
        UPDATE documents SET classificacao_id = ${classeId}
        WHERE module = ${module} AND classificacao_id IS NULL AND deleted_at IS NULL AND fase <> 'eliminado'
        RETURNING id
      `;
      if (rows.length > 0) {
        await this.recalcularPrazos(sql, sql`d.id = ANY(${rows.map((r) => r.id)})`);
        atualizados += rows.length;
      }
    }
    await this.audit.logTenant({
      actorId,
      action: 'classificacao_padrao_em_lote',
      resourceType: 'document',
      ip,
      metadata: { atualizados },
    });
    return { atualizados };
  }

  // ===================== Temporalidade =====================

  async resumo(): Promise<TemporalidadeResumo> {
    const sql = this.sql();
    const count = (lista: TemporalidadeLista) => sql.unsafe(`
      SELECT COUNT(*)::bigint AS n FROM documents d
      LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
      WHERE d.deleted_at IS NULL AND ${LISTA_WHERE[lista]}
    `);
    const [t, e, r, s, total] = await Promise.all([
      count('a_transferir'),
      count('a_eliminar'),
      count('a_recolher'),
      count('sem_classificacao'),
      sql`SELECT COUNT(*)::bigint AS n FROM documents WHERE deleted_at IS NULL AND fase <> 'eliminado'`,
    ]);
    const n = (rows: ReadonlyArray<Record<string, unknown>>): number => Number(rows[0]?.n ?? 0);
    return { aTransferir: n(t), aEliminar: n(e), aRecolher: n(r), semClassificacao: n(s), totalAtivos: n(total) };
  }

  async lista(
    lista: TemporalidadeLista,
    page: number,
    pageSize: number,
  ): Promise<{ items: TemporalidadeItem[]; total: number }> {
    const sql = this.sql();
    const offset = (page - 1) * pageSize;
    // LISTA_WHERE e constante do codigo (nunca entrada do usuario); paginacao vai por bind.
    const rows = await sql.unsafe(
      `SELECT d.id, d.module, ${DESCRICAO_DOC_SQL} AS descricao, cl.codigo AS classificacao_codigo,
              cl.descricao AS classificacao_descricao, d.document_date, d.exercicio, d.fase,
              d.data_prevista_transferencia, d.data_prevista_destinacao
       FROM documents d
       LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.deleted_at IS NULL AND ${LISTA_WHERE[lista]}
       ORDER BY d.data_prevista_destinacao ASC NULLS LAST, d.data_prevista_transferencia ASC NULLS LAST, d.id
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    const total = await sql.unsafe(
      `SELECT COUNT(*)::bigint AS n FROM documents d
       LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
       WHERE d.deleted_at IS NULL AND ${LISTA_WHERE[lista]}`,
    );
    const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString().slice(0, 10) : null);
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        module: r.module as string,
        descricao: (r.descricao as string) ?? '',
        classificacaoCodigo: (r.classificacao_codigo as string | null) ?? null,
        classificacaoDescricao: (r.classificacao_descricao as string | null) ?? null,
        documentDate: iso(r.document_date),
        exercicio: r.exercicio as number,
        fase: r.fase as TemporalidadeItem['fase'],
        dataPrevistaTransferencia: iso(r.data_prevista_transferencia),
        dataPrevistaDestinacao: iso(r.data_prevista_destinacao),
      })),
      total: Number(total[0]?.n ?? 0),
    };
  }

  /**
   * Transferencia (corrente -> intermediaria) ou recolhimento (-> permanente).
   * So aceita documentos que estao de fato na lista correspondente — nada de
   * antecipar prazo pela API. Gera guia numerada por ano.
   */
  async movimentar(
    tipo: 'transferencia' | 'recolhimento',
    ids: string[],
    observacoes: string | null,
    actorId: string,
    ip: string,
  ): Promise<{ guiaId: string; numero: number; ano: number; total: number }> {
    const sql = this.sql();
    const lista: TemporalidadeLista = tipo === 'transferencia' ? 'a_transferir' : 'a_recolher';
    const ano = Number(hojeIso().slice(0, 4));

    const result = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      ids = await expandirDossies(tx, ids);
      const elegiveis = await tx.unsafe(
        `SELECT d.id FROM documents d
         LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
         WHERE d.deleted_at IS NULL AND d.id = ANY($1::uuid[]) AND ${LISTA_WHERE[lista]}
         FOR UPDATE OF d`,
        [ids],
      );
      if (elegiveis.length !== ids.length) {
        throw new BadRequestException(
          `${ids.length - elegiveis.length} documento(s) nao estao aptos para ${tipo} (prazo nao vencido ou fase diferente)`,
        );
      }
      // Serializa a numeracao da guia por tipo/ano dentro do tenant.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`guia:${tipo}:${ano}`}))`;
      const prox = await tx<Array<{ n: number }>>`
        SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM guias_arquivisticas WHERE tipo = ${tipo} AND ano = ${ano}
      `;
      const numero = prox[0]!.n;
      const guia = await tx<Array<{ id: string }>>`
        INSERT INTO guias_arquivisticas (numero, ano, tipo, observacoes, criado_por)
        VALUES (${numero}, ${ano}, ${tipo}, ${observacoes}, ${actorId})
        RETURNING id
      `;
      const guiaId = guia[0]!.id;
      await tx`
        INSERT INTO guia_itens (guia_id, document_id)
        SELECT ${guiaId}, unnest(${ids}::uuid[])
      `;
      await tx`
        UPDATE documents SET fase = ${tipo === 'transferencia' ? 'intermediaria' : 'permanente'},
          fase_alterada_em = now(), atualizado_em = now()
        WHERE id = ANY(${ids}::uuid[])
      `;
      return { guiaId, numero, ano, total: ids.length };
    });

    await this.audit.logTenant({
      actorId,
      action: tipo === 'transferencia' ? 'documentos_transferidos' : 'documentos_recolhidos',
      resourceType: 'guia_arquivistica',
      resourceId: result.guiaId,
      ip,
      metadata: { numero: result.numero, ano: result.ano, total: result.total, ids },
    });
    return result;
  }

  async listGuias(): Promise<
    Array<{ id: string; numero: number; ano: number; tipo: string; total: number; criadoEm: string; criadoPor: string | null }>
  > {
    const sql = this.sql();
    const rows = await sql<
      Array<{ id: string; numero: number; ano: number; tipo: string; total: string; criado_em: Date; criado_por_nome: string | null }>
    >`
      SELECT g.id, g.numero, g.ano, g.tipo, g.criado_em, u.nome AS criado_por_nome,
             (SELECT COUNT(*) FROM guia_itens gi WHERE gi.guia_id = g.id)::bigint AS total
      FROM guias_arquivisticas g
      LEFT JOIN users u ON u.id = g.criado_por
      ORDER BY g.criado_em DESC
      LIMIT 200
    `;
    return rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      ano: r.ano,
      tipo: r.tipo,
      total: Number(r.total),
      criadoEm: r.criado_em.toISOString(),
      criadoPor: r.criado_por_nome,
    }));
  }

  async guiaPdf(guiaId: string): Promise<{ pdf: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const sql = this.sql();
    const guias = await sql<
      Array<{ numero: number; ano: number; tipo: string; observacoes: string | null; criado_em: Date; criado_por_nome: string | null }>
    >`
      SELECT g.numero, g.ano, g.tipo, g.observacoes, g.criado_em, u.nome AS criado_por_nome
      FROM guias_arquivisticas g LEFT JOIN users u ON u.id = g.criado_por
      WHERE g.id = ${guiaId}
    `;
    const g = guias[0];
    if (!g) throw new NotFoundException('Guia nao encontrada');
    const itens = await sql.unsafe(
      `SELECT cl.codigo, ${DESCRICAO_DOC_SQL} AS descricao, d.document_date, d.exercicio, d.module
       FROM guia_itens gi
       JOIN documents d ON d.id = gi.document_id
       LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE gi.guia_id = $1
       ORDER BY cl.codigo NULLS LAST, d.exercicio, d.document_date`,
      [guiaId],
    );

    const titulo = g.tipo === 'transferencia' ? 'GUIA DE TRANSFERÊNCIA' : 'GUIA DE RECOLHIMENTO';
    const destino =
      g.tipo === 'transferencia' ? 'Arquivo Corrente → Arquivo Intermediário' : 'Arquivo Intermediário → Arquivo Permanente';
    const numeroFmt = `${String(g.numero).padStart(3, '0')}/${g.ano}`;

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFKitDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const col = { cod: 40, desc: 100, data: 400, ex: 470, mod: 510 };
      const pageBottom = doc.page.height - doc.page.margins.bottom;
      const cabecalhoTabela = (): void => {
        doc.font('Helvetica-Bold').fontSize(8);
        const y = doc.y;
        doc.text('Classe', col.cod, y, { width: 55 });
        doc.text('Documento', col.desc, y, { width: 290 });
        doc.text('Data', col.data, y, { width: 65 });
        doc.text('Exerc.', col.ex, y, { width: 40 });
        doc.text('Módulo', col.mod, y, { width: 50 });
        doc.moveDown(0.4);
        doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#999999').stroke();
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(8);
      };

      doc.fontSize(11).font('Helvetica-Bold').text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(14).text(`${titulo} Nº ${numeroFmt}`, { align: 'center' });
      doc.fontSize(9).font('Helvetica').text(destino, { align: 'center' });
      doc.moveDown(0.8);
      doc.fontSize(9).text(`Data: ${g.criado_em.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
      doc.text(`Responsável pelo registro: ${g.criado_por_nome ?? '—'}`);
      doc.text(`Quantidade de documentos: ${itens.length}`);
      if (g.observacoes) doc.text(`Observações: ${g.observacoes}`);
      doc.moveDown(0.8);
      cabecalhoTabela();

      for (const it of itens) {
        const descricao = String(it.descricao ?? '—');
        const h = doc.heightOfString(descricao, { width: 290 });
        if (doc.y + h > pageBottom - 20) {
          doc.addPage();
          cabecalhoTabela();
        }
        const y = doc.y;
        const data = it.document_date instanceof Date ? it.document_date.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
        doc.text(String(it.codigo ?? '—'), col.cod, y, { width: 55 });
        doc.text(descricao, col.desc, y, { width: 290 });
        doc.text(data, col.data, y, { width: 65 });
        doc.text(String(it.exercicio), col.ex, y, { width: 40 });
        doc.text(String(it.module), col.mod, y, { width: 50 });
        doc.y = y + Math.max(h, 10) + 3;
      }

      if (doc.y > pageBottom - 110) doc.addPage();
      doc.moveDown(4);
      const yAss = doc.y;
      doc.moveTo(60, yAss).lineTo(260, yAss).strokeColor('#000000').stroke();
      doc.moveTo(335, yAss).lineTo(535, yAss).stroke();
      doc.fontSize(8).text('Responsável pela entrega', 60, yAss + 4, { width: 200, align: 'center' });
      doc.text('Responsável pelo recebimento', 335, yAss + 4, { width: 200, align: 'center' });
      doc.end();
    });
    return { pdf, nome: `${g.tipo}-${g.numero}-${g.ano}.pdf` };
  }
}

/** Parser CSV minimo (separador ';', aspas duplas com escape ""). */
function parseCsvLine(linha: string): string[] {
  const out: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (ch === '"') {
        aspas = false;
      } else {
        atual += ch;
      }
    } else if (ch === '"') {
      aspas = true;
    } else if (ch === ';') {
      out.push(atual);
      atual = '';
    } else {
      atual += ch;
    }
  }
  out.push(atual);
  return out.map((v) => (v.startsWith("'") && /^'[=+\-@]/.test(v) ? v.slice(1) : v));
}
