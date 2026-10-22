import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CRITICIDADES,
  PRAZOS_SLA,
  STATUS_ENCERRADOS,
  horasUteisEntre,
  somarHorasUteis,
  type AnexoChamado,
  type ChamadoCreateAdminInput,
  type ChamadoCreateInput,
  type ChamadoDetalhe,
  type ChamadoResumo,
  type ChamadoUpdateInput,
  type Criticidade,
  type FeriadoInput,
  type MensagemChamado,
  type MensagemChamadoInput,
  type RelatorioSla,
  type ReleaseInput,
  type ReleaseView,
  type StatusChamado,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { EmailService } from '../email/email.service';

interface TicketRow {
  id: string;
  number: string;
  tenant_id: string;
  orgao: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  criticality: Criticidade;
  status: StatusChamado;
  channel: string;
  opened_by_name: string;
  opened_by_email: string | null;
  opened_by_user_id: string | null;
  assignee_admin_id: string | null;
  responsavel: string | null;
  attachments: AnexoChamado[];
  created_at: Date;
  updated_at: Date;
  response_due_at: Date;
  resolution_due_at: Date;
  first_response_at: Date | null;
  resolved_at: Date | null;
  justification: string | null;
  contingency: string | null;
  satisfaction: number | null;
}

const SELECT = `
  k.id, k.number::text, k.tenant_id, t.nome AS orgao, t.slug, k.title, k.description, k.category, k.criticality, k.status,
  k.channel, k.opened_by_name, k.opened_by_email, k.opened_by_user_id, k.assignee_admin_id, a.nome AS responsavel,
  k.attachments, k.created_at, k.updated_at, k.response_due_at, k.resolution_due_at, k.first_response_at, k.resolved_at,
  k.justification, k.contingency, k.satisfaction
`;
const FROM = `FROM platform.tickets k JOIN public.tenants t ON t.id = k.tenant_id LEFT JOIN public.superadmins a ON a.id = k.assignee_admin_id`;

const MAX_ANEXO = 10 * 1024 * 1024;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const media = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

/** Tipo do anexo pelos primeiros bytes (nao confia no nome nem no Content-Type). */
function tipoAnexo(buf: Buffer): 'pdf' | 'png' | 'jpg' | null {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

/**
 * Chamados dos orgaos com a equipe JEOS. Prazos de SLA em horas uteis
 * (seg-sex, 08h-12h e 13h-17h de Fortaleza, sem feriados). Todo acesso pelo
 * orgao filtra pelo orgao da rota; mensagens internas nunca vao para o orgao.
 */
@Injectable()
export class ChamadosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  private async feriados(): Promise<Set<string>> {
    const rows = await this.db.catalog()<Array<{ data: string }>>`SELECT data::text FROM platform.holidays`;
    return new Set(rows.map((r) => r.data));
  }

  private async prazos(c: Criticidade, aPartir = new Date()): Promise<{ resposta: Date; solucao: Date }> {
    const f = await this.feriados();
    return { resposta: somarHorasUteis(aPartir, PRAZOS_SLA[c].resposta, f), solucao: somarHorasUteis(aPartir, PRAZOS_SLA[c].solucao, f) };
  }

  private resumo(r: TicketRow): ChamadoResumo {
    const agora = Date.now();
    const aberto = !STATUS_ENCERRADOS.includes(r.status);
    return {
      id: r.id,
      numero: Number(r.number),
      tenantId: r.tenant_id,
      orgao: r.orgao,
      titulo: r.title,
      categoria: r.category,
      criticidade: r.criticality,
      status: r.status,
      canal: r.channel,
      abertoPor: r.opened_by_name,
      responsavel: r.responsavel,
      responsavelId: r.assignee_admin_id,
      criadoEm: r.created_at.toISOString(),
      atualizadoEm: r.updated_at.toISOString(),
      prazoResposta: r.response_due_at.toISOString(),
      prazoSolucao: r.resolution_due_at.toISOString(),
      respondidoEm: r.first_response_at?.toISOString() ?? null,
      resolvidoEm: r.resolved_at?.toISOString() ?? null,
      respostaAtrasada: r.first_response_at ? r.first_response_at > r.response_due_at : aberto && agora > r.response_due_at.getTime(),
      solucaoAtrasada: r.resolved_at ? r.resolved_at > r.resolution_due_at : aberto && agora > r.resolution_due_at.getTime(),
      satisfacao: r.satisfaction,
    };
  }

  private async linha(id: string, tenantId?: string): Promise<TicketRow> {
    const sql = this.db.catalog();
    const [r] = await sql<TicketRow[]>`
      SELECT ${sql.unsafe(SELECT)} ${sql.unsafe(FROM)}
      WHERE k.id = ${id} AND (${tenantId ?? null}::uuid IS NULL OR k.tenant_id = ${tenantId ?? null})
    `;
    if (!r) throw new NotFoundException('Chamado não encontrado');
    return r;
  }

  async detalhe(id: string, opts: { tenantId?: string; comInternas: boolean }): Promise<ChamadoDetalhe> {
    const r = await this.linha(id, opts.tenantId);
    const msgs = await this.db.catalog()<
      Array<{ id: string; author_type: MensagemChamado['autorTipo']; author_name: string; body: string; internal: boolean; attachments: AnexoChamado[]; created_at: Date }>
    >`
      SELECT id, author_type, author_name, body, internal, attachments, created_at FROM platform.ticket_messages
      WHERE ticket_id = ${id} AND (${opts.comInternas} OR NOT internal) ORDER BY created_at
    `;
    return {
      ...this.resumo(r),
      descricao: r.description,
      anexos: r.attachments ?? [],
      justificativa: r.justification,
      contingencia: r.contingency,
      solicitanteEmail: r.opened_by_email,
      mensagens: msgs.map((m) => ({
        id: m.id,
        autorTipo: m.author_type,
        autor: m.author_name,
        corpo: m.body,
        interna: m.internal,
        anexos: m.attachments ?? [],
        criadoEm: m.created_at.toISOString(),
      })),
    };
  }

  async listar(f: {
    tenantId?: string;
    status?: string;
    criticidade?: string;
    responsavelId?: string;
    atrasados?: boolean;
    abertos?: boolean;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: ChamadoResumo[]; total: number }> {
    const sql = this.db.catalog();
    const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
    const num = f.q && /^\d+$/.test(f.q.trim()) ? Number(f.q.trim()) : null;
    const filtro = sql`
      WHERE (${f.tenantId ?? null}::uuid IS NULL OR k.tenant_id = ${f.tenantId ?? null})
        AND (${f.status ?? null}::text IS NULL OR k.status = ${f.status ?? null})
        AND (${f.criticidade ?? null}::text IS NULL OR k.criticality = ${f.criticidade ?? null})
        AND (${f.responsavelId ?? null}::uuid IS NULL OR k.assignee_admin_id = ${f.responsavelId ?? null})
        AND (${f.abertos ?? false} = false OR k.status NOT IN ('resolvido', 'fechado', 'cancelado'))
        AND (${f.atrasados ?? false} = false OR (k.status NOT IN ('resolvido', 'fechado', 'cancelado') AND
          ((k.first_response_at IS NULL AND k.response_due_at < now()) OR k.resolution_due_at < now())))
        AND (${q}::text IS NULL OR lower(k.title) LIKE ${q} OR lower(t.nome) LIKE ${q} OR k.number = ${num ?? -1})
    `;
    const rows = await sql<TicketRow[]>`
      SELECT ${sql.unsafe(SELECT)} ${sql.unsafe(FROM)} ${filtro}
      ORDER BY (k.status IN ('resolvido', 'fechado', 'cancelado')), k.resolution_due_at
      LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}
    `;
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n ${sql.unsafe(FROM)} ${filtro}`;
    return { items: rows.map((r) => this.resumo(r)), total: t?.n ?? 0 };
  }

  /** Aberto pelo usuario do orgao. */
  async abrirPeloOrgao(
    tenantId: string,
    autor: { id: string; nome: string; email: string },
    input: ChamadoCreateInput,
  ): Promise<ChamadoDetalhe> {
    const p = await this.prazos(input.criticidade);
    const [r] = await this.db.catalog()<Array<{ id: string; number: string }>>`
      INSERT INTO platform.tickets (tenant_id, opened_by_user_id, opened_by_name, opened_by_email, channel, category, criticality,
        title, description, attachments, response_due_at, resolution_due_at)
      VALUES (${tenantId}, ${autor.id}, ${autor.nome}, ${autor.email}, 'portal', ${input.categoria}, ${input.criticidade},
        ${input.titulo}, ${input.descricao}, ${this.db.catalog().json(input.anexos as never)}, ${p.resposta}, ${p.solucao})
      RETURNING id, number::text
    `;
    void this.avisarEquipe(r!.number, input.titulo);
    return this.detalhe(r!.id, { tenantId, comInternas: false });
  }

  /** Aberto pela equipe em nome do orgao (telefone, e-mail...). */
  async abrirPelaEquipe(input: ChamadoCreateAdminInput, admin: { id: string; nome: string }): Promise<ChamadoDetalhe> {
    const p = await this.prazos(input.criticidade);
    const sql = this.db.catalog();
    const [r] = await sql<Array<{ id: string }>>`
      INSERT INTO platform.tickets (tenant_id, opened_by_name, opened_by_email, channel, category, criticality, title, description,
        attachments, response_due_at, resolution_due_at, assignee_admin_id)
      VALUES (${input.tenantId}, ${input.solicitanteNome}, ${input.solicitanteEmail ?? null}, ${input.canal}, ${input.categoria},
        ${input.criticidade}, ${input.titulo}, ${input.descricao}, ${sql.json(input.anexos as never)}, ${p.resposta}, ${p.solucao}, ${admin.id})
      RETURNING id
    `;
    await sql`
      INSERT INTO platform.ticket_messages (ticket_id, author_type, author_id, author_name, body, internal)
      VALUES (${r!.id}, 'system', ${admin.id}, 'Sistema', ${`Chamado registrado por ${admin.nome}.`}, true)
    `;
    return this.detalhe(r!.id, { comInternas: true });
  }

  private async avisarEquipe(numero: string, titulo: string): Promise<void> {
    const [s] = await this.db.catalog()<Array<{ email: string | null }>>`
      SELECT config->>'remetenteEmail' AS email FROM platform.settings WHERE key = 'email_smtp' AND enabled
    `;
    if (!s?.email) return;
    await this.email.enviar({
      tenantId: null,
      para: s.email,
      remetente: 'jDoc — Atendimento',
      assunto: `Novo chamado nº ${numero}: ${titulo}`,
      paragrafos: [`Um órgão abriu o chamado nº ${numero}: "${titulo}".`],
      botao: { texto: 'Abrir a fila de chamados', url: this.email.urlApp('/superadmin/chamados') },
    });
  }

  /** Mensagem da equipe (publica ou interna) ou do orgao. */
  async mensagem(
    id: string,
    autor: { tipo: 'admin' | 'user'; id: string; nome: string },
    input: MensagemChamadoInput,
    tenantId?: string,
  ): Promise<ChamadoDetalhe> {
    const r = await this.linha(id, tenantId);
    if (autor.tipo === 'user' && input.interna) throw new ForbiddenException('Mensagem interna é só da equipe');
    if (STATUS_ENCERRADOS.includes(r.status) && r.status !== 'resolvido') throw new BadRequestException('Chamado encerrado');
    const sql = this.db.catalog();
    await sql`
      INSERT INTO platform.ticket_messages (ticket_id, author_type, author_id, author_name, body, internal, attachments)
      VALUES (${id}, ${autor.tipo}, ${autor.id}, ${autor.nome}, ${input.corpo}, ${input.interna}, ${sql.json(input.anexos as never)})
    `;
    if (autor.tipo === 'admin' && !input.interna) {
      // Primeira resposta publica conta para o SLA; responder poe "em atendimento".
      await sql`
        UPDATE platform.tickets SET first_response_at = coalesce(first_response_at, now()),
          status = CASE WHEN status = 'aberto' THEN 'em_atendimento' ELSE status END,
          assignee_admin_id = coalesce(assignee_admin_id, ${autor.id}), updated_at = now()
        WHERE id = ${id}
      `;
      if (r.opened_by_email) {
        void this.email.enviar({
          tenantId: r.tenant_id,
          para: r.opened_by_email,
          remetente: 'jDoc — Suporte JEOS',
          assunto: `Resposta no chamado nº ${r.number}: ${r.title}`,
          paragrafos: [`Olá, ${r.opened_by_name}.`, `${autor.nome} respondeu o seu chamado:`, input.corpo.slice(0, 2000)],
          botao: { texto: 'Ver o chamado', url: this.email.urlApp(`/${r.slug}/suporte?chamado=${id}`) },
        });
      }
    } else if (autor.tipo === 'user') {
      // Orgao respondeu: volta para a fila da equipe.
      await sql`
        UPDATE platform.tickets SET status = CASE WHEN status IN ('aguardando_cliente', 'resolvido') THEN 'em_atendimento' ELSE status END,
          resolved_at = CASE WHEN status = 'resolvido' THEN NULL ELSE resolved_at END, updated_at = now()
        WHERE id = ${id}
      `;
    }
    return this.detalhe(id, { tenantId, comInternas: autor.tipo === 'admin' });
  }

  /** Equipe muda status, criticidade, responsavel, justificativa e contingencia. */
  async atualizar(id: string, input: ChamadoUpdateInput, admin: { id: string; nome: string }): Promise<{ antes: ChamadoResumo; depois: ChamadoDetalhe }> {
    const r = await this.linha(id);
    const antes = this.resumo(r);
    const encerrando = input.status && ['resolvido', 'fechado'].includes(input.status) && !STATUS_ENCERRADOS.includes(r.status);
    const justificativa = input.justificativa === undefined ? r.justification : input.justificativa;
    if (encerrando && (antes.respostaAtrasada || antes.solucaoAtrasada || Date.now() > r.resolution_due_at.getTime()) && !justificativa?.trim()) {
      throw new BadRequestException({ message: 'O prazo estourou: informe a justificativa para encerrar', code: 'justificativa_obrigatoria' });
    }
    let respostaDue = r.response_due_at;
    let solucaoDue = r.resolution_due_at;
    if (input.criticidade && input.criticidade !== r.criticality) {
      const p = await this.prazos(input.criticidade, r.created_at);
      respostaDue = p.resposta;
      solucaoDue = p.solucao;
    }
    const status = input.status ?? r.status;
    const sql = this.db.catalog();
    await sql`
      UPDATE platform.tickets SET
        status = ${status},
        criticality = ${input.criticidade ?? r.criticality},
        response_due_at = ${respostaDue},
        resolution_due_at = ${solucaoDue},
        assignee_admin_id = ${input.responsavelId === undefined ? r.assignee_admin_id : input.responsavelId},
        justification = ${justificativa},
        contingency = ${input.contingencia === undefined ? r.contingency : input.contingencia},
        resolved_at = CASE WHEN ${status} = 'resolvido' THEN coalesce(resolved_at, now())
                           WHEN ${status} IN ('aberto', 'em_atendimento', 'aguardando_cliente') THEN NULL ELSE resolved_at END,
        closed_at = CASE WHEN ${status} IN ('fechado', 'cancelado') THEN coalesce(closed_at, now()) ELSE NULL END,
        updated_at = now()
      WHERE id = ${id}
    `;
    if (input.status && input.status !== r.status) {
      await sql`
        INSERT INTO platform.ticket_messages (ticket_id, author_type, author_id, author_name, body, internal)
        VALUES (${id}, 'system', ${admin.id}, 'Sistema', ${`${admin.nome} mudou a situação.`}, false)
      `;
    }
    return { antes, depois: await this.detalhe(id, { comInternas: true }) };
  }

  /** Orgao avalia o atendimento (1 a 5) depois de resolvido; isso fecha o chamado. */
  async avaliar(id: string, tenantId: string, nota: number, comentario?: string): Promise<ChamadoDetalhe> {
    const r = await this.linha(id, tenantId);
    if (r.status !== 'resolvido' && r.status !== 'fechado') throw new BadRequestException('Só dá para avaliar depois de resolvido');
    await this.db.catalog()`
      UPDATE platform.tickets SET satisfaction = ${nota}, satisfaction_comment = ${comentario ?? null}, status = 'fechado',
        closed_at = coalesce(closed_at, now()), updated_at = now()
      WHERE id = ${id}
    `;
    return this.detalhe(id, { tenantId, comInternas: false });
  }

  /** Anexo (PDF, PNG ou JPG ate 10 MB) no storage do orgao. */
  async enviarAnexo(tenantId: string, file: { buffer: Buffer; size: number; originalname?: string }): Promise<AnexoChamado> {
    if (file.size > MAX_ANEXO) throw new BadRequestException('Anexo maior que 10 MB');
    const tipo = tipoAnexo(file.buffer);
    if (!tipo) throw new BadRequestException('Envie PDF, PNG ou JPG');
    const [t] = await this.db.catalog()<Array<{ slug: string }>>`SELECT slug FROM public.tenants WHERE id = ${tenantId}`;
    if (!t) throw new NotFoundException('Órgão não encontrado');
    const key = `${randomUUID()}.${tipo}`;
    await this.storage.upload(t.slug, key, file.buffer);
    return { key, nome: (file.originalname ?? `anexo.${tipo}`).slice(0, 200), tamanho: file.size };
  }

  /** URL temporaria de um anexo — so se ele pertence ao chamado (e o chamado ao orgao). */
  async urlAnexo(id: string, key: string, opts: { tenantId?: string; comInternas: boolean }): Promise<{ url: string }> {
    const d = await this.detalhe(id, opts);
    const todos = [...d.anexos, ...d.mensagens.flatMap((m) => m.anexos)];
    const a = todos.find((x) => x.key === key);
    if (!a) throw new NotFoundException('Anexo não encontrado');
    const [t] = await this.db.catalog()<Array<{ slug: string }>>`SELECT slug FROM public.tenants WHERE id = ${d.tenantId}`;
    return { url: await this.storage.createSignedUrl(t!.slug, key, 60, a.nome.replace(/\.[^.]+$/, '')) };
  }

  // ---------------- Relatorio de SLA ----------------

  async relatorio(de: Date, ate: Date, tenantId?: string): Promise<RelatorioSla> {
    const sql = this.db.catalog();
    const rows = await sql<TicketRow[]>`
      SELECT ${sql.unsafe(SELECT)} ${sql.unsafe(FROM)}
      WHERE k.created_at BETWEEN ${de} AND ${ate} AND k.status <> 'cancelado'
        AND (${tenantId ?? null}::uuid IS NULL OR k.tenant_id = ${tenantId ?? null})
    `;
    const f = await this.feriados();
    const calc = (lista: TicketRow[]) => {
      const respondidos = lista.filter((r) => r.first_response_at);
      const resolvidos = lista.filter((r) => r.resolved_at);
      return {
        total: lista.length,
        respostaNoPrazoPct: pct(respondidos.filter((r) => r.first_response_at! <= r.response_due_at).length, respondidos.length),
        solucaoNoPrazoPct: pct(resolvidos.filter((r) => r.resolved_at! <= r.resolution_due_at).length, resolvidos.length),
        mediaRespostaH: media(respondidos.map((r) => horasUteisEntre(r.created_at, r.first_response_at!, f))),
        mediaSolucaoH: media(resolvidos.map((r) => horasUteisEntre(r.created_at, r.resolved_at!, f))),
        satisfacaoMedia: media(lista.filter((r) => r.satisfaction).map((r) => r.satisfaction!)),
      };
    };
    const geral = calc(rows);
    const porOrgao = new Map<string, TicketRow[]>();
    for (const r of rows) porOrgao.set(r.tenant_id, [...(porOrgao.get(r.tenant_id) ?? []), r]);
    return {
      de: de.toISOString(),
      ate: ate.toISOString(),
      ...geral,
      atrasadosAbertos: rows.filter((r) => {
        const v = this.resumo(r);
        return !STATUS_ENCERRADOS.includes(r.status) && (v.respostaAtrasada || v.solucaoAtrasada);
      }).length,
      porCriticidade: CRITICIDADES.map((c) => {
        const x = calc(rows.filter((r) => r.criticality === c));
        return { criticidade: c, total: x.total, respostaNoPrazoPct: x.respostaNoPrazoPct, solucaoNoPrazoPct: x.solucaoNoPrazoPct };
      }),
      porOrgao: [...porOrgao.entries()]
        .map(([id, lista]) => {
          const x = calc(lista);
          return { tenantId: id, orgao: lista[0]!.orgao, total: x.total, respostaNoPrazoPct: x.respostaNoPrazoPct, solucaoNoPrazoPct: x.solucaoNoPrazoPct, satisfacaoMedia: x.satisfacaoMedia };
        })
        .sort((a, b) => b.total - a.total),
    };
  }

  // ---------------- Releases e feriados ----------------

  async releases(limite = 100): Promise<ReleaseView[]> {
    const rows = await this.db.catalog()<Array<{ id: string; version: string; title: string; body: string; kind: ReleaseView['tipo']; published_at: Date }>>`
      SELECT id, version, title, body, kind, published_at FROM platform.releases ORDER BY published_at DESC LIMIT ${limite}
    `;
    return rows.map((r) => ({ id: r.id, versao: r.version, titulo: r.title, corpo: r.body, tipo: r.kind, publicadoEm: r.published_at.toISOString() }));
  }

  async publicarRelease(input: ReleaseInput): Promise<ReleaseView> {
    const [r] = await this.db.catalog()<Array<{ id: string }>>`
      INSERT INTO platform.releases (version, title, body, kind) VALUES (${input.versao}, ${input.titulo}, ${input.corpo}, ${input.tipo}) RETURNING id
    `;
    return (await this.releases()).find((x) => x.id === r!.id)!;
  }

  async editarRelease(id: string, input: ReleaseInput): Promise<ReleaseView> {
    const r = await this.db.catalog()`
      UPDATE platform.releases SET version = ${input.versao}, title = ${input.titulo}, body = ${input.corpo}, kind = ${input.tipo} WHERE id = ${id}
    `;
    if (!r.count) throw new NotFoundException('Nota de versão não encontrada');
    return (await this.releases()).find((x) => x.id === id)!;
  }

  async excluirRelease(id: string): Promise<void> {
    await this.db.catalog()`DELETE FROM platform.releases WHERE id = ${id}`;
  }

  async listarFeriados(): Promise<FeriadoInput[]> {
    return this.db.catalog()<FeriadoInput[]>`SELECT data::text AS data, nome FROM platform.holidays ORDER BY data DESC`;
  }

  async salvarFeriado(f: FeriadoInput): Promise<void> {
    await this.db.catalog()`
      INSERT INTO platform.holidays (data, nome) VALUES (${f.data}, ${f.nome}) ON CONFLICT (data) DO UPDATE SET nome = EXCLUDED.nome
    `;
  }

  async excluirFeriado(data: string): Promise<void> {
    await this.db.catalog()`DELETE FROM platform.holidays WHERE data = ${data}`;
  }
}
