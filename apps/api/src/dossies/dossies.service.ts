import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  DOC_MODULES,
  EVENTO_DOSSIE_LABEL,
  TIPO_DOSSIE_LABEL,
  caminhoLocal,
  sistemaDoModulo,
  type DocModule,
  type DossieCreateInput,
  type DossieDocumentoView,
  type DossieEventoView,
  type DossieResumoView,
  type DossiesPage,
  type DossiesQuery,
  type DossieUpdateInput,
  type DossieView,
  type EventoDossie,
  type TenantAccessClaims,
  type TipoDossie,
  hojeIso,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { sistemaAtivo } from '../common/sistema.guard';
import { ArquivisticaService } from '../arquivistica/arquivistica.service';

const IDENT = `COALESCE(NULLIF(concat_ws(' — ',
    CASE WHEN d.metadados ? 'numero' THEN concat_ws(' ', t.nome, 'nº', d.metadados->>'numero') END,
    CASE WHEN d.doc_caixa IS NOT NULL THEN 'Doc. Caixa ' || d.doc_caixa END,
    NULLIF(d.descricao, ''), NULLIF(d.historico, '')), ''), d.original_name, 'Documento')`;

interface ResumoRow {
  id: string;
  tipo: TipoDossie;
  numero: string;
  assunto: string;
  interessado: string | null;
  classe_codigo: string | null;
  classe_descricao: string | null;
  nivel_acesso: 'publico' | 'restrito';
  data_abertura: Date;
  data_encerramento: Date | null;
  total_documentos: number;
  total_paginas: number;
  apensado_id: string | null;
  apensado_numero: string | null;
  apensado_assunto: string | null;
  total_apensos: number;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const br = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '—');

/**
 * Dossies e processos. Regras:
 * - restrito so para quem ve restritos (como documento);
 * - juntada/desentranhamento so com o conjunto aberto; desentranhar exige motivo;
 * - documento juntado assume a classe do conjunto e conta prazo do encerramento;
 * - apensado segue o principal (um nivel: principal nao pode estar apensado);
 * - reabrir so enquanto nada foi transferido/recolhido.
 */
@Injectable()
export class DossiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly arquivistica: ArquivisticaService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  private podeVerRestrito(user: TenantAccessClaims): boolean {
    return user.role === 'admin' || user.permissions.includes('acervo_restrito:read');
  }

  private modulosLegiveis(user: TenantAccessClaims): DocModule[] {
    const contratados = DOC_MODULES.filter((m) => sistemaAtivo(sistemaDoModulo(m)));
    return user.role === 'admin' ? contratados : contratados.filter((m) => user.permissions.includes(`${m}:read`));
  }

  private visivel(sql: Sql, user: TenantAccessClaims): ReturnType<Sql> {
    return this.podeVerRestrito(user) ? sql`true` : sql`ds.nivel_acesso = 'publico'`;
  }

  private resumoSql(sql: Sql, where: ReturnType<Sql>, limite: number, offset: number) {
    return sql<ResumoRow[]>`
      SELECT ds.id, ds.tipo, ds.numero, ds.assunto, ds.interessado, cl.codigo AS classe_codigo, cl.descricao AS classe_descricao,
             ds.nivel_acesso, ds.data_abertura, ds.data_encerramento,
             (SELECT count(*) FROM dossie_documentos x WHERE x.dossie_id = ds.id)::int AS total_documentos,
             (SELECT COALESCE(sum(d.paginas), 0) FROM dossie_documentos x JOIN documents d ON d.id = x.document_id WHERE x.dossie_id = ds.id)::int AS total_paginas,
             p.id AS apensado_id, p.numero AS apensado_numero, p.assunto AS apensado_assunto,
             (SELECT count(*) FROM dossies a WHERE a.apensado_a = ds.id)::int AS total_apensos
      FROM dossies ds
      LEFT JOIN classificacoes cl ON cl.id = ds.classificacao_id
      LEFT JOIN dossies p ON p.id = ds.apensado_a
      WHERE ${where}
      ORDER BY (ds.data_encerramento IS NULL) DESC, ds.data_abertura DESC, ds.numero DESC
      LIMIT ${limite} OFFSET ${offset}
    `;
  }

  private toResumo(r: ResumoRow): DossieResumoView {
    return {
      id: r.id,
      tipo: r.tipo,
      numero: r.numero,
      assunto: r.assunto,
      interessado: r.interessado,
      classeCodigo: r.classe_codigo,
      classeDescricao: r.classe_descricao,
      nivelAcesso: r.nivel_acesso,
      dataAbertura: iso(r.data_abertura)!,
      dataEncerramento: iso(r.data_encerramento),
      status: r.data_encerramento ? 'encerrado' : 'aberto',
      totalDocumentos: r.total_documentos,
      totalPaginas: r.total_paginas,
      apensadoA: r.apensado_id ? { id: r.apensado_id, numero: r.apensado_numero!, assunto: r.apensado_assunto! } : null,
      totalApensos: r.total_apensos,
    };
  }

  async listar(user: TenantAccessClaims, q: DossiesQuery): Promise<DossiesPage> {
    const sql = this.sql();
    const partes: Array<ReturnType<Sql>> = [this.visivel(sql, user)];
    if (q.situacao === 'abertos') partes.push(sql`ds.data_encerramento IS NULL`);
    if (q.situacao === 'encerrados') partes.push(sql`ds.data_encerramento IS NOT NULL`);
    if (q.tipo) partes.push(sql`ds.tipo = ${q.tipo}`);
    if (q.q) {
      const termo = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      partes.push(sql`(ds.numero ILIKE ${termo} OR ds.assunto ILIKE ${termo} OR ds.interessado ILIKE ${termo})`);
    }
    const w = partes.reduce((a, p) => sql`${a} AND ${p}`);
    const [c] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM dossies ds WHERE ${w}`;
    const rows = await this.resumoSql(sql, w, q.pageSize, (q.page - 1) * q.pageSize);
    return { items: rows.map((r) => this.toResumo(r)), total: c?.n ?? 0, page: q.page, pageSize: q.pageSize };
  }

  async obter(user: TenantAccessClaims, id: string): Promise<DossieView> {
    const sql = this.sql();
    const [r] = await this.resumoSql(sql, sql`ds.id = ${id} AND ${this.visivel(sql, user)}`, 1, 0);
    if (!r) throw new NotFoundException('Dossiê/processo não encontrado');
    const [extra] = await sql<
      Array<{ local_fisico_id: string | null; observacoes: string | null; classificacao_id: string | null; criado_por: string | null; destinacao: string | null }>
    >`
      SELECT ds.local_fisico_id, ds.observacoes, ds.classificacao_id, u.nome AS criado_por, cl.destinacao
      FROM dossies ds LEFT JOIN users u ON u.id = ds.criado_por LEFT JOIN classificacoes cl ON cl.id = ds.classificacao_id
      WHERE ds.id = ${id}
    `;
    const podeRestrito = this.podeVerRestrito(user);
    const docs = await sql<
      Array<{ id: string; ordem: number; identificacao: string; document_date: Date | null; paginas: number | null; restrito: boolean; juntado_em: Date; juntado_por: string | null; fase: string; tr: Date | null; de: Date | null }>
    >`
      SELECT d.id, dd.ordem, ${sql.unsafe(IDENT)} AS identificacao, d.document_date, d.paginas,
             COALESCE(d.nivel_acesso, 'publico') = 'restrito' AS restrito, dd.juntado_em, u.nome AS juntado_por,
             d.fase, d.data_prevista_transferencia AS tr, d.data_prevista_destinacao AS de
      FROM dossie_documentos dd
      JOIN documents d ON d.id = dd.document_id
      LEFT JOIN document_types t ON t.id = d.document_type_id
      LEFT JOIN users u ON u.id = dd.juntado_por
      WHERE dd.dossie_id = ${id}
      ORDER BY dd.ordem
    `;
    const apensos = await sql<Array<{ id: string; numero: string; assunto: string }>>`
      SELECT id, numero, assunto FROM dossies WHERE apensado_a = ${id} ORDER BY numero
    `;
    const eventos = await sql<Array<{ tipo: EventoDossie; descricao: string; usuario: string | null; criado_em: Date }>>`
      SELECT e.tipo, e.descricao, u.nome AS usuario, e.criado_em
      FROM dossie_eventos e LEFT JOIN users u ON u.id = e.usuario_id
      WHERE e.dossie_id = ${id} ORDER BY e.criado_em DESC
    `;
    const locais = extra?.local_fisico_id
      ? await sql<Array<{ id: string; parentId: string | null; tipo: 'predio'; codigo: string }>>`SELECT id, parent_id AS "parentId", tipo, codigo FROM locais_fisicos`
      : [];
    const primeiro = docs[0];
    return {
      ...this.toResumo(r),
      localFisico: extra?.local_fisico_id ? caminhoLocal(extra.local_fisico_id, locais) : null,
      observacoes: extra?.observacoes ?? null,
      classificacaoId: extra?.classificacao_id ?? null,
      previsaoTransferencia: iso(primeiro?.tr ?? null),
      previsaoDestinacao: iso(primeiro?.de ?? null),
      destinacao: (extra?.destinacao as DossieView['destinacao']) ?? null,
      fase: primeiro?.fase ?? null,
      documentos: docs.map(
        (d): DossieDocumentoView => ({
          id: d.id,
          ordem: d.ordem,
          identificacao: d.restrito && !podeRestrito ? 'Documento restrito' : d.identificacao,
          dataDocumento: iso(d.document_date),
          paginas: d.paginas,
          restrito: d.restrito,
          juntadoEm: d.juntado_em.toISOString(),
          juntadoPor: d.juntado_por,
        }),
      ),
      apensos,
      eventos: eventos.map((e): DossieEventoView => ({ tipo: e.tipo, descricao: e.descricao, usuario: e.usuario, data: e.criado_em.toISOString() })),
      criadoPor: extra?.criado_por ?? null,
    };
  }

  private async evento(sql: Sql, dossieId: string, tipo: EventoDossie, descricao: string, userId: string): Promise<void> {
    await sql`INSERT INTO dossie_eventos (dossie_id, tipo, descricao, usuario_id) VALUES (${dossieId}, ${tipo}, ${descricao}, ${userId})`;
  }

  /** Dossie visivel ao usuario (404 generico) com o estado atual. */
  private async carregar(sql: Sql, user: TenantAccessClaims, id: string) {
    const [d] = await sql<Array<{ id: string; numero: string; data_abertura: Date; data_encerramento: Date | null; apensado_a: string | null; classificacao_id: string | null; nivel_acesso: string }>>`
      SELECT ds.id, ds.numero, ds.data_abertura, ds.data_encerramento, ds.apensado_a, ds.classificacao_id, ds.nivel_acesso
      FROM dossies ds WHERE ds.id = ${id} AND ${this.visivel(sql, user)}
    `;
    if (!d) throw new NotFoundException('Dossiê/processo não encontrado');
    return d;
  }

  private async assertClasse(sql: Sql, classeId: string | null | undefined): Promise<void> {
    if (!classeId) return;
    const c = await sql`SELECT 1 FROM classificacoes WHERE id = ${classeId} AND ativo`;
    if (c.length === 0) throw new BadRequestException('Classe inválida ou inativa');
  }

  /** Recalcula os prazos dos documentos do conjunto (e dos apensos). */
  private async recalcular(sql: Sql, dossieId: string): Promise<void> {
    await this.arquivistica.recalcularPrazos(
      sql,
      sql`d.id IN (SELECT dd2.document_id FROM dossie_documentos dd2 JOIN dossies x ON x.id = dd2.dossie_id
                   WHERE x.id = ${dossieId} OR x.apensado_a = ${dossieId})`,
    );
    // Sem classe/encerramento os prazos precisam sumir (recalcularPrazos so escreve quem tem classe).
    await sql`
      UPDATE documents SET data_prevista_transferencia = NULL, data_prevista_destinacao = NULL, data_inicio_contagem = NULL
      WHERE id IN (SELECT dd2.document_id FROM dossie_documentos dd2 JOIN dossies x ON x.id = dd2.dossie_id
                   WHERE (x.id = ${dossieId} OR x.apensado_a = ${dossieId})
                     AND (CASE WHEN x.apensado_a IS NOT NULL THEN (SELECT p.data_encerramento FROM dossies p WHERE p.id = x.apensado_a) ELSE x.data_encerramento END) IS NULL)
    `;
  }

  async criar(user: TenantAccessClaims, input: DossieCreateInput, ip: string): Promise<DossieView> {
    const sql = this.sql();
    await this.assertClasse(sql, input.classificacaoId);
    if (input.dataAbertura && input.dataAbertura > hojeIso()) throw new BadRequestException('A data de abertura não pode ser futura');
    const nivel = input.nivelAcesso ?? (this.podeVerRestrito(user) ? 'restrito' : 'publico');
    if (nivel === 'restrito' && !this.podeVerRestrito(user)) {
      throw new BadRequestException('Sem acesso a documentos restritos você não pode abrir dossiê restrito');
    }
    let id: string;
    try {
      id = await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        let numero = input.numero?.trim();
        if (!numero) {
          const ano = (input.dataAbertura ?? hojeIso()).slice(0, 4);
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`dossie-${input.tipo}-${ano}`}))`;
          const [n] = await tx<Array<{ proximo: number }>>`
            SELECT COALESCE(max(split_part(numero, '/', 1)::int), 0) + 1 AS proximo
            FROM dossies WHERE tipo = ${input.tipo} AND numero ~ ${`^[0-9]+/${ano}$`}
          `;
          numero = `${String(n!.proximo).padStart(3, '0')}/${ano}`;
        }
        const [d] = await tx<Array<{ id: string }>>`
          INSERT INTO dossies (tipo, numero, assunto, interessado, classificacao_id, nivel_acesso, data_abertura, local_fisico_id, observacoes, criado_por)
          VALUES (${input.tipo}, ${numero}, ${input.assunto}, ${input.interessado || null}, ${input.classificacaoId ?? null}, ${nivel},
                  ${input.dataAbertura ?? hojeIso()}, ${input.localFisicoId ?? null}, ${input.observacoes || null}, ${user.sub})
          RETURNING id
        `;
        await this.evento(tx, d!.id, 'abertura', `${TIPO_DOSSIE_LABEL[input.tipo]} ${numero} aberto: ${input.assunto}`, user.sub);
        return d!.id;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException(`Já existe ${TIPO_DOSSIE_LABEL[input.tipo].toLowerCase()} com esse número`);
      throw e;
    }
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_aberto', resourceType: 'dossie', resourceId: id, ip });
    return this.obter(user, id);
  }

  async atualizar(user: TenantAccessClaims, id: string, input: DossieUpdateInput, ip: string): Promise<DossieView> {
    const sql = this.sql();
    await this.carregar(sql, user, id);
    await this.assertClasse(sql, input.classificacaoId);
    await sql`
      UPDATE dossies SET
        assunto = COALESCE(${input.assunto ?? null}, assunto),
        interessado = ${input.interessado === undefined ? sql`interessado` : input.interessado},
        classificacao_id = ${input.classificacaoId === undefined ? sql`classificacao_id` : input.classificacaoId},
        nivel_acesso = COALESCE(${input.nivelAcesso ?? null}, nivel_acesso),
        local_fisico_id = ${input.localFisicoId === undefined ? sql`local_fisico_id` : input.localFisicoId},
        observacoes = ${input.observacoes === undefined ? sql`observacoes` : input.observacoes}
      WHERE id = ${id}
    `;
    if (input.classificacaoId !== undefined) {
      // A classe do conjunto vale para os documentos juntados.
      await sql`UPDATE documents SET classificacao_id = ${input.classificacaoId} WHERE id IN (SELECT document_id FROM dossie_documentos WHERE dossie_id = ${id})`;
      await this.recalcular(sql, id);
    }
    await this.evento(sql, id, 'alteracao', `Dados alterados: ${Object.keys(input).join(', ')}`, user.sub);
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_alterado', resourceType: 'dossie', resourceId: id, ip, metadata: { campos: Object.keys(input) } });
    return this.obter(user, id);
  }

  async juntar(user: TenantAccessClaims, id: string, documentIds: string[], ip: string): Promise<DossieView> {
    const sql = this.sql();
    const d = await this.carregar(sql, user, id);
    if (d.data_encerramento) throw new ConflictException('Conjunto encerrado: reabra para juntar documentos');
    const ids = [...new Set(documentIds)];
    const legiveis = this.modulosLegiveis(user);
    const docs = await sql<Array<{ id: string; module: DocModule; restrito: boolean; fase: string; titulo: string; dossie: string | null }>>`
      SELECT d.id, d.module, COALESCE(d.nivel_acesso, 'publico') = 'restrito' AS restrito, d.fase, ${sql.unsafe(IDENT)} AS titulo,
             (SELECT x.numero FROM dossie_documentos dd JOIN dossies x ON x.id = dd.dossie_id WHERE dd.document_id = d.id) AS dossie
      FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id
      WHERE d.id = ANY(${ids}::uuid[]) AND d.deleted_at IS NULL
    `;
    const invisivel = (x: (typeof docs)[number]) => !legiveis.includes(x.module) || (x.restrito && !this.podeVerRestrito(user));
    if (docs.length !== ids.length || docs.some(invisivel)) throw new BadRequestException('Algum documento informado não existe ou está na lixeira');
    const ja = docs.find((x) => x.dossie);
    if (ja) throw new ConflictException(`"${ja.titulo}" já está juntado ao dossiê/processo ${ja.dossie}`);
    if (docs.some((x) => x.fase !== 'corrente')) throw new BadRequestException('Só documentos na fase corrente podem ser juntados');

    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await tx`SELECT id FROM dossies WHERE id = ${id} FOR UPDATE`;
      const [m] = await tx<Array<{ max: number }>>`SELECT COALESCE(max(ordem), 0)::int AS max FROM dossie_documentos WHERE dossie_id = ${id}`;
      let ordem = m!.max;
      for (const docId of ids) {
        ordem++;
        await tx`INSERT INTO dossie_documentos (dossie_id, document_id, ordem, juntado_por) VALUES (${id}, ${docId}, ${ordem}, ${user.sub})`;
      }
      if (d.classificacao_id) await tx`UPDATE documents SET classificacao_id = ${d.classificacao_id} WHERE id = ANY(${ids}::uuid[])`;
      const titulos = ids.map((i) => docs.find((x) => x.id === i)!.titulo);
      await this.evento(tx, id, 'juntada', `${ids.length} documento(s) juntado(s): ${titulos.slice(0, 5).join('; ')}${titulos.length > 5 ? '…' : ''}`, user.sub);
    });
    await this.recalcular(sql, id);
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_juntada', resourceType: 'dossie', resourceId: id, ip, metadata: { documentos: ids } });
    return this.obter(user, id);
  }

  async desentranhar(user: TenantAccessClaims, id: string, documentId: string, motivo: string, ip: string): Promise<DossieView> {
    const sql = this.sql();
    const d = await this.carregar(sql, user, id);
    if (d.data_encerramento) throw new ConflictException('Conjunto encerrado: reabra para desentranhar');
    const [r] = await sql<Array<{ ordem: number }>>`DELETE FROM dossie_documentos WHERE dossie_id = ${id} AND document_id = ${documentId} RETURNING ordem`;
    if (!r) throw new NotFoundException('Documento não está juntado a este conjunto');
    await this.evento(sql, id, 'desentranhamento', `Documento de ordem ${r.ordem} desentranhado. Motivo: ${motivo}`, user.sub);
    await this.arquivistica.recalcularDocumento(documentId);
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_desentranhamento', resourceType: 'dossie', resourceId: id, ip, metadata: { documentId, motivo } });
    return this.obter(user, id);
  }

  async encerrar(user: TenantAccessClaims, id: string, data: string | undefined, ip: string): Promise<DossieView> {
    const sql = this.sql();
    const d = await this.carregar(sql, user, id);
    if (d.data_encerramento) throw new ConflictException('Já está encerrado');
    if (d.apensado_a) throw new BadRequestException('Processo apensado segue o principal: encerre o processo principal');
    const [c] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM dossie_documentos WHERE dossie_id = ${id}`;
    if (!c?.n) throw new BadRequestException('Junte ao menos um documento antes de encerrar');
    const dataEnc = data ?? hojeIso();
    if (dataEnc > hojeIso()) throw new BadRequestException('A data de encerramento não pode ser futura');
    if (dataEnc < iso(d.data_abertura)!) throw new BadRequestException('O encerramento não pode ser anterior à abertura');
    await sql`UPDATE dossies SET data_encerramento = ${dataEnc} WHERE id = ${id}`;
    await this.evento(sql, id, 'encerramento', `Encerrado em ${br(dataEnc)}. A temporalidade dos documentos passa a contar desta data.`, user.sub);
    await this.recalcular(sql, id);
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_encerrado', resourceType: 'dossie', resourceId: id, ip });
    return this.obter(user, id);
  }

  async reabrir(user: TenantAccessClaims, id: string, motivo: string, ip: string): Promise<DossieView> {
    const sql = this.sql();
    const d = await this.carregar(sql, user, id);
    if (!d.data_encerramento) throw new ConflictException('Já está aberto');
    const movidos = await sql`
      SELECT 1 FROM dossie_documentos dd JOIN documents doc ON doc.id = dd.document_id JOIN dossies x ON x.id = dd.dossie_id
      WHERE (x.id = ${id} OR x.apensado_a = ${id}) AND doc.fase <> 'corrente' LIMIT 1
    `;
    if (movidos.length > 0) throw new BadRequestException('Há documentos já transferidos, recolhidos ou eliminados: o conjunto não pode ser reaberto');
    await sql`UPDATE dossies SET data_encerramento = NULL WHERE id = ${id}`;
    await this.evento(sql, id, 'reabertura', `Reaberto. Motivo: ${motivo}`, user.sub);
    await this.recalcular(sql, id);
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_reaberto', resourceType: 'dossie', resourceId: id, ip, metadata: { motivo } });
    return this.obter(user, id);
  }

  async apensar(user: TenantAccessClaims, id: string, principalId: string, ip: string): Promise<DossieView> {
    const sql = this.sql();
    if (id === principalId) throw new BadRequestException('Não é possível apensar ao próprio processo');
    const d = await this.carregar(sql, user, id);
    const p = await this.carregar(sql, user, principalId);
    if (d.apensado_a) throw new ConflictException('Já está apensado');
    if (d.data_encerramento || p.data_encerramento) throw new BadRequestException('Os dois precisam estar abertos para a apensação');
    if (p.apensado_a) throw new BadRequestException('O principal está apensado a outro: apense ao processo principal dele');
    const [temApensos] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM dossies WHERE apensado_a = ${id}`;
    if (temApensos?.n) throw new BadRequestException('Este processo tem apensos: desapense-os antes');
    await sql`UPDATE dossies SET apensado_a = ${principalId} WHERE id = ${id}`;
    await this.evento(sql, id, 'apensacao', `Apensado ao ${p.numero}`, user.sub);
    await this.evento(sql, principalId, 'apensacao', `Recebeu em apenso o ${d.numero}`, user.sub);
    await this.recalcular(sql, principalId);
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_apensado', resourceType: 'dossie', resourceId: id, ip, metadata: { principalId } });
    return this.obter(user, id);
  }

  async desapensar(user: TenantAccessClaims, id: string, motivo: string, ip: string): Promise<DossieView> {
    const sql = this.sql();
    const d = await this.carregar(sql, user, id);
    if (!d.apensado_a) throw new ConflictException('Não está apensado');
    const [p] = await sql<Array<{ numero: string; data_encerramento: Date | null }>>`SELECT numero, data_encerramento FROM dossies WHERE id = ${d.apensado_a}`;
    if (p?.data_encerramento) throw new BadRequestException('O principal está encerrado: reabra-o para desapensar');
    await sql`UPDATE dossies SET apensado_a = NULL WHERE id = ${id}`;
    await this.evento(sql, id, 'desapensacao', `Desapensado do ${p?.numero}. Motivo: ${motivo}`, user.sub);
    await this.evento(sql, d.apensado_a, 'desapensacao', `${d.numero} desapensado. Motivo: ${motivo}`, user.sub);
    await this.recalcular(sql, id);
    await this.audit.logTenant({ actorId: user.sub, action: 'dossie_desapensado', resourceType: 'dossie', resourceId: id, ip, metadata: { motivo } });
    return this.obter(user, id);
  }

  /** Capa + indice (folha de rosto com a ordem de juntada) + termo de encerramento. */
  async capa(user: TenantAccessClaims, id: string): Promise<{ pdf: Buffer; nome: string }> {
    const v = await this.obter(user, id);
    const ctx = requireTenantContext();
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFKitDocument({ size: 'A4', margin: 50, bufferPages: true });
      const partes: Buffer[] = [];
      doc.on('data', (c: Buffer) => partes.push(c));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      // Capa
      doc.font('Helvetica-Bold').fontSize(12).text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.moveDown(3);
      doc.fontSize(26).text(`${TIPO_DOSSIE_LABEL[v.tipo].toUpperCase()} Nº ${v.numero}`, { align: 'center' });
      doc.moveDown(1.5);
      doc.font('Helvetica').fontSize(12);
      const campo = (r: string, val: string | null) => {
        doc.font('Helvetica-Bold').text(`${r}: `, { continued: true }).font('Helvetica').text(val || '—');
        doc.moveDown(0.4);
      };
      campo('Assunto', v.assunto);
      campo('Interessado', v.interessado);
      campo('Classificação', v.classeCodigo ? `${v.classeCodigo} — ${v.classeDescricao}` : 'Sem classificação');
      campo('Abertura', br(v.dataAbertura));
      campo('Encerramento', v.dataEncerramento ? br(v.dataEncerramento) : 'Em aberto');
      campo('Acesso', v.nivelAcesso === 'restrito' ? 'Restrito' : 'Público');
      if (v.localFisico) campo('Localização do original', v.localFisico);
      if (v.apensadoA) campo('Apensado ao', `${v.apensadoA.numero} — ${v.apensadoA.assunto}`);
      if (v.apensos.length) campo('Apensos', v.apensos.map((a) => a.numero).join(', '));
      // Indice
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(14).text('ÍNDICE DE DOCUMENTOS', { align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`${TIPO_DOSSIE_LABEL[v.tipo]} nº ${v.numero}`, { align: 'center' });
      doc.moveDown(1).fillColor('#0f172a');
      doc.font('Helvetica-Bold').fontSize(8);
      const cab = doc.y;
      doc.text('ORDEM', 50, cab, { width: 45 }).text('DOCUMENTO', 95, cab, { width: 300 }).text('DATA', 400, cab, { width: 70 }).text('PÁGS.', 470, cab, { width: 75, align: 'right' });
      doc.moveDown(0.6).font('Helvetica').fontSize(9);
      for (const d of v.documentos) {
        if (doc.y > doc.page.height - 90) doc.addPage();
        const y = doc.y;
        const h = doc.heightOfString(d.identificacao, { width: 300 });
        doc.text(String(d.ordem), 50, y, { width: 45 }).text(d.identificacao, 95, y, { width: 300 }).text(br(d.dataDocumento), 400, y, { width: 70 }).text(d.paginas ? String(d.paginas) : '—', 470, y, { width: 75, align: 'right' });
        doc.y = y + Math.max(h, 11) + 4;
      }
      doc.moveDown(0.5).font('Helvetica-Bold').text(`Total: ${v.totalDocumentos} documento(s), ${v.totalPaginas} página(s)`, 50);
      // Termo de encerramento
      if (v.dataEncerramento) {
        doc.moveDown(2).font('Helvetica-Bold').fontSize(12).text('TERMO DE ENCERRAMENTO', 50, doc.y, { align: 'center' });
        doc.moveDown(0.6).font('Helvetica').fontSize(10).text(
          `Em ${br(v.dataEncerramento)}, encerra-se o presente ${TIPO_DOSSIE_LABEL[v.tipo].toLowerCase()} nº ${v.numero}, com ${v.totalDocumentos} documento(s) e ${v.totalPaginas} página(s). A partir desta data, conta-se o prazo de guarda previsto na Tabela de Temporalidade${v.classeCodigo ? ` para a classe ${v.classeCodigo}` : ''}.`,
          { align: 'justify' },
        );
      }
      // Historico de atos
      doc.moveDown(1.5).font('Helvetica-Bold').fontSize(11).text('HISTÓRICO', 50);
      doc.font('Helvetica').fontSize(8);
      for (const e of [...v.eventos].reverse()) {
        if (doc.y > doc.page.height - 70) doc.addPage();
        doc.text(`${new Date(e.data).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — ${EVENTO_DOSSIE_LABEL[e.tipo]} — ${e.descricao}${e.usuario ? ` (${e.usuario})` : ''}`, 50);
      }
      doc.end();
    });
    return { pdf, nome: `${v.tipo}-${v.numero.replace(/[^\w-]+/g, '-')}.pdf` };
  }
}
