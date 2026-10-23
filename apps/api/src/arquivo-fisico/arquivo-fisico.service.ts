import PDFKitDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { Sql } from 'postgres';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  TIPO_LOCAL_LABEL,
  caminhoLocal,
  podeConter,
  type ArquivoFisicoResumo,
  type ConteudoLocal,
  type EmprestimoCreateInput,
  type EmprestimoView,
  type LocalFisicoInput,
  type LocalFisicoView,
  type TenantAccessClaims,
  type TipoLocal,
  hojeIso,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { loadEnv } from '../config/env';
import { requireTenantContext } from '../tenancy/tenant-context';

const DESCRICAO_DOC_SQL = `COALESCE(NULLIF(d.descricao, ''), NULLIF(d.historico, ''), d.credor, dt.nome, d.original_name)`;

interface LocalRow {
  id: string;
  parent_id: string | null;
  tipo: TipoLocal;
  codigo: string;
  descricao: string | null;
  capacidade: number | null;
  ativo: boolean;
  total_documentos: string;
  emprestado: boolean;
}

interface EmprestimoRow {
  id: string;
  numero: number;
  ano: number;
  document_id: string | null;
  documento_descricao: string | null;
  local_fisico_id: string | null;
  local_codigo: string | null;
  solicitante_nome: string;
  solicitante_setor: string;
  finalidade: string | null;
  data_saida: Date;
  prazo_devolucao: Date;
  data_devolucao: Date | null;
  registrado_por_nome: string | null;
  recebido_por_nome: string | null;
  atrasado: boolean;
}

function toEmprestimo(r: EmprestimoRow): EmprestimoView {
  return {
    id: r.id,
    numero: r.numero,
    ano: r.ano,
    status: r.data_devolucao ? 'devolvido' : 'aberto',
    atrasado: r.atrasado,
    documentId: r.document_id,
    documentoDescricao: r.documento_descricao,
    localFisicoId: r.local_fisico_id,
    localCodigo: r.local_codigo,
    solicitanteNome: r.solicitante_nome,
    solicitanteSetor: r.solicitante_setor,
    finalidade: r.finalidade,
    dataSaida: r.data_saida.toISOString(),
    prazoDevolucao: r.prazo_devolucao.toISOString().slice(0, 10),
    dataDevolucao: r.data_devolucao ? r.data_devolucao.toISOString() : null,
    registradoPor: r.registrado_por_nome,
    recebidoPor: r.recebido_por_nome,
  };
}

function pdfBuffer(build: (doc: PDFKit.PDFDocument) => void | Promise<void>, opts: PDFKit.PDFDocumentOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument(opts);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve(build(doc))
      .then(() => doc.end())
      .catch(reject);
  });
}

@Injectable()
export class ArquivoFisicoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  private podeVerRestrito(user: TenantAccessClaims): boolean {
    return user.role === 'admin' || user.permissions.includes('acervo_restrito:read');
  }

  // ===================== Locais =====================

  async listLocais(): Promise<LocalFisicoView[]> {
    const rows = await this.sql()<LocalRow[]>`
      SELECT l.id, l.parent_id, l.tipo, l.codigo, l.descricao, l.capacidade, l.ativo,
             (SELECT COUNT(*) FROM documents d WHERE d.local_fisico_id = l.id AND d.deleted_at IS NULL)::bigint AS total_documentos,
             EXISTS (SELECT 1 FROM emprestimos e WHERE e.local_fisico_id = l.id AND e.data_devolucao IS NULL) AS emprestado
      FROM locais_fisicos l
      ORDER BY l.codigo
    `;
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      tipo: r.tipo,
      codigo: r.codigo,
      descricao: r.descricao,
      capacidade: r.capacidade,
      ativo: r.ativo,
      totalDocumentos: Number(r.total_documentos),
      emprestado: r.emprestado,
    }));
  }

  /** Pai precisa existir, estar ativo e ser de nivel "maior"; nao pode criar ciclo. */
  private async validarPai(sql: Sql, parentId: string | null, tipo: TipoLocal, proprioId?: string): Promise<void> {
    if (!parentId) return;
    if (parentId === proprioId) throw new BadRequestException('Local nao pode estar dentro de si mesmo');
    const rows = await sql<Array<{ tipo: TipoLocal; ativo: boolean }>>`SELECT tipo, ativo FROM locais_fisicos WHERE id = ${parentId}`;
    const pai = rows[0];
    if (!pai || !pai.ativo) throw new BadRequestException('Local superior invalido ou inativo');
    if (!podeConter(pai.tipo, tipo)) {
      throw new BadRequestException(`${TIPO_LOCAL_LABEL[tipo]} nao pode ficar dentro de ${TIPO_LOCAL_LABEL[pai.tipo]}`);
    }
    if (proprioId) {
      const ciclo = await sql`
        WITH RECURSIVE sobe AS (
          SELECT id, parent_id FROM locais_fisicos WHERE id = ${parentId}
          UNION ALL
          SELECT l.id, l.parent_id FROM locais_fisicos l JOIN sobe s ON l.id = s.parent_id
        )
        SELECT 1 FROM sobe WHERE id = ${proprioId} LIMIT 1
      `;
      if (ciclo.length > 0) throw new BadRequestException('Movimentacao criaria um ciclo de locais');
    }
  }

  async createLocal(data: LocalFisicoInput, actorId: string, ip: string): Promise<{ id: string }> {
    const sql = this.sql();
    await this.validarPai(sql, data.parentId, data.tipo);
    try {
      const rows = await sql<Array<{ id: string }>>`
        INSERT INTO locais_fisicos (parent_id, tipo, codigo, descricao, capacidade, ativo)
        VALUES (${data.parentId}, ${data.tipo}, ${data.codigo}, ${data.descricao}, ${data.capacidade}, ${data.ativo})
        RETURNING id
      `;
      const id = rows[0]!.id;
      await this.audit.logTenant({ actorId, action: 'local_fisico_created', resourceType: 'local_fisico', resourceId: id, ip, metadata: { ...data } });
      return { id };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Ja existe local com esse codigo neste nivel');
      throw e;
    }
  }

  async updateLocal(id: string, data: Partial<LocalFisicoInput>, actorId: string, ip: string): Promise<void> {
    const sql = this.sql();
    const rows = await sql<LocalRow[]>`SELECT *, 0::bigint AS total_documentos, false AS emprestado FROM locais_fisicos WHERE id = ${id}`;
    const atual = rows[0];
    if (!atual) throw new NotFoundException('Local nao encontrado');
    const m = {
      parentId: data.parentId === undefined ? atual.parent_id : data.parentId,
      tipo: data.tipo ?? atual.tipo,
      codigo: data.codigo ?? atual.codigo,
      descricao: data.descricao === undefined ? atual.descricao : data.descricao,
      capacidade: data.capacidade === undefined ? atual.capacidade : data.capacidade,
      ativo: data.ativo ?? atual.ativo,
    };
    await this.validarPai(sql, m.parentId, m.tipo, id);
    if (m.tipo !== atual.tipo) {
      const filhos = await sql<Array<{ tipo: TipoLocal }>>`SELECT DISTINCT tipo FROM locais_fisicos WHERE parent_id = ${id}`;
      const invalido = filhos.find((f) => !podeConter(m.tipo, f.tipo));
      if (invalido) {
        throw new BadRequestException(`Contem ${TIPO_LOCAL_LABEL[invalido.tipo]}: nao pode virar ${TIPO_LOCAL_LABEL[m.tipo]}`);
      }
    }
    try {
      await sql`
        UPDATE locais_fisicos SET parent_id = ${m.parentId}, tipo = ${m.tipo}, codigo = ${m.codigo},
          descricao = ${m.descricao}, capacidade = ${m.capacidade}, ativo = ${m.ativo}, atualizado_em = now()
        WHERE id = ${id}
      `;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Ja existe local com esse codigo neste nivel');
      throw e;
    }
    await this.audit.logTenant({ actorId, action: 'local_fisico_updated', resourceType: 'local_fisico', resourceId: id, ip, metadata: { antes: atual, depois: m } });
  }

  /** Local com conteudo, sublocais ou historico de emprestimo so e inativado. */
  async deleteLocal(id: string, actorId: string, ip: string): Promise<{ inativado: boolean }> {
    const sql = this.sql();
    const uso = await sql<Array<{ em_uso: boolean }>>`
      SELECT (EXISTS (SELECT 1 FROM documents WHERE local_fisico_id = ${id})
           OR EXISTS (SELECT 1 FROM locais_fisicos WHERE parent_id = ${id})
           OR EXISTS (SELECT 1 FROM emprestimos WHERE local_fisico_id = ${id})) AS em_uso
    `;
    const emUso = uso[0]?.em_uso ?? false;
    if (emUso) {
      await sql`UPDATE locais_fisicos SET ativo = false, atualizado_em = now() WHERE id = ${id}`;
    } else {
      const del = await sql`DELETE FROM locais_fisicos WHERE id = ${id} RETURNING id`;
      if (del.length === 0) throw new NotFoundException('Local nao encontrado');
    }
    await this.audit.logTenant({ actorId, action: emUso ? 'local_fisico_inativado' : 'local_fisico_deleted', resourceType: 'local_fisico', resourceId: id, ip });
    return { inativado: emUso };
  }

  async conteudo(user: TenantAccessClaims, localId: string): Promise<ConteudoLocal> {
    const sql = this.sql();
    const existe = await sql`SELECT 1 FROM locais_fisicos WHERE id = ${localId}`;
    if (existe.length === 0) throw new NotFoundException('Local nao encontrado');
    const pode = this.podeVerRestrito(user);
    const rows = await sql.unsafe(
      `SELECT d.id, d.module, ${DESCRICAO_DOC_SQL} AS descricao, cl.codigo AS classificacao_codigo,
              d.exercicio, d.document_date, d.fase, d.nivel_acesso
       FROM documents d
       LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
       LEFT JOIN document_types dt ON dt.id = d.document_type_id
       WHERE d.local_fisico_id = $1 AND d.deleted_at IS NULL
       ORDER BY cl.codigo NULLS LAST, d.exercicio, d.document_date, d.id`,
      [localId],
    );
    const visiveis = rows.filter((r) => pode || r.nivel_acesso !== 'restrito');
    return {
      itens: visiveis.map((r) => ({
        id: r.id as string,
        module: r.module as string,
        descricao: String(r.descricao ?? ''),
        classificacaoCodigo: (r.classificacao_codigo as string | null) ?? null,
        exercicio: r.exercicio as number,
        documentDate: r.document_date instanceof Date ? r.document_date.toISOString().slice(0, 10) : null,
        fase: r.fase as string,
      })),
      ocultos: rows.length - visiveis.length,
    };
  }

  /** Vincula documentos ao local (original em papel guardado ali). */
  async vincular(user: TenantAccessClaims, localId: string, ids: string[], ip: string): Promise<{ vinculados: number }> {
    const sql = this.sql();
    const local = await sql`SELECT 1 FROM locais_fisicos WHERE id = ${localId} AND ativo`;
    if (local.length === 0) throw new BadRequestException('Local fisico invalido ou inativo');
    const rows = await sql<Array<{ id: string }>>`
      UPDATE documents SET local_fisico_id = ${localId}, possui_original_fisico = true, atualizado_em = now()
      WHERE id = ANY(${ids}) AND deleted_at IS NULL
        AND (${this.podeVerRestrito(user)} OR nivel_acesso = 'publico')
      RETURNING id
    `;
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'documentos_vinculados_local',
      resourceType: 'local_fisico',
      resourceId: localId,
      ip,
      metadata: { ids: rows.map((r) => r.id) },
    });
    return { vinculados: rows.length };
  }

  // ===================== PDFs =====================

  /** Etiqueta para colar na caixa: codigo grande, caminho, faixa de exercicios/classes e QR para a tela interna. */
  async etiquetaPdf(localId: string): Promise<{ pdf: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const sql = this.sql();
    const locais = await this.listLocais();
    const local = locais.find((l) => l.id === localId);
    if (!local) throw new NotFoundException('Local nao encontrado');
    const resumo = await sql<Array<{ min: number | null; max: number | null; classes: string[] | null; n: string }>>`
      SELECT MIN(d.exercicio) AS min, MAX(d.exercicio) AS max,
             array_agg(DISTINCT cl.codigo) FILTER (WHERE cl.codigo IS NOT NULL) AS classes,
             COUNT(*)::bigint AS n
      FROM documents d LEFT JOIN classificacoes cl ON cl.id = d.classificacao_id
      WHERE d.local_fisico_id = ${localId} AND d.deleted_at IS NULL
    `;
    const r = resumo[0];
    const url = `${loadEnv().FRONTEND_URL.replace(/\/+$/, '')}/${ctx.slug}/arquivo-fisico?local=${localId}`;
    const qr = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
    const mm = (v: number) => (v * 72) / 25.4;

    const pdf = await pdfBuffer(
      (doc) => {
        const w = mm(150);
        const m = mm(6);
        doc.rect(m / 2, m / 2, w - m, mm(100) - m).lineWidth(1.5).stroke('#1e2a4a');
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e2a4a').text(ctx.nome.toUpperCase(), m, m, { width: w - 2 * m - mm(32) });
        doc.fontSize(8).font('Helvetica').fillColor('#555').text(caminhoLocal(local.parentId, locais) || 'Sem local superior', { width: w - 2 * m - mm(32) });
        doc.image(qr, w - m - mm(28), m, { width: mm(28) });
        doc.fontSize(9).fillColor('#555').text(TIPO_LOCAL_LABEL[local.tipo].toUpperCase(), m, mm(30));
        doc.fontSize(40).font('Helvetica-Bold').fillColor('#000').text(local.codigo, m, mm(35), { width: w - 2 * m });
        doc.fontSize(10).font('Helvetica').fillColor('#222');
        if (local.descricao) doc.text(local.descricao, { width: w - 2 * m });
        doc.moveDown(0.4);
        const exercicios = r?.min ? (r.min === r.max ? `${r.min}` : `${r.min} a ${r.max}`) : '—';
        doc.text(`Exercícios: ${exercicios}    Documentos: ${Number(r?.n ?? 0)}`);
        if (r?.classes?.length) doc.text(`Classes: ${r.classes.slice(0, 12).join(', ')}${r.classes.length > 12 ? '…' : ''}`, { width: w - 2 * m });
      },
      { size: [mm(150), mm(100)], margin: 0 },
    );
    return { pdf, nome: `etiqueta-${local.codigo.replace(/[^\w.-]+/g, '_')}.pdf` };
  }

  /** Espelho da caixa: lista do conteudo para guardar dentro da propria caixa. */
  async espelhoPdf(user: TenantAccessClaims, localId: string): Promise<{ pdf: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const locais = await this.listLocais();
    const local = locais.find((l) => l.id === localId);
    if (!local) throw new NotFoundException('Local nao encontrado');
    const { itens, ocultos } = await this.conteudo(user, localId);

    const pdf = await pdfBuffer(
      (doc) => {
        const bottom = doc.page.height - doc.page.margins.bottom;
        const col = { cl: 40, desc: 95, ex: 410, data: 450, fase: 505 };
        const cab = () => {
          doc.font('Helvetica-Bold').fontSize(8);
          const y = doc.y;
          doc.text('Classe', col.cl, y, { width: 55 });
          doc.text('Documento', col.desc, y, { width: 310 });
          doc.text('Exerc.', col.ex, y, { width: 40 });
          doc.text('Data', col.data, y, { width: 55 });
          doc.text('Fase', col.fase, y, { width: 50 });
          doc.moveDown(0.4);
          doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#999').stroke();
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(8);
        };
        doc.fontSize(11).font('Helvetica-Bold').text(ctx.nome.toUpperCase(), { align: 'center' });
        doc.fontSize(14).text(`ESPELHO DE ${TIPO_LOCAL_LABEL[local.tipo].toUpperCase()} ${local.codigo}`, { align: 'center' });
        doc.fontSize(9).font('Helvetica').text(caminhoLocal(local.id, locais), { align: 'center' });
        doc.moveDown(0.5).text(`Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })} — ${itens.length} documento(s)${ocultos ? ` + ${ocultos} de acesso restrito` : ''}`);
        doc.moveDown(0.8);
        cab();
        for (const it of itens) {
          const h = doc.heightOfString(it.descricao, { width: 310 });
          if (doc.y + h > bottom - 20) {
            doc.addPage();
            cab();
          }
          const y = doc.y;
          doc.text(it.classificacaoCodigo ?? '—', col.cl, y, { width: 55 });
          doc.text(it.descricao, col.desc, y, { width: 310 });
          doc.text(String(it.exercicio), col.ex, y, { width: 40 });
          doc.text(it.documentDate ? new Date(`${it.documentDate}T12:00:00`).toLocaleDateString('pt-BR') : '—', col.data, y, { width: 55 });
          doc.text(it.fase, col.fase, y, { width: 50 });
          doc.y = y + Math.max(h, 10) + 3;
        }
      },
      { size: 'A4', margin: 40 },
    );
    return { pdf, nome: `espelho-${local.codigo.replace(/[^\w.-]+/g, '_')}.pdf` };
  }

  // ===================== Emprestimos =====================

  private async emprestimoRows(sql: Sql, where: ReturnType<Sql>): Promise<EmprestimoView[]> {
    const rows = await sql<EmprestimoRow[]>`
      SELECT e.id, e.numero, e.ano, e.document_id, e.local_fisico_id, e.solicitante_nome, e.solicitante_setor,
             e.finalidade, e.data_saida, e.prazo_devolucao, e.data_devolucao,
             COALESCE(NULLIF(d.descricao, ''), NULLIF(d.historico, ''), d.credor, d.original_name) AS documento_descricao,
             l.codigo AS local_codigo, ur.nome AS registrado_por_nome, uv.nome AS recebido_por_nome,
             (e.data_devolucao IS NULL AND e.prazo_devolucao < (now() AT TIME ZONE 'America/Fortaleza')::date) AS atrasado
      FROM emprestimos e
      LEFT JOIN documents d ON d.id = e.document_id
      LEFT JOIN locais_fisicos l ON l.id = e.local_fisico_id
      LEFT JOIN users ur ON ur.id = e.registrado_por
      LEFT JOIN users uv ON uv.id = e.recebido_por
      WHERE ${where}
      ORDER BY (e.data_devolucao IS NULL) DESC, e.prazo_devolucao ASC, e.data_saida DESC
      LIMIT 500
    `;
    return rows.map(toEmprestimo);
  }

  async listEmprestimos(user: TenantAccessClaims, status: 'abertos' | 'atrasados' | 'todos'): Promise<EmprestimoView[]> {
    const sql = this.sql();
    const pode = this.podeVerRestrito(user);
    return this.emprestimoRows(
      sql,
      sql`
        (${status} = 'todos' OR e.data_devolucao IS NULL)
        AND (${status} <> 'atrasados' OR e.prazo_devolucao < (now() AT TIME ZONE 'America/Fortaleza')::date)
        AND (e.document_id IS NULL OR ${pode} OR d.nivel_acesso = 'publico')
      `,
    );
  }

  async emprestar(user: TenantAccessClaims, data: EmprestimoCreateInput, ip: string): Promise<EmprestimoView> {
    const sql = this.sql();
    const hoje = hojeIso();
    if (data.prazoDevolucao < hoje) throw new BadRequestException('Prazo de devolucao nao pode ser no passado');
    if (data.documentId) {
      const doc = await sql<Array<{ possui_original_fisico: boolean; nivel_acesso: string }>>`
        SELECT possui_original_fisico, nivel_acesso FROM documents WHERE id = ${data.documentId} AND deleted_at IS NULL
      `;
      if (!doc[0] || (doc[0].nivel_acesso === 'restrito' && !this.podeVerRestrito(user))) {
        throw new NotFoundException('Documento nao encontrado');
      }
      if (!doc[0].possui_original_fisico) throw new BadRequestException('Documento nao possui original fisico cadastrado');
    } else {
      const loc = await sql`SELECT 1 FROM locais_fisicos WHERE id = ${data.localFisicoId} AND ativo`;
      if (loc.length === 0) throw new NotFoundException('Local nao encontrado');
    }
    const ano = new Date().getFullYear();
    let id: string;
    try {
      id = await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        await tx`SELECT pg_advisory_xact_lock(hashtext(${`emprestimo:${ano}`}))`;
        const prox = await tx<Array<{ n: number }>>`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM emprestimos WHERE ano = ${ano}`;
        const rows = await tx<Array<{ id: string }>>`
          INSERT INTO emprestimos (numero, ano, document_id, local_fisico_id, solicitante_nome, solicitante_setor,
                                   finalidade, registrado_por, prazo_devolucao)
          VALUES (${prox[0]!.n}, ${ano}, ${data.documentId}, ${data.localFisicoId}, ${data.solicitanteNome},
                  ${data.solicitanteSetor}, ${data.finalidade}, ${user.sub}, ${data.prazoDevolucao})
          RETURNING id
        `;
        return rows[0]!.id;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Item ja esta emprestado (emprestimo em aberto)');
      throw e;
    }
    await this.audit.logTenant({ actorId: user.sub, action: 'emprestimo_registrado', resourceType: 'emprestimo', resourceId: id, ip, metadata: { ...data } });
    return (await this.emprestimoRows(sql, sql`e.id = ${id}`))[0]!;
  }

  async devolver(user: TenantAccessClaims, id: string, observacao: string | null, ip: string): Promise<EmprestimoView> {
    const sql = this.sql();
    const rows = await sql`
      UPDATE emprestimos SET data_devolucao = now(), recebido_por = ${user.sub}, observacao_devolucao = ${observacao}
      WHERE id = ${id} AND data_devolucao IS NULL
      RETURNING id
    `;
    if (rows.length === 0) throw new BadRequestException('Emprestimo nao encontrado ou ja devolvido');
    await this.audit.logTenant({ actorId: user.sub, action: 'emprestimo_devolvido', resourceType: 'emprestimo', resourceId: id, ip, metadata: { observacao } });
    return (await this.emprestimoRows(sql, sql`e.id = ${id}`))[0]!;
  }

  async termoPdf(user: TenantAccessClaims, id: string): Promise<{ pdf: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const sql = this.sql();
    const pode = this.podeVerRestrito(user);
    const [e] = await this.emprestimoRows(
      sql,
      sql`e.id = ${id} AND (e.document_id IS NULL OR ${pode} OR d.nivel_acesso = 'publico')`,
    );
    if (!e) throw new NotFoundException('Emprestimo nao encontrado');
    const locais = await this.listLocais();
    const item = e.documentId
      ? `Documento: ${e.documentoDescricao ?? e.documentId}`
      : `${caminhoLocal(e.localFisicoId, locais)} (caixa inteira)`;
    const dt = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR');

    const pdf = await pdfBuffer(
      (doc) => {
        doc.fontSize(11).font('Helvetica-Bold').text(ctx.nome.toUpperCase(), { align: 'center' });
        doc.fontSize(14).text(`TERMO DE EMPRÉSTIMO Nº ${String(e.numero).padStart(3, '0')}/${e.ano}`, { align: 'center' });
        doc.moveDown(1.5).font('Helvetica').fontSize(10);
        doc.text(`Solicitante: ${e.solicitanteNome}`);
        doc.text(`Setor: ${e.solicitanteSetor}`);
        if (e.finalidade) doc.text(`Finalidade: ${e.finalidade}`);
        doc.moveDown(0.5).text(item);
        doc.moveDown(0.5).text(`Data de saída: ${dt(e.dataSaida)}        Devolução prevista: ${dt(e.prazoDevolucao)}`);
        doc.text(`Registrado por: ${e.registradoPor ?? '—'}`);
        if (e.dataDevolucao) doc.text(`Devolvido em ${dt(e.dataDevolucao)} — recebido por ${e.recebidoPor ?? '—'}`);
        doc.moveDown(1.2).fontSize(9).text(
          'O solicitante declara ter recebido o(s) documento(s) acima em bom estado de conservação e se compromete a ' +
            'devolvê-lo(s) na data prevista, íntegro(s) e na mesma ordem, sem retirar, acrescentar ou substituir folhas.',
          { align: 'justify' },
        );
        doc.moveDown(5);
        const y = doc.y;
        doc.moveTo(60, y).lineTo(260, y).stroke();
        doc.moveTo(335, y).lineTo(535, y).stroke();
        doc.fontSize(8).text('Solicitante', 60, y + 4, { width: 200, align: 'center' });
        doc.text('Responsável pelo Arquivo', 335, y + 4, { width: 200, align: 'center' });
      },
      { size: 'A4', margin: 50 },
    );
    return { pdf, nome: `termo-emprestimo-${e.numero}-${e.ano}.pdf` };
  }

  async resumo(): Promise<ArquivoFisicoResumo> {
    const rows = await this.sql()<Array<{ caixas: string; docs: string; abertos: string; atrasados: string }>>`
      SELECT (SELECT COUNT(*) FROM locais_fisicos WHERE tipo = 'caixa' AND ativo)::bigint AS caixas,
             (SELECT COUNT(*) FROM documents WHERE possui_original_fisico AND deleted_at IS NULL)::bigint AS docs,
             (SELECT COUNT(*) FROM emprestimos WHERE data_devolucao IS NULL)::bigint AS abertos,
             (SELECT COUNT(*) FROM emprestimos WHERE data_devolucao IS NULL AND prazo_devolucao < (now() AT TIME ZONE 'America/Fortaleza')::date)::bigint AS atrasados
    `;
    const r = rows[0]!;
    return {
      caixas: Number(r.caixas),
      documentosComOriginal: Number(r.docs),
      emprestimosAbertos: Number(r.abertos),
      emprestimosAtrasados: Number(r.atrasados),
    };
  }
}
