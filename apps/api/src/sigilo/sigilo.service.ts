import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import PDFKitDocument from 'pdfkit';
import type { Sql } from 'postgres';
import {
  GRAUS_SIGILO,
  GRAU_SIGILO_LABEL,
  PRAZO_SIGILO_ANOS,
  fundamentoSigilo,
  prazoFimSigilo,
  type ClassificarSigiloInput,
  type GrauSigilo,
  type HipoteseSigilo,
  type SigiloResumo,
  type TenantAccessClaims,
  type TermoSigiloView,
  hojeIso,
} from '@jdoc/shared';
import { loadEnv } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { podeVerSigiloso } from '../common/acesso-documento';
import { requireTenantContext } from '../tenancy/tenant-context';
import { gerarPdfTabela } from '../common/exportacao';

const SIGILO_QUEUE = 'sigilo';
const JOB_DIARIO = 'sigilo-diario';
const DIA_MS = 86_400_000;

interface TermoRow {
  id: string;
  numero: number;
  ano: number;
  document_id: string;
  documento: string;
  grau: GrauSigilo;
  hipotese: HipoteseSigilo;
  fundamento_complemento: string | null;
  razoes: string;
  autoridade_nome: string;
  autoridade_cargo: string;
  data_producao: Date;
  data_classificacao: Date;
  prazo_fim: Date;
  status: TermoSigiloView['status'];
  encerrado_em: Date | null;
  motivo_encerramento: string | null;
  classificado_por: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const br = (d: string | Date | null) => (d ? new Date(typeof d === 'string' ? `${d.slice(0, 10)}T12:00:00` : d).toLocaleDateString('pt-BR') : '—');
const IDENT = `COALESCE(NULLIF(concat_ws(' — ',
    CASE WHEN d.metadados ? 'numero' THEN concat_ws(' ', t.nome, 'nº', d.metadados->>'numero') END,
    CASE WHEN d.doc_caixa IS NOT NULL THEN 'Doc. Caixa ' || d.doc_caixa END,
    NULLIF(d.descricao, ''), NULLIF(d.historico, '')), ''), d.original_name, 'Documento')`;

/**
 * Sigilo (LAI). Classificar torna o documento restrito (toda a visibilidade existente
 * passa a valer); o termo guarda o nivel anterior para restaurar quando o sigilo acaba
 * (desclassificacao antecipada ou fim do prazo — este, automatico todo dia e tambem
 * conferido ao consultar, para nunca depender so do job).
 */
@Injectable()
export class SigiloService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SigiloService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private redis: Redis[] = [];

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();
    const conexao = () => {
      const r = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.redis.push(r);
      return r;
    };
    this.queue = new Queue(SIGILO_QUEUE, { connection: conexao() });
    this.worker = new Worker(SIGILO_QUEUE, () => this.expirarTodos(), { connection: conexao(), concurrency: 1 });
    this.worker.on('failed', (_j, err) => this.logger.error(`Sigilo diario falhou: ${err.message}`));
    if (env.NODE_ENV !== 'test') {
      // 00:20: logo apos a virada do dia o sigilo vencido ja cai.
      await this.queue.add(JOB_DIARIO, {}, { repeat: { pattern: '20 0 * * *', key: JOB_DIARIO }, jobId: JOB_DIARIO, removeOnComplete: 30, removeOnFail: 30 });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.redis.map((r) => r.quit()));
  }

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  /** Informacao classificada: so quem tem acervo_sigiloso:read (alem do admin) ve conteudo e razoes. */
  private podeVerRestrito(user: TenantAccessClaims): boolean {
    return podeVerSigiloso(user);
  }

  /** Fim do prazo: status expirado e nivel de acesso anterior restaurado. Idempotente. */
  async expirarVencidos(sql: Sql): Promise<number> {
    const vencidos = await sql<Array<{ id: string; document_id: string; nivel_acesso_anterior: string }>>`
      UPDATE termos_sigilo SET status = 'expirado', encerrado_em = now(),
             motivo_encerramento = 'Fim do prazo de sigilo (art. 24, § 4º, da Lei nº 12.527/2011)'
      WHERE status = 'vigente' AND prazo_fim <= (now() AT TIME ZONE 'America/Fortaleza')::date
      RETURNING id, document_id, nivel_acesso_anterior
    `;
    for (const v of vencidos) {
      await sql`UPDATE documents SET grau_sigilo = NULL, nivel_acesso = ${v.nivel_acesso_anterior} WHERE id = ${v.document_id}`;
      await sql`
        INSERT INTO audit_logs (action, resource_type, resource_id, metadata)
        VALUES ('sigilo_expirado', 'documento', ${v.document_id}, ${sql.json({ termo: v.id })})
      `;
    }
    return vencidos.length;
  }

  async expirarTodos(): Promise<void> {
    const tenants = await this.db.catalog()<Array<{ schema_name: string; slug: string }>>`
      SELECT schema_name, slug FROM public.tenants WHERE status = 'ativo' AND 'arquivo' = ANY(modulos)
    `;
    for (const t of tenants) {
      try {
        const n = await this.expirarVencidos(this.db.tenant(t.schema_name));
        if (n > 0) this.logger.log(`${t.slug}: ${n} sigilo(s) encerrado(s) por prazo`);
      } catch (e) {
        this.logger.error(`Sigilo ${t.slug}: ${(e as Error).message}`);
      }
    }
  }

  private toView(r: TermoRow, user: TenantAccessClaims): TermoSigiloView {
    const vigente = r.status === 'vigente';
    return {
      id: r.id,
      numeroTci: `TCI ${String(r.numero).padStart(3, '0')}/${r.ano}`,
      documentId: r.document_id,
      // Termo vigente = documento restrito: sem permissao, nao revela o titulo.
      documento: vigente && !this.podeVerRestrito(user) ? 'Documento classificado' : r.documento,
      grau: r.grau,
      hipotese: r.hipotese,
      fundamento: fundamentoSigilo(r.hipotese, r.fundamento_complemento),
      razoes: vigente && !this.podeVerRestrito(user) ? '—' : r.razoes,
      autoridadeNome: r.autoridade_nome,
      autoridadeCargo: r.autoridade_cargo,
      dataProducao: iso(r.data_producao),
      dataClassificacao: iso(r.data_classificacao),
      prazoFim: iso(r.prazo_fim),
      status: r.status,
      encerradoEm: r.encerrado_em?.toISOString() ?? null,
      motivoEncerramento: r.motivo_encerramento,
      classificadoPor: r.classificado_por,
      diasRestantes: vigente ? Math.ceil((r.prazo_fim.getTime() - Date.now()) / DIA_MS) : null,
    };
  }

  private termos(sql: Sql, where: ReturnType<Sql>) {
    return sql<TermoRow[]>`
      SELECT ts.*, ${sql.unsafe(IDENT)} AS documento, u.nome AS classificado_por
      FROM termos_sigilo ts
      JOIN documents d ON d.id = ts.document_id
      LEFT JOIN document_types t ON t.id = d.document_type_id
      LEFT JOIN users u ON u.id = ts.criado_por
      WHERE ${where}
      ORDER BY (ts.status = 'vigente') DESC, ts.prazo_fim ASC, ts.ano DESC, ts.numero DESC
      LIMIT 500
    `;
  }

  async listar(user: TenantAccessClaims, situacao: 'vigentes' | 'encerrados' | 'todos', documentId?: string): Promise<TermoSigiloView[]> {
    const sql = this.sql();
    await this.expirarVencidos(sql);
    const partes: Array<ReturnType<Sql>> = [
      situacao === 'vigentes' ? sql`ts.status = 'vigente'` : situacao === 'encerrados' ? sql`ts.status <> 'vigente'` : sql`true`,
    ];
    if (documentId) partes.push(sql`ts.document_id = ${documentId}`);
    const rows = await this.termos(sql, partes.reduce((a, p) => sql`${a} AND ${p}`));
    return rows.map((r) => this.toView(r, user));
  }

  async resumo(): Promise<SigiloResumo> {
    const sql = this.sql();
    await this.expirarVencidos(sql);
    const porGrau = await sql<Array<{ grau: GrauSigilo; n: number }>>`
      SELECT grau, count(*)::int AS n FROM termos_sigilo WHERE status = 'vigente' GROUP BY grau
    `;
    const [x] = await sql<Array<{ expirando: number; desclassificados: number }>>`
      SELECT count(*) FILTER (WHERE status = 'vigente' AND prazo_fim <= (now() AT TIME ZONE 'America/Fortaleza')::date + 30)::int AS expirando,
             count(*) FILTER (WHERE status <> 'vigente' AND encerrado_em > now() - interval '12 months')::int AS desclassificados
      FROM termos_sigilo
    `;
    const vigentesPorGrau = Object.fromEntries(GRAUS_SIGILO.map((g) => [g, porGrau.find((p) => p.grau === g)?.n ?? 0])) as Record<GrauSigilo, number>;
    return { vigentesPorGrau, expirandoEm30Dias: x?.expirando ?? 0, desclassificados12Meses: x?.desclassificados ?? 0 };
  }

  async classificar(user: TenantAccessClaims, documentId: string, input: ClassificarSigiloInput, ip: string): Promise<TermoSigiloView> {
    const sql = this.sql();
    await this.expirarVencidos(sql);
    const [doc] = await sql<Array<{ document_date: Date | null; nivel_acesso: string | null; fase: string; deleted_at: Date | null }>>`
      SELECT document_date, nivel_acesso, fase, deleted_at FROM documents WHERE id = ${documentId}
    `;
    // Quem nao ve restritos nao classifica documento restrito (nem confirma que existe).
    if (!doc || doc.deleted_at || (doc.nivel_acesso === 'restrito' && !this.podeVerRestrito(user))) {
      throw new NotFoundException('Documento não encontrado');
    }
    if (doc.fase === 'eliminado') throw new BadRequestException('Documento eliminado não pode ser classificado');
    const dataProducao = input.dataProducao ?? (doc.document_date ? iso(doc.document_date) : null);
    if (!dataProducao) throw new BadRequestException('Informe a data de produção do documento');
    const maximo = prazoFimSigilo(dataProducao, input.grau);
    const prazoFim = input.prazoFim ?? maximo;
    const hoje = hojeIso();
    if (prazoFim > maximo) {
      throw new BadRequestException(`O prazo máximo para o grau ${GRAU_SIGILO_LABEL[input.grau].toLowerCase()} é ${PRAZO_SIGILO_ANOS[input.grau]} anos da produção (até ${br(maximo)}).`);
    }
    if (prazoFim <= hoje) {
      throw new BadRequestException(`O prazo desse grau já venceu em ${br(prazoFim)}: a informação já é pública e não pode ser classificada neste grau.`);
    }

    const id = await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const ano = Number(hojeIso().slice(0, 4));
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'tci-' + ano}))`;
      const vigente = await tx`SELECT 1 FROM termos_sigilo WHERE document_id = ${documentId} AND status = 'vigente'`;
      if (vigente.length > 0) throw new ConflictException('O documento já tem classificação vigente. Para mudar o grau, desclassifique e classifique de novo.');
      const [n] = await tx<Array<{ proximo: number }>>`SELECT COALESCE(max(numero), 0) + 1 AS proximo FROM termos_sigilo WHERE ano = ${ano}`;
      const [t] = await tx<Array<{ id: string }>>`
        INSERT INTO termos_sigilo (numero, ano, document_id, grau, hipotese, fundamento_complemento, razoes, autoridade_nome,
                                   autoridade_cargo, data_producao, data_classificacao, prazo_fim, nivel_acesso_anterior, criado_por)
        VALUES (${n!.proximo}, ${ano}, ${documentId}, ${input.grau}, ${input.hipotese}, ${input.fundamentoComplemento || null},
                ${input.razoes}, ${input.autoridadeNome}, ${input.autoridadeCargo}, ${dataProducao}, ${hoje}, ${prazoFim},
                ${doc.nivel_acesso ?? 'publico'}, ${user.sub})
        RETURNING id
      `;
      await tx`UPDATE documents SET grau_sigilo = ${input.grau}, nivel_acesso = 'restrito' WHERE id = ${documentId}`;
      return t!.id;
    });
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'sigilo_classificado',
      resourceType: 'documento',
      resourceId: documentId,
      ip,
      metadata: { termo: id, grau: input.grau, prazoFim },
    });
    return (await this.listar(user, 'todos', documentId)).find((t) => t.id === id)!;
  }

  async desclassificar(user: TenantAccessClaims, termoId: string, motivo: string, ip: string): Promise<TermoSigiloView> {
    const sql = this.sql();
    const [t] = await sql<Array<{ document_id: string; nivel_acesso_anterior: string }>>`
      UPDATE termos_sigilo SET status = 'desclassificado', encerrado_em = now(), encerrado_por = ${user.sub}, motivo_encerramento = ${motivo}
      WHERE id = ${termoId} AND status = 'vigente'
      RETURNING document_id, nivel_acesso_anterior
    `;
    if (!t) throw new NotFoundException('Termo não encontrado ou já encerrado');
    await sql`UPDATE documents SET grau_sigilo = NULL, nivel_acesso = ${t.nivel_acesso_anterior} WHERE id = ${t.document_id}`;
    await this.audit.logTenant({ actorId: user.sub, action: 'sigilo_desclassificado', resourceType: 'documento', resourceId: t.document_id, ip, metadata: { termo: termoId, motivo } });
    return (await this.listar(user, 'todos', t.document_id)).find((x) => x.id === termoId)!;
  }

  /** Termo de Classificacao de Informacao (modelo do Decreto 7.724/2012, anexo). */
  async tci(user: TenantAccessClaims, termoId: string): Promise<{ pdf: Buffer; nome: string }> {
    const sql = this.sql();
    const [r] = await this.termos(sql, sql`ts.id = ${termoId}`);
    if (!r) throw new NotFoundException('Termo não encontrado');
    if (r.status === 'vigente' && !this.podeVerRestrito(user)) throw new NotFoundException('Termo não encontrado');
    const t = this.toView(r, user);
    const ctx = requireTenantContext();
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFKitDocument({ size: 'A4', margin: 50 });
      const partes: Buffer[] = [];
      doc.on('data', (c: Buffer) => partes.push(c));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      doc.font('Helvetica-Bold').fontSize(11).text(ctx.nome.toUpperCase(), { align: 'center' });
      doc.fontSize(14).text('TERMO DE CLASSIFICAÇÃO DE INFORMAÇÃO', { align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`${t.numeroTci} · Lei nº 12.527/2011 e Decreto nº 7.724/2012`, { align: 'center' });
      doc.moveDown(1.2).fillColor('#0f172a');
      const linha = (rotulo: string, valor: string) => {
        const y = doc.y;
        doc.rect(50, y - 2, 495, 0.5).fill('#cbd5e1').fillColor('#0f172a');
        doc.font('Helvetica-Bold').fontSize(8).text(rotulo.toUpperCase(), 55, y + 3, { width: 150 });
        doc.font('Helvetica').fontSize(9).text(valor, 210, y + 3, { width: 330 });
        doc.y = Math.max(doc.y, y + 16) + 4;
      };
      linha('Órgão/entidade', ctx.nome);
      linha('Código de indexação', t.numeroTci);
      linha('Grau de sigilo', GRAU_SIGILO_LABEL[t.grau]);
      linha('Tipo de documento / assunto', t.documento);
      linha('Data de produção', br(t.dataProducao));
      linha('Fundamento legal', t.fundamento);
      linha('Razões da classificação', t.razoes);
      linha('Prazo da restrição de acesso', `Até ${br(t.prazoFim)} (máximo legal: ${PRAZO_SIGILO_ANOS[t.grau]} anos da produção)`);
      linha('Data da classificação', br(t.dataClassificacao));
      linha('Autoridade classificadora', `${t.autoridadeNome} — ${t.autoridadeCargo}`);
      linha('Registrado no sistema por', t.classificadoPor ?? '—');
      if (t.status !== 'vigente') {
        linha(t.status === 'expirado' ? 'Fim do sigilo por prazo' : 'Desclassificação', `${br(t.encerradoEm)} — ${t.motivoEncerramento ?? ''}`);
      }
      doc.moveDown(3);
      const y = doc.y;
      doc.moveTo(170, y).lineTo(425, y).strokeColor('#000').stroke();
      doc.fontSize(8).text(`${t.autoridadeNome} — ${t.autoridadeCargo}`, 170, y + 4, { width: 255, align: 'center' });
      doc.end();
    });
    return { pdf, nome: `${t.numeroTci.replace(/\s+/g, '-').replace('/', '-')}.pdf` };
  }

  /** Rol anual (art. 30): desclassificados nos ultimos 12 meses + quantidade classificada por grau. */
  async rol(user: TenantAccessClaims): Promise<{ pdf: Buffer; nome: string }> {
    const sql = this.sql();
    await this.expirarVencidos(sql);
    const resumo = await this.resumo();
    const encerrados = await this.termos(sql, sql`ts.status <> 'vigente' AND ts.encerrado_em > now() - interval '12 months'`);
    const ctx = requireTenantContext();
    type L = { a: string; b: string; c: string; d: string; e: string };
    const linhasGrau: L[] = GRAUS_SIGILO.map((g) => ({ a: GRAU_SIGILO_LABEL[g], b: String(resumo.vigentesPorGrau[g]), c: '', d: '', e: '' }));
    const linhasDesc: L[] = encerrados.map((r) => {
      const v = this.toView(r, user);
      return { a: v.numeroTci, b: v.documento, c: GRAU_SIGILO_LABEL[v.grau], d: br(v.encerradoEm), e: v.status === 'expirado' ? 'Fim do prazo' : 'Desclassificação' };
    });
    const pdf = await gerarPdfTabela<L>(
      {
        orgao: ctx.nome,
        titulo: 'Rol de Informações Classificadas e Desclassificadas',
        detalhes: ['Art. 30 da Lei nº 12.527/2011 — publicação anual', `Período: últimos 12 meses até ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}`],
      },
      [
        {
          subtitulo: 'Documentos classificados em cada grau de sigilo (vigentes)',
          colunas: [
            { titulo: 'Grau', peso: 70, valor: (l) => l.a },
            { titulo: 'Quantidade', peso: 30, valor: (l) => l.b, alinhar: 'right' },
          ],
          linhas: linhasGrau,
        },
        {
          subtitulo: 'Informações desclassificadas nos últimos 12 meses',
          colunas: [
            { titulo: 'Termo', peso: 14, valor: (l) => l.a },
            { titulo: 'Documento', peso: 46, valor: (l) => l.b },
            { titulo: 'Grau', peso: 14, valor: (l) => l.c },
            { titulo: 'Data', peso: 12, valor: (l) => l.d },
            { titulo: 'Forma', peso: 14, valor: (l) => l.e },
          ],
          linhas: linhasDesc,
        },
      ],
    );
    return { pdf, nome: `rol-sigilo-${hojeIso()}.pdf` };
  }
}
