import { Injectable, NotFoundException } from '@nestjs/common';
import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  CAMPOS_PADRAO_DICIONARIO,
  MANUAL,
  PADRAO_NOMES_EXPORTACAO,
  type TenantAccessClaims,
  type TreinamentoInput,
  type TreinamentoView,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';

function pdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((ok, falha) => {
    const doc = new PDFKitDocument({ size: 'A4', margin: 50, bufferPages: true });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', falha);
    try {
      build(doc);
      const total = doc.bufferedPageRange().count;
      for (let i = 0; i < total; i++) {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(7).fillColor('#94a3b8').text(`Página ${i + 1} de ${total}`, 50, doc.page.height - 35, { width: doc.page.width - 100, align: 'right' });
      }
      doc.end();
    } catch (e) {
      falha(e as Error);
    }
  });
}

interface TreinamentoRow {
  id: string;
  titulo: string;
  data: Date;
  carga_horaria: string | null;
  instrutor: string | null;
  local: string | null;
  conteudo: string | null;
  modalidade: 'presencial' | 'remoto';
  participantes: unknown;
  criado_por_nome: string | null;
  criado_em: Date;
}

/** Manual do usuario em PDF e o registro de treinamentos (lista de presenca). */
@Injectable()
export class AjudaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  manualPdf(): Promise<{ arquivo: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const areas = [...new Set(MANUAL.map((t) => t.area))];
    return pdf((doc) => {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.fontSize(18).text('Manual do Usuário — jDoc', { align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text('Gestão documental, arquivo e digitalização', { align: 'center' });
      doc.moveDown(1.5);
      for (const area of areas) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#1d4ed8').text(area);
        doc.moveDown(0.3);
        for (const t of MANUAL.filter((x) => x.area === area)) {
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(t.titulo);
          doc.font('Helvetica').fontSize(9).fillColor('#475569').text(t.resumo);
          doc.fillColor('#0f172a').moveDown(0.2);
          t.passos.forEach((p, i) => doc.fontSize(9).text(`${i + 1}. ${p}`, { indent: 10 }));
          for (const d of t.dicas ?? []) doc.fontSize(8).fillColor('#475569').text(`Dica: ${d}`, { indent: 10 });
          doc.fillColor('#0f172a').moveDown(0.6);
        }
        doc.moveDown(0.4);
      }
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1d4ed8').text('Estrutura de arquivos e metadados');
      doc.font('Helvetica').fontSize(9).fillColor('#0f172a').moveDown(0.3).text(`Padrão de nomes e pastas na exportação: ${PADRAO_NOMES_EXPORTACAO}`);
      doc.moveDown(0.5);
      for (const c of CAMPOS_PADRAO_DICIONARIO) {
        doc.font('Helvetica-Bold').fontSize(9).text(`${c.rotulo} (${c.campo})`, { continued: true });
        doc.font('Helvetica').text(` — ${c.descricao}. Formato: ${c.formato}${c.obrigatorio ? '. Obrigatório' : ''}.`);
      }
    }).then((arquivo) => ({ arquivo, nome: 'manual-do-usuario-jdoc.pdf' }));
  }

  private view(r: TreinamentoRow): TreinamentoView {
    const participantes = (typeof r.participantes === 'string' ? JSON.parse(r.participantes) : r.participantes) as TreinamentoView['participantes'];
    return {
      id: r.id,
      titulo: r.titulo,
      data: r.data.toISOString().slice(0, 10),
      cargaHoraria: r.carga_horaria === null ? null : Number(r.carga_horaria),
      instrutor: r.instrutor ?? '',
      local: r.local ?? '',
      conteudo: r.conteudo ?? '',
      modalidade: r.modalidade,
      participantes: participantes ?? [],
      criadoPor: r.criado_por_nome,
      criadoEm: r.criado_em.toISOString(),
    };
  }

  async listar(): Promise<TreinamentoView[]> {
    const rows = await this.sql()<TreinamentoRow[]>`
      SELECT t.*, u.nome AS criado_por_nome FROM treinamentos t LEFT JOIN users u ON u.id = t.criado_por ORDER BY t.data DESC, t.criado_em DESC
    `;
    return rows.map((r) => this.view(r));
  }

  private async obter(id: string): Promise<TreinamentoView> {
    const [r] = await this.sql()<TreinamentoRow[]>`
      SELECT t.*, u.nome AS criado_por_nome FROM treinamentos t LEFT JOIN users u ON u.id = t.criado_por WHERE t.id = ${id}
    `;
    if (!r) throw new NotFoundException('Treinamento não encontrado');
    return this.view(r);
  }

  async criar(user: TenantAccessClaims, input: TreinamentoInput, ip: string): Promise<TreinamentoView> {
    const sql = this.sql();
    const [r] = await sql<Array<{ id: string }>>`
      INSERT INTO treinamentos (titulo, data, carga_horaria, instrutor, local, conteudo, modalidade, participantes, criado_por)
      VALUES (${input.titulo}, ${input.data}, ${input.cargaHoraria ?? null}, ${input.instrutor || null}, ${input.local || null},
              ${input.conteudo || null}, ${input.modalidade}, ${sql.json(input.participantes as never)}, ${user.sub})
      RETURNING id
    `;
    await this.audit.logTenant({ actorId: user.sub, action: 'treinamento_registrado', resourceType: 'treinamento', resourceId: r!.id, ip, metadata: { titulo: input.titulo, participantes: input.participantes.length } });
    return this.obter(r!.id);
  }

  async atualizar(user: TenantAccessClaims, id: string, input: TreinamentoInput, ip: string): Promise<TreinamentoView> {
    const sql = this.sql();
    const r = await sql`
      UPDATE treinamentos SET titulo = ${input.titulo}, data = ${input.data}, carga_horaria = ${input.cargaHoraria ?? null},
        instrutor = ${input.instrutor || null}, local = ${input.local || null}, conteudo = ${input.conteudo || null},
        modalidade = ${input.modalidade}, participantes = ${sql.json(input.participantes as never)}, atualizado_em = now()
      WHERE id = ${id}
    `;
    if (r.count === 0) throw new NotFoundException('Treinamento não encontrado');
    await this.audit.logTenant({ actorId: user.sub, action: 'treinamento_alterado', resourceType: 'treinamento', resourceId: id, ip });
    return this.obter(id);
  }

  async excluir(user: TenantAccessClaims, id: string, ip: string): Promise<void> {
    const r = await this.sql()`DELETE FROM treinamentos WHERE id = ${id}`;
    if (r.count === 0) throw new NotFoundException('Treinamento não encontrado');
    await this.audit.logTenant({ actorId: user.sub, action: 'treinamento_excluido', resourceType: 'treinamento', resourceId: id, ip });
  }

  /** Lista de presenca para assinatura (ou ja preenchida, com os participantes registrados). */
  async listaPresenca(id: string): Promise<{ arquivo: Buffer; nome: string }> {
    const ctx = requireTenantContext();
    const t = await this.obter(id);
    const linhas = Math.max(t.participantes.length, 15);
    const arquivo = await pdf((doc) => {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.fontSize(14).text('LISTA DE PRESENÇA — CAPACITAÇÃO', { align: 'center' });
      doc.moveDown(1).font('Helvetica').fontSize(9);
      doc.text(`Treinamento: ${t.titulo}`);
      doc.text(`Data: ${t.data.split('-').reverse().join('/')}${t.cargaHoraria ? ` · Carga horária: ${t.cargaHoraria} h` : ''} · ${t.modalidade === 'remoto' ? 'Remoto' : 'Presencial'}${t.local ? ` · ${t.local}` : ''}`);
      if (t.instrutor) doc.text(`Instrutor(a): ${t.instrutor}`);
      if (t.conteudo) doc.moveDown(0.3).text(`Conteúdo: ${t.conteudo}`);
      doc.moveDown(0.8);
      const x = [50, 75, 245, 345, 455];
      const y0 = doc.y;
      doc.font('Helvetica-Bold').fontSize(8);
      ['Nº', 'Nome', 'Cargo', 'Secretaria', 'Assinatura'].forEach((h, i) => doc.text(h, x[i]!, y0));
      doc.moveTo(50, y0 + 12).lineTo(545, y0 + 12).stroke('#cbd5e1');
      let y = y0 + 18;
      doc.font('Helvetica').fontSize(8);
      for (let i = 0; i < linhas; i++) {
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 60;
        }
        const p = t.participantes[i];
        doc.text(String(i + 1), x[0]!, y);
        if (p) {
          doc.text(p.nome, x[1]!, y, { width: 165 });
          doc.text(p.cargo ?? '', x[2]!, y, { width: 95 });
          doc.text(p.secretaria ?? '', x[3]!, y, { width: 105 });
        }
        doc.moveTo(x[4]!, y + 10).lineTo(545, y + 10).stroke('#cbd5e1');
        y += 22;
      }
      doc.x = 50;
      doc.y = Math.min(y + 30, doc.page.height - 80);
      doc.moveTo(170, doc.y).lineTo(425, doc.y).stroke('#0f172a');
      doc.text('Instrutor(a)', 170, doc.y + 4, { width: 255, align: 'center' });
    });
    return { arquivo, nome: `lista-presenca-${t.data}.pdf` };
  }
}
