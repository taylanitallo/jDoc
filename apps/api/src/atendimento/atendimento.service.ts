import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  CANAL_LABEL,
  FORMA_ACESSO_LABEL,
  LAI_ALERTA_DIAS,
  VINCULO_LABEL,
  prazoFinalLai,
  type AtendimentoConcluirInput,
  type AtendimentoCreateInput,
  type AtendimentoDocumento,
  type AtendimentoResumo,
  type AtendimentosPage,
  type AtendimentosQuery,
  type AtendimentoView,
  type TenantAccessClaims,
  hojeIso,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';

interface Row {
  id: string;
  numero: number;
  ano: number;
  status: AtendimentoView['status'];
  solicitante_nome: string;
  solicitante_documento: string | null;
  solicitante_contato: string | null;
  vinculo: AtendimentoView['vinculo'];
  setor_orgao: string | null;
  canal: AtendimentoView['canal'];
  finalidade: string;
  forma_acesso: AtendimentoView['formaAcesso'];
  documentos_nao_cadastrados: string | null;
  justificativa_restrito: string | null;
  data_pedido: Date;
  prazo_final: Date;
  prorrogado: boolean;
  justificativa_prorrogacao: string | null;
  resposta: string | null;
  concluido_em: Date | null;
  registrado_por_nome: string | null;
  concluido_por_nome: string | null;
  documentos: AtendimentoDocumento[] | null;
}

const DIA_MS = 86_400_000;
const protocolo = (numero: number, ano: number) => `ATD ${String(numero).padStart(3, '0')}/${ano}`;

/** Identificacao legivel do documento (mesma regra do inventario). */
const IDENT = `COALESCE(NULLIF(concat_ws(' — ',
    CASE WHEN d.metadados ? 'numero' THEN concat_ws(' ', t.nome, 'nº', d.metadados->>'numero') END,
    CASE WHEN d.doc_caixa IS NOT NULL THEN 'Doc. Caixa ' || d.doc_caixa END,
    NULLIF(d.descricao, ''), NULLIF(d.historico, '')), ''), d.original_name, 'Documento')`;

/**
 * Atendimento ao publico e consultas ao acervo (LAI). Regras:
 * - documento restrito so entra por quem pode ve-lo, e com justificativa registrada;
 * - quem nao ve restritos recebe "Documento restrito" no lugar do titulo;
 * - indeferimento exige fundamentacao; prorrogacao (+10 dias) uma vez, com justificativa;
 * - atendimento concluido nao volta a ser editado (historico).
 */
@Injectable()
export class AtendimentoService {
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

  private toView(r: Row, user: TenantAccessClaims): AtendimentoView {
    const ve = this.podeVerRestrito(user);
    const concluido = r.status !== 'aberto';
    return {
      id: r.id,
      protocolo: protocolo(r.numero, r.ano),
      status: r.status,
      solicitanteNome: r.solicitante_nome,
      solicitanteDocumento: r.solicitante_documento,
      solicitanteContato: r.solicitante_contato,
      vinculo: r.vinculo,
      setorOrgao: r.setor_orgao,
      canal: r.canal,
      finalidade: r.finalidade,
      formaAcesso: r.forma_acesso,
      documentos: (r.documentos ?? []).map((d) => (d.restrito && !ve ? { ...d, identificacao: 'Documento restrito' } : d)),
      documentosNaoCadastrados: r.documentos_nao_cadastrados,
      justificativaRestrito: r.justificativa_restrito,
      dataPedido: r.data_pedido.toISOString(),
      prazoFinal: r.prazo_final.toISOString(),
      prorrogado: r.prorrogado,
      justificativaProrrogacao: r.justificativa_prorrogacao,
      resposta: r.resposta,
      concluidoEm: r.concluido_em?.toISOString() ?? null,
      registradoPor: r.registrado_por_nome,
      concluidoPor: r.concluido_por_nome,
      diasRestantes: concluido ? null : Math.ceil((r.prazo_final.getTime() - Date.now()) / DIA_MS),
    };
  }

  private selecionar(sql: Sql, where: ReturnType<Sql>, limite = 1, offset = 0) {
    return sql<Row[]>`
      SELECT a.*, ur.nome AS registrado_por_nome, uc.nome AS concluido_por_nome,
        (SELECT json_agg(json_build_object(
                  'id', d.id, 'identificacao', ${sql.unsafe(IDENT)},
                  'restrito', COALESCE(d.nivel_acesso, 'publico') = 'restrito', 'modulo', d.module)
                ORDER BY d.document_date NULLS LAST)
           FROM atendimento_documentos ad
           JOIN documents d ON d.id = ad.document_id
           LEFT JOIN document_types t ON t.id = d.document_type_id
          WHERE ad.atendimento_id = a.id) AS documentos
      FROM atendimentos a
      LEFT JOIN users ur ON ur.id = a.registrado_por
      LEFT JOIN users uc ON uc.id = a.concluido_por
      WHERE ${where}
      ORDER BY (a.status = 'aberto') DESC, CASE WHEN a.status = 'aberto' THEN a.prazo_final END ASC, a.data_pedido DESC
      LIMIT ${limite} OFFSET ${offset}
    `;
  }

  private filtro(sql: Sql, q: AtendimentosQuery): ReturnType<Sql> {
    const partes: Array<ReturnType<Sql>> = [sql`true`];
    if (q.situacao === 'abertos') partes.push(sql`a.status = 'aberto'`);
    if (q.situacao === 'atrasados') partes.push(sql`a.status = 'aberto' AND a.prazo_final < now()`);
    if (q.situacao === 'concluidos') partes.push(sql`a.status <> 'aberto'`);
    if (q.documentId) partes.push(sql`EXISTS (SELECT 1 FROM atendimento_documentos x WHERE x.atendimento_id = a.id AND x.document_id = ${q.documentId})`);
    if (q.q) {
      const termo = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const num = /^\d+$/.test(q.q) ? Number(q.q) : -1;
      partes.push(sql`(a.solicitante_nome ILIKE ${termo} OR a.finalidade ILIKE ${termo} OR a.setor_orgao ILIKE ${termo} OR a.numero = ${num})`);
    }
    return partes.reduce((acc, p) => sql`${acc} AND ${p}`);
  }

  async listar(user: TenantAccessClaims, q: AtendimentosQuery): Promise<AtendimentosPage> {
    const sql = this.sql();
    const w = this.filtro(sql, q);
    const [c] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM atendimentos a WHERE ${w}`;
    const rows = await this.selecionar(sql, w, q.pageSize, (q.page - 1) * q.pageSize);
    return { items: rows.map((r) => this.toView(r, user)), total: c?.n ?? 0, page: q.page, pageSize: q.pageSize };
  }

  async obter(user: TenantAccessClaims, id: string): Promise<AtendimentoView> {
    const sql = this.sql();
    const r = (await this.selecionar(sql, sql`a.id = ${id}`))[0];
    if (!r) throw new NotFoundException('Atendimento não encontrado');
    return this.toView(r, user);
  }

  async resumo(): Promise<AtendimentoResumo> {
    const [r] = await this.sql()<
      Array<{ abertos: number; vencendo: number; atrasados: number; concluidos_mes: number; media: string | null }>
    >`
      SELECT count(*) FILTER (WHERE status = 'aberto')::int AS abertos,
             count(*) FILTER (WHERE status = 'aberto' AND prazo_final >= now() AND prazo_final < now() + make_interval(days => ${LAI_ALERTA_DIAS}))::int AS vencendo,
             count(*) FILTER (WHERE status = 'aberto' AND prazo_final < now())::int AS atrasados,
             count(*) FILTER (WHERE status IN ('atendido', 'indeferido') AND concluido_em >= date_trunc('month', now()))::int AS concluidos_mes,
             avg(EXTRACT(EPOCH FROM (concluido_em - data_pedido)) / 86400)
               FILTER (WHERE status IN ('atendido', 'indeferido') AND concluido_em > now() - interval '12 months')::text AS media
      FROM atendimentos
    `;
    return {
      abertos: r?.abertos ?? 0,
      vencendo: r?.vencendo ?? 0,
      atrasados: r?.atrasados ?? 0,
      concluidosNoMes: r?.concluidos_mes ?? 0,
      mediaDiasResposta: r?.media ? Math.round(Number(r.media) * 10) / 10 : null,
    };
  }

  async criar(user: TenantAccessClaims, input: AtendimentoCreateInput, ip: string): Promise<AtendimentoView> {
    const sql = this.sql();
    const ids = [...new Set(input.documentIds)];
    if (ids.length > 0) {
      const docs = await sql<Array<{ id: string; restrito: boolean }>>`
        SELECT id, COALESCE(nivel_acesso, 'publico') = 'restrito' AS restrito
        FROM documents WHERE id = ANY(${ids}) AND deleted_at IS NULL
      `;
      if (docs.length !== ids.length) throw new BadRequestException('Algum documento informado não existe ou está na lixeira');
      const temRestrito = docs.some((d) => d.restrito);
      // Quem nao ve restrito tambem nao pode conceder acesso a ele (nem confirmar que existe).
      if (temRestrito && !this.podeVerRestrito(user)) throw new BadRequestException('Algum documento informado não existe ou está na lixeira');
      if (temRestrito && (input.justificativaRestrito ?? '').trim().length < 10) {
        throw new BadRequestException('Há documento restrito no pedido: registre a justificativa da autorização de acesso (mín. 10 caracteres).');
      }
    }
    if (ids.length === 0 && !(input.documentosNaoCadastrados ?? '').trim()) {
      throw new BadRequestException('Informe os documentos consultados (do sistema ou descritos no campo livre).');
    }
    const dataPedido = input.dataPedido ?? new Date();
    if (dataPedido.getTime() > Date.now() + 60_000) throw new BadRequestException('A data do pedido não pode ser futura');

    const id = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const ano = Number(hojeIso(dataPedido).slice(0, 4));
      // Numeracao sequencial por ano sem colisao entre pedidos simultaneos.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'atendimento-' + ano}))`;
      const [n] = await tx<Array<{ proximo: number }>>`SELECT COALESCE(max(numero), 0) + 1 AS proximo FROM atendimentos WHERE ano = ${ano}`;
      const [a] = await tx<Array<{ id: string }>>`
        INSERT INTO atendimentos (numero, ano, solicitante_nome, solicitante_documento, solicitante_contato, vinculo, setor_orgao,
                                  canal, finalidade, forma_acesso, documentos_nao_cadastrados, justificativa_restrito,
                                  data_pedido, prazo_final, registrado_por)
        VALUES (${n!.proximo}, ${ano}, ${input.solicitanteNome}, ${input.solicitanteDocumento || null}, ${input.solicitanteContato || null},
                ${input.vinculo}, ${input.setorOrgao || null}, ${input.canal}, ${input.finalidade}, ${input.formaAcesso},
                ${input.documentosNaoCadastrados || null}, ${input.justificativaRestrito || null},
                ${dataPedido}, ${prazoFinalLai(dataPedido, false)}, ${user.sub})
        RETURNING id
      `;
      for (const docId of ids) {
        await tx`INSERT INTO atendimento_documentos (atendimento_id, document_id) VALUES (${a!.id}, ${docId})`;
      }
      return a!.id;
    });
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'atendimento_registrado',
      resourceType: 'atendimento',
      resourceId: id,
      ip,
      metadata: { documentos: ids.length, formaAcesso: input.formaAcesso },
    });
    return this.obter(user, id);
  }

  private async aberto(sql: Sql, id: string): Promise<{ prorrogado: boolean; data_pedido: Date }> {
    const [a] = await sql<Array<{ status: string; prorrogado: boolean; data_pedido: Date }>>`
      SELECT status, prorrogado, data_pedido FROM atendimentos WHERE id = ${id}
    `;
    if (!a) throw new NotFoundException('Atendimento não encontrado');
    if (a.status !== 'aberto') throw new ConflictException('Este atendimento já foi concluído');
    return a;
  }

  async concluir(user: TenantAccessClaims, id: string, input: AtendimentoConcluirInput, ip: string): Promise<AtendimentoView> {
    const sql = this.sql();
    await this.aberto(sql, id);
    await sql`
      UPDATE atendimentos SET status = ${input.status}, resposta = ${input.resposta}, concluido_em = now(), concluido_por = ${user.sub}
      WHERE id = ${id} AND status = 'aberto'
    `;
    await this.audit.logTenant({ actorId: user.sub, action: `atendimento_${input.status}`, resourceType: 'atendimento', resourceId: id, ip });
    return this.obter(user, id);
  }

  async prorrogar(user: TenantAccessClaims, id: string, justificativa: string, ip: string): Promise<AtendimentoView> {
    const sql = this.sql();
    const a = await this.aberto(sql, id);
    if (a.prorrogado) throw new ConflictException('O prazo já foi prorrogado uma vez (a LAI permite uma prorrogação de 10 dias).');
    await sql`
      UPDATE atendimentos SET prorrogado = true, justificativa_prorrogacao = ${justificativa}, prazo_final = ${prazoFinalLai(a.data_pedido, true)}
      WHERE id = ${id}
    `;
    await this.audit.logTenant({ actorId: user.sub, action: 'atendimento_prorrogado', resourceType: 'atendimento', resourceId: id, ip, metadata: { justificativa } });
    return this.obter(user, id);
  }

  /** Comprovante para o solicitante (restritos aparecem sem titulo para quem emite sem permissao). */
  async comprovante(user: TenantAccessClaims, id: string): Promise<{ pdf: Buffer; nome: string }> {
    const a = await this.obter(user, id);
    if (a.documentos.some((d) => d.restrito) && !this.podeVerRestrito(user)) {
      throw new ForbiddenException('O atendimento inclui documento restrito: só quem tem acesso a restritos emite o comprovante.');
    }
    const ctx = requireTenantContext();
    const dataBr = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }) : '—');
    const STATUS: Record<string, string> = { aberto: 'Em andamento', atendido: 'Atendido', indeferido: 'Indeferido', cancelado: 'Cancelado' };
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFKitDocument({ size: 'A4', margin: 50 });
      const partes: Buffer[] = [];
      doc.on('data', (c: Buffer) => partes.push(c));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      const campo = (rotulo: string, valor: string | null | undefined) => {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`${rotulo}: `, { continued: true });
        doc.font('Helvetica').text(valor || '—');
      };
      doc.font('Helvetica-Bold').fontSize(11).text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.fontSize(14).text('COMPROVANTE DE ATENDIMENTO', { align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Protocolo ${a.protocolo} · Lei nº 12.527/2011 (Acesso à Informação)`, { align: 'center' });
      doc.moveDown(1.2).fillColor('#0f172a');
      campo('Solicitante', a.solicitanteNome);
      campo('CPF/RG', a.solicitanteDocumento);
      campo('Contato', a.solicitanteContato);
      campo('Vínculo', VINCULO_LABEL[a.vinculo]);
      if (a.setorOrgao) campo('Setor/órgão', a.setorOrgao);
      campo('Canal', CANAL_LABEL[a.canal]);
      campo('Data do pedido', dataBr(a.dataPedido));
      campo('Prazo', `${dataBr(a.prazoFinal)}${a.prorrogado ? ' (prorrogado)' : ''}`);
      campo('Forma de acesso', FORMA_ACESSO_LABEL[a.formaAcesso]);
      campo('Situação', STATUS[a.status]);
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(10).text('Finalidade');
      doc.font('Helvetica').fontSize(9).text(a.finalidade);
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(10).text('Documentos');
      doc.font('Helvetica').fontSize(9);
      a.documentos.forEach((d, i) => doc.text(`${i + 1}. ${d.identificacao}${d.restrito ? ' (acesso restrito autorizado)' : ''}`));
      if (a.documentosNaoCadastrados) doc.text(`Outros: ${a.documentosNaoCadastrados}`);
      if (a.documentos.length === 0 && !a.documentosNaoCadastrados) doc.text('—');
      if (a.resposta) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(10).text(a.status === 'indeferido' ? 'Fundamentação do indeferimento' : 'Resposta');
        doc.font('Helvetica').fontSize(9).text(a.resposta);
        if (a.status === 'indeferido') {
          doc.moveDown(0.3).fillColor('#475569').fontSize(8)
            .text('Cabe recurso no prazo de 10 dias, contados da ciência da decisão (art. 15 da Lei nº 12.527/2011).');
          doc.fillColor('#0f172a');
        }
      }
      doc.moveDown(4);
      const y = doc.y;
      doc.moveTo(70, y).lineTo(260, y).strokeColor('#000').stroke();
      doc.moveTo(335, y).lineTo(525, y).stroke();
      doc.fontSize(8).text('Solicitante', 70, y + 4, { width: 190, align: 'center' });
      doc.text(`Atendente${a.concluidoPor || a.registradoPor ? ` — ${a.concluidoPor ?? a.registradoPor}` : ''}`, 335, y + 4, { width: 190, align: 'center' });
      doc.end();
    });
    return { pdf, nome: `atendimento-${a.protocolo.replace(/\D+/g, '-').replace(/^-|-$/g, '')}.pdf` };
  }
}
