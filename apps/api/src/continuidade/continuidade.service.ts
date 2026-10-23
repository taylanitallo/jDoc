import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  FUSO_ORGAO,
  META_DISPONIBILIDADE,
  RPO_HORAS,
  RTO_HORAS,
  SCHEMA_NAME_REGEX,
  type ContinuidadeView,
  type RestauracaoTesteView,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { StorageService, assertSafeFileKey } from '../storage/storage.module';
import { JobsService, type ResultadoJob } from '../operacao/jobs.service';
import { executarDump, trocarSchema } from '../superadmin/backups/executar-dump';
import { gerarPdfTabela, type ColunaExport } from '../common/exportacao';
import { DestinoSegregadoService } from './destino-segregado.service';

/** Teto de arquivos por execucao da copia (o restante vai na proxima). */
const COPIA_LOTE = 3000;
/** Arquivos sorteados para conferir o hash no teste de restauracao. */
const AMOSTRA_ARQUIVOS = 10;

interface TenantRow {
  id: string;
  slug: string;
  schema_name: string;
}

class Desfazer extends Error {}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * Continuidade: copia segregada, teste de restauracao em rodizio,
 * disponibilidade por minuto e o painel que o orgao ve.
 */
@Injectable()
export class ContinuidadeService implements OnModuleInit {
  private readonly logger = new Logger(ContinuidadeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly destino: DestinoSegregadoService,
  ) {}

  onModuleInit(): void {
    this.jobs.registrar('copia_segregada', () => this.copiaSegregada());
    this.jobs.registrar('teste_restauracao', () => this.testeRestauracao());
    this.jobs.aCadaMinuto(() => this.marcarMinuto());
  }

  /** A API esta no ar neste minuto: conta uma vez, mesmo com varias instancias. */
  async marcarMinuto(): Promise<void> {
    await this.db.catalog()`
      INSERT INTO platform.disponibilidade_dias AS d (dia, minutos, ultimo_minuto)
      VALUES ((now() AT TIME ZONE ${FUSO_ORGAO})::date, 1, date_trunc('minute', now()))
      ON CONFLICT (dia) DO UPDATE SET minutos = least(d.minutos + 1, 1440), ultimo_minuto = EXCLUDED.ultimo_minuto
      WHERE d.ultimo_minuto < EXCLUDED.ultimo_minuto
    `;
  }

  private async tenants(): Promise<TenantRow[]> {
    return this.db.catalog()<TenantRow[]>`SELECT id, slug, schema_name FROM public.tenants WHERE status <> 'arquivado' ORDER BY nome`;
  }

  // ---------------- Copia segregada ----------------

  async copiaSegregada(): Promise<ResultadoJob> {
    if (!this.destino.configurado()) {
      throw new Error('Destino segregado não configurado (COPIA_SUPABASE_URL/COPIA_SUPABASE_SERVICE_ROLE_KEY ou COPIA_DIR)');
    }
    let copiados = 0;
    let bytes = 0;
    let falhas = 0;
    for (const t of await this.tenants()) {
      if (!SCHEMA_NAME_REGEX.test(t.schema_name)) continue;
      const restante = COPIA_LOTE - copiados;
      if (restante <= 0) break;
      const r = await this.copiarTenant(t, restante);
      copiados += r.copiados;
      bytes += r.bytes;
      falhas += r.falhas;
    }
    return { resumo: `${copiados} arquivo(s) copiado(s) (${(bytes / 1048576).toFixed(1)} MB)${falhas ? `, ${falhas} falha(s)` : ''}`, copiados, falhas };
  }

  async copiarTenant(t: TenantRow, limite: number): Promise<{ copiados: number; bytes: number; falhas: number }> {
    const sql = this.db.tenant(t.schema_name);
    const ja = new Set(
      (await this.db.catalog()<Array<{ file_key: string }>>`SELECT file_key FROM platform.arquivos_copia WHERE tenant_id = ${t.id}`).map((r) => r.file_key),
    );
    const chaves = [
      ...(await sql<Array<{ k: string }>>`SELECT file_key AS k FROM documents WHERE file_key IS NOT NULL`).map((r) => r.k),
      ...(await sql<Array<{ k: string }>>`SELECT file_key AS k FROM document_files`).map((r) => r.k),
      ...(
        await this.db.catalog()<Array<{ k: string }>>`
          SELECT file_key AS k FROM public.backups WHERE tenant_id = ${t.id} AND status = 'concluido' AND file_key IS NOT NULL
        `
      ).map((r) => r.k),
    ].filter((k) => !ja.has(k));
    let copiados = 0;
    let bytes = 0;
    let falhas = 0;
    for (const key of chaves.slice(0, limite)) {
      try {
        assertSafeFileKey(key);
        const dados = await this.storage.download(t.slug, key);
        await this.destino.enviar(t.slug, key, dados);
        await this.db.catalog()`
          INSERT INTO platform.arquivos_copia (tenant_id, file_key, bytes, sha256)
          VALUES (${t.id}, ${key}, ${dados.length}, ${createHash('sha256').update(dados).digest('hex')})
          ON CONFLICT (tenant_id, file_key) DO NOTHING
        `;
        copiados++;
        bytes += dados.length;
      } catch (e) {
        falhas++;
        this.logger.warn(`Cópia de ${t.slug}/${key}: ${(e as Error).message}`);
      }
    }
    return { copiados, bytes, falhas };
  }

  // ---------------- Teste de restauracao ----------------

  /** Agendado: o orgao com backup que esta ha mais tempo sem teste. */
  async testeRestauracao(tenantId?: string): Promise<ResultadoJob> {
    const [alvo] = await this.db.catalog()<Array<{ id: string; nome: string }>>`
      SELECT t.id, t.nome FROM public.tenants t
      WHERE t.status <> 'arquivado' AND (${tenantId ?? null}::uuid IS NULL OR t.id = ${tenantId ?? null})
        AND EXISTS (SELECT 1 FROM public.backups b WHERE b.tenant_id = t.id AND b.status = 'concluido' AND b.file_key IS NOT NULL
                    AND b.kind <> 'completo')
      ORDER BY (SELECT max(r.criado_em) FROM platform.restauracao_testes r WHERE r.tenant_id = t.id) NULLS FIRST
      LIMIT 1
    `;
    if (!alvo) return { resumo: 'Nenhum órgão com backup para testar' };
    const r = await this.testarTenant(alvo.id);
    return { resumo: `${alvo.nome}: ${r.status === 'sucesso' ? 'restaurado e conferido' : `falhou (${r.erro ?? ''})`}`, status: r.status };
  }

  async testarTenant(tenantId: string): Promise<RestauracaoTesteView> {
    const cat = this.db.catalog();
    const [t] = await cat<Array<TenantRow>>`SELECT id, slug, schema_name FROM public.tenants WHERE id = ${tenantId}`;
    if (!t || !SCHEMA_NAME_REGEX.test(t.schema_name)) throw new NotFoundException('Órgão não encontrado');
    const [b] = await cat<Array<{ id: string; file_key: string; concluido_em: Date | null }>>`
      SELECT id, file_key, concluido_em FROM public.backups
      WHERE tenant_id = ${t.id} AND status = 'concluido' AND file_key IS NOT NULL AND kind <> 'completo'
      ORDER BY criado_em DESC LIMIT 1
    `;
    const inicio = Date.now();
    const temp = `rtest_${t.schema_name.replace(/^tenant_/, '').slice(0, 40)}`;
    const registro = {
      documentos: null as number | null,
      usuarios: null as number | null,
      auditoria: null as number | null,
      integra: null as boolean | null,
      conferidos: 0,
      ok: 0,
    };
    let erro: string | null = null;
    try {
      if (!b) throw new Error('Órgão sem backup concluído');
      const dump = trocarSchema(gunzipSync(await this.storage.download(t.slug, b.file_key)).toString('utf8'), t.schema_name, temp);
      // Tudo numa transacao desfeita no fim: o schema temporario nunca fica.
      await cat
        .begin(async (tx) => {
          await tx.unsafe(`DROP SCHEMA IF EXISTS "${temp}" CASCADE`);
          if (!new RegExp(`^CREATE SCHEMA "?${temp}"?;`, 'm').test(dump)) await tx.unsafe(`CREATE SCHEMA "${temp}"`);
          await executarDump(tx, dump);
          const [c] = await tx.unsafe<Array<{ docs: number; users: number; logs: number }>>(
            `SELECT (SELECT count(*) FROM "${temp}".documents)::int AS docs, (SELECT count(*) FROM "${temp}".users)::int AS users,
                    (SELECT count(*) FROM "${temp}".audit_logs)::int AS logs`,
          );
          registro.documentos = c!.docs;
          registro.usuarios = c!.users;
          registro.auditoria = c!.logs;
          const temCadeia = await tx.unsafe(
            `SELECT 1 FROM information_schema.columns WHERE table_schema = '${temp}' AND table_name = 'audit_logs' AND column_name = 'hash'`,
          );
          if (temCadeia.length) {
            const [q] = await tx.unsafe<Array<{ n: number }>>(
              `SELECT count(*)::int AS n FROM (
                 SELECT hash, hash_anterior, lag(hash) OVER (ORDER BY seq) AS ant, row_number() OVER (ORDER BY seq) AS pos,
                        "${temp}".audit_log_hash(hash_anterior, id, seq, actor_id, action, resource_type, resource_id, ip, user_agent, metadata, criado_em) AS calc
                 FROM "${temp}".audit_logs) x
               WHERE calc IS DISTINCT FROM hash OR (pos > 1 AND ant IS DISTINCT FROM hash_anterior)`,
            );
            registro.integra = q!.n === 0;
          }
          const amostra = await tx.unsafe<Array<{ file_key: string; file_hash: string }>>(
            `SELECT file_key, file_hash FROM "${temp}".documents WHERE file_key IS NOT NULL AND file_hash IS NOT NULL ORDER BY random() LIMIT ${AMOSTRA_ARQUIVOS}`,
          );
          for (const a of amostra) {
            registro.conferidos++;
            try {
              const dados = await this.storage.download(t.slug, a.file_key);
              if (createHash('sha256').update(dados).digest('hex') === a.file_hash.trim()) registro.ok++;
            } catch {
              // arquivo ausente conta como nao conferido
            }
          }
          throw new Desfazer();
        })
        .catch((e: unknown) => {
          if (!(e instanceof Desfazer)) throw e;
        });
      if (registro.integra === false) throw new Error('Trilha de auditoria do backup não confere');
      if (registro.conferidos > 0 && registro.ok < registro.conferidos) {
        throw new Error(`${registro.conferidos - registro.ok} de ${registro.conferidos} arquivo(s) da amostra ausentes ou diferentes`);
      }
    } catch (e) {
      erro = (e as Error).message.slice(0, 1000);
    }
    const [r] = await cat<Array<{ id: string; criado_em: Date }>>`
      INSERT INTO platform.restauracao_testes (tenant_id, backup_id, backup_em, status, documentos, usuarios, auditoria_registros,
                                               auditoria_integra, arquivos_conferidos, arquivos_ok, duracao_ms, erro)
      VALUES (${t.id}, ${b?.id ?? null}, ${b?.concluido_em ?? null}, ${erro ? 'falha' : 'sucesso'}, ${registro.documentos}, ${registro.usuarios},
              ${registro.auditoria}, ${registro.integra}, ${registro.conferidos}, ${registro.ok}, ${Date.now() - inicio}, ${erro})
      RETURNING id, criado_em
    `;
    return {
      id: r!.id,
      status: erro ? 'falha' : 'sucesso',
      backupEm: iso(b?.concluido_em),
      documentos: registro.documentos,
      usuarios: registro.usuarios,
      auditoriaRegistros: registro.auditoria,
      auditoriaIntegra: registro.integra,
      arquivosConferidos: registro.conferidos,
      arquivosOk: registro.ok,
      duracaoMs: Date.now() - inicio,
      erro,
      criadoEm: r!.criado_em.toISOString(),
    };
  }

  // ---------------- Painel ----------------

  async painel(tenantId: string): Promise<ContinuidadeView> {
    const cat = this.db.catalog();
    const [t] = await cat<Array<TenantRow & { migracao_aceita_em: Date | null; migracao_aceita_por: string | null; migracao_aceita_obs: string | null }>>`
      SELECT id, slug, schema_name, migracao_aceita_em, migracao_aceita_por, migracao_aceita_obs FROM public.tenants WHERE id = ${tenantId}
    `;
    if (!t) throw new NotFoundException('Órgão não encontrado');
    const [ultimo] = await cat<Array<{ em: Date; bytes: string | null }>>`
      SELECT concluido_em AS em, size_bytes AS bytes FROM public.backups
      WHERE tenant_id = ${tenantId} AND status = 'concluido' AND kind <> 'completo' ORDER BY concluido_em DESC LIMIT 1
    `;
    const [mes] = await cat<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM public.backups
      WHERE tenant_id = ${tenantId} AND status = 'concluido'
        AND (concluido_em AT TIME ZONE ${FUSO_ORGAO}) >= date_trunc('month', now() AT TIME ZONE ${FUSO_ORGAO})
    `;
    const [copia] = await cat<Array<{ n: number; ultima: Date | null }>>`
      SELECT count(*)::int AS n, max(copiado_em) AS ultima FROM platform.arquivos_copia WHERE tenant_id = ${tenantId}
    `;
    let total = 0;
    if (SCHEMA_NAME_REGEX.test(t.schema_name)) {
      const sql = this.db.tenant(t.schema_name);
      const [n] = await sql<Array<{ n: number }>>`
        SELECT ((SELECT count(*) FROM documents WHERE file_key IS NOT NULL) + (SELECT count(*) FROM document_files))::int AS n
      `;
      const [bk] = await cat<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM public.backups WHERE tenant_id = ${tenantId} AND status = 'concluido' AND file_key IS NOT NULL
      `;
      total = (n?.n ?? 0) + (bk?.n ?? 0);
    }
    const testes = await cat<
      Array<{
        id: string;
        status: 'sucesso' | 'falha';
        backup_em: Date | null;
        documentos: number | null;
        usuarios: number | null;
        auditoria_registros: number | null;
        auditoria_integra: boolean | null;
        arquivos_conferidos: number | null;
        arquivos_ok: number | null;
        duracao_ms: number | null;
        erro: string | null;
        criado_em: Date;
      }>
    >`SELECT * FROM platform.restauracao_testes WHERE tenant_id = ${tenantId} ORDER BY criado_em DESC LIMIT 12`;
    const dias = await this.disponibilidade(30);
    const doMes = dias.filter((d) => d.dia.slice(0, 7) === dias[dias.length - 1]?.dia.slice(0, 7));
    const testesView: RestauracaoTesteView[] = testes.map((r) => ({
      id: r.id,
      status: r.status,
      backupEm: iso(r.backup_em),
      documentos: r.documentos,
      usuarios: r.usuarios,
      auditoriaRegistros: r.auditoria_registros,
      auditoriaIntegra: r.auditoria_integra,
      arquivosConferidos: r.arquivos_conferidos,
      arquivosOk: r.arquivos_ok,
      duracaoMs: r.duracao_ms,
      erro: r.erro,
      criadoEm: r.criado_em.toISOString(),
    }));
    return {
      rpoHoras: RPO_HORAS,
      rtoHoras: RTO_HORAS,
      metaDisponibilidade: META_DISPONIBILIDADE,
      ultimoBackup: ultimo ? { em: ultimo.em.toISOString(), bytes: ultimo.bytes === null ? null : Number(ultimo.bytes) } : null,
      backupsNoMes: mes?.n ?? 0,
      copiaSegregada: {
        configurada: this.destino.configurado(),
        destino: this.destino.descricao(),
        arquivosCopiados: copia?.n ?? 0,
        arquivosPendentes: Math.max(0, total - (copia?.n ?? 0)),
        ultimaCopia: iso(copia?.ultima),
      },
      ultimoTesteRestauracao: testesView[0] ?? null,
      testesRestauracao: testesView,
      disponibilidade: dias,
      disponibilidadeMes: doMes.length ? Math.round((doMes.reduce((s, d) => s + d.percentual, 0) / doMes.length) * 100) / 100 : null,
      migracao: { aceitaEm: iso(t.migracao_aceita_em), aceitaPor: t.migracao_aceita_por, observacao: t.migracao_aceita_obs },
    };
  }

  /**
   * Relatorio mensal para anexar a medicao: disponibilidade, backups, testes
   * de restauracao, chamados com SLA e paginas de digitalizacao aceitas.
   */
  async relatorioMensal(tenantId: string, mes: string): Promise<{ arquivo: Buffer; nome: string }> {
    const cat = this.db.catalog();
    const [t] = await cat<Array<TenantRow & { nome: string }>>`SELECT id, slug, schema_name, nome FROM public.tenants WHERE id = ${tenantId}`;
    if (!t || !SCHEMA_NAME_REGEX.test(t.schema_name)) throw new NotFoundException('Órgão não encontrado');
    const inicio = `${mes}-01`;
    const dias = await this.disponibilidade(31, mes);
    const media = dias.length ? dias.reduce((s, d) => s + d.percentual, 0) / dias.length : null;
    const doMes = (col: string) =>
      cat`(${cat.unsafe(col)} AT TIME ZONE ${FUSO_ORGAO})::date >= ${inicio}::date AND (${cat.unsafe(col)} AT TIME ZONE ${FUSO_ORGAO})::date < (${inicio}::date + interval '1 month')`;
    const backups = await cat<Array<{ em: Date; kind: string; bytes: string | null; status: string }>>`
      SELECT coalesce(concluido_em, criado_em) AS em, kind, size_bytes AS bytes, status FROM public.backups
      WHERE tenant_id = ${tenantId} AND ${doMes('criado_em')} ORDER BY criado_em
    `;
    const testes = await cat<
      Array<{ criado_em: Date; status: string; documentos: number | null; arquivos_ok: number | null; arquivos_conferidos: number | null; erro: string | null }>
    >`
      SELECT criado_em, status, documentos, arquivos_ok, arquivos_conferidos, erro FROM platform.restauracao_testes
      WHERE tenant_id = ${tenantId} AND ${doMes('criado_em')} ORDER BY criado_em
    `;
    const chamados = await cat<
      Array<{ number: string; title: string; criticality: string; created_at: Date; resolved_at: Date | null; no_prazo: boolean | null }>
    >`
      SELECT number, title, criticality, created_at, resolved_at,
             CASE WHEN resolved_at IS NULL THEN NULL ELSE resolved_at <= resolution_due_at END AS no_prazo
      FROM platform.tickets WHERE tenant_id = ${tenantId} AND ${doMes('created_at')} ORDER BY created_at
    `;
    const sql = this.db.tenant(t.schema_name);
    const producao = await sql<Array<{ secretaria: string; lotes: number; paginas: number }>>`
      SELECT coalesce(l.orgao_codigo || ' — ' || (SELECT o.descricao FROM orgaos o WHERE o.codigo = l.orgao_codigo ORDER BY o.exercicio DESC LIMIT 1), 'Sem secretaria') AS secretaria,
             count(*)::int AS lotes, coalesce(sum(l.paginas_aceitas), 0)::int AS paginas
      FROM digit_lotes l
      WHERE l.aceite_em IS NOT NULL
        AND (l.aceite_em AT TIME ZONE ${FUSO_ORGAO})::date >= ${inicio}::date
        AND (l.aceite_em AT TIME ZONE ${FUSO_ORGAO})::date < (${inicio}::date + interval '1 month')
      GROUP BY 1 ORDER BY 1
    `;
    const dt = (d: Date) => d.toLocaleString('pt-BR', { timeZone: FUSO_ORGAO, dateStyle: 'short', timeStyle: 'short' });
    const mb = (b: string | null) => (b ? `${(Number(b) / 1048576).toFixed(1)} MB` : '—');
    const noPrazo = chamados.filter((c) => c.no_prazo).length;
    const resolvidos = chamados.filter((c) => c.resolved_at).length;
    const [ano, m] = mes.split('-');
    const arquivo = await gerarPdfTabela(
      {
        orgao: t.nome,
        titulo: `Relatório Mensal de Disponibilidade e Continuidade — ${m}/${ano}`,
        detalhes: [
          `Disponibilidade média: ${media === null ? 'sem medição' : `${media.toFixed(2)}%`} (meta ${META_DISPONIBILIDADE}%) · RPO ${RPO_HORAS} h · RTO ${RTO_HORAS} h`,
          `Backups: ${backups.filter((b) => b.status === 'concluido').length} concluído(s) · Testes de restauração: ` +
            `${testes.filter((x) => x.status === 'sucesso').length}/${testes.length} com sucesso · Cópia segregada: ${this.destino.descricao() ?? 'não configurada'}`,
          `Chamados: ${chamados.length} aberto(s), ${resolvidos} resolvido(s), ${noPrazo} dentro do prazo de SLA`,
        ],
      },
      [
        {
          subtitulo: 'Disponibilidade por dia',
          colunas: [
            { titulo: 'Dia', peso: 50, valor: (d) => d.dia.split('-').reverse().join('/') },
            { titulo: 'Disponível', peso: 50, valor: (d) => `${d.percentual.toFixed(2)}%`, alinhar: 'right' },
          ] as ColunaExport<(typeof dias)[number]>[],
          linhas: dias,
        },
        {
          subtitulo: 'Backups',
          colunas: [
            { titulo: 'Data', peso: 30, valor: (b) => dt(b.em) },
            { titulo: 'Tipo', peso: 25, valor: (b) => b.kind },
            { titulo: 'Tamanho', peso: 20, valor: (b) => mb(b.bytes), alinhar: 'right' },
            { titulo: 'Situação', peso: 25, valor: (b) => b.status },
          ] as ColunaExport<(typeof backups)[number]>[],
          linhas: backups,
        },
        {
          subtitulo: 'Testes de restauração',
          colunas: [
            { titulo: 'Data', peso: 25, valor: (x) => dt(x.criado_em) },
            { titulo: 'Resultado', peso: 15, valor: (x) => (x.status === 'sucesso' ? 'Sucesso' : 'Falha') },
            { titulo: 'Documentos', peso: 15, valor: (x) => x.documentos, alinhar: 'right' },
            { titulo: 'Arquivos conferidos', peso: 15, valor: (x) => (x.arquivos_conferidos ? `${x.arquivos_ok}/${x.arquivos_conferidos}` : '—') },
            { titulo: 'Observação', peso: 30, valor: (x) => x.erro },
          ] as ColunaExport<(typeof testes)[number]>[],
          linhas: testes,
        },
        {
          subtitulo: 'Chamados de suporte',
          colunas: [
            { titulo: 'Nº', peso: 8, valor: (c) => c.number },
            { titulo: 'Assunto', peso: 40, valor: (c) => c.title },
            { titulo: 'Criticidade', peso: 12, valor: (c) => c.criticality },
            { titulo: 'Aberto', peso: 14, valor: (c) => dt(c.created_at) },
            { titulo: 'Resolvido', peso: 14, valor: (c) => (c.resolved_at ? dt(c.resolved_at) : 'Em aberto') },
            { titulo: 'No prazo', peso: 12, valor: (c) => (c.no_prazo === null ? '—' : c.no_prazo ? 'Sim' : 'Não') },
          ] as ColunaExport<(typeof chamados)[number]>[],
          linhas: chamados,
        },
        {
          subtitulo: 'Digitalização — páginas aceitas no mês (medição)',
          colunas: [
            { titulo: 'Secretaria', peso: 60, valor: (p) => p.secretaria },
            { titulo: 'Lotes aceitos', peso: 20, valor: (p) => p.lotes, alinhar: 'right' },
            { titulo: 'Páginas aceitas', peso: 20, valor: (p) => p.paginas, alinhar: 'right' },
          ] as ColunaExport<(typeof producao)[number]>[],
          linhas: producao,
        },
      ] as never,
    );
    return { arquivo, nome: `relatorio-mensal-${t.slug}-${mes}.pdf` };
  }

  /** % do dia com a API no ar; o dia de hoje conta so os minutos ja passados. */
  async disponibilidade(dias: number, mes?: string): Promise<Array<{ dia: string; percentual: number }>> {
    const rows = await this.db.catalog()<Array<{ dia: string; percentual: number }>>`
      WITH hoje AS (SELECT (now() AT TIME ZONE ${FUSO_ORGAO}) AS agora),
      periodo AS (
        SELECT d::date AS dia FROM hoje,
          generate_series(
            coalesce(${mes ? `${mes}-01` : null}::date, (hoje.agora::date - (${dias - 1})::int)),
            coalesce((${mes ? `${mes}-01` : null}::date + interval '1 month - 1 day')::date, hoje.agora::date),
            interval '1 day') d
      )
      SELECT to_char(p.dia, 'YYYY-MM-DD') AS dia,
             round(least(100, coalesce(d.minutos, 0) * 100.0 /
               CASE WHEN p.dia = (SELECT agora::date FROM hoje)
                    THEN greatest(1, extract(epoch FROM (SELECT agora FROM hoje) - p.dia::timestamp) / 60)
                    ELSE 1440 END), 2)::float AS percentual
      FROM periodo p LEFT JOIN platform.disponibilidade_dias d ON d.dia = p.dia
      WHERE p.dia <= (SELECT agora::date FROM hoje)
        -- Antes do primeiro dia medido nao ha dado: nao aparece como queda.
        AND p.dia >= coalesce((SELECT min(dia) FROM platform.disponibilidade_dias), p.dia)
      ORDER BY p.dia
    `;
    return rows;
  }
}
