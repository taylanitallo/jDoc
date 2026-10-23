import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  caminhoLocal,
  dataLiberacaoEliminacao,
  fraseConfirmacaoEliminacao,
  type EliminacaoItemView,
  type EliminacaoStatus,
  type EliminacaoView,
  type TenantAccessClaims,
  type TipoLocal,
  hojeIso,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { StorageService } from '../storage/storage.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { DESCRICAO_DOC_SQL, LISTA_WHERE, expandirDossies } from './arquivistica.service';

/** Eliminacoes que "seguram" um documento (ele nao pode entrar em outra listagem). */
const ATIVAS = ['rascunho', 'aprovada', 'edital_publicado'];

interface EliminacaoRow {
  id: string;
  numero: number;
  ano: number;
  status: EliminacaoStatus;
  observacoes: string | null;
  comissao: Array<{ nome: string; cargo: string }> | string;
  ata_aprovacao: string | null;
  data_aprovacao: Date | null;
  veiculo_publicacao: string | null;
  data_publicacao_edital: Date | null;
  prazo_edital_dias: number;
  criado_em: Date;
  concluida_em: Date | null;
  motivo_cancelamento: string | null;
  total_itens: string;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dataBr = (s: string | null) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const numeroFmt = (e: { numero: number; ano: number }) => `${String(e.numero).padStart(3, '0')}/${e.ano}`;

function toView(r: EliminacaoRow): EliminacaoView {
  const dataPub = iso(r.data_publicacao_edital);
  return {
    id: r.id,
    numero: r.numero,
    ano: r.ano,
    status: r.status,
    observacoes: r.observacoes,
    comissao: typeof r.comissao === 'string' ? JSON.parse(r.comissao) : r.comissao,
    ataAprovacao: r.ata_aprovacao,
    dataAprovacao: iso(r.data_aprovacao),
    veiculoPublicacao: r.veiculo_publicacao,
    dataPublicacaoEdital: dataPub,
    prazoEditalDias: r.prazo_edital_dias,
    liberadaEm: dataLiberacaoEliminacao(dataPub, r.prazo_edital_dias),
    totalItens: Number(r.total_itens),
    criadoEm: r.criado_em.toISOString(),
    concluidaEm: r.concluida_em ? r.concluida_em.toISOString() : null,
    motivoCancelamento: r.motivo_cancelamento,
  };
}

function pdfBuffer(build: (doc: PDFKit.PDFDocument) => void, opts: PDFKit.PDFDocumentOptions = { size: 'A4', margin: 50 }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument(opts);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

@Injectable()
export class EliminacaoService {
  private readonly logger = new Logger(EliminacaoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  private async rows(sql: Sql, where: ReturnType<Sql>): Promise<EliminacaoRow[]> {
    return sql<EliminacaoRow[]>`
      SELECT e.*, (SELECT COUNT(*) FROM eliminacao_itens i WHERE i.eliminacao_id = e.id)::bigint AS total_itens
      FROM eliminacoes e WHERE ${where}
      ORDER BY e.ano DESC, e.numero DESC
    `;
  }

  async list(): Promise<EliminacaoView[]> {
    const sql = this.sql();
    return (await this.rows(sql, sql`true`)).map(toView);
  }

  async get(id: string): Promise<EliminacaoView> {
    const sql = this.sql();
    const r = (await this.rows(sql, sql`e.id = ${id}`))[0];
    if (!r) throw new NotFoundException('Eliminacao nao encontrada');
    return toView(r);
  }

  async itens(id: string): Promise<EliminacaoItemView[]> {
    await this.get(id);
    const rows = await this.sql()<
      Array<{
        document_id: string;
        classificacao_codigo: string | null;
        classificacao_descricao: string | null;
        descricao: string;
        module: string;
        exercicio: number | null;
        document_date: Date | null;
        local_fisico: string | null;
      }>
    >`
      SELECT document_id, classificacao_codigo, classificacao_descricao, descricao, module, exercicio, document_date, local_fisico
      FROM eliminacao_itens WHERE eliminacao_id = ${id}
      ORDER BY classificacao_codigo NULLS LAST, exercicio, document_date, document_id
    `;
    return rows.map((r) => ({
      documentId: r.document_id,
      classificacaoCodigo: r.classificacao_codigo,
      classificacaoDescricao: r.classificacao_descricao,
      descricao: r.descricao,
      module: r.module,
      exercicio: r.exercicio,
      documentDate: iso(r.document_date),
      localFisico: r.local_fisico,
    }));
  }

  /** Documentos "A eliminar" que ainda nao estao em nenhuma listagem ativa. */
  async candidatos(): Promise<Array<{ id: string; descricao: string; classificacaoCodigo: string | null; exercicio: number }>> {
    const rows = await this.sql().unsafe(
      `SELECT d.id, ${DESCRICAO_DOC_SQL} AS descricao, cl.codigo AS classificacao_codigo, d.exercicio
       FROM documents d
       LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.deleted_at IS NULL AND ${LISTA_WHERE.a_eliminar}
         AND NOT EXISTS (
           SELECT 1 FROM eliminacao_itens i JOIN eliminacoes e ON e.id = i.eliminacao_id
           WHERE i.document_id = d.id AND e.status = ANY($1::varchar[]))
       ORDER BY cl.codigo NULLS LAST, d.exercicio, d.id
       LIMIT 5000`,
      [ATIVAS],
    );
    return rows.map((r) => ({
      id: r.id as string,
      descricao: String(r.descricao ?? ''),
      classificacaoCodigo: (r.classificacao_codigo as string | null) ?? null,
      exercicio: r.exercicio as number,
    }));
  }

  private async locaisPorId(sql: Sql) {
    return sql<Array<{ id: string; parentId: string | null; tipo: TipoLocal; codigo: string }>>`
      SELECT id, parent_id AS "parentId", tipo, codigo FROM locais_fisicos
    `;
  }

  // ===================== Fluxo =====================

  async criar(user: TenantAccessClaims, observacoes: string | null, prazoEditalDias: number, ip: string): Promise<EliminacaoView> {
    const sql = this.sql();
    const ano = Number(hojeIso().slice(0, 4));
    const id = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`eliminacao:${ano}`}))`;
      const prox = await tx<Array<{ n: number }>>`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM eliminacoes WHERE ano = ${ano}`;
      const r = await tx<Array<{ id: string }>>`
        INSERT INTO eliminacoes (numero, ano, observacoes, prazo_edital_dias, criado_por)
        VALUES (${prox[0]!.n}, ${ano}, ${observacoes}, ${prazoEditalDias}, ${user.sub})
        RETURNING id
      `;
      return r[0]!.id;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'eliminacao_criada', resourceType: 'eliminacao', resourceId: id, ip });
    return this.get(id);
  }

  private async exigirStatus(sql: Sql, id: string, esperado: EliminacaoStatus[]): Promise<EliminacaoRow> {
    const r = (await sql<EliminacaoRow[]>`SELECT *, 0::bigint AS total_itens FROM eliminacoes WHERE id = ${id} FOR UPDATE`)[0];
    if (!r) throw new NotFoundException('Eliminacao nao encontrada');
    if (!esperado.includes(r.status)) {
      throw new ConflictException(`Operacao invalida para eliminacao com status "${r.status}"`);
    }
    return r;
  }

  /** Adiciona documentos a listagem (so em rascunho, so elegiveis, so fora de outra listagem ativa). */
  async adicionarItens(user: TenantAccessClaims, id: string, ids: string[], ip: string): Promise<{ adicionados: number }> {
    const sql = this.sql();
    const adicionados = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await this.exigirStatus(tx, id, ['rascunho']);
      ids = await expandirDossies(tx, ids);
      const elegiveis = await tx.unsafe(
        `SELECT d.id, d.module, d.exercicio, d.document_date, d.local_fisico_id, ${DESCRICAO_DOC_SQL} AS descricao,
                cl.codigo AS classificacao_codigo, cl.descricao AS classificacao_descricao
         FROM documents d
         LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
         LEFT JOIN document_types dt ON dt.id = d.document_type_id
         WHERE d.id = ANY($1::uuid[]) AND d.deleted_at IS NULL AND ${LISTA_WHERE.a_eliminar}
           AND NOT EXISTS (
             SELECT 1 FROM eliminacao_itens i JOIN eliminacoes e ON e.id = i.eliminacao_id
             WHERE i.document_id = d.id AND e.status = ANY($2::varchar[]))
         FOR UPDATE OF d`,
        [ids, ATIVAS],
      );
      if (elegiveis.length !== ids.length) {
        throw new BadRequestException(
          `${ids.length - elegiveis.length} documento(s) nao podem entrar na listagem: prazo nao vencido, destinacao nao e eliminacao, ou ja estao em outra listagem`,
        );
      }
      const locais = await this.locaisPorId(tx);
      for (const d of elegiveis) {
        await tx`
          INSERT INTO eliminacao_itens (eliminacao_id, document_id, classificacao_codigo, classificacao_descricao,
                                        descricao, module, exercicio, document_date, local_fisico)
          VALUES (${id}, ${d.id as string}, ${d.classificacao_codigo as string | null}, ${d.classificacao_descricao as string | null},
                  ${String(d.descricao ?? '')}, ${d.module as string}, ${d.exercicio as number}, ${(d.document_date as Date | null) ?? null},
                  ${d.local_fisico_id ? caminhoLocal(d.local_fisico_id as string, locais) : null})
          ON CONFLICT DO NOTHING
        `;
      }
      return elegiveis.length;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'eliminacao_itens_adicionados', resourceType: 'eliminacao', resourceId: id, ip, metadata: { ids } });
    return { adicionados };
  }

  async removerItens(user: TenantAccessClaims, id: string, ids: string[], ip: string): Promise<{ removidos: number }> {
    const sql = this.sql();
    const removidos = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await this.exigirStatus(tx, id, ['rascunho']);
      const r = await tx`DELETE FROM eliminacao_itens WHERE eliminacao_id = ${id} AND document_id = ANY(${ids}) RETURNING document_id`;
      return r.length;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'eliminacao_itens_removidos', resourceType: 'eliminacao', resourceId: id, ip, metadata: { ids } });
    return { removidos };
  }

  async aprovar(
    user: TenantAccessClaims,
    id: string,
    data: { ataAprovacao: string; dataAprovacao: string; comissao: Array<{ nome: string; cargo: string }> },
    ip: string,
  ): Promise<EliminacaoView> {
    const sql = this.sql();
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await this.exigirStatus(tx, id, ['rascunho']);
      const n = await tx<Array<{ n: string }>>`SELECT COUNT(*)::bigint AS n FROM eliminacao_itens WHERE eliminacao_id = ${id}`;
      if (Number(n[0]?.n ?? 0) === 0) throw new BadRequestException('Listagem vazia: adicione documentos antes de aprovar');
      await tx`
        UPDATE eliminacoes SET status = 'aprovada', ata_aprovacao = ${data.ataAprovacao},
          data_aprovacao = ${data.dataAprovacao}, comissao = ${tx.json(data.comissao as never)}
        WHERE id = ${id}
      `;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'eliminacao_aprovada', resourceType: 'eliminacao', resourceId: id, ip, metadata: data });
    return this.get(id);
  }

  async publicarEdital(
    user: TenantAccessClaims,
    id: string,
    data: { veiculoPublicacao: string; dataPublicacaoEdital: string },
    ip: string,
  ): Promise<EliminacaoView> {
    const sql = this.sql();
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const e = await this.exigirStatus(tx, id, ['aprovada']);
      if (e.data_aprovacao && data.dataPublicacaoEdital < iso(e.data_aprovacao)!) {
        throw new BadRequestException('Edital nao pode ser publicado antes da aprovacao da CPAD');
      }
      await tx`
        UPDATE eliminacoes SET status = 'edital_publicado', veiculo_publicacao = ${data.veiculoPublicacao},
          data_publicacao_edital = ${data.dataPublicacaoEdital}
        WHERE id = ${id}
      `;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'eliminacao_edital_publicado', resourceType: 'eliminacao', resourceId: id, ip, metadata: data });
    return this.get(id);
  }

  async cancelar(user: TenantAccessClaims, id: string, motivo: string, ip: string): Promise<EliminacaoView> {
    const sql = this.sql();
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await this.exigirStatus(tx, id, ['rascunho', 'aprovada', 'edital_publicado']);
      await tx`
        UPDATE eliminacoes SET status = 'cancelada', cancelada_em = now(), cancelada_por = ${user.sub},
          motivo_cancelamento = ${motivo}
        WHERE id = ${id}
      `;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'eliminacao_cancelada', resourceType: 'eliminacao', resourceId: id, ip, metadata: { motivo } });
    return this.get(id);
  }

  /**
   * CONCLUSAO — IRREVERSIVEL. So admin, so com edital publicado e prazo
   * cumprido, com frase de confirmacao digitada. Revalida cada documento dentro
   * da transacao (classe/prazo podem ter mudado desde a listagem; emprestado
   * nao pode ser destruido). Grava o registro permanente (metadados + hash de
   * cada arquivo) e so DEPOIS do commit apaga os PDFs do storage.
   */
  async concluir(user: TenantAccessClaims, id: string, confirmacao: string, ip: string): Promise<EliminacaoView> {
    if (user.role !== 'admin') throw new ForbiddenException('Somente administradores concluem eliminacao');
    const ctx = requireTenantContext();
    const sql = this.sql();
    const hoje = hojeIso();

    const { chaves, total } = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const e = await this.exigirStatus(tx, id, ['edital_publicado']);
      if (confirmacao !== fraseConfirmacaoEliminacao(e.numero, e.ano)) {
        throw new BadRequestException(`Confirmacao invalida: digite exatamente "${fraseConfirmacaoEliminacao(e.numero, e.ano)}"`);
      }
      const liberada = dataLiberacaoEliminacao(iso(e.data_publicacao_edital), e.prazo_edital_dias);
      if (!liberada || hoje < liberada) {
        throw new BadRequestException(`Prazo do edital ainda nao terminou: eliminacao liberada a partir de ${dataBr(liberada)}`);
      }

      const itens = await tx<Array<{ document_id: string }>>`
        SELECT document_id FROM eliminacao_itens WHERE eliminacao_id = ${id} FOR UPDATE
      `;
      const ids = itens.map((i) => i.document_id);
      const aptos = await tx.unsafe(
        `SELECT d.id FROM documents d LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
         WHERE d.id = ANY($1::uuid[]) AND d.deleted_at IS NULL AND ${LISTA_WHERE.a_eliminar}
         FOR UPDATE OF d`,
        [ids],
      );
      if (aptos.length !== ids.length) {
        throw new ConflictException(
          `${ids.length - aptos.length} documento(s) deixaram de ser elegiveis (classe, prazo, fase ou exclusao mudaram). Cancele esta eliminacao e monte nova listagem.`,
        );
      }
      const emprestados = await tx`
        SELECT 1 FROM emprestimos WHERE data_devolucao IS NULL
          AND (document_id = ANY(${ids}) OR local_fisico_id IN (SELECT local_fisico_id FROM documents WHERE id = ANY(${ids})))
        LIMIT 1
      `;
      if (emprestados.length > 0) {
        throw new ConflictException('Ha documento (ou caixa) da listagem emprestado. Registre a devolucao antes de eliminar.');
      }

      // Registro permanente: nome + hash de TODOS os arquivos de cada documento.
      const arquivos = await tx<Array<{ document_id: string; nome: string; hash: string; file_key: string; principal: boolean }>>`
        SELECT id AS document_id, original_name AS nome, file_hash AS hash, file_key, true AS principal
        FROM documents WHERE id = ANY(${ids}) AND file_key IS NOT NULL
        UNION ALL
        SELECT document_id, original_name, file_hash, file_key, false FROM document_files WHERE document_id = ANY(${ids})
      `;
      const porDoc = new Map<string, Array<{ nome: string; hash: string; principal: boolean }>>();
      for (const a of arquivos) {
        porDoc.set(a.document_id, [...(porDoc.get(a.document_id) ?? []), { nome: a.nome, hash: a.hash, principal: a.principal }]);
      }
      const locais = await this.locaisPorId(tx);
      const locDocs = await tx<Array<{ id: string; local_fisico_id: string | null }>>`
        SELECT id, local_fisico_id FROM documents WHERE id = ANY(${ids})
      `;
      for (const d of locDocs) {
        await tx`
          UPDATE eliminacao_itens SET arquivos = ${tx.json((porDoc.get(d.id) ?? []) as never)},
            local_fisico = ${d.local_fisico_id ? caminhoLocal(d.local_fisico_id, locais) : null}
          WHERE eliminacao_id = ${id} AND document_id = ${d.id}
        `;
      }

      await tx`DELETE FROM document_textos WHERE document_id = ANY(${ids})`;
      await tx`DELETE FROM document_files WHERE document_id = ANY(${ids})`;
      await tx`
        UPDATE documents SET fase = 'eliminado', status = 'eliminado', file_key = NULL, file_size = NULL, paginas = NULL,
          ocr_status = NULL, eliminado_em = now(), eliminacao_id = ${id}, fase_alterada_em = now(), atualizado_em = now()
        WHERE id = ANY(${ids})
      `;
      await tx`UPDATE eliminacoes SET status = 'concluida', concluida_em = now(), concluida_por = ${user.sub} WHERE id = ${id}`;
      return { chaves: arquivos.map((a) => a.file_key), total: ids.length };
    });

    // Apos o commit: remove os PDFs. Falha aqui nao reverte o registro (o documento
    // ja consta eliminado); a chave orfa vai para o log de auditoria para limpeza.
    const falhas: string[] = [];
    for (const k of chaves) {
      try {
        await this.storage.deleteStrict(ctx.slug, k);
      } catch (err) {
        falhas.push(k);
        this.logger.error(`Falha ao apagar ${k} da eliminacao ${id}: ${(err as Error).message}`);
      }
    }
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'eliminacao_concluida',
      resourceType: 'eliminacao',
      resourceId: id,
      ip,
      metadata: { documentos: total, arquivosApagados: chaves.length - falhas.length, falhasStorage: falhas },
    });
    return this.get(id);
  }

  // ===================== Documentos oficiais (PDF) =====================

  async listagemPdf(id: string): Promise<{ pdf: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const e = await this.get(id);
    const itens = await this.itens(id);
    const porClasse = new Map<string, { descricao: string; qtd: number; min: number | null; max: number | null }>();
    for (const i of itens) {
      const k = i.classificacaoCodigo ?? '—';
      const g = porClasse.get(k) ?? { descricao: i.classificacaoDescricao ?? '—', qtd: 0, min: null, max: null };
      g.qtd++;
      if (i.exercicio) {
        g.min = g.min === null ? i.exercicio : Math.min(g.min, i.exercicio);
        g.max = g.max === null ? i.exercicio : Math.max(g.max, i.exercicio);
      }
      porClasse.set(k, g);
    }
    const pdf = await pdfBuffer((doc) => {
      doc.fontSize(11).font('Helvetica-Bold').text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.fontSize(14).text(`LISTAGEM DE ELIMINAÇÃO DE DOCUMENTOS Nº ${numeroFmt(e)}`, { align: 'center' });
      doc.moveDown(0.3).fontSize(9).font('Helvetica').text('Resolução CONARQ nº 40/2014', { align: 'center' });
      doc.moveDown(1);
      const cab = (y: number) => {
        doc.font('Helvetica-Bold').fontSize(8);
        doc.text('Código', 50, y, { width: 60 });
        doc.text('Assunto / série documental', 110, y, { width: 270 });
        doc.text('Datas-limite', 385, y, { width: 80 });
        doc.text('Quantidade', 470, y, { width: 75, align: 'right' });
        doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor('#999').stroke();
        doc.font('Helvetica').fontSize(8);
        doc.y = y + 16;
      };
      cab(doc.y);
      for (const [cod, g] of porClasse) {
        const h = doc.heightOfString(g.descricao, { width: 270 });
        if (doc.y + h > doc.page.height - 120) {
          doc.addPage();
          cab(doc.y);
        }
        const y = doc.y;
        doc.text(cod, 50, y, { width: 60 });
        doc.text(g.descricao, 110, y, { width: 270 });
        doc.text(g.min ? (g.min === g.max ? `${g.min}` : `${g.min}–${g.max}`) : '—', 385, y, { width: 80 });
        doc.text(`${g.qtd} documento(s)`, 470, y, { width: 75, align: 'right' });
        doc.y = y + Math.max(h, 10) + 4;
      }
      doc.moveDown(0.5).font('Helvetica-Bold').text(`Total: ${itens.length} documento(s)`, 50);
      doc.font('Helvetica');
      if (e.observacoes) doc.moveDown(0.5).text(`Observações: ${e.observacoes}`, 50);

      doc.addPage();
      doc.fontSize(11).font('Helvetica-Bold').text('RELAÇÃO ANALÍTICA DOS DOCUMENTOS', { align: 'center' }).moveDown(0.8);
      doc.font('Helvetica').fontSize(8);
      for (const i of itens) {
        const linha = `${i.classificacaoCodigo ?? '—'}  ·  ${i.descricao}  ·  ${i.exercicio ?? ''}${i.documentDate ? ` (${dataBr(i.documentDate)})` : ''}${i.localFisico ? `  ·  ${i.localFisico}` : ''}`;
        if (doc.y > doc.page.height - 80) doc.addPage();
        doc.text(linha, 50, doc.y, { width: 495 });
        doc.moveDown(0.2);
      }
    });
    return { pdf, nome: `listagem-eliminacao-${e.numero}-${e.ano}.pdf` };
  }

  async editalPdf(id: string): Promise<{ pdf: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const e = await this.get(id);
    if (e.status === 'rascunho') throw new BadRequestException('Edital so apos aprovacao da CPAD');
    const itens = await this.itens(id);
    const classes = [...new Set(itens.map((i) => `${i.classificacaoCodigo ?? ''} ${i.classificacaoDescricao ?? ''}`.trim()))];
    const anos = itens.map((i) => i.exercicio).filter((v): v is number => v !== null);
    const periodo = anos.length ? `${Math.min(...anos)} a ${Math.max(...anos)}` : '—';
    const pdf = await pdfBuffer((doc) => {
      doc.fontSize(11).font('Helvetica-Bold').text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.fontSize(14).text(`EDITAL DE CIÊNCIA DE ELIMINAÇÃO DE DOCUMENTOS Nº ${numeroFmt(e)}`, { align: 'center' });
      doc.moveDown(1.5).font('Helvetica').fontSize(11);
      doc.text(
        `O(A) ${ctx.nome}, em conformidade com a Listagem de Eliminação de Documentos nº ${numeroFmt(e)}, aprovada pela ` +
          `Comissão Permanente de Avaliação de Documentos em ${dataBr(e.dataAprovacao)} (ata nº ${e.ataAprovacao ?? '—'}), ` +
          `faz saber a quem possa interessar que, a partir do ${e.prazoEditalDias}º dia subsequente à data de publicação deste ` +
          `Edital, se não houver oposição, eliminará ${itens.length} documento(s) relativo(s) a:`,
        { align: 'justify' },
      );
      doc.moveDown(0.6).fontSize(10);
      for (const c of classes) doc.text(`• ${c}`, { indent: 20 });
      doc.moveDown(0.6).fontSize(11).text(`Período: ${periodo}.`);
      doc.moveDown(0.6).text(
        'Os interessados, no prazo citado, poderão requerer, às suas expensas, o desentranhamento de documentos ou cópias de ' +
          'peças de processos, mediante petição dirigida à Comissão Permanente de Avaliação de Documentos.',
        { align: 'justify' },
      );
      doc.moveDown(2).text(`${e.veiculoPublicacao ? `Publicado em: ${e.veiculoPublicacao}, ` : ''}${dataBr(e.dataPublicacaoEdital)}`, { align: 'right' });
      doc.moveDown(4);
      const y = doc.y;
      doc.moveTo(170, y).lineTo(430, y).stroke();
      doc.fontSize(9).text(e.comissao[0] ? `${e.comissao[0].nome} — ${e.comissao[0].cargo}` : 'Presidente da CPAD', 150, y + 4, { width: 300, align: 'center' });
    });
    return { pdf, nome: `edital-eliminacao-${e.numero}-${e.ano}.pdf` };
  }

  async termoPdf(id: string): Promise<{ pdf: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const e = await this.get(id);
    if (e.status !== 'concluida') throw new BadRequestException('Termo de eliminacao so apos a conclusao');
    const sql = this.sql();
    const itens = await sql<Array<{ classificacao_codigo: string | null; descricao: string; exercicio: number | null; local_fisico: string | null; arquivos: unknown }>>`
      SELECT classificacao_codigo, descricao, exercicio, local_fisico, arquivos FROM eliminacao_itens
      WHERE eliminacao_id = ${id} ORDER BY local_fisico NULLS LAST, classificacao_codigo, exercicio
    `;
    const concluida = new Date(e.concluidaEm!);
    const pdf = await pdfBuffer((doc) => {
      doc.fontSize(11).font('Helvetica-Bold').text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.fontSize(14).text(`TERMO DE ELIMINAÇÃO DE DOCUMENTOS Nº ${numeroFmt(e)}`, { align: 'center' });
      doc.moveDown(1.5).font('Helvetica').fontSize(11).text(
        `Aos ${concluida.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza', day: 'numeric', month: 'long', year: 'numeric' })}, ` +
          `o(a) ${ctx.nome}, de acordo com a Listagem de Eliminação nº ${numeroFmt(e)}, aprovada pela Comissão Permanente de ` +
          `Avaliação de Documentos em ${dataBr(e.dataAprovacao)} (ata nº ${e.ataAprovacao}), e com o Edital de Ciência de ` +
          `Eliminação publicado em ${e.veiculoPublicacao}, em ${dataBr(e.dataPublicacaoEdital)}, procedeu à eliminação dos ` +
          `arquivos digitais de ${itens.length} documento(s), conforme a Tabela de Temporalidade do órgão. Os metadados e a ` +
          `impressão digital (SHA-256) de cada arquivo eliminado permanecem registrados no sistema, como prova de sua existência e ` +
          `de sua eliminação regular.`,
        { align: 'justify' },
      );
      doc.moveDown(2);
      for (const m of e.comissao) {
        if (doc.y > doc.page.height - 90) doc.addPage();
        const y = doc.y + 18;
        doc.moveTo(170, y).lineTo(430, y).stroke();
        doc.fontSize(9).text(`${m.nome} — ${m.cargo}`, 150, y + 4, { width: 300, align: 'center' });
        doc.y = y + 20;
      }

      const fisicos = itens.filter((i) => i.local_fisico);
      if (fisicos.length > 0) {
        doc.addPage().fontSize(12).font('Helvetica-Bold').text('ANEXO — DESTRUIÇÃO DOS ORIGINAIS EM PAPEL', { align: 'center' });
        doc.moveDown(0.3).fontSize(9).font('Helvetica').text(
          'Os originais abaixo devem ser retirados das caixas indicadas e destruídos (fragmentação), registrando-se a data da destruição.',
          { align: 'center' },
        );
        doc.moveDown(0.8);
        let caixaAtual = '';
        for (const i of fisicos) {
          if (doc.y > doc.page.height - 70) doc.addPage();
          if (i.local_fisico !== caixaAtual) {
            caixaAtual = i.local_fisico!;
            doc.moveDown(0.4).font('Helvetica-Bold').fontSize(9).text(caixaAtual);
            doc.font('Helvetica');
          }
          doc.fontSize(8).text(`[   ]  ${i.classificacao_codigo ?? '—'} · ${i.descricao} · ${i.exercicio ?? ''}`, { indent: 12 });
        }
      }

      doc.addPage().fontSize(12).font('Helvetica-Bold').text('ANEXO — REGISTRO DOS ARQUIVOS DIGITAIS ELIMINADOS', { align: 'center' });
      doc.moveDown(0.8).font('Helvetica').fontSize(7);
      for (const i of itens) {
        const arqs = (typeof i.arquivos === 'string' ? JSON.parse(i.arquivos) : i.arquivos) as Array<{ nome: string; hash: string }>;
        if (doc.y > doc.page.height - 70) doc.addPage();
        doc.font('Helvetica-Bold').text(`${i.classificacao_codigo ?? '—'} · ${i.descricao}`);
        doc.font('Courier');
        for (const a of arqs) doc.text(`   ${a.hash}  ${a.nome}`);
        if (arqs.length === 0) doc.font('Helvetica').text('   (sem arquivo digital)');
        doc.font('Helvetica').moveDown(0.2);
      }
    });
    return { pdf, nome: `termo-eliminacao-${e.numero}-${e.ano}.pdf` };
  }
}
