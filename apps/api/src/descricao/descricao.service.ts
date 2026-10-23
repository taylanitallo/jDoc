import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  DOC_MODULES,
  ELEMENTOS_NOBRADE,
  ELEMENTOS_OPCIONAIS,
  NIVEL_DESCRICAO_LABEL,
  codigoReferencia,
  datasLimite,
  faltantesNobrade,
  hojeIso,
  nivelFilhoPermitido,
  sistemaDoModulo,
  type DocModule,
  type ElementosDescricao,
  type NivelDescricao,
  type TenantAccessClaims,
  type UnidadeDescricaoCreateInput,
  type UnidadeDescricaoNo,
  type UnidadeDescricaoUpdateInput,
  type UnidadeDescricaoView,
  type VincularDescricaoInput,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { sistemaAtivo } from '../common/sistema.guard';

const IDENT = `COALESCE(NULLIF(concat_ws(' — ',
    CASE WHEN d.metadados ? 'numero' THEN concat_ws(' ', t.nome, 'nº', d.metadados->>'numero') END,
    CASE WHEN d.doc_caixa IS NOT NULL THEN 'Doc. Caixa ' || d.doc_caixa END,
    NULLIF(d.descricao, ''), NULLIF(d.historico, '')), ''), d.original_name, 'Documento')`;

interface UnidadeRow {
  id: string;
  parent_id: string | null;
  nivel: NivelDescricao;
  codigo: string;
  titulo: string;
  datas: string | null;
  dimensao_suporte: string | null;
  produtor: string | null;
  condicoes_acesso: string | null;
  elementos: ElementosDescricao;
  pontos_acesso: string[];
  atualizado_em: Date;
  atualizado_por: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dataBr = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const n = (x: number) => x.toLocaleString('pt-BR');

/**
 * Descricao arquivistica multinivel (NOBRADE). A arvore e pequena (centenas de unidades):
 * carrega inteira para montar codigos de referencia, heranca do produtor e subarvores.
 */
@Injectable()
export class DescricaoService {
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

  private modulosLegiveis(user: TenantAccessClaims): DocModule[] {
    const contratados = DOC_MODULES.filter((m) => sistemaAtivo(sistemaDoModulo(m)));
    return user.role === 'admin' ? contratados : contratados.filter((m) => user.permissions.includes(`${m}:read`));
  }

  private async todas(sql: Sql): Promise<Map<string, UnidadeRow>> {
    const rows = await sql<UnidadeRow[]>`
      SELECT u.id, u.parent_id, u.nivel, u.codigo, u.titulo, u.datas, u.dimensao_suporte, u.produtor, u.condicoes_acesso,
             u.elementos, u.pontos_acesso, u.atualizado_em, us.nome AS atualizado_por
      FROM unidades_descricao u LEFT JOIN users us ON us.id = u.atualizado_por
      ORDER BY u.codigo
    `;
    return new Map(rows.map((r) => [r.id, r]));
  }

  private cadeia(mapa: Map<string, UnidadeRow>, id: string): UnidadeRow[] {
    const out: UnidadeRow[] = [];
    let atual = mapa.get(id);
    while (atual && out.length < 50) {
      out.unshift(atual);
      atual = atual.parent_id ? mapa.get(atual.parent_id) : undefined;
    }
    return out;
  }

  private produtorHerdado(mapa: Map<string, UnidadeRow>, u: UnidadeRow): string | null {
    let p = u.parent_id ? mapa.get(u.parent_id) : undefined;
    while (p) {
      if (p.produtor?.trim()) return p.produtor;
      p = p.parent_id ? mapa.get(p.parent_id) : undefined;
    }
    return null;
  }

  /** Ids da unidade e de todos os descendentes, em pre-ordem (ordem do instrumento de pesquisa). */
  private subarvore(mapa: Map<string, UnidadeRow>, id: string): string[] {
    const filhos = new Map<string, string[]>();
    for (const u of mapa.values()) {
      if (!u.parent_id) continue;
      const l = filhos.get(u.parent_id) ?? [];
      l.push(u.id);
      filhos.set(u.parent_id, l);
    }
    const out: string[] = [];
    const visitar = (x: string) => {
      out.push(x);
      for (const f of (filhos.get(x) ?? []).sort((a, b) => mapa.get(a)!.codigo.localeCompare(mapa.get(b)!.codigo, 'pt-BR', { numeric: true }))) visitar(f);
    };
    visitar(id);
    return out;
  }

  private faltantes(mapa: Map<string, UnidadeRow>, u: UnidadeRow): string[] {
    const herdado = this.produtorHerdado(mapa, u);
    return faltantesNobrade(
      { codigo: u.codigo, titulo: u.titulo, datas: u.datas, nivel: u.nivel, dimensaoSuporte: u.dimensao_suporte, produtor: u.produtor, condicoesAcesso: u.condicoes_acesso },
      herdado !== null,
    );
  }

  async arvore(): Promise<UnidadeDescricaoNo[]> {
    const sql = this.sql();
    const mapa = await this.todas(sql);
    const contagens = await sql<Array<{ id: string; docs: number; dossies: number }>>`
      SELECT u.id,
             (SELECT count(*) FROM documents d WHERE d.unidade_descricao_id = u.id AND d.deleted_at IS NULL)::int AS docs,
             (SELECT count(*) FROM dossies ds WHERE ds.unidade_descricao_id = u.id)::int AS dossies
      FROM unidades_descricao u
    `;
    const c = new Map(contagens.map((x) => [x.id, x]));
    return [...mapa.values()].map((u) => ({
      id: u.id,
      parentId: u.parent_id,
      nivel: u.nivel,
      codigo: u.codigo,
      titulo: u.titulo,
      datas: u.datas,
      completa: this.faltantes(mapa, u).length === 0,
      totalDocumentos: c.get(u.id)?.docs ?? 0,
      totalDossies: c.get(u.id)?.dossies ?? 0,
    }));
  }

  async obter(user: TenantAccessClaims, id: string): Promise<UnidadeDescricaoView> {
    const sql = this.sql();
    const mapa = await this.todas(sql);
    const u = mapa.get(id);
    if (!u) throw new NotFoundException('Unidade de descrição não encontrada');
    const cadeia = this.cadeia(mapa, id);
    const ids = this.subarvore(mapa, id);

    // Sugestoes de 1.3 e 1.5 a partir do que esta vinculado na subarvore (documentos diretos e os juntados a dossies vinculados).
    const [s] = await sql<Array<{ docs: number; paginas: number; ano_min: number | null; ano_max: number | null; dossies: number; fisicos: number }>>`
      WITH docs AS (
        SELECT d.id, d.paginas, d.document_date, d.exercicio, d.possui_original_fisico
        FROM documents d
        WHERE d.deleted_at IS NULL
          AND (d.unidade_descricao_id = ANY(${ids}::uuid[])
               OR d.id IN (SELECT dd.document_id FROM dossie_documentos dd JOIN dossies ds ON ds.id = dd.dossie_id
                           WHERE ds.unidade_descricao_id = ANY(${ids}::uuid[])))
      )
      SELECT count(*)::int AS docs, COALESCE(sum(paginas), 0)::int AS paginas,
             min(COALESCE(extract(year FROM document_date)::int, exercicio)) AS ano_min,
             max(COALESCE(extract(year FROM document_date)::int, exercicio)) AS ano_max,
             (SELECT count(*) FROM dossies WHERE unidade_descricao_id = ANY(${ids}::uuid[]))::int AS dossies,
             count(*) FILTER (WHERE possui_original_fisico)::int AS fisicos
      FROM docs
    `;
    const partesDim: string[] = [];
    if (s && s.docs > 0) partesDim.push(`${n(s.docs)} documento(s) digital(is), ${n(s.paginas)} página(s)`);
    if (s && s.dossies > 0) partesDim.push(`${n(s.dossies)} dossiê(s)/processo(s)`);
    if (s && s.fisicos > 0) partesDim.push(`${n(s.fisicos)} com original em papel`);

    const podeRestrito = this.podeVerRestrito(user);
    const docs = await sql<Array<{ id: string; identificacao: string; document_date: Date | null; restrito: boolean }>>`
      SELECT d.id, ${sql.unsafe(IDENT)} AS identificacao, d.document_date, COALESCE(d.nivel_acesso, 'publico') = 'restrito' AS restrito
      FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id
      WHERE d.unidade_descricao_id = ${id} AND d.deleted_at IS NULL
      ORDER BY d.document_date NULLS LAST, d.criado_em
      LIMIT 100
    `;
    const [tot] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM documents WHERE unidade_descricao_id = ${id} AND deleted_at IS NULL`;
    const dossies = await sql<Array<{ id: string; tipo: 'dossie' | 'processo'; numero: string; assunto: string; nivel_acesso: string }>>`
      SELECT id, tipo, numero, assunto, nivel_acesso FROM dossies WHERE unidade_descricao_id = ${id} ORDER BY numero
    `;

    return {
      id: u.id,
      parentId: u.parent_id,
      nivel: u.nivel,
      codigo: u.codigo,
      codigoReferencia: codigoReferencia(cadeia),
      titulo: u.titulo,
      datas: u.datas,
      dimensaoSuporte: u.dimensao_suporte,
      produtor: u.produtor,
      produtorHerdado: this.produtorHerdado(mapa, u),
      condicoesAcesso: u.condicoes_acesso,
      elementos: u.elementos ?? {},
      pontosAcesso: u.pontos_acesso ?? [],
      faltantes: this.faltantes(mapa, u),
      caminho: cadeia.map((x) => ({ id: x.id, nivel: x.nivel, codigo: x.codigo, titulo: x.titulo })),
      sugestoes: { datas: datasLimite(s?.ano_min ?? null, s?.ano_max ?? null), dimensaoSuporte: partesDim.length ? partesDim.join('; ') : null },
      documentos: docs.map((d) => ({
        id: d.id,
        identificacao: d.restrito && !podeRestrito ? 'Documento restrito' : d.identificacao,
        dataDocumento: iso(d.document_date),
        restrito: d.restrito,
      })),
      totalDocumentos: tot?.n ?? 0,
      dossies: dossies
        .filter((d) => podeRestrito || d.nivel_acesso === 'publico')
        .map((d) => ({ id: d.id, tipo: d.tipo, numero: d.numero, assunto: d.assunto })),
      atualizadoEm: u.atualizado_em.toISOString(),
      atualizadoPor: u.atualizado_por,
    };
  }

  private elementosLimpos(e: UnidadeDescricaoCreateInput['elementos']): ElementosDescricao {
    const out: ElementosDescricao = {};
    for (const k of ELEMENTOS_OPCIONAIS) {
      const v = e?.[k];
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    return out;
  }

  private conflito(e: unknown): never {
    if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe uma unidade com este código no mesmo nível');
    throw e;
  }

  async criar(user: TenantAccessClaims, input: UnidadeDescricaoCreateInput, ip: string): Promise<UnidadeDescricaoView> {
    const sql = this.sql();
    let paiNivel: NivelDescricao | null = null;
    if (input.parentId) {
      const [p] = await sql<Array<{ nivel: NivelDescricao }>>`SELECT nivel FROM unidades_descricao WHERE id = ${input.parentId}`;
      if (!p) throw new BadRequestException('Unidade superior não encontrada');
      paiNivel = p.nivel;
    }
    if (!nivelFilhoPermitido(paiNivel, input.nivel)) {
      throw new BadRequestException(
        paiNivel
          ? `${NIVEL_DESCRICAO_LABEL[input.nivel]} não pode ficar abaixo de ${NIVEL_DESCRICAO_LABEL[paiNivel].toLowerCase()}`
          : 'No topo da árvore só pode haver o acervo da entidade, um fundo ou uma coleção',
      );
    }
    if (input.nivel === 'acervo') {
      const [ja] = await sql`SELECT 1 FROM unidades_descricao WHERE nivel = 'acervo'`;
      if (ja) throw new ConflictException('O acervo da entidade (nível 0) já foi descrito');
    }
    let id = '';
    try {
      const [r] = await sql<Array<{ id: string }>>`
        INSERT INTO unidades_descricao (parent_id, nivel, codigo, titulo, datas, dimensao_suporte, produtor, condicoes_acesso, elementos, pontos_acesso, criado_por, atualizado_por)
        VALUES (${input.parentId ?? null}, ${input.nivel}, ${input.codigo}, ${input.titulo}, ${input.datas || null}, ${input.dimensaoSuporte || null},
                ${input.produtor || null}, ${input.condicoesAcesso || null}, ${sql.json(this.elementosLimpos(input.elementos))},
                ${[...new Set(input.pontosAcesso ?? [])]}, ${user.sub}, ${user.sub})
        RETURNING id
      `;
      id = r!.id;
    } catch (e) {
      this.conflito(e);
    }
    await this.audit.logTenant({ actorId: user.sub, action: 'descricao_criada', resourceType: 'unidade_descricao', resourceId: id, ip, metadata: { nivel: input.nivel, codigo: input.codigo } });
    return this.obter(user, id);
  }

  async atualizar(user: TenantAccessClaims, id: string, input: UnidadeDescricaoUpdateInput, ip: string): Promise<UnidadeDescricaoView> {
    const sql = this.sql();
    const [atual] = await sql<Array<{ elementos: ElementosDescricao }>>`SELECT elementos FROM unidades_descricao WHERE id = ${id}`;
    if (!atual) throw new NotFoundException('Unidade de descrição não encontrada');
    // Elementos: merge (chave enviada vazia/null apaga o elemento).
    let elementos: ElementosDescricao | undefined;
    if (input.elementos) {
      elementos = { ...(atual.elementos ?? {}) };
      for (const k of ELEMENTOS_OPCIONAIS) {
        if (!(k in input.elementos)) continue;
        const v = input.elementos[k];
        if (typeof v === 'string' && v.trim()) elementos[k] = v.trim();
        else delete elementos[k];
      }
    }
    const v = <T>(x: T | undefined) => x !== undefined;
    try {
      await sql`
        UPDATE unidades_descricao SET
          codigo = CASE WHEN ${v(input.codigo)} THEN ${input.codigo ?? ''} ELSE codigo END,
          titulo = CASE WHEN ${v(input.titulo)} THEN ${input.titulo ?? ''} ELSE titulo END,
          datas = CASE WHEN ${v(input.datas)} THEN ${input.datas || null} ELSE datas END,
          dimensao_suporte = CASE WHEN ${v(input.dimensaoSuporte)} THEN ${input.dimensaoSuporte || null} ELSE dimensao_suporte END,
          produtor = CASE WHEN ${v(input.produtor)} THEN ${input.produtor || null} ELSE produtor END,
          condicoes_acesso = CASE WHEN ${v(input.condicoesAcesso)} THEN ${input.condicoesAcesso || null} ELSE condicoes_acesso END,
          elementos = ${elementos ? sql`${sql.json(elementos)}` : sql`elementos`},
          pontos_acesso = ${input.pontosAcesso ? sql`${[...new Set(input.pontosAcesso)]}::text[]` : sql`pontos_acesso`},
          atualizado_por = ${user.sub},
          atualizado_em = now()
        WHERE id = ${id}
      `;
    } catch (e) {
      this.conflito(e);
    }
    await this.audit.logTenant({ actorId: user.sub, action: 'descricao_alterada', resourceType: 'unidade_descricao', resourceId: id, ip, metadata: { campos: Object.keys(input) } });
    return this.obter(user, id);
  }

  async excluir(user: TenantAccessClaims, id: string, ip: string): Promise<{ excluida: true }> {
    const sql = this.sql();
    const [u] = await sql<Array<{ codigo: string; filhos: number; docs: number; dossies: number }>>`
      SELECT u.codigo,
             (SELECT count(*) FROM unidades_descricao f WHERE f.parent_id = u.id)::int AS filhos,
             (SELECT count(*) FROM documents d WHERE d.unidade_descricao_id = u.id)::int AS docs,
             (SELECT count(*) FROM dossies ds WHERE ds.unidade_descricao_id = u.id)::int AS dossies
      FROM unidades_descricao u WHERE u.id = ${id}
    `;
    if (!u) throw new NotFoundException('Unidade de descrição não encontrada');
    if (u.filhos > 0) throw new ConflictException('Exclua ou mova antes as unidades abaixo desta');
    if (u.docs + u.dossies > 0) throw new ConflictException('Há documentos ou dossiês vinculados: desvincule antes de excluir');
    await sql`DELETE FROM unidades_descricao WHERE id = ${id}`;
    await this.audit.logTenant({ actorId: user.sub, action: 'descricao_excluida', resourceType: 'unidade_descricao', resourceId: id, ip, metadata: { codigo: u.codigo } });
    return { excluida: true };
  }

  async vincular(user: TenantAccessClaims, id: string, input: VincularDescricaoInput, ip: string): Promise<UnidadeDescricaoView> {
    const sql = this.sql();
    const [u] = await sql<Array<{ nivel: NivelDescricao }>>`SELECT nivel FROM unidades_descricao WHERE id = ${id}`;
    if (!u) throw new NotFoundException('Unidade de descrição não encontrada');
    if (u.nivel === 'acervo') throw new BadRequestException('Vincule os documentos a um fundo, série, dossiê ou item — não ao acervo da entidade');
    const docIds = [...new Set(input.documentIds ?? [])];
    const dosIds = [...new Set(input.dossieIds ?? [])];
    const podeRestrito = this.podeVerRestrito(user);
    if (docIds.length) {
      const ok = await sql<Array<{ id: string }>>`
        SELECT id FROM documents
        WHERE id = ANY(${docIds}::uuid[]) AND deleted_at IS NULL AND module = ANY(${this.modulosLegiveis(user)})
          AND (${podeRestrito} OR COALESCE(nivel_acesso, 'publico') = 'publico')
      `;
      if (ok.length !== docIds.length) throw new NotFoundException('Documento não encontrado');
      await sql`UPDATE documents SET unidade_descricao_id = ${id} WHERE id = ANY(${docIds}::uuid[])`;
    }
    if (dosIds.length) {
      const ok = await sql<Array<{ id: string }>>`
        SELECT id FROM dossies WHERE id = ANY(${dosIds}::uuid[]) AND (${podeRestrito} OR nivel_acesso = 'publico')
      `;
      if (ok.length !== dosIds.length) throw new NotFoundException('Dossiê/processo não encontrado');
      await sql`UPDATE dossies SET unidade_descricao_id = ${id} WHERE id = ANY(${dosIds}::uuid[])`;
    }
    await this.audit.logTenant({ actorId: user.sub, action: 'descricao_vinculada', resourceType: 'unidade_descricao', resourceId: id, ip, metadata: { documentos: docIds.length, dossies: dosIds.length } });
    return this.obter(user, id);
  }

  async desvincular(user: TenantAccessClaims, id: string, input: VincularDescricaoInput, ip: string): Promise<UnidadeDescricaoView> {
    const sql = this.sql();
    const docIds = input.documentIds ?? [];
    const dosIds = input.dossieIds ?? [];
    if (docIds.length) await sql`UPDATE documents SET unidade_descricao_id = NULL WHERE unidade_descricao_id = ${id} AND id = ANY(${docIds}::uuid[])`;
    if (dosIds.length) await sql`UPDATE dossies SET unidade_descricao_id = NULL WHERE unidade_descricao_id = ${id} AND id = ANY(${dosIds}::uuid[])`;
    await this.audit.logTenant({ actorId: user.sub, action: 'descricao_desvinculada', resourceType: 'unidade_descricao', resourceId: id, ip, metadata: { documentos: docIds.length, dossies: dosIds.length } });
    return this.obter(user, id);
  }

  /**
   * Instrumentos de pesquisa (PDF):
   * - guia: niveis 0 e 1 (acervo da entidade e seus fundos/colecoes) — visao geral para o consulente;
   * - inventario: a unidade e todos os niveis abaixo, com os elementos preenchidos;
   * - catalogo: inventario + relacao dos documentos de cada unidade.
   */
  async instrumento(user: TenantAccessClaims, tipo: 'guia' | 'inventario' | 'catalogo', ip: string, id?: string): Promise<{ pdf: Buffer; nome: string }> {
    const sql = this.sql();
    const ctx = requireTenantContext();
    const mapa = await this.todas(sql);
    let ordem: string[];
    let titulo: string;
    if (tipo === 'guia') {
      const raizes = [...mapa.values()].filter((u) => !u.parent_id).map((u) => u.id);
      ordem = raizes.flatMap((r) => this.subarvore(mapa, r)).filter((x) => ['acervo', 'fundo', 'colecao'].includes(mapa.get(x)!.nivel));
      titulo = 'GUIA DO ACERVO';
      if (ordem.length === 0) throw new BadRequestException('Descreva ao menos um fundo ou coleção para gerar o guia');
    } else {
      if (!id || !mapa.has(id)) throw new NotFoundException('Unidade de descrição não encontrada');
      ordem = this.subarvore(mapa, id);
      const u = mapa.get(id)!;
      titulo = `${tipo === 'catalogo' ? 'CATÁLOGO' : 'INVENTÁRIO'} — ${u.titulo.toUpperCase()}`;
    }
    const podeRestrito = this.podeVerRestrito(user);
    const docsPorUnidade = new Map<string, Array<{ identificacao: string; document_date: Date | null; restrito: boolean }>>();
    if (tipo === 'catalogo') {
      const docs = await sql<Array<{ unidade: string; identificacao: string; document_date: Date | null; restrito: boolean }>>`
        SELECT d.unidade_descricao_id AS unidade, ${sql.unsafe(IDENT)} AS identificacao, d.document_date,
               COALESCE(d.nivel_acesso, 'publico') = 'restrito' AS restrito
        FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id
        WHERE d.unidade_descricao_id = ANY(${ordem}::uuid[]) AND d.deleted_at IS NULL
        ORDER BY d.document_date NULLS LAST, d.criado_em
      `;
      for (const d of docs) {
        const l = docsPorUnidade.get(d.unidade) ?? [];
        l.push(d);
        docsPorUnidade.set(d.unidade, l);
      }
    }
    const profundidadeBase = tipo === 'guia' ? 0 : this.cadeia(mapa, ordem[0]!).length - 1;

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFKitDocument({ size: 'A4', margin: 50, bufferPages: true });
      const partes: Buffer[] = [];
      doc.on('data', (c: Buffer) => partes.push(c));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      doc.font('Helvetica-Bold').fontSize(11).text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.moveDown(0.8).fontSize(16).text(titulo, { align: 'center' });
      doc.moveDown(0.3).font('Helvetica').fontSize(8).fillColor('#475569')
        .text(`Instrumento de pesquisa elaborado segundo a NOBRADE (CONARQ) — emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}`, { align: 'center' });
      doc.fillColor('#0f172a').moveDown(1.2);

      for (const uid of ordem) {
        const u = mapa.get(uid)!;
        const cadeia = this.cadeia(mapa, uid);
        const recuo = Math.min(Math.max(cadeia.length - 1 - profundidadeBase, 0), 5) * 12;
        const largura = doc.page.width - 100 - recuo;
        if (doc.y > doc.page.height - 140) doc.addPage();
        doc.x = 50 + recuo;
        doc.font('Helvetica-Bold').fontSize(u.nivel === 'acervo' || u.nivel === 'fundo' || u.nivel === 'colecao' ? 12 : 10.5)
          .text(`${codigoReferencia(cadeia)} — ${u.titulo}`, 50 + recuo, doc.y, { width: largura });
        doc.font('Helvetica').fontSize(8).fillColor('#475569').text(NIVEL_DESCRICAO_LABEL[u.nivel], { width: largura });
        doc.fillColor('#0f172a').moveDown(0.3);
        const valores: Record<string, string | null | undefined> = {
          datas: u.datas,
          dimensaoSuporte: u.dimensao_suporte,
          produtor: u.produtor,
          condicoesAcesso: u.condicoes_acesso,
          pontosAcesso: u.pontos_acesso?.length ? u.pontos_acesso.join('; ') : null,
          ...(u.elementos ?? {}),
        };
        for (const el of ELEMENTOS_NOBRADE) {
          if (el.chave === 'codigo' || el.chave === 'titulo' || el.chave === 'nivel') continue;
          const val = valores[el.chave];
          if (!val) continue;
          if (doc.y > doc.page.height - 80) doc.addPage();
          doc.fontSize(9).font('Helvetica-Bold').text(`${el.nome}: `, 50 + recuo, doc.y, { width: largura, continued: true }).font('Helvetica').text(val, { align: 'justify' });
          doc.moveDown(0.15);
        }
        const docs = docsPorUnidade.get(uid);
        if (docs?.length) {
          doc.moveDown(0.3).font('Helvetica-Bold').fontSize(8.5).text(`Documentos (${n(docs.length)}):`, 50 + recuo, doc.y, { width: largura });
          doc.font('Helvetica').fontSize(8);
          for (const d of docs) {
            if (doc.y > doc.page.height - 60) doc.addPage();
            const ident = d.restrito && !podeRestrito ? 'Documento de acesso restrito' : d.identificacao;
            doc.text(`• ${d.document_date ? dataBr(iso(d.document_date)) : 's/d'} — ${ident}`, 50 + recuo + 8, doc.y, { width: largura - 8 });
          }
        }
        doc.moveDown(0.9);
      }
      const paginas = doc.bufferedPageRange();
      for (let i = 0; i < paginas.count; i++) {
        doc.switchToPage(i);
        // Rodape abaixo da margem: sem zerar a margem o pdfkit abriria uma pagina em branco.
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7).fillColor('#64748b')
          .text(`${ctx.nome} — ${titulo} — página ${i + 1} de ${paginas.count}`, 50, doc.page.height - 35, { width: doc.page.width - 100, align: 'center', lineBreak: false });
      }
      doc.end();
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'instrumento_pesquisa_emitido', resourceType: 'unidade_descricao', resourceId: id, ip, metadata: { tipo } });
    return { pdf, nome: `${tipo}-${hojeIso()}.pdf` };
  }
}
