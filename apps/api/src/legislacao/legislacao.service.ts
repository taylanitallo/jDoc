import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  DOC_MODULES,
  AGRUPADORES,
  dadosDaEpigrafe,
  hojeIso,
  notaEvento,
  parseTextoNormativo,
  rotuloNorma,
  rotuloExibicao,
  rotuloNormaCurto,
  sistemaDoModulo,
  situacaoNorma,
  textoCompilado,
  type AlteracoesInput,
  type DispositivoBase,
  type DispositivoInput,
  type DispositivoParse,
  type DocModule,
  type NoCompilado,
  type NormaCreateInput,
  type NormaRelacaoView,
  type NormaResumoView,
  type NormasPage,
  type NormasQuery,
  type NormaUpdateInput,
  type NormaView,
  type RedacaoBase,
  type SituacaoNorma,
  type TenantAccessClaims,
  type TipoNorma,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { sistemaAtivo } from '../common/sistema.guard';

interface NormaRow {
  id: string;
  document_id: string;
  tipo: TipoNorma;
  numero: string;
  ano: number;
  data_publicacao: Date | null;
  ementa: string;
  situacao: SituacaoNorma;
  revogada_total: boolean;
  publicada: boolean;
  revisada_por: string | null;
  revisada_em: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Quem pode ver a norma: mesmo criterio do documento (modulo legivel + restrito so com permissao). */
interface Visao {
  publico: boolean;
  user?: TenantAccessClaims;
}

@Injectable()
export class LegislacaoService {
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

  /** Filtro SQL (alias n = normas, d = documents) do que a visao enxerga. */
  private filtro(sql: Sql, v: Visao): ReturnType<Sql> {
    if (v.publico) return sql`n.publicada AND COALESCE(d.nivel_acesso, 'publico') = 'publico' AND d.deleted_at IS NULL`;
    const u = v.user!;
    const restrito = this.podeVerRestrito(u) ? sql`true` : sql`COALESCE(d.nivel_acesso, 'publico') = 'publico'`;
    return sql`d.deleted_at IS NULL AND d.module = ANY(${this.modulosLegiveis(u)}) AND ${restrito}`;
  }

  private resumo(r: NormaRow): NormaResumoView {
    const ref = { id: r.id, tipo: r.tipo, numero: r.numero, ano: r.ano, dataPublicacao: iso(r.data_publicacao) };
    return {
      ...ref,
      documentId: r.document_id,
      ementa: r.ementa,
      situacao: r.situacao,
      publicada: r.publicada,
      rotulo: rotuloNorma(ref),
    };
  }

  private async carregar(sql: Sql, v: Visao, id: string): Promise<NormaRow> {
    const [r] = await sql<NormaRow[]>`
      SELECT n.* FROM normas n JOIN documents d ON d.id = n.document_id WHERE n.id = ${id} AND ${this.filtro(sql, v)}
    `;
    if (!r) throw new NotFoundException('Norma não encontrada');
    return r;
  }

  // ---------------------------------------------------------------------------

  /** Extrai o texto do PDF (OCR ja feito) ou usa o texto colado, e devolve a estrutura sugerida (nao grava). */
  async estruturar(
    user: TenantAccessClaims,
    documentId: string,
    textoColado: string | undefined,
  ): Promise<{ dispositivos: DispositivoParse[]; sugestao: Partial<NormaCreateInput>; normaExistenteId: string | null }> {
    const sql = this.sql();
    const [doc] = await sql<Array<{ id: string; exercicio: number; metadados: Record<string, unknown>; tipo_nome: string | null; descricao: string | null }>>`
      SELECT d.id, d.exercicio, d.metadados, t.nome AS tipo_nome, d.descricao
      FROM documents d LEFT JOIN document_types t ON t.id = d.document_type_id
      WHERE d.id = ${documentId} AND ${this.filtro(sql, { publico: false, user })}
    `;
    if (!doc) throw new NotFoundException('Documento não encontrado');
    let texto = textoColado?.trim() ?? '';
    if (!texto) {
      const paginas = await sql<Array<{ texto: string }>>`
        SELECT texto FROM document_textos WHERE document_id = ${documentId} AND document_file_id IS NULL ORDER BY pagina
      `;
      texto = paginas.map((p) => p.texto).join('\n');
    }
    if (!texto.trim()) {
      throw new UnprocessableEntityException('O texto deste PDF ainda não foi extraído (ou é uma imagem sem OCR). Cole o texto da norma para continuar.');
    }
    const dispositivos = parseTextoNormativo(texto);
    const md: Record<string, unknown> = typeof doc.metadados === 'string' ? (JSON.parse(doc.metadados) as Record<string, unknown>) : (doc.metadados ?? {});
    const nomeTipo = (doc.tipo_nome ?? '').toLowerCase();
    const tipo: TipoNorma = nomeTipo.includes('complementar')
      ? 'lei_complementar'
      : nomeTipo.includes('lei')
        ? 'lei'
        : nomeTipo.includes('decreto')
          ? 'decreto'
          : nomeTipo.includes('portaria')
            ? 'portaria'
            : nomeTipo.includes('resolu')
              ? 'resolucao'
              : 'outro';
    // Metadados do Acervo primeiro; o que faltar sai da propria epigrafe ("LEI Nº 100, DE 1º DE MARÇO DE 2010").
    const epigrafe = dispositivos.find((d) => d.rotulo === 'Epígrafe');
    const daEpigrafe = epigrafe ? dadosDaEpigrafe(epigrafe.texto) : { numero: null, ano: null, dataPublicacao: null };
    const ementaTexto = dispositivos.find((d) => d.rotulo === 'Ementa')?.texto;
    const dataPub = typeof md['data_publicacao'] === 'string' && md['data_publicacao'] ? (md['data_publicacao'] as string) : daEpigrafe.dataPublicacao;
    const numero = typeof md['numero'] === 'string' && md['numero'] ? (md['numero'] as string).replace(/[^\d.\-/A-Za-z]/g, '') : (daEpigrafe.numero ?? '');
    const [existente] = await sql<Array<{ id: string }>>`SELECT id FROM normas WHERE document_id = ${documentId}`;
    return {
      dispositivos,
      sugestao: {
        documentId,
        tipo,
        numero,
        ano: dataPub ? Number(dataPub.slice(0, 4)) : (daEpigrafe.ano ?? doc.exercicio),
        dataPublicacao: dataPub,
        ementa: (typeof md['ementa'] === 'string' && md['ementa'] ? (md['ementa'] as string) : (ementaTexto ?? doc.descricao)) ?? '',
      },
      normaExistenteId: existente?.id ?? null,
    };
  }

  /** Valida a arvore enviada pelo editor (refs unicos, pai declarado antes do filho). */
  private validarArvore(dispositivos: DispositivoInput[]): void {
    const vistos = new Set<string>();
    for (const d of dispositivos) {
      if (vistos.has(d.ref)) throw new BadRequestException(`Dispositivo repetido: ${d.ref}`);
      if (d.parentRef && !vistos.has(d.parentRef)) throw new BadRequestException(`"${d.rotulo}" aponta para um dispositivo pai que não vem antes dele`);
      vistos.add(d.ref);
    }
  }

  private async inserirDispositivos(tx: Sql, normaId: string, dispositivos: DispositivoInput[]): Promise<void> {
    const ids = new Map<string, string>();
    let ordem = 0;
    for (const d of dispositivos) {
      const [r] = await tx<Array<{ id: string }>>`
        INSERT INTO norma_dispositivos (norma_id, parent_id, tipo, rotulo, ordem, texto_original)
        VALUES (${normaId}, ${d.parentRef ? ids.get(d.parentRef)! : null}, ${d.tipo}, ${d.rotulo}, ${++ordem}, ${d.texto})
        RETURNING id
      `;
      ids.set(d.ref, r!.id);
    }
  }

  async criar(user: TenantAccessClaims, input: NormaCreateInput, ip: string): Promise<NormaView> {
    const sql = this.sql();
    this.validarArvore(input.dispositivos);
    const [doc] = await sql`
      SELECT 1 FROM documents d WHERE d.id = ${input.documentId} AND d.deleted_at IS NULL AND d.module = ANY(${this.modulosLegiveis(user)})
        AND (${this.podeVerRestrito(user)} OR COALESCE(d.nivel_acesso, 'publico') = 'publico')
    `;
    if (!doc) throw new NotFoundException('Documento não encontrado');
    let id = '';
    try {
      id = await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        const [n] = await tx<Array<{ id: string }>>`
          INSERT INTO normas (document_id, tipo, numero, ano, data_publicacao, ementa, publicada, revisada_por, revisada_em)
          VALUES (${input.documentId}, ${input.tipo}, ${input.numero}, ${input.ano}, ${input.dataPublicacao ?? null}, ${input.ementa},
                  ${input.publicada}, ${user.sub}, now())
          RETURNING id
        `;
        await this.inserirDispositivos(tx, n!.id, input.dispositivos);
        return n!.id;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Este documento já tem texto estruturado, ou já existe norma com o mesmo tipo, número e ano');
      }
      throw e;
    }
    await this.audit.logTenant({ actorId: user.sub, action: 'norma_estruturada', resourceType: 'norma', resourceId: id, ip, metadata: { dispositivos: input.dispositivos.length } });
    return this.obter({ publico: false, user }, id);
  }

  async atualizar(user: TenantAccessClaims, id: string, input: NormaUpdateInput, ip: string): Promise<NormaView> {
    const sql = this.sql();
    const n = await this.carregar(sql, { publico: false, user }, id);
    try {
      await sql`
        UPDATE normas SET
          tipo = ${input.tipo ?? n.tipo},
          numero = ${input.numero ?? n.numero},
          ano = ${input.ano ?? n.ano},
          data_publicacao = ${input.dataPublicacao === undefined ? iso(n.data_publicacao) : input.dataPublicacao},
          ementa = ${input.ementa ?? n.ementa},
          publicada = ${input.publicada ?? n.publicada}
        WHERE id = ${id}
      `;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Já existe norma com o mesmo tipo, número e ano');
      throw e;
    }
    await this.audit.logTenant({ actorId: user.sub, action: 'norma_alterada_dados', resourceType: 'norma', resourceId: id, ip, metadata: { campos: Object.keys(input) } });
    return this.obter({ publico: false, user }, id);
  }

  /** Reestrutura o texto (correcao da revisao). Bloqueado depois que houver alteracoes registradas. */
  async substituirDispositivos(user: TenantAccessClaims, id: string, dispositivos: DispositivoInput[], ip: string): Promise<NormaView> {
    const sql = this.sql();
    await this.carregar(sql, { publico: false, user }, id);
    this.validarArvore(dispositivos);
    const [alt] = await sql`SELECT 1 FROM norma_redacoes r JOIN norma_dispositivos d ON d.id = r.dispositivo_id WHERE d.norma_id = ${id} LIMIT 1`;
    if (alt) throw new ConflictException('Esta norma já foi alterada por outra: a estrutura não pode mais ser refeita, só corrigida pelas alterações');
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      await tx`DELETE FROM norma_dispositivos WHERE norma_id = ${id}`;
      await this.inserirDispositivos(tx, id, dispositivos);
      await tx`UPDATE normas SET revisada_por = ${user.sub}, revisada_em = now() WHERE id = ${id}`;
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'norma_reestruturada', resourceType: 'norma', resourceId: id, ip, metadata: { dispositivos: dispositivos.length } });
    return this.obter({ publico: false, user }, id);
  }

  // ---------------------------------------------------------------------------

  private async estrutura(sql: Sql, normaId: string): Promise<{ dispositivos: DispositivoBase[]; redacoes: RedacaoBase[] }> {
    const disp = await sql<Array<{ id: string; parent_id: string | null; tipo: DispositivoBase['tipo']; rotulo: string; ordem: number; texto_original: string | null }>>`
      SELECT id, parent_id, tipo, rotulo, ordem, texto_original FROM norma_dispositivos WHERE norma_id = ${normaId} ORDER BY ordem
    `;
    const red = await sql<
      Array<{ id: string; dispositivo_id: string; acao: RedacaoBase['acao']; texto: string | null; vigencia_inicio: Date; criado_em: Date; n_id: string; n_tipo: TipoNorma; n_numero: string; n_ano: number; n_data: Date | null }>
    >`
      SELECT r.id, r.dispositivo_id, r.acao, r.texto, r.vigencia_inicio, r.criado_em,
             a.id AS n_id, a.tipo AS n_tipo, a.numero AS n_numero, a.ano AS n_ano, a.data_publicacao AS n_data
      FROM norma_redacoes r
      JOIN norma_dispositivos d ON d.id = r.dispositivo_id
      JOIN normas a ON a.id = r.norma_alteradora_id
      WHERE d.norma_id = ${normaId}
    `;
    return {
      dispositivos: disp.map((d) => ({ id: d.id, parentId: d.parent_id, tipo: d.tipo, rotulo: d.rotulo, ordem: Number(d.ordem), textoOriginal: d.texto_original })),
      redacoes: red.map((r) => ({
        id: r.id,
        dispositivoId: r.dispositivo_id,
        acao: r.acao,
        texto: r.texto,
        vigenciaInicio: iso(r.vigencia_inicio)!,
        criadoEm: r.criado_em.toISOString(),
        normaAlteradora: { id: r.n_id, tipo: r.n_tipo, numero: r.n_numero, ano: r.n_ano, dataPublicacao: iso(r.n_data) },
      })),
    };
  }

  private async relacoes(sql: Sql, v: Visao, id: string): Promise<{ alteradaPor: NormaRelacaoView[]; altera: NormaRelacaoView[] }> {
    const rows = await sql<Array<NormaRow & { rel_tipo: NormaRelacaoView['tipo']; sentido: 'por' | 'altera' }>>`
      SELECT n.*, x.tipo AS rel_tipo, x.sentido FROM (
        SELECT origem_id AS outra, tipo, 'por' AS sentido FROM norma_relacoes WHERE destino_id = ${id}
        UNION ALL
        SELECT destino_id AS outra, tipo, 'altera' AS sentido FROM norma_relacoes WHERE origem_id = ${id}
      ) x
      JOIN normas n ON n.id = x.outra
      JOIN documents d ON d.id = n.document_id
      WHERE ${this.filtro(sql, v)}
      ORDER BY n.ano, n.numero
    `;
    const map = (r: (typeof rows)[number]): NormaRelacaoView => ({ tipo: r.rel_tipo, norma: this.resumo(r) });
    return { alteradaPor: rows.filter((r) => r.sentido === 'por').map(map), altera: rows.filter((r) => r.sentido === 'altera').map(map) };
  }

  async obter(v: Visao, id: string, data?: string): Promise<NormaView> {
    const sql = this.sql();
    const n = await this.carregar(sql, v, id);
    const hoje = hojeIso();
    const dia = data ?? hoje;
    const { dispositivos, redacoes } = await this.estrutura(sql, id);
    // Vigencia futura vira situacao na data certa sem job: recalcula na leitura.
    const atual = situacaoNorma(dispositivos, redacoes, hoje, n.revogada_total);
    if (atual !== n.situacao) {
      await sql`UPDATE normas SET situacao = ${atual} WHERE id = ${id}`;
      n.situacao = atual;
    }
    const rel = await this.relacoes(sql, v, id);
    const [rev] = n.revisada_por ? await sql<Array<{ nome: string }>>`SELECT nome FROM users WHERE id = ${n.revisada_por}` : [];
    return {
      ...this.resumo(n),
      data: dia,
      compilado: textoCompilado(dispositivos, redacoes, dia),
      ...rel,
      totalDispositivos: dispositivos.length,
      temAlteracoes: redacoes.length > 0,
      revisadaPor: v.publico ? null : (rev?.nome ?? null),
      revisadaEm: v.publico ? null : (n.revisada_em?.toISOString() ?? null),
      ...(v.publico ? {} : { dispositivos }),
    };
  }

  async listar(v: Visao, q: NormasQuery): Promise<NormasPage> {
    const sql = this.sql();
    const partes: Array<ReturnType<Sql>> = [this.filtro(sql, v)];
    if (q.tipo) partes.push(sql`n.tipo = ${q.tipo}`);
    if (q.ano) partes.push(sql`n.ano = ${q.ano}`);
    if (q.situacao) partes.push(sql`n.situacao = ${q.situacao}`);
    if (q.q) {
      const termo = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const numero = q.q.replace(/[^\d]/g, '');
      partes.push(sql`(
        n.ementa ILIKE ${termo}
        ${numero ? sql`OR regexp_replace(n.numero, '[^0-9]', '', 'g') = ${numero}` : sql``}
        OR EXISTS (SELECT 1 FROM norma_dispositivos x WHERE x.norma_id = n.id AND x.texto_original ILIKE ${termo})
        OR EXISTS (SELECT 1 FROM norma_redacoes r JOIN norma_dispositivos x ON x.id = r.dispositivo_id WHERE x.norma_id = n.id AND r.texto ILIKE ${termo})
      )`);
    }
    const w = partes.reduce((a, p) => sql`${a} AND ${p}`);
    const [c] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM normas n JOIN documents d ON d.id = n.document_id WHERE ${w}`;
    const rows = await sql<NormaRow[]>`
      SELECT n.* FROM normas n JOIN documents d ON d.id = n.document_id
      WHERE ${w}
      ORDER BY n.ano DESC, length(n.numero) DESC, n.numero DESC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
    `;
    return { items: rows.map((r) => this.resumo(r)), total: c?.n ?? 0, page: q.page, pageSize: q.pageSize };
  }

  /** Norma do documento (para o botao "Texto compilado" no Acervo). */
  async porDocumento(user: TenantAccessClaims, documentId: string): Promise<{ normaId: string | null }> {
    const sql = this.sql();
    const [r] = await sql<Array<{ id: string }>>`
      SELECT n.id FROM normas n JOIN documents d ON d.id = n.document_id WHERE n.document_id = ${documentId} AND ${this.filtro(sql, { publico: false, user })}
    `;
    return { normaId: r?.id ?? null };
  }

  // ---------------------------------------------------------------------------

  /** A norma :id (alteradora) altera/revoga/inclui dispositivos da norma alvo. */
  async alterar(user: TenantAccessClaims, alteradoraId: string, input: AlteracoesInput, ip: string): Promise<NormaView> {
    const sql = this.sql();
    const v: Visao = { publico: false, user };
    const alteradora = await this.carregar(sql, v, alteradoraId);
    if (input.alvoId === alteradoraId) throw new BadRequestException('Uma norma não altera a si mesma');
    await this.carregar(sql, v, input.alvoId);
    const vigencia = input.vigenciaInicio ?? iso(alteradora.data_publicacao) ?? hojeIso();

    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const doAlvo = async (dispId: string) => {
        const [d] = await tx<Array<{ id: string; ordem: number; tipo: string }>>`
          SELECT id, ordem, tipo FROM norma_dispositivos WHERE id = ${dispId} AND norma_id = ${input.alvoId}
        `;
        if (!d) throw new BadRequestException('Dispositivo não pertence à norma alterada');
        return d;
      };
      let revogou = false;
      let alterou = false;
      for (const it of input.itens) {
        if (it.acao === 'inclusao') {
          const apos = await doAlvo(it.inserirAposId!);
          if (it.parentId) await doAlvo(it.parentId);
          const [prox] = await tx<Array<{ ordem: number }>>`
            SELECT ordem FROM norma_dispositivos WHERE norma_id = ${input.alvoId} AND ordem > ${apos.ordem} ORDER BY ordem LIMIT 1
          `;
          const ordem = prox ? (Number(apos.ordem) + Number(prox.ordem)) / 2 : Number(apos.ordem) + 1;
          const [novo] = await tx<Array<{ id: string }>>`
            INSERT INTO norma_dispositivos (norma_id, parent_id, tipo, rotulo, ordem, texto_original)
            VALUES (${input.alvoId}, ${it.parentId ?? null}, ${it.tipo!}, ${it.rotulo!}, ${ordem}, NULL) RETURNING id
          `;
          await tx`INSERT INTO norma_redacoes (dispositivo_id, acao, texto, norma_alteradora_id, vigencia_inicio, criado_por)
                   VALUES (${novo!.id}, 'inclusao', ${it.texto!}, ${alteradoraId}, ${vigencia}, ${user.sub})`;
          alterou = true;
        } else {
          const d = await doAlvo(it.dispositivoId!);
          await tx`INSERT INTO norma_redacoes (dispositivo_id, acao, texto, norma_alteradora_id, vigencia_inicio, criado_por)
                   VALUES (${d.id}, ${it.acao}, ${it.acao === 'revogacao' ? null : it.texto!}, ${alteradoraId}, ${vigencia}, ${user.sub})`;
          if (it.acao === 'revogacao') revogou = true;
          else alterou = true;
        }
      }
      if (input.revogacaoTotal) {
        await tx`UPDATE normas SET revogada_total = true WHERE id = ${input.alvoId}`;
        await tx`INSERT INTO norma_relacoes (origem_id, destino_id, tipo) VALUES (${alteradoraId}, ${input.alvoId}, 'revoga') ON CONFLICT DO NOTHING`;
      }
      if (revogou) await tx`INSERT INTO norma_relacoes (origem_id, destino_id, tipo) VALUES (${alteradoraId}, ${input.alvoId}, 'revoga_parcialmente') ON CONFLICT DO NOTHING`;
      if (alterou) await tx`INSERT INTO norma_relacoes (origem_id, destino_id, tipo) VALUES (${alteradoraId}, ${input.alvoId}, 'altera') ON CONFLICT DO NOTHING`;
    });

    // Situacao da alvo com a vigencia de hoje (alteracao com vigencia futura so conta quando chegar).
    const [alvo] = await sql<Array<{ revogada_total: boolean }>>`SELECT revogada_total FROM normas WHERE id = ${input.alvoId}`;
    const { dispositivos, redacoes } = await this.estrutura(sql, input.alvoId);
    await sql`UPDATE normas SET situacao = ${situacaoNorma(dispositivos, redacoes, hojeIso(), alvo!.revogada_total)} WHERE id = ${input.alvoId}`;
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'norma_alteracao_registrada',
      resourceType: 'norma',
      resourceId: input.alvoId,
      ip,
      metadata: { alteradora: alteradoraId, itens: input.itens.length, revogacaoTotal: !!input.revogacaoTotal, vigencia },
    });
    return this.obter(v, input.alvoId);
  }

  // ---------------------------------------------------------------------------

  /** PDF do texto compilado no estilo Planalto. */
  async compiladoPdf(v: Visao, id: string, data?: string): Promise<{ pdf: Buffer; nome: string }> {
    const norma = await this.obter(v, id, data);
    const ctx = requireTenantContext();
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFKitDocument({ size: 'A4', margin: 56, bufferPages: true });
      const partes: Buffer[] = [];
      doc.on('data', (c: Buffer) => partes.push(c));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      const largura = doc.page.width - 112;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(ctx.nome.toUpperCase(), { align: 'center' });
      // Se o texto ja traz epigrafe/ementa (como no Planalto), o cabecalho nao as repete.
      const temEpigrafe = norma.compilado.some((n) => n.rotulo === 'Epígrafe');
      if (!temEpigrafe) doc.moveDown(0.6).fontSize(13).text(rotuloNorma(norma).toUpperCase(), { align: 'center' });
      doc.moveDown(0.3).font('Helvetica').fontSize(8).fillColor('#475569')
        .text(`Texto compilado — vigente em ${norma.data.split('-').reverse().join('/')} · Situação: ${norma.situacao === 'revogada_parcial' ? 'Revogada parcialmente' : norma.situacao.charAt(0).toUpperCase() + norma.situacao.slice(1)}`, { align: 'center' });
      if (!temEpigrafe) doc.moveDown(0.6).fillColor('#0f172a').font('Helvetica-Oblique').fontSize(9).text(norma.ementa, 56 + largura * 0.4, doc.y, { width: largura * 0.6, align: 'justify' });
      doc.fillColor('#0f172a').moveDown(1);

      const x = 56;
      const escrever = (no: NoCompilado) => {
        if (doc.y > doc.page.height - 90) doc.addPage();
        const agrupador = AGRUPADORES.includes(no.tipo);
        if (agrupador) {
          doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(no.rotulo, x, doc.y, { width: largura, align: 'center' });
          if (no.texto) doc.font('Helvetica-Bold').text(no.texto, { width: largura, align: 'center' });
          doc.moveDown(0.3);
        } else {
          // Redacoes superadas: riscadas, em cinza, com a nota de quem alterou.
          for (const h of no.historico) {
            if (h.vigente) continue;
            if (h.texto === null) continue;
            const y = doc.y;
            doc.font('Helvetica').fontSize(9).fillColor('#94a3b8');
            const rot = rotuloExibicao(no.tipo, no.rotulo);
            const t = `${rot ? `${rot} ` : ''}${h.texto}`;
            doc.text(t, x, y, { width: largura, align: 'justify', strike: true });
            const nota = notaEvento(h);
            if (nota) doc.fontSize(7.5).fillColor('#2563eb').text(nota, { width: largura });
            doc.moveDown(0.25);
          }
          const atual = no.historico.find((h) => h.vigente)!;
          const corpo = no.revogado ? '(Revogado)' : (no.texto ?? '');
          doc.fontSize(10).fillColor('#0f172a');
          if (no.rotulo === 'Epígrafe') {
            doc.font('Helvetica-Bold').text(corpo.toUpperCase(), x, doc.y, { width: largura, align: 'center' });
          } else if (no.rotulo === 'Ementa') {
            doc.moveDown(0.3).font('Helvetica-Oblique').fontSize(9).text(corpo, x + largura * 0.45, doc.y, { width: largura * 0.55, align: 'justify' });
            doc.moveDown(0.6);
          } else if (no.tipo === 'preambulo' || no.tipo === 'fecho') {
            doc.font('Helvetica').text(corpo, x, doc.y, { width: largura, align: no.tipo === 'fecho' ? 'left' : 'justify' });
          } else {
            doc.font(no.tipo === 'artigo' ? 'Helvetica-Bold' : 'Helvetica').text(`${rotuloExibicao(no.tipo, no.rotulo)} `, x, doc.y, { width: largura, continued: true });
            doc.font('Helvetica').text(corpo, { width: largura, align: 'justify' });
          }
          const nota = notaEvento(atual);
          if (nota) doc.fontSize(7.5).fillColor('#2563eb').text(nota, x, doc.y, { width: largura });
          doc.fillColor('#0f172a').moveDown(0.4);
        }
        for (const f of no.filhos) escrever(f);
      };
      for (const no of norma.compilado) escrever(no);

      const pags = doc.bufferedPageRange();
      for (let i = 0; i < pags.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(
          `${ctx.nome} — ${rotuloNormaCurto(norma)} — texto compilado, sem valor oficial; confira a publicação original — página ${i + 1} de ${pags.count}`,
          56,
          doc.page.height - 36,
          { width: doc.page.width - 112, align: 'center', lineBreak: false },
        );
      }
      doc.end();
    });
    return { pdf, nome: `${norma.tipo}-${norma.numero.replace(/[^\w-]+/g, '-')}-${norma.ano}-compilado.pdf` };
  }
}
