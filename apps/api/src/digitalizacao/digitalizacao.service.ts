import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Sql } from 'postgres';
import {
  CHECKLIST_QC,
  etapasPermitidas,
  protocoloLote,
  type AvancarEtapaInput,
  type EtapaLote,
  type EventoLoteView,
  type ItemLoteInput,
  type ItemLoteUpdateInput,
  type ItemLoteView,
  type LoteCreateInput,
  type LoteDetalheView,
  type LoteResumoView,
  type LotesQuery,
  type LoteUpdateInput,
  type NaoConformidadeView,
  type PlanoInput,
  type PlanoView,
  type ProducaoQuery,
  type ProducaoResumo,
  type QcInput,
  type QcView,
  type TenantAccessClaims,
  type VerificacaoAutomaticaLote,
  hojeIso,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { filtroLotacao, lotacaoDe } from '../common/acesso-documento';

/** Quem pode aprovar plano e dar o aceite: admin ou fiscal_contrato:update. */
export function ehFiscal(user: TenantAccessClaims): boolean {
  return user.role === 'admin' || user.permissions.includes('fiscal_contrato:update');
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const isoDia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Nome da secretaria pelo codigo (cadastro de orgaos do exercicio mais recente). */
const NOME_ORGAO = (col: string) =>
  `(SELECT o.descricao FROM orgaos o WHERE o.codigo = ${col} AND o.deleted_at IS NULL ORDER BY o.exercicio DESC LIMIT 1)`;

interface LoteRow {
  id: string;
  numero: number;
  ano: number;
  plano_id: string | null;
  plano_titulo: string | null;
  orgao_codigo: string | null;
  orgao_nome: string | null;
  descricao: string;
  setor_origem: string | null;
  responsavel_entrega: string | null;
  etapa: EtapaLote;
  caixas: number;
  paginas_estimadas: number | null;
  amostragem_pct: number;
  estado_conservacao: LoteDetalheView['estadoConservacao'];
  sigiloso: boolean;
  fragil: boolean;
  grande_formato: boolean;
  contaminado: boolean;
  observacoes: string | null;
  aceite_por_nome: string | null;
  aceite_em: Date | null;
  aceite_ip: string | null;
  aceite_observacao: string | null;
  paginas_aceitas: number | null;
  criado_por_nome: string | null;
  criado_em: Date;
  documentos: number;
  paginas: number;
  nc_abertas: number;
}

/**
 * Servico de digitalizacao. Regras:
 * - etapas so andam na ordem (etapasPermitidas); do controle de qualidade so se
 *   sai para "disponibilizado" pelo aceite do fiscal, ou volta para retrabalho;
 * - o aceite exige o ultimo controle de qualidade aprovado e nenhuma nao
 *   conformidade aberta, e congela as paginas aceitas (medicao);
 * - cada mudanca vira evento na cadeia de custodia e na auditoria.
 */
@Injectable()
export class DigitalizacaoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  /** Usuario lotado so trabalha nos lotes das suas secretarias (lote sem secretaria: todos). */
  private filtroLoteLotacao(sql: Sql, user: TenantAccessClaims) {
    const lot = lotacaoDe(user);
    return lot ? sql`(l.orgao_codigo IS NULL OR l.orgao_codigo = ANY(${lot}::varchar[]))` : sql`true`;
  }

  private assertLotacao(user: TenantAccessClaims, orgaoCodigo: string | null | undefined): void {
    const lot = lotacaoDe(user);
    if (lot && orgaoCodigo && !lot.includes(orgaoCodigo)) {
      throw new ForbiddenException('Você só trabalha com lotes das secretarias em que está lotado');
    }
  }

  // ---------------- Planos ----------------

  async listarPlanos(): Promise<PlanoView[]> {
    const sql = this.sql();
    const rows = await sql<
      Array<{
        id: string;
        orgao_codigo: string | null;
        orgao_nome: string | null;
        titulo: string;
        diagnostico: string | null;
        setores: string | null;
        volume_caixas: number | null;
        volume_paginas: number | null;
        inicio: Date | null;
        fim: Date | null;
        metas: string | null;
        status: 'rascunho' | 'aprovado';
        aprovado_por_nome: string | null;
        aprovado_em: Date | null;
        lotes: number;
        paginas_aceitas: number;
      }>
    >`
      SELECT p.*, ${sql.unsafe(NOME_ORGAO('p.orgao_codigo'))} AS orgao_nome, u.nome AS aprovado_por_nome,
             (SELECT count(*)::int FROM digit_lotes l WHERE l.plano_id = p.id) AS lotes,
             (SELECT coalesce(sum(l.paginas_aceitas), 0)::int FROM digit_lotes l WHERE l.plano_id = p.id) AS paginas_aceitas
      FROM digit_planos p LEFT JOIN users u ON u.id = p.aprovado_por
      ORDER BY p.criado_em DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      orgaoCodigo: r.orgao_codigo,
      orgaoNome: r.orgao_nome,
      titulo: r.titulo,
      diagnostico: r.diagnostico,
      setores: r.setores,
      volumeCaixas: r.volume_caixas,
      volumePaginas: r.volume_paginas,
      inicio: isoDia(r.inicio),
      fim: isoDia(r.fim),
      metas: r.metas,
      status: r.status,
      aprovadoPor: r.aprovado_por_nome,
      aprovadoEm: iso(r.aprovado_em),
      lotes: r.lotes,
      paginasAceitas: r.paginas_aceitas,
    }));
  }

  async criarPlano(user: TenantAccessClaims, input: PlanoInput, ip: string): Promise<{ id: string }> {
    const sql = this.sql();
    const [p] = await sql<Array<{ id: string }>>`
      INSERT INTO digit_planos (orgao_codigo, titulo, diagnostico, setores, volume_caixas, volume_paginas, inicio, fim, metas, criado_por)
      VALUES (${input.orgaoCodigo ?? null}, ${input.titulo}, ${input.diagnostico ?? null}, ${input.setores ?? null},
              ${input.volumeCaixas ?? null}, ${input.volumePaginas ?? null}, ${input.inicio ?? null}, ${input.fim ?? null},
              ${input.metas ?? null}, ${user.sub})
      RETURNING id
    `;
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_plano_criado', resourceType: 'digit_plano', resourceId: p!.id, ip, metadata: { titulo: input.titulo } });
    return { id: p!.id };
  }

  async atualizarPlano(user: TenantAccessClaims, id: string, input: PlanoInput, ip: string): Promise<void> {
    const sql = this.sql();
    const [p] = await sql<Array<{ status: string }>>`SELECT status FROM digit_planos WHERE id = ${id}`;
    if (!p) throw new NotFoundException('Plano não encontrado');
    if (p.status === 'aprovado') throw new ConflictException('Plano já aprovado pelo fiscal: não pode mais ser alterado');
    await sql`
      UPDATE digit_planos SET orgao_codigo = ${input.orgaoCodigo ?? null}, titulo = ${input.titulo}, diagnostico = ${input.diagnostico ?? null},
        setores = ${input.setores ?? null}, volume_caixas = ${input.volumeCaixas ?? null}, volume_paginas = ${input.volumePaginas ?? null},
        inicio = ${input.inicio ?? null}, fim = ${input.fim ?? null}, metas = ${input.metas ?? null}, atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_plano_alterado', resourceType: 'digit_plano', resourceId: id, ip });
  }

  async aprovarPlano(user: TenantAccessClaims, id: string, ip: string): Promise<void> {
    if (!ehFiscal(user)) throw new ForbiddenException('Só o fiscal do contrato aprova o plano de trabalho');
    const sql = this.sql();
    const r = await sql`
      UPDATE digit_planos SET status = 'aprovado', aprovado_por = ${user.sub}, aprovado_em = now(), aprovado_ip = ${ip}
      WHERE id = ${id} AND status = 'rascunho'
    `;
    if (r.count === 0) throw new ConflictException('Plano não encontrado ou já aprovado');
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_plano_aprovado', resourceType: 'digit_plano', resourceId: id, ip });
  }

  // ---------------- Lotes ----------------

  /** `where` e um fragmento sql`...` ja montado. */
  private selecionarLotes(sql: Sql, where: object, limite: number, offset: number) {
    return sql<LoteRow[]>`
      SELECT l.*, p.titulo AS plano_titulo, ${sql.unsafe(NOME_ORGAO('l.orgao_codigo'))} AS orgao_nome,
             ua.nome AS aceite_por_nome, uc.nome AS criado_por_nome,
             (SELECT count(*)::int FROM documents d WHERE d.lote_digitalizacao_id = l.id AND d.deleted_at IS NULL) AS documentos,
             (SELECT coalesce(sum(d.paginas), 0)::int FROM documents d WHERE d.lote_digitalizacao_id = l.id AND d.deleted_at IS NULL) AS paginas,
             (SELECT count(*)::int FROM digit_nao_conformidades n WHERE n.lote_id = l.id AND n.status = 'aberta') AS nc_abertas
      FROM digit_lotes l
      LEFT JOIN digit_planos p ON p.id = l.plano_id
      LEFT JOIN users ua ON ua.id = l.aceite_por
      LEFT JOIN users uc ON uc.id = l.criado_por
      WHERE ${where as never}
      ORDER BY l.ano DESC, l.numero DESC
      LIMIT ${limite} OFFSET ${offset}
    `;
  }

  private resumo(r: LoteRow): LoteResumoView {
    return {
      id: r.id,
      protocolo: protocoloLote(r.numero, r.ano),
      descricao: r.descricao,
      orgaoCodigo: r.orgao_codigo,
      orgaoNome: r.orgao_nome,
      etapa: r.etapa,
      caixas: r.caixas,
      documentos: r.documentos,
      paginas: r.paginas,
      paginasAceitas: r.paginas_aceitas,
      ncAbertas: r.nc_abertas,
      sigiloso: r.sigiloso,
      fragil: r.fragil,
      grandeFormato: r.grande_formato,
      contaminado: r.contaminado,
      criadoEm: r.criado_em.toISOString(),
      aceiteEm: iso(r.aceite_em),
    };
  }

  async listarLotes(user: TenantAccessClaims, q: LotesQuery): Promise<{ items: LoteResumoView[]; total: number }> {
    const sql = this.sql();
    const where = sql`
      ${this.filtroLoteLotacao(sql, user)}
      AND (${q.etapa ?? null}::varchar IS NULL OR l.etapa = ${q.etapa ?? null})
      AND (${q.orgaoCodigo ?? null}::varchar IS NULL OR l.orgao_codigo = ${q.orgaoCodigo ?? null})
      AND (${q.planoId ?? null}::uuid IS NULL OR l.plano_id = ${q.planoId ?? null})
      AND (${q.q ?? null}::varchar IS NULL OR l.descricao ILIKE ${q.q ? `%${q.q}%` : null} OR l.setor_origem ILIKE ${q.q ? `%${q.q}%` : null})
    `;
    const rows = await this.selecionarLotes(sql, where, q.pageSize, (q.page - 1) * q.pageSize);
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM digit_lotes l WHERE ${where}`;
    return { items: rows.map((r) => this.resumo(r)), total: t?.n ?? 0 };
  }

  private async linhaLote(user: TenantAccessClaims, id: string): Promise<LoteRow> {
    const sql = this.sql();
    const [r] = await this.selecionarLotes(sql, sql`l.id = ${id} AND ${this.filtroLoteLotacao(sql, user)}`, 1, 0);
    if (!r) throw new NotFoundException('Lote não encontrado');
    return r;
  }

  async verificacao(sql: Sql, loteId: string): Promise<VerificacaoAutomaticaLote> {
    const [v] = await sql<Array<{ documentos: number; sem_arquivo: number; sem_paginas: number; sem_desc: number }>>`
      SELECT count(*)::int AS documentos,
             count(*) FILTER (WHERE d.file_key IS NULL)::int AS sem_arquivo,
             count(*) FILTER (WHERE d.file_key IS NOT NULL AND coalesce(d.paginas, 0) = 0)::int AS sem_paginas,
             count(*) FILTER (WHERE coalesce(nullif(trim(d.descricao), ''), nullif(trim(d.assunto), '')) IS NULL OR d.document_date IS NULL)::int AS sem_desc
      FROM documents d WHERE d.lote_digitalizacao_id = ${loteId} AND d.deleted_at IS NULL
    `;
    const dup = await sql<Array<{ hash: string; n: number }>>`
      SELECT d.file_hash AS hash, count(*)::int AS n FROM documents d
      WHERE d.lote_digitalizacao_id = ${loteId} AND d.deleted_at IS NULL AND d.file_hash IS NOT NULL
      GROUP BY d.file_hash HAVING count(*) > 1
    `;
    return {
      documentos: v?.documentos ?? 0,
      semArquivo: v?.sem_arquivo ?? 0,
      semPaginas: v?.sem_paginas ?? 0,
      semDescricaoOuData: v?.sem_desc ?? 0,
      duplicadosPorHash: dup.map((d) => ({ hash: d.hash, documentos: d.n })),
    };
  }

  async detalhe(user: TenantAccessClaims, id: string): Promise<LoteDetalheView> {
    const sql = this.sql();
    const r = await this.linhaLote(user, id);
    const itens = await sql<
      Array<{
        id: string;
        tipo: ItemLoteView['tipo'];
        identificacao: string;
        local_fisico_id: string | null;
        local_codigo: string | null;
        datas_limite: string | null;
        folhas: number | null;
        estado_conservacao: ItemLoteView['estadoConservacao'];
        observacao: string | null;
        conferido_devolucao: boolean;
      }>
    >`
      SELECT i.*, lf.codigo AS local_codigo FROM digit_lote_itens i LEFT JOIN locais_fisicos lf ON lf.id = i.local_fisico_id
      WHERE i.lote_id = ${id} ORDER BY i.criado_em
    `;
    const eventos = await sql<Array<{ id: string; etapa_de: EtapaLote | null; etapa_para: EtapaLote; observacao: string | null; nome: string | null; ip: string | null; criado_em: Date }>>`
      SELECT e.id, e.etapa_de, e.etapa_para, e.observacao, u.nome, e.ip, e.criado_em
      FROM digit_lote_eventos e LEFT JOIN users u ON u.id = e.usuario_id
      WHERE e.lote_id = ${id} ORDER BY e.criado_em
    `;
    const qcs = await sql<Array<{ id: string; amostra: number; checklist: unknown; aprovado: boolean; observacao: string | null; nome: string | null; criado_em: Date }>>`
      SELECT q.id, q.amostra, q.checklist, q.aprovado, q.observacao, u.nome, q.criado_em
      FROM digit_qc q LEFT JOIN users u ON u.id = q.avaliado_por WHERE q.lote_id = ${id} ORDER BY q.criado_em DESC
    `;
    const ncs = await sql<
      Array<{
        id: string;
        tipo: NaoConformidadeView['tipo'];
        descricao: string;
        document_id: string | null;
        documento: string | null;
        status: 'aberta' | 'corrigida';
        criado_por_nome: string | null;
        criado_em: Date;
        correcao: string | null;
        corrigida_por_nome: string | null;
        corrigida_em: Date | null;
      }>
    >`
      SELECT n.id, n.tipo, n.descricao, n.document_id, coalesce(nullif(d.descricao, ''), d.original_name) AS documento, n.status,
             uc.nome AS criado_por_nome, n.criado_em, n.correcao, uk.nome AS corrigida_por_nome, n.corrigida_em
      FROM digit_nao_conformidades n
      LEFT JOIN documents d ON d.id = n.document_id
      LEFT JOIN users uc ON uc.id = n.criado_por
      LEFT JOIN users uk ON uk.id = n.corrigida_por
      WHERE n.lote_id = ${id} ORDER BY n.status = 'aberta' DESC, n.criado_em DESC
    `;
    const verificacao = await this.verificacao(sql, id);
    const base = r.paginas || verificacao.documentos;
    return {
      ...this.resumo(r),
      planoId: r.plano_id,
      planoTitulo: r.plano_titulo,
      setorOrigem: r.setor_origem,
      responsavelEntrega: r.responsavel_entrega,
      paginasEstimadas: r.paginas_estimadas,
      amostragemPct: r.amostragem_pct,
      estadoConservacao: r.estado_conservacao,
      observacoes: r.observacoes,
      aceitePor: r.aceite_por_nome,
      aceiteIp: r.aceite_ip,
      aceiteObservacao: r.aceite_observacao,
      criadoPor: r.criado_por_nome,
      itens: itens.map((i) => ({
        id: i.id,
        tipo: i.tipo,
        identificacao: i.identificacao,
        localFisicoId: i.local_fisico_id,
        localFisicoCodigo: i.local_codigo,
        datasLimite: i.datas_limite,
        folhas: i.folhas,
        estadoConservacao: i.estado_conservacao,
        observacao: i.observacao,
        conferidoDevolucao: i.conferido_devolucao,
      })),
      eventos: eventos.map(
        (e): EventoLoteView => ({ id: e.id, etapaDe: e.etapa_de, etapaPara: e.etapa_para, observacao: e.observacao, usuario: e.nome, ip: e.ip, criadoEm: e.criado_em.toISOString() }),
      ),
      qcs: qcs.map(
        (q): QcView => ({
          id: q.id,
          amostra: q.amostra,
          checklist: (typeof q.checklist === 'string' ? JSON.parse(q.checklist) : q.checklist) as QcView['checklist'],
          aprovado: q.aprovado,
          observacao: q.observacao,
          avaliadoPor: q.nome,
          criadoEm: q.criado_em.toISOString(),
        }),
      ),
      naoConformidades: ncs.map((n) => ({
        id: n.id,
        tipo: n.tipo,
        descricao: n.descricao,
        documentId: n.document_id,
        documento: n.documento,
        status: n.status,
        criadoPor: n.criado_por_nome,
        criadoEm: n.criado_em.toISOString(),
        correcao: n.correcao,
        corrigidaPor: n.corrigida_por_nome,
        corrigidaEm: iso(n.corrigida_em),
      })),
      verificacao,
      amostraSugerida: Math.max(1, Math.ceil((base * r.amostragem_pct) / 100)),
    };
  }

  async criarLote(user: TenantAccessClaims, input: LoteCreateInput, ip: string): Promise<{ id: string }> {
    this.assertLotacao(user, input.orgaoCodigo);
    const sql = this.sql();
    const id = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const ano = Number(hojeIso().slice(0, 4));
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'digit-lote-' + ano}))`;
      const [n] = await tx<Array<{ proximo: number }>>`SELECT coalesce(max(numero), 0) + 1 AS proximo FROM digit_lotes WHERE ano = ${ano}`;
      const [l] = await tx<Array<{ id: string }>>`
        INSERT INTO digit_lotes (numero, ano, plano_id, orgao_codigo, descricao, setor_origem, responsavel_entrega, caixas,
                                 paginas_estimadas, amostragem_pct, estado_conservacao, sigiloso, fragil, grande_formato,
                                 contaminado, observacoes, criado_por)
        VALUES (${n!.proximo}, ${ano}, ${input.planoId ?? null}, ${input.orgaoCodigo ?? null}, ${input.descricao},
                ${input.setorOrigem ?? null}, ${input.responsavelEntrega ?? null}, ${input.caixas}, ${input.paginasEstimadas ?? null},
                ${input.amostragemPct}, ${input.estadoConservacao}, ${input.sigiloso}, ${input.fragil}, ${input.grandeFormato},
                ${input.contaminado}, ${input.observacoes ?? null}, ${user.sub})
        RETURNING id
      `;
      await tx`
        INSERT INTO digit_lote_eventos (lote_id, etapa_de, etapa_para, observacao, usuario_id, ip)
        VALUES (${l!.id}, NULL, 'recebido', ${'Lote recebido para digitalização'}, ${user.sub}, ${ip})
      `;
      return l!.id;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_lote_recebido', resourceType: 'digit_lote', resourceId: id, ip, metadata: { descricao: input.descricao } });
    return { id };
  }

  async atualizarLote(user: TenantAccessClaims, id: string, input: LoteUpdateInput, ip: string): Promise<void> {
    const r = await this.linhaLote(user, id);
    if (r.etapa === 'devolvido') throw new ConflictException('Lote encerrado (originais devolvidos)');
    if (input.orgaoCodigo !== undefined) this.assertLotacao(user, input.orgaoCodigo);
    const sql = this.sql();
    const v = <K extends keyof LoteUpdateInput>(k: K, col: string) => (input[k] === undefined ? sql.unsafe(col) : (input[k] as never));
    await sql`
      UPDATE digit_lotes SET
        plano_id = ${v('planoId', 'plano_id')}, orgao_codigo = ${v('orgaoCodigo', 'orgao_codigo')}, descricao = ${v('descricao', 'descricao')},
        setor_origem = ${v('setorOrigem', 'setor_origem')}, responsavel_entrega = ${v('responsavelEntrega', 'responsavel_entrega')},
        caixas = ${v('caixas', 'caixas')}, paginas_estimadas = ${v('paginasEstimadas', 'paginas_estimadas')},
        amostragem_pct = ${v('amostragemPct', 'amostragem_pct')}, estado_conservacao = ${v('estadoConservacao', 'estado_conservacao')},
        sigiloso = ${v('sigiloso', 'sigiloso')}, fragil = ${v('fragil', 'fragil')}, grande_formato = ${v('grandeFormato', 'grande_formato')},
        contaminado = ${v('contaminado', 'contaminado')}, observacoes = ${v('observacoes', 'observacoes')}, atualizado_em = now()
      WHERE id = ${id}
    `;
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_lote_alterado', resourceType: 'digit_lote', resourceId: id, ip });
  }

  private async evento(sql: Sql, loteId: string, de: EtapaLote | null, para: EtapaLote, obs: string | null, user: TenantAccessClaims, ip: string) {
    await sql`
      INSERT INTO digit_lote_eventos (lote_id, etapa_de, etapa_para, observacao, usuario_id, ip)
      VALUES (${loteId}, ${de}, ${para}, ${obs}, ${user.sub}, ${ip})
    `;
  }

  async avancar(user: TenantAccessClaims, id: string, input: AvancarEtapaInput, ip: string): Promise<void> {
    const r = await this.linhaLote(user, id);
    if (input.para === 'disponibilizado') {
      throw new BadRequestException('O lote só é disponibilizado pelo aceite do fiscal do contrato');
    }
    if (!etapasPermitidas(r.etapa).includes(input.para)) {
      throw new BadRequestException('Etapa fora da ordem do fluxo de digitalização');
    }
    const sql = this.sql();
    if (input.para === 'devolvido') {
      const [p] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM digit_lote_itens WHERE lote_id = ${id} AND NOT conferido_devolucao`;
      if ((p?.n ?? 0) > 0) throw new BadRequestException(`Confira a devolução de todos os itens do inventário (${p!.n} pendente(s)).`);
    }
    await sql`UPDATE digit_lotes SET etapa = ${input.para}, atualizado_em = now() WHERE id = ${id} AND etapa = ${r.etapa}`;
    await this.evento(sql, id, r.etapa, input.para, input.observacao ?? null, user, ip);
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'digit_lote_etapa',
      resourceType: 'digit_lote',
      resourceId: id,
      ip,
      metadata: { de: r.etapa, para: input.para },
    });
  }

  // ---------------- Inventario ----------------

  async adicionarItem(user: TenantAccessClaims, loteId: string, input: ItemLoteInput, ip: string): Promise<void> {
    const r = await this.linhaLote(user, loteId);
    if (r.etapa === 'devolvido') throw new ConflictException('Lote encerrado');
    await this.sql()`
      INSERT INTO digit_lote_itens (lote_id, tipo, identificacao, local_fisico_id, datas_limite, folhas, estado_conservacao, observacao)
      VALUES (${loteId}, ${input.tipo}, ${input.identificacao}, ${input.localFisicoId ?? null}, ${input.datasLimite ?? null},
              ${input.folhas ?? null}, ${input.estadoConservacao}, ${input.observacao ?? null})
    `;
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_item_inventariado', resourceType: 'digit_lote', resourceId: loteId, ip, metadata: { identificacao: input.identificacao } });
  }

  async atualizarItem(user: TenantAccessClaims, loteId: string, itemId: string, input: ItemLoteUpdateInput, ip: string): Promise<void> {
    await this.linhaLote(user, loteId);
    const sql = this.sql();
    const v = <K extends keyof ItemLoteUpdateInput>(k: K, col: string) => (input[k] === undefined ? sql.unsafe(col) : (input[k] as never));
    const r = await sql`
      UPDATE digit_lote_itens SET tipo = ${v('tipo', 'tipo')}, identificacao = ${v('identificacao', 'identificacao')},
        local_fisico_id = ${v('localFisicoId', 'local_fisico_id')}, datas_limite = ${v('datasLimite', 'datas_limite')},
        folhas = ${v('folhas', 'folhas')}, estado_conservacao = ${v('estadoConservacao', 'estado_conservacao')},
        observacao = ${v('observacao', 'observacao')}, conferido_devolucao = ${v('conferidoDevolucao', 'conferido_devolucao')}
      WHERE id = ${itemId} AND lote_id = ${loteId}
    `;
    if (r.count === 0) throw new NotFoundException('Item não encontrado');
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_item_alterado', resourceType: 'digit_lote', resourceId: loteId, ip, metadata: { itemId } });
  }

  async removerItem(user: TenantAccessClaims, loteId: string, itemId: string, ip: string): Promise<void> {
    const r = await this.linhaLote(user, loteId);
    if (r.etapa !== 'recebido') throw new ConflictException('Itens só saem do inventário enquanto o lote está em "Recebido"');
    await this.sql()`DELETE FROM digit_lote_itens WHERE id = ${itemId} AND lote_id = ${loteId}`;
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_item_removido', resourceType: 'digit_lote', resourceId: loteId, ip, metadata: { itemId } });
  }

  // ---------------- Documentos do lote ----------------

  async vincularDocumentos(user: TenantAccessClaims, loteId: string, ids: string[], ip: string): Promise<{ vinculados: number }> {
    const r = await this.linhaLote(user, loteId);
    if (r.etapa === 'disponibilizado' || r.etapa === 'devolvido') throw new ConflictException('Lote já aceito: não recebe documentos novos');
    const sql = this.sql();
    const rows = await sql<Array<{ id: string }>>`
      UPDATE documents d SET lote_digitalizacao_id = ${loteId}
      WHERE d.id = ANY(${ids}::uuid[]) AND d.deleted_at IS NULL AND ${filtroLotacao(sql, user)}
      RETURNING d.id
    `;
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_documentos_vinculados', resourceType: 'digit_lote', resourceId: loteId, ip, metadata: { count: rows.length } });
    return { vinculados: rows.length };
  }

  async desvincularDocumento(user: TenantAccessClaims, loteId: string, documentId: string, ip: string): Promise<void> {
    const r = await this.linhaLote(user, loteId);
    if (r.etapa === 'disponibilizado' || r.etapa === 'devolvido') throw new ConflictException('Lote já aceito');
    await this.sql()`UPDATE documents SET lote_digitalizacao_id = NULL WHERE id = ${documentId} AND lote_digitalizacao_id = ${loteId}`;
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_documento_desvinculado', resourceType: 'digit_lote', resourceId: loteId, ip, metadata: { documentId } });
  }

  async documentosDoLote(user: TenantAccessClaims, loteId: string): Promise<Array<{ id: string; titulo: string; paginas: number | null; temArquivo: boolean; module: string }>> {
    await this.linhaLote(user, loteId);
    const sql = this.sql();
    return sql<Array<{ id: string; titulo: string; paginas: number | null; temArquivo: boolean; module: string }>>`
      SELECT d.id, coalesce(nullif(d.descricao, ''), nullif(d.assunto, ''), d.original_name) AS titulo, d.paginas,
             d.file_key IS NOT NULL AS "temArquivo", d.module
      FROM documents d WHERE d.lote_digitalizacao_id = ${loteId} AND d.deleted_at IS NULL AND ${filtroLotacao(sql, user)}
      ORDER BY d.criado_em
    `;
  }

  // ---------------- Controle de qualidade ----------------

  async registrarQc(user: TenantAccessClaims, loteId: string, input: QcInput, ip: string): Promise<{ aprovado: boolean }> {
    const r = await this.linhaLote(user, loteId);
    if (r.etapa !== 'controle_qualidade') throw new BadRequestException('Leve o lote para "Controle de qualidade" antes de avaliar');
    const faltando = CHECKLIST_QC.filter((k) => input.checklist[k] === undefined);
    if (faltando.length) throw new BadRequestException('Responda todos os itens do checklist');
    const aprovado = CHECKLIST_QC.every((k) => input.checklist[k]) && input.naoConformidades.length === 0;
    const sql = this.sql();
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const [q] = await tx<Array<{ id: string }>>`
        INSERT INTO digit_qc (lote_id, amostra, checklist, aprovado, observacao, avaliado_por)
        VALUES (${loteId}, ${input.amostra}, ${tx.json(input.checklist as never)}, ${aprovado}, ${input.observacao ?? null}, ${user.sub})
        RETURNING id
      `;
      for (const nc of input.naoConformidades) {
        await tx`
          INSERT INTO digit_nao_conformidades (lote_id, qc_id, document_id, tipo, descricao, criado_por)
          VALUES (${loteId}, ${q!.id}, ${nc.documentId ?? null}, ${nc.tipo}, ${nc.descricao}, ${user.sub})
        `;
      }
    });
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'digit_qc_registrado',
      resourceType: 'digit_lote',
      resourceId: loteId,
      ip,
      metadata: { aprovado, amostra: input.amostra, naoConformidades: input.naoConformidades.length },
    });
    return { aprovado };
  }

  async corrigirNc(user: TenantAccessClaims, loteId: string, ncId: string, correcao: string, ip: string): Promise<void> {
    await this.linhaLote(user, loteId);
    const r = await this.sql()`
      UPDATE digit_nao_conformidades SET status = 'corrigida', correcao = ${correcao}, corrigida_por = ${user.sub}, corrigida_em = now()
      WHERE id = ${ncId} AND lote_id = ${loteId} AND status = 'aberta'
    `;
    if (r.count === 0) throw new NotFoundException('Não conformidade não encontrada ou já corrigida');
    await this.audit.logTenant({ actorId: user.sub, action: 'digit_nc_corrigida', resourceType: 'digit_lote', resourceId: loteId, ip, metadata: { ncId } });
  }

  /** Aceite formal: ultimo QC aprovado, sem NC aberta. Congela as paginas aceitas. */
  async aceitar(user: TenantAccessClaims, loteId: string, observacao: string | undefined, ip: string): Promise<void> {
    if (!ehFiscal(user)) throw new ForbiddenException('Só o fiscal do contrato dá o aceite do lote');
    const r = await this.linhaLote(user, loteId);
    if (r.etapa !== 'controle_qualidade') throw new BadRequestException('O aceite é dado no controle de qualidade');
    const sql = this.sql();
    const [qc] = await sql<Array<{ aprovado: boolean }>>`SELECT aprovado FROM digit_qc WHERE lote_id = ${loteId} ORDER BY criado_em DESC LIMIT 1`;
    if (!qc?.aprovado) throw new BadRequestException('O último controle de qualidade precisa estar aprovado');
    if (r.nc_abertas > 0) throw new BadRequestException(`Há ${r.nc_abertas} não conformidade(s) aberta(s)`);
    if (r.documentos === 0) throw new BadRequestException('Vincule os documentos digitalizados ao lote antes do aceite');
    await sql`
      UPDATE digit_lotes SET etapa = 'disponibilizado', aceite_por = ${user.sub}, aceite_em = now(), aceite_ip = ${ip},
        aceite_observacao = ${observacao ?? null}, paginas_aceitas = ${r.paginas}, atualizado_em = now()
      WHERE id = ${loteId} AND etapa = 'controle_qualidade'
    `;
    await this.evento(sql, loteId, 'controle_qualidade', 'disponibilizado', `Aceite do fiscal: ${r.paginas} página(s)`, user, ip);
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'digit_lote_aceito',
      resourceType: 'digit_lote',
      resourceId: loteId,
      ip,
      metadata: { paginas: r.paginas, documentos: r.documentos },
    });
  }

  // ---------------- Producao ----------------

  async producao(user: TenantAccessClaims, q: ProducaoQuery): Promise<ProducaoResumo> {
    const sql = this.sql();
    const rows = await sql<
      Array<{
        id: string;
        numero: number;
        ano: number;
        descricao: string;
        orgao_codigo: string | null;
        orgao_nome: string | null;
        etapa: EtapaLote;
        documentos: number;
        paginas: number;
        paginas_aceitas: number | null;
        ncs: number;
        nc_abertas: number;
        aceite_em: Date | null;
      }>
    >`
      SELECT l.id, l.numero, l.ano, l.descricao, l.orgao_codigo, ${sql.unsafe(NOME_ORGAO('l.orgao_codigo'))} AS orgao_nome, l.etapa,
             (SELECT count(*)::int FROM documents d WHERE d.lote_digitalizacao_id = l.id AND d.deleted_at IS NULL) AS documentos,
             (SELECT coalesce(sum(d.paginas), 0)::int FROM documents d WHERE d.lote_digitalizacao_id = l.id AND d.deleted_at IS NULL) AS paginas,
             l.paginas_aceitas,
             (SELECT count(*)::int FROM digit_nao_conformidades n WHERE n.lote_id = l.id) AS ncs,
             (SELECT count(*)::int FROM digit_nao_conformidades n WHERE n.lote_id = l.id AND n.status = 'aberta') AS nc_abertas,
             l.aceite_em
      FROM digit_lotes l
      WHERE ${this.filtroLoteLotacao(sql, user)}
        AND (${q.orgaoCodigo ?? null}::varchar IS NULL OR l.orgao_codigo = ${q.orgaoCodigo ?? null})
        -- Periodo: pelo aceite (medicao); lote sem aceite entra pela data de recebimento.
        AND (${q.de ?? null}::date IS NULL OR coalesce(l.aceite_em, l.criado_em) >= ${q.de ?? null}::date)
        AND (${q.ate ?? null}::date IS NULL OR coalesce(l.aceite_em, l.criado_em) < ${q.ate ?? null}::date + 1)
      ORDER BY l.orgao_codigo NULLS LAST, l.ano, l.numero
    `;
    const linhas = rows.map((r) => ({
      loteId: r.id,
      protocolo: protocoloLote(r.numero, r.ano),
      descricao: r.descricao,
      orgaoCodigo: r.orgao_codigo,
      orgaoNome: r.orgao_nome,
      etapa: r.etapa,
      documentos: r.documentos,
      paginasDigitalizadas: r.paginas,
      paginasAceitas: r.paginas_aceitas ?? 0,
      naoConformidades: r.ncs,
      ncAbertas: r.nc_abertas,
      aceiteEm: iso(r.aceite_em),
    }));
    const porSec = new Map<string, ProducaoResumo['porSecretaria'][number]>();
    for (const l of linhas) {
      const k = l.orgaoCodigo ?? '';
      const a = porSec.get(k) ?? { orgaoCodigo: l.orgaoCodigo, orgaoNome: l.orgaoNome, paginasAceitas: 0, paginasDigitalizadas: 0, lotes: 0 };
      a.paginasAceitas += l.paginasAceitas;
      a.paginasDigitalizadas += l.paginasDigitalizadas;
      a.lotes += 1;
      porSec.set(k, a);
    }
    return {
      linhas,
      totais: {
        lotes: linhas.length,
        documentos: linhas.reduce((s, l) => s + l.documentos, 0),
        paginasDigitalizadas: linhas.reduce((s, l) => s + l.paginasDigitalizadas, 0),
        paginasAceitas: linhas.reduce((s, l) => s + l.paginasAceitas, 0),
        naoConformidades: linhas.reduce((s, l) => s + l.naoConformidades, 0),
      },
      porSecretaria: [...porSec.values()],
    };
  }
}
