import { createHash, randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import type { Sql } from 'postgres';
import {
  CAMPOS_PADRAO_DICIONARIO,
  EXPORTACAO_VALIDADE_DIAS,
  PADRAO_NOMES_EXPORTACAO,
  SCHEMA_NAME_REGEX,
  descreverLog,
  segmentoNome,
  type LogRegistro,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.module';
import { JobsService } from '../operacao/jobs.service';
import { loadEnv } from '../config/env';
import { gerarCsv, type ColunaExport } from '../common/exportacao';
import { EXPORTACAO_QUEUE, partesDe, type ExportacaoJobData, type ParteGuardada } from './exportacao.service';

interface DocExport {
  id: string;
  module: string;
  orgao_codigo: string | null;
  orgao_nome: string | null;
  tipo: string | null;
  numero: string | null;
  assunto: string | null;
  interessado: string | null;
  palavras_chave: string[] | null;
  document_date: Date | null;
  exercicio: number;
  descricao: string | null;
  historico: string | null;
  credor: string | null;
  doc_caixa: string | null;
  value: string | null;
  classe_codigo: string | null;
  classe_descricao: string | null;
  fase: string;
  nivel_acesso: string | null;
  grau_sigilo: string | null;
  dados_pessoais: string | null;
  file_key: string | null;
  file_hash: string | null;
  file_size: string | null;
  paginas: number | null;
  original_name: string;
  metadados: unknown;
  criado_em: Date;
}

interface ArquivoExport {
  documentId: string;
  key: string;
  caminho: string;
  hash: string | null;
  bytes: number;
}

const dataIso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/**
 * Monta a exportacao integral em partes ZIP (EXPORTACAO_PARTE_MB cada): PDFs
 * na estrutura padrao de pastas e, na parte 1, metadados (CSV e JSON),
 * classificacao, trilha de auditoria, dicionario, hashes e o LEIA-ME.
 */
@Injectable()
export class ExportacaoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportacaoWorker.name);
  private worker: Worker<ExportacaoJobData> | null = null;
  private redis: Redis | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.redis = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<ExportacaoJobData>(EXPORTACAO_QUEUE, (job) => this.processar(job), { connection: this.redis, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.logger.error(`Exportação ${job?.data.exportacaoId} falhou: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.redis?.quit();
  }

  async processar(job: Job<ExportacaoJobData>): Promise<void> {
    const d = job.data;
    if (!SCHEMA_NAME_REGEX.test(d.schemaName)) throw new Error(`Schema inválido: ${d.schemaName}`);
    const sql = this.db.tenant(d.schemaName);
    const run = await this.jobs.iniciarRegistro('exportacao', { tenantId: d.tenantId, origem: 'manual' });
    await sql`UPDATE exportacoes SET status = 'processando', iniciado_em = now() WHERE id = ${d.exportacaoId}`;
    try {
      await this.apagarExpiradas(sql, d.slug);
      const r = await this.gerar(sql, d);
      await this.jobs.concluirRegistro(run, null, { resumo: `${r.documentos} documento(s), ${r.partes} parte(s)` });
    } catch (e) {
      await sql`UPDATE exportacoes SET status = 'erro', erro = ${(e as Error).message.slice(0, 1000)}, concluido_em = now() WHERE id = ${d.exportacaoId}`;
      await this.jobs.concluirRegistro(run, (e as Error).message);
      throw e;
    }
  }

  /** Remove do storage as partes de exportacoes vencidas. */
  private async apagarExpiradas(sql: Sql, slug: string): Promise<void> {
    const velhas = await sql<Array<{ id: string; partes: unknown }>>`
      SELECT id, partes FROM exportacoes WHERE expira_em < now() AND partes <> '[]'::jsonb
    `;
    for (const v of velhas) {
      for (const p of partesDe(v.partes)) await this.storage.delete(slug, p.key).catch(() => undefined);
      await sql`UPDATE exportacoes SET partes = '[]'::jsonb WHERE id = ${v.id}`;
    }
  }

  private async gerar(sql: Sql, d: ExportacaoJobData): Promise<{ documentos: number; partes: number }> {
    const [exp] = await sql<Array<{ orgao_codigo: string | null }>>`SELECT orgao_codigo FROM exportacoes WHERE id = ${d.exportacaoId}`;
    const filtroOrgao = exp?.orgao_codigo ?? null;
    const docs = await sql<DocExport[]>`
      SELECT d.id, d.module, o.codigo AS orgao_codigo, o.descricao AS orgao_nome, t.nome AS tipo, d.numero, d.assunto, d.interessado,
             d.palavras_chave, d.document_date, d.exercicio, d.descricao, d.historico, d.credor, d.doc_caixa, d.value,
             c.codigo AS classe_codigo, c.descricao AS classe_descricao, d.fase, d.nivel_acesso, d.grau_sigilo, d.dados_pessoais,
             d.file_key, d.file_hash, d.file_size, d.paginas, d.original_name, d.metadados, d.criado_em
      FROM documents d
      LEFT JOIN orgaos o ON o.id = d.orgao_id
      LEFT JOIN document_types t ON t.id = d.document_type_id
      LEFT JOIN classificacoes c ON c.id = d.classificacao_id
      WHERE d.deleted_at IS NULL AND (${filtroOrgao}::varchar IS NULL OR o.codigo = ${filtroOrgao})
      ORDER BY o.codigo NULLS LAST, d.exercicio, d.module, d.document_date NULLS LAST, d.id
    `;
    const extras = await sql<Array<{ document_id: string; file_key: string; file_hash: string; file_size: string }>>`
      SELECT f.document_id, f.file_key, f.file_hash, f.file_size FROM document_files f
      JOIN documents d ON d.id = f.document_id WHERE d.deleted_at IS NULL ORDER BY f.criado_em
    `;

    // Caminho de cada arquivo no padrao de nomes (sem colisao).
    const usados = new Set<string>();
    const unico = (base: string) => {
      let c = `${base}.pdf`;
      for (let n = 2; usados.has(c.toLowerCase()); n++) c = `${base}-${n}.pdf`;
      usados.add(c.toLowerCase());
      return c;
    };
    const caminhoDoc = new Map<string, string>();
    const arquivos: ArquivoExport[] = [];
    for (const x of docs) {
      const pasta = [
        segmentoNome(x.orgao_codigo ? `${x.orgao_codigo}-${x.orgao_nome ?? ''}` : null, 'sem-secretaria'),
        String(x.exercicio),
        segmentoNome(x.module, 'documentos'),
        segmentoNome(x.tipo, 'sem-tipo'),
      ].join('/');
      const base = `documentos/${pasta}/${dataIso(x.document_date) || 'sem-data'}_${segmentoNome(x.numero, x.id.slice(0, 8))}`;
      if (x.file_key) {
        const c = unico(base);
        caminhoDoc.set(x.id, c);
        arquivos.push({ documentId: x.id, key: x.file_key, caminho: c, hash: x.file_hash, bytes: Number(x.file_size ?? 0) });
      }
      let n = 0;
      for (const e of extras.filter((f) => f.document_id === x.id)) {
        n++;
        arquivos.push({ documentId: x.id, key: e.file_key, caminho: unico(`${base}_anexo-${n}`), hash: e.file_hash, bytes: Number(e.file_size) });
      }
    }

    const meta = await this.metadadosArquivos(sql, d, docs, caminhoDoc, arquivos);

    // Distribui os PDFs em partes ate o limite; os metadados vao na primeira.
    const limite = loadEnv().EXPORTACAO_PARTE_MB * 1048576;
    const grupos: ArquivoExport[][] = [[]];
    let acumulado = meta.reduce((s, m) => s + m.dados.length, 0);
    for (const a of arquivos) {
      if (acumulado + a.bytes > limite && grupos[grupos.length - 1]!.length > 0) {
        grupos.push([]);
        acumulado = 0;
      }
      grupos[grupos.length - 1]!.push(a);
      acumulado += a.bytes;
    }

    const partes: ParteGuardada[] = [];
    let bytes = 0;
    let falhas = 0;
    for (let i = 0; i < grupos.length; i++) {
      const r = await this.montarParte(d.slug, grupos[i]!, i === 0 ? meta : []);
      falhas += r.falhas;
      const key = `${randomUUID()}.zip`;
      await this.storage.upload(d.slug, key, r.zip);
      bytes += r.zip.length;
      partes.push({
        numero: i + 1,
        nome: `exportacao-${d.slug}-parte-${i + 1}-de-${grupos.length}.zip`,
        bytes: r.zip.length,
        sha256: createHash('sha256').update(r.zip).digest('hex'),
        arquivos: r.arquivos,
        key,
      });
    }
    if (falhas > 0) throw new Error(`${falhas} arquivo(s) não puderam ser lidos do armazenamento`);
    await sql`
      UPDATE exportacoes SET status = 'concluido', partes = ${sql.json(partes as never)}, documentos = ${docs.length},
        arquivos = ${arquivos.length}, bytes = ${bytes}, concluido_em = now(),
        expira_em = now() + make_interval(days => ${EXPORTACAO_VALIDADE_DIAS})
      WHERE id = ${d.exportacaoId}
    `;
    await sql`
      INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, metadata)
      VALUES (NULL, 'exportacao_integral_gerada', 'exportacao', ${d.exportacaoId},
              ${sql.json({ documentos: docs.length, arquivos: arquivos.length, partes: partes.length } as never)})
    `;
    return { documentos: docs.length, partes: partes.length };
  }

  private montarParte(slug: string, arquivos: ArquivoExport[], extras: Array<{ nome: string; dados: Buffer }>): Promise<{ zip: Buffer; arquivos: number; falhas: number }> {
    return new Promise((ok, falha) => {
      // PDF ja e comprimido: guardado sem recomprimir (bem mais rapido).
      const zip = archiver('zip', { zlib: { level: 6 } });
      const partes: Buffer[] = [];
      zip.on('data', (c: Buffer) => partes.push(c));
      zip.on('error', falha);
      let falhas = 0;
      let incluidos = 0;
      void (async () => {
        try {
          for (const m of extras) {
            zip.append(m.dados, { name: m.nome });
            incluidos++;
          }
          for (const a of arquivos) {
            try {
              zip.append(await this.storage.download(slug, a.key), { name: a.caminho, store: true });
              incluidos++;
            } catch {
              falhas++;
            }
          }
          zip.on('end', () => ok({ zip: Buffer.concat(partes), arquivos: incluidos, falhas }));
          await zip.finalize();
        } catch (e) {
          falha(e as Error);
        }
      })();
    });
  }

  private async metadadosArquivos(
    sql: Sql,
    d: ExportacaoJobData,
    docs: DocExport[],
    caminhoDoc: Map<string, string>,
    arquivos: ArquivoExport[],
  ): Promise<Array<{ nome: string; dados: Buffer }>> {
    const linha = (x: DocExport) => ({
      identificador: x.id,
      caminho_arquivo: caminhoDoc.get(x.id) ?? '',
      modulo: x.module,
      secretaria_codigo: x.orgao_codigo ?? '',
      secretaria: x.orgao_nome ?? '',
      tipo_documental: x.tipo ?? '',
      numero: x.numero ?? '',
      assunto: x.assunto ?? '',
      interessado: x.interessado ?? '',
      palavras_chave: (x.palavras_chave ?? []).join(', '),
      data_documento: dataIso(x.document_date),
      exercicio: x.exercicio,
      descricao: x.descricao ?? x.historico ?? '',
      credor: x.credor ?? '',
      doc_caixa: x.doc_caixa ?? '',
      valor: x.value ?? '',
      classificacao: x.classe_codigo ? `${x.classe_codigo} — ${x.classe_descricao ?? ''}` : '',
      fase: x.fase,
      nivel_acesso: x.grau_sigilo ? 'sigiloso' : (x.nivel_acesso ?? 'publico'),
      grau_sigilo: x.grau_sigilo ?? '',
      dados_pessoais: x.dados_pessoais ?? 'nao',
      hash_sha256: x.file_hash?.trim() ?? '',
      paginas: x.paginas ?? '',
      nome_original: x.original_name,
      criado_em: x.criado_em.toISOString(),
      campos_do_tipo: (typeof x.metadados === 'string' ? JSON.parse(x.metadados) : x.metadados) ?? {},
    });
    const registros = docs.map(linha);
    type Reg = (typeof registros)[number];
    const chaves = Object.keys(registros[0] ?? { identificador: '' }) as Array<keyof Reg>;
    const colunas: ColunaExport<Reg>[] = chaves.map((k) => ({
      titulo: String(k),
      peso: 1,
      valor: (r) => (k === 'campos_do_tipo' ? JSON.stringify(r[k]) : (r[k] as string | number)),
    }));

    const classes = await sql<Array<{ codigo: string; descricao: string; prazo_corrente_anos: number | null; prazo_intermediario_anos: number | null; destinacao: string | null }>>`
      SELECT codigo, descricao, prazo_corrente_anos, prazo_intermediario_anos, destinacao FROM classificacoes ORDER BY codigo
    `;
    const logs = await sql<Array<{ seq: string; criado_em: Date; action: string; nome: string | null; resource_type: string | null; resource_id: string | null; ip: string | null; metadata: unknown; hash: string | null }>>`
      SELECT l.seq, l.criado_em, l.action, u.nome, l.resource_type, l.resource_id, l.ip, l.metadata, l.hash
      FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.seq
    `;
    const logLegivel = (l: (typeof logs)[number]): LogRegistro => ({
      id: l.seq,
      criadoEm: l.criado_em.toISOString(),
      action: l.action,
      actorType: 'usuario',
      adminName: l.nome,
      orgao: d.nome,
      entity: l.resource_type,
      entityId: l.resource_id,
      changes: null,
      metadata: (typeof l.metadata === 'string' ? (() => { try { return JSON.parse(l.metadata as string) as Record<string, unknown>; } catch { return null; } })() : (l.metadata as Record<string, unknown> | null)),
      ip: l.ip,
    });

    const hashes = arquivos.filter((a) => a.hash).map((a) => `${a.hash!.trim()}  ${a.caminho}`).join('\n');
    const leiaMe = [
      `EXPORTAÇÃO INTEGRAL — ${d.nome}`,
      `Gerada em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })} pelo jDoc (JEOS Sistemas).`,
      '',
      `Documentos: ${docs.length} · Arquivos PDF: ${arquivos.length}`,
      '',
      'Conteúdo (formatos abertos):',
      '- documentos/ ........ PDFs na estrutura de pastas abaixo',
      '- metadados.csv ...... uma linha por documento (abre no Excel/LibreOffice; separador ;)',
      '- metadados.json ..... os mesmos dados em JSON',
      '- classificacao.csv .. plano de classificação e tabela de temporalidade',
      '- auditoria.csv ...... trilha de auditoria completa, com o hash encadeado de cada registro',
      '- dicionario-metadados.csv ... significado de cada campo',
      '- hashes.sha256 ...... SHA-256 de cada PDF (confira com: sha256sum -c hashes.sha256)',
      '',
      `Padrão de nomes: ${PADRAO_NOMES_EXPORTACAO}`,
    ].join('\r\n');

    return [
      { nome: 'LEIA-ME.txt', dados: Buffer.from(`\uFEFF${leiaMe}\r\n`, 'utf8') },
      { nome: 'metadados.csv', dados: gerarCsv(colunas, registros) },
      { nome: 'metadados.json', dados: Buffer.from(JSON.stringify({ orgao: d.nome, geradoEm: new Date().toISOString(), documentos: registros }, null, 2), 'utf8') },
      {
        nome: 'classificacao.csv',
        dados: gerarCsv(
          [
            { titulo: 'codigo', peso: 1, valor: (c) => c.codigo },
            { titulo: 'descricao', peso: 1, valor: (c) => c.descricao },
            { titulo: 'prazo_corrente_anos', peso: 1, valor: (c) => c.prazo_corrente_anos },
            { titulo: 'prazo_intermediario_anos', peso: 1, valor: (c) => c.prazo_intermediario_anos },
            { titulo: 'destinacao', peso: 1, valor: (c) => c.destinacao },
          ] as ColunaExport<(typeof classes)[number]>[],
          classes,
        ),
      },
      {
        nome: 'auditoria.csv',
        dados: gerarCsv(
          [
            { titulo: 'seq', peso: 1, valor: (l) => l.seq },
            { titulo: 'data_hora', peso: 1, valor: (l) => l.criado_em.toISOString() },
            { titulo: 'usuario', peso: 1, valor: (l) => l.nome },
            { titulo: 'acao', peso: 1, valor: (l) => l.action },
            { titulo: 'descricao', peso: 1, valor: (l) => descreverLog(logLegivel(l)) },
            { titulo: 'registro', peso: 1, valor: (l) => l.resource_id },
            { titulo: 'ip', peso: 1, valor: (l) => l.ip },
            { titulo: 'hash', peso: 1, valor: (l) => l.hash },
          ] as ColunaExport<(typeof logs)[number]>[],
          logs,
        ),
      },
      {
        nome: 'dicionario-metadados.csv',
        dados: gerarCsv(
          [
            { titulo: 'campo', peso: 1, valor: (c) => c.campo },
            { titulo: 'rotulo', peso: 1, valor: (c) => c.rotulo },
            { titulo: 'descricao', peso: 1, valor: (c) => c.descricao },
            { titulo: 'formato', peso: 1, valor: (c) => c.formato },
          ] as ColunaExport<(typeof CAMPOS_PADRAO_DICIONARIO)[number]>[],
          CAMPOS_PADRAO_DICIONARIO,
        ),
      },
      { nome: 'hashes.sha256', dados: Buffer.from(`${hashes}\n`, 'utf8') },
    ];
  }
}
