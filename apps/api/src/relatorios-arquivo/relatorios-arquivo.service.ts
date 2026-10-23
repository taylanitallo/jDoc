import { BadRequestException, Injectable } from '@nestjs/common';
import type { Sql } from 'postgres';
import {
  CAMPOS_PADRAO_DICIONARIO,
  DOC_MODULES,
  PADRAO_NOMES_EXPORTACAO,
  ROTULO_TIPO_CAMPO,
  type CampoDicionario,
  type CampoMetadado,
  INVENTARIO_EXPORT_MAX,
  descreverFiltro,
  sistemaDoModulo,
  type DocModule,
  type InventarioFiltro,
  type InventarioItem,
  type InventarioPage,
  type QuantitativoArquivo,
  type QuantitativoLinha,
  type TenantAccessClaims,
  hojeIso,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { sistemaAtivo } from '../common/sistema.guard';
import { gerarCsv, gerarPdfTabela, type ColunaExport } from '../common/exportacao';
import { filtroLotacao } from '../common/acesso-documento';

const MODULO_ROTULO: Record<string, string> = {
  receitas: 'Receitas',
  despesas: 'Despesas',
  balancete: 'Balancete',
  extrato: 'Extrato',
  outros: 'Outros arquivos',
  acervo: 'Acervo',
};
const FASE_ROTULO: Record<string, string> = {
  corrente: 'Corrente',
  intermediaria: 'Intermediária',
  permanente: 'Permanente',
  eliminado: 'Eliminado',
};
const dataBr = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : null);

interface ItemRow {
  id: string;
  classe_codigo: string | null;
  classe_descricao: string | null;
  destinacao: 'eliminacao' | 'guarda_permanente' | null;
  tipo: string | null;
  identificacao: string;
  document_date: Date | null;
  exercicio: number | null;
  module: DocModule;
  fase: InventarioItem['fase'];
  data_prevista_transferencia: Date | null;
  data_prevista_destinacao: Date | null;
  localizacao: string | null;
  nivel_acesso: InventarioItem['nivelAcesso'] | null;
  paginas: number | null;
  digitalizado: boolean | null;
  dados_pessoais: InventarioItem['dadosPessoais'] | null;
  secretaria: string | null;
  grau_sigilo: string | null;
}

const isoData = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toItem = (r: ItemRow): InventarioItem => ({
  id: r.id,
  classeCodigo: r.classe_codigo,
  classeDescricao: r.classe_descricao,
  tipo: r.tipo,
  identificacao: r.identificacao,
  dataDocumento: isoData(r.document_date),
  exercicio: r.exercicio,
  modulo: r.module,
  fase: r.fase,
  previsaoTransferencia: isoData(r.data_prevista_transferencia),
  previsaoDestinacao: isoData(r.data_prevista_destinacao),
  destinacao: r.destinacao,
  localizacao: r.localizacao,
  nivelAcesso: r.nivel_acesso ?? 'publico',
  paginas: r.paginas,
  digitalizado: !!r.digitalizado,
  dadosPessoais: r.dados_pessoais ?? 'nao',
  secretaria: r.secretaria,
  // Sigiloso (LAI) aparece como tal no inventario.
  ...(r.grau_sigilo ? { nivelAcesso: 'restrito' as const } : {}),
});

/** Colunas do inventario (as mesmas no PDF e no CSV). */
const COLUNAS_INVENTARIO: ColunaExport<InventarioItem>[] = [
  { titulo: 'Classe', peso: 7, valor: (i) => i.classeCodigo },
  { titulo: 'Tipo', peso: 10, valor: (i) => i.tipo ?? MODULO_ROTULO[i.modulo] },
  { titulo: 'Identificação', peso: 30, valor: (i) => i.identificacao },
  { titulo: 'Data', peso: 7, valor: (i) => dataBr(i.dataDocumento) },
  { titulo: 'Exerc.', peso: 5, valor: (i) => (i.exercicio ? String(i.exercicio) : null), alinhar: 'center' },
  { titulo: 'Fase', peso: 8, valor: (i) => FASE_ROTULO[i.fase] ?? i.fase },
  { titulo: 'Transf. prevista', peso: 8, valor: (i) => dataBr(i.previsaoTransferencia) },
  { titulo: 'Destinação', peso: 12, valor: (i) => (i.destinacao ? `${i.destinacao === 'eliminacao' ? 'Eliminação' : 'Guarda permanente'}${i.previsaoDestinacao ? ` em ${dataBr(i.previsaoDestinacao)}` : ''}` : null) },
  { titulo: 'Localização', peso: 14, valor: (i) => i.localizacao },
  { titulo: 'Acesso', peso: 6, valor: (i) => (i.nivelAcesso === 'restrito' ? 'Restrito' : 'Público') },
  { titulo: 'Dados pessoais', peso: 7, valor: (i) => (i.dadosPessoais === 'sensiveis' ? 'Sensíveis' : i.dadosPessoais === 'comuns' ? 'Sim' : 'Não') },
  { titulo: 'Págs.', peso: 5, valor: (i) => i.paginas, alinhar: 'right' },
];

/**
 * Relatorios do Arquivo. Mesmas regras de visibilidade da busca: so modulos que o
 * usuario le (admin: todos os contratados), restrito so com acervo_restrito:read,
 * lixeira nunca; eliminados so quando pedidos (ficam os metadados, sem arquivo).
 */
@Injectable()
export class RelatoriosArquivoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private sql(): Sql {
    return this.db.tenant(requireTenantContext().schemaName);
  }

  private modulosLegiveis(user: TenantAccessClaims): DocModule[] {
    const contratados = DOC_MODULES.filter((m) => sistemaAtivo(sistemaDoModulo(m)));
    if (user.role === 'admin') return contratados;
    return contratados.filter((m) => user.permissions.includes(`${m}:read`));
  }

  /** WHERE comum ao inventario e aos quantitativos. */
  private where(sql: Sql, user: TenantAccessClaims, f: InventarioFiltro) {
    const legiveis = this.modulosLegiveis(user);
    const mods = f.modulos?.length ? f.modulos.filter((m) => legiveis.includes(m)) : legiveis;
    const podeVerRestrito = user.role === 'admin' || user.permissions.includes('acervo_restrito:read');
    const partes = [sql`d.deleted_at IS NULL`, sql`d.module = ANY(${mods.length ? mods : ['__nenhum__']})`];
    if (!podeVerRestrito) partes.push(sql`COALESCE(d.nivel_acesso, 'publico') = 'publico'`);
    partes.push(filtroLotacao(sql, user));
    if (!f.incluirEliminados) partes.push(sql`d.fase <> 'eliminado'`);
    if (f.fase) partes.push(sql`d.fase = ${f.fase}`);
    if (f.nivelAcesso) partes.push(sql`COALESCE(d.nivel_acesso, 'publico') = ${f.nivelAcesso}`);
    if (f.semClasse) partes.push(sql`d.classificacao_id IS NULL`);
    if (f.dadosPessoais === 'sim') partes.push(sql`d.dados_pessoais <> 'nao'`);
    if (f.dadosPessoais === 'sensiveis') partes.push(sql`d.dados_pessoais = 'sensiveis'`);
    if (f.orgaoId) partes.push(sql`d.orgao_id = ${f.orgaoId}`);
    if (f.classe) partes.push(sql`(c.codigo = ${f.classe} OR c.codigo LIKE ${`${f.classe}.%`})`);
    if (f.tipoId) partes.push(sql`d.document_type_id = ${f.tipoId}`);
    if (f.exercicioDe) partes.push(sql`d.exercicio >= ${f.exercicioDe}`);
    if (f.exercicioAte) partes.push(sql`d.exercicio <= ${f.exercicioAte}`);
    if (f.localId) {
      partes.push(sql`d.local_fisico_id IN (
        WITH RECURSIVE sub AS (
          SELECT id FROM locais_fisicos WHERE id = ${f.localId}
          UNION ALL SELECT l.id FROM locais_fisicos l JOIN sub ON l.parent_id = sub.id
        ) SELECT id FROM sub)`);
    }
    if (f.q) {
      const termo = `%${f.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      partes.push(sql`(
        d.descricao ILIKE ${termo} OR d.historico ILIKE ${termo} OR d.credor ILIKE ${termo}
        OR d.doc_caixa ILIKE ${termo} OR d.metadados::text ILIKE ${termo}
      )`);
    }
    return partes.reduce((acc, p) => sql`${acc} AND ${p}`);
  }

  private consultaItens(sql: Sql, user: TenantAccessClaims, f: InventarioFiltro, limite: number, offset: number) {
    return sql<ItemRow[]>`
      WITH RECURSIVE caminho AS (
        SELECT id, codigo::text AS path FROM locais_fisicos WHERE parent_id IS NULL
        UNION ALL
        SELECT l.id, cm.path || ' / ' || l.codigo FROM locais_fisicos l JOIN caminho cm ON l.parent_id = cm.id
      )
      SELECT d.id, c.codigo AS classe_codigo, c.descricao AS classe_descricao, c.destinacao,
             t.nome AS tipo,
             COALESCE(
               NULLIF(concat_ws(' — ',
                 CASE WHEN d.metadados ? 'numero' THEN concat_ws(' ', t.nome, 'nº', d.metadados->>'numero') END,
                 CASE WHEN d.doc_caixa IS NOT NULL THEN 'Doc. Caixa ' || d.doc_caixa END,
                 NULLIF(d.descricao, ''), NULLIF(d.historico, ''), NULLIF(d.credor, '')
               ), ''),
               d.original_name, 'Documento sem descrição'
             ) AS identificacao,
             d.document_date, d.exercicio, d.module, d.fase,
             d.data_prevista_transferencia, d.data_prevista_destinacao,
             cm.path AS localizacao, d.nivel_acesso, d.paginas, d.digitalizado, d.dados_pessoais, d.grau_sigilo,
             (SELECT concat_ws(' — ', o.codigo, o.descricao) FROM orgaos o WHERE o.id = d.orgao_id) AS secretaria
      FROM documents d
      LEFT JOIN classificacoes c ON c.id = d.classificacao_id
      LEFT JOIN document_types t ON t.id = d.document_type_id
      LEFT JOIN caminho cm ON cm.id = d.local_fisico_id
      WHERE ${this.where(sql, user, f)}
      ORDER BY c.codigo NULLS LAST, d.exercicio NULLS LAST, d.document_date NULLS LAST, d.id
      LIMIT ${limite} OFFSET ${offset}
    `;
  }

  private async contar(sql: Sql, user: TenantAccessClaims, f: InventarioFiltro): Promise<number> {
    const [r] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM documents d LEFT JOIN classificacoes c ON c.id = d.classificacao_id
      WHERE ${this.where(sql, user, f)}
    `;
    return r?.n ?? 0;
  }

  async inventario(user: TenantAccessClaims, f: InventarioFiltro, page: number, pageSize: number): Promise<InventarioPage> {
    const sql = this.sql();
    const [total, rows] = await Promise.all([this.contar(sql, user, f), this.consultaItens(sql, user, f, pageSize, (page - 1) * pageSize)]);
    return { items: rows.map(toItem), total, page, pageSize };
  }

  async exportarInventario(user: TenantAccessClaims, f: InventarioFiltro, formato: 'pdf' | 'csv', ip: string): Promise<{ arquivo: Buffer; nome: string }> {
    const sql = this.sql();
    const total = await this.contar(sql, user, f);
    if (total > INVENTARIO_EXPORT_MAX) {
      throw new BadRequestException(
        `O inventário tem ${total.toLocaleString('pt-BR')} documentos; o limite por arquivo é ${INVENTARIO_EXPORT_MAX.toLocaleString('pt-BR')}. Filtre por classe, fase, exercício ou local.`,
      );
    }
    const itens = (await this.consultaItens(sql, user, f, INVENTARIO_EXPORT_MAX, 0)).map(toItem);
    const nomes = await this.nomesFiltro(sql, f);
    const ctx = requireTenantContext();
    await this.audit.logTenant({
      actorId: user.sub,
      action: 'relatorio_inventario_exportado',
      resourceType: 'relatorio',
      ip,
      metadata: { formato, total, filtro: f },
    });
    const data = hojeIso();
    if (formato === 'csv') return { arquivo: gerarCsv(COLUNAS_INVENTARIO, itens), nome: `inventario-${data}.csv` };
    const arquivo = await gerarPdfTabela(
      { orgao: ctx.nome, titulo: 'Inventário do Acervo', detalhes: descreverFiltro(f, nomes), emitidoPor: await this.nomeUsuario(sql, user.sub) },
      [{ colunas: COLUNAS_INVENTARIO, linhas: itens, rodape: `Total: ${itens.length.toLocaleString('pt-BR')} documento(s)` }],
    );
    return { arquivo, nome: `inventario-${data}.pdf` };
  }

  async quantitativo(user: TenantAccessClaims, f: InventarioFiltro): Promise<QuantitativoArquivo> {
    const sql = this.sql();
    const w = this.where(sql, user, f);
    const base = sql`FROM documents d LEFT JOIN classificacoes c ON c.id = d.classificacao_id WHERE ${w}`;
    const [tot] = await sql<
      Array<{ documentos: number; paginas: number; bytes: string; digitalizados: number; com_original: number; restritos: number; sem_classe: number }>
    >`
      SELECT count(*)::int AS documentos, COALESCE(sum(d.paginas), 0)::int AS paginas, COALESCE(sum(d.file_size), 0)::text AS bytes,
             count(*) FILTER (WHERE d.digitalizado)::int AS digitalizados,
             count(*) FILTER (WHERE d.possui_original_fisico OR d.local_fisico_id IS NOT NULL)::int AS com_original,
             count(*) FILTER (WHERE d.nivel_acesso = 'restrito')::int AS restritos,
             count(*) FILTER (WHERE d.classificacao_id IS NULL)::int AS sem_classe
      ${base}
    `;
    const agrupar = (chave: ReturnType<Sql>, rotulo: ReturnType<Sql>, extraJoin = sql``) =>
      sql<Array<{ chave: string | null; rotulo: string | null; documentos: number; paginas: number }>>`
        SELECT ${chave}::text AS chave, ${rotulo}::text AS rotulo, count(*)::int AS documentos, COALESCE(sum(d.paginas), 0)::int AS paginas
        FROM documents d LEFT JOIN classificacoes c ON c.id = d.classificacao_id ${extraJoin}
        WHERE ${w}
        GROUP BY 1, 2
        ORDER BY 1 NULLS LAST
      `;
    const [porFase, porClasse, porTipo, porModulo, porExercicio] = await Promise.all([
      agrupar(sql`d.fase`, sql`d.fase`),
      agrupar(sql`c.codigo`, sql`c.descricao`),
      agrupar(sql`t.id`, sql`t.nome`, sql`LEFT JOIN document_types t ON t.id = d.document_type_id`),
      agrupar(sql`d.module`, sql`d.module`),
      agrupar(sql`d.exercicio`, sql`d.exercicio`),
    ]);
    const linha =
      (rotuloVazio: string, mapa?: Record<string, string>) =>
      (r: { chave: string | null; rotulo: string | null; documentos: number; paginas: number }): QuantitativoLinha => ({
        chave: r.chave ?? '',
        rotulo: r.chave === null ? rotuloVazio : ((mapa?.[r.rotulo ?? ''] ?? r.rotulo) || rotuloVazio),
        documentos: r.documentos,
        paginas: r.paginas,
      });
    return {
      totais: {
        documentos: tot?.documentos ?? 0,
        paginas: tot?.paginas ?? 0,
        bytes: Number(tot?.bytes ?? 0),
        digitalizados: tot?.digitalizados ?? 0,
        comOriginalFisico: tot?.com_original ?? 0,
        restritos: tot?.restritos ?? 0,
        semClassificacao: tot?.sem_classe ?? 0,
      },
      porFase: porFase.map(linha('—', FASE_ROTULO)),
      porClasse: porClasse.map(linha('Sem classificação')),
      porTipo: porTipo.map(linha('Sem tipo')),
      porModulo: porModulo.map(linha('—', MODULO_ROTULO)),
      porExercicio: porExercicio.map(linha('Sem exercício')),
    };
  }

  async exportarQuantitativo(user: TenantAccessClaims, f: InventarioFiltro, formato: 'pdf' | 'csv', ip: string): Promise<{ arquivo: Buffer; nome: string }> {
    const sql = this.sql();
    const q = await this.quantitativo(user, f);
    const ctx = requireTenantContext();
    await this.audit.logTenant({ actorId: user.sub, action: 'relatorio_quantitativo_exportado', resourceType: 'relatorio', ip, metadata: { formato, filtro: f } });
    const data = hojeIso();
    type Linha = QuantitativoLinha & { grupo?: string };
    const secoes: Array<{ subtitulo: string; linhas: Linha[] }> = [
      { subtitulo: 'Por fase', linhas: q.porFase },
      { subtitulo: 'Por classe (Plano de Classificação)', linhas: q.porClasse.map((l) => ({ ...l, rotulo: l.chave ? `${l.chave} — ${l.rotulo}` : l.rotulo })) },
      { subtitulo: 'Por tipo documental', linhas: q.porTipo },
      { subtitulo: 'Por módulo', linhas: q.porModulo },
      { subtitulo: 'Por exercício', linhas: q.porExercicio },
    ];
    const colunas = (titulo: string): ColunaExport<Linha>[] => [
      { titulo, peso: 60, valor: (l) => l.rotulo },
      { titulo: 'Documentos', peso: 20, valor: (l) => l.documentos, alinhar: 'right' },
      { titulo: 'Páginas', peso: 20, valor: (l) => l.paginas, alinhar: 'right' },
    ];
    if (formato === 'csv') {
      const todas = secoes.flatMap((s) => s.linhas.map((l) => ({ ...l, grupo: s.subtitulo })));
      const cols: ColunaExport<Linha>[] = [{ titulo: 'Agrupamento', peso: 1, valor: (l) => l.grupo }, ...colunas('Item')];
      return { arquivo: gerarCsv(cols, todas), nome: `quantitativo-acervo-${data}.csv` };
    }
    const t = q.totais;
    const arquivo = await gerarPdfTabela(
      {
        orgao: ctx.nome,
        titulo: 'Quantitativo do Acervo',
        detalhes: [
          ...descreverFiltro(f, await this.nomesFiltro(sql, f)),
          `Total: ${t.documentos.toLocaleString('pt-BR')} documentos · ${t.paginas.toLocaleString('pt-BR')} páginas · ` +
            `${t.digitalizados.toLocaleString('pt-BR')} digitalizados · ${t.comOriginalFisico.toLocaleString('pt-BR')} com original físico · ` +
            `${t.restritos.toLocaleString('pt-BR')} restritos · ${t.semClassificacao.toLocaleString('pt-BR')} sem classificação`,
        ],
        emitidoPor: await this.nomeUsuario(sql, user.sub),
      },
      secoes.map((s) => ({ subtitulo: s.subtitulo, colunas: colunas('Item'), linhas: s.linhas })),
    );
    return { arquivo, nome: `quantitativo-acervo-${data}.pdf` };
  }

  /**
   * Dicionario de metadados do orgao: campos padrao de todo documento + os
   * campos definidos em cada tipo de documento, e o padrao de nomes da exportacao.
   */
  async dicionario(user: TenantAccessClaims, formato: 'pdf' | 'csv', ip: string): Promise<{ arquivo: Buffer; nome: string }> {
    const sql = this.sql();
    const ctx = requireTenantContext();
    const tipos = await sql<Array<{ nome: string; modulo: string | null; campos: unknown }>>`
      SELECT nome, modulo, campos FROM document_types WHERE ativo ORDER BY nome
    `;
    type Linha = CampoDicionario & { origem: string };
    const padrao: Linha[] = CAMPOS_PADRAO_DICIONARIO.map((c) => ({ ...c, origem: 'Todos os documentos' }));
    const proprios: Linha[] = tipos.flatMap((t) => {
      const lista = (typeof t.campos === 'string' ? JSON.parse(t.campos) : t.campos) as CampoMetadado[] | null;
      return (lista ?? []).map((c) => ({
        campo: c.chave,
        rotulo: c.rotulo,
        descricao: `Campo do tipo ${t.nome}`,
        formato: ROTULO_TIPO_CAMPO[c.tipo] + (c.opcoes?.length ? `: ${c.opcoes.join(', ')}` : ''),
        obrigatorio: c.obrigatorio,
        exemplo: '',
        origem: t.nome,
      }));
    });
    await this.audit.logTenant({ actorId: user.sub, action: 'dicionario_metadados_exportado', resourceType: 'relatorio', ip, metadata: { formato } });
    const colunas: ColunaExport<Linha>[] = [
      { titulo: 'Aplica-se a', peso: 14, valor: (l) => l.origem },
      { titulo: 'Campo', peso: 12, valor: (l) => l.campo },
      { titulo: 'Rótulo', peso: 14, valor: (l) => l.rotulo },
      { titulo: 'Descrição', peso: 28, valor: (l) => l.descricao },
      { titulo: 'Formato', peso: 14, valor: (l) => l.formato },
      { titulo: 'Obrigatório', peso: 8, valor: (l) => (l.obrigatorio ? 'Sim' : 'Não'), alinhar: 'center' },
      { titulo: 'Exemplo', peso: 10, valor: (l) => l.exemplo },
    ];
    const data = hojeIso();
    if (formato === 'csv') return { arquivo: gerarCsv(colunas, [...padrao, ...proprios]), nome: `dicionario-metadados-${data}.csv` };
    const arquivo = await gerarPdfTabela(
      {
        orgao: ctx.nome,
        titulo: 'Dicionário de Metadados',
        detalhes: [`Padrão de nomes e pastas na exportação: ${PADRAO_NOMES_EXPORTACAO}`],
        emitidoPor: await this.nomeUsuario(sql, user.sub),
      },
      [
        { subtitulo: 'Metadados padrão (todos os documentos)', colunas, linhas: padrao },
        ...(proprios.length ? [{ subtitulo: 'Campos próprios dos tipos de documento', colunas, linhas: proprios }] : []),
      ],
    );
    return { arquivo, nome: `dicionario-metadados-${data}.pdf` };
  }

  /** Inventario topografico: cada local (predio > sala > estante > caixa) com a quantidade de documentos. */
  async topografico(user: TenantAccessClaims, ip: string): Promise<{ arquivo: Buffer; nome: string }> {
    const sql = this.sql();
    const podeVerRestrito = user.role === 'admin' || user.permissions.includes('acervo_restrito:read');
    const rows = await sql<Array<{ path: string; tipo: string; descricao: string | null; documentos: number; ativo: boolean }>>`
      WITH RECURSIVE caminho AS (
        SELECT id, codigo::text AS path, 0 AS nivel FROM locais_fisicos WHERE parent_id IS NULL
        UNION ALL
        SELECT l.id, cm.path || ' / ' || l.codigo, cm.nivel + 1 FROM locais_fisicos l JOIN caminho cm ON l.parent_id = cm.id
      )
      SELECT cm.path, l.tipo, l.descricao, l.ativo,
             (SELECT count(*) FROM documents d
               WHERE d.local_fisico_id = l.id AND d.deleted_at IS NULL AND d.fase <> 'eliminado'
                 AND (${podeVerRestrito} OR COALESCE(d.nivel_acesso, 'publico') = 'publico')
                 AND ${filtroLotacao(sql, user)})::int AS documentos
      FROM caminho cm JOIN locais_fisicos l ON l.id = cm.id
      ORDER BY cm.path
    `;
    const ctx = requireTenantContext();
    await this.audit.logTenant({ actorId: user.sub, action: 'relatorio_topografico_exportado', resourceType: 'relatorio', ip });
    const TIPO: Record<string, string> = { predio: 'Prédio', sala: 'Sala', estante: 'Estante', prateleira: 'Prateleira', caixa: 'Caixa' };
    const total = rows.reduce((s, r) => s + r.documentos, 0);
    const arquivo = await gerarPdfTabela(
      { orgao: ctx.nome, titulo: 'Inventário Topográfico', detalhes: ['Onde está o original em papel de cada conjunto documental'], emitidoPor: await this.nomeUsuario(sql, user.sub) },
      [
        {
          colunas: [
            { titulo: 'Localização', peso: 45, valor: (r) => r.path },
            { titulo: 'Tipo', peso: 10, valor: (r) => TIPO[r.tipo] ?? r.tipo },
            { titulo: 'Descrição', peso: 30, valor: (r) => `${r.descricao ?? ''}${r.ativo ? '' : ' (inativo)'}`.trim() },
            { titulo: 'Documentos', peso: 15, valor: (r) => r.documentos, alinhar: 'right' },
          ],
          linhas: rows,
          rodape: `Total: ${rows.length.toLocaleString('pt-BR')} locais · ${total.toLocaleString('pt-BR')} documentos com original localizado`,
        },
      ],
    );
    return { arquivo, nome: `inventario-topografico-${hojeIso()}.pdf` };
  }

  private async nomesFiltro(sql: Sql, f: InventarioFiltro): Promise<{ tipo: string | null; local: string | null }> {
    const tipo = f.tipoId ? (await sql<Array<{ nome: string }>>`SELECT nome FROM document_types WHERE id = ${f.tipoId}`)[0]?.nome ?? null : null;
    const local = f.localId ? (await sql<Array<{ codigo: string }>>`SELECT codigo FROM locais_fisicos WHERE id = ${f.localId}`)[0]?.codigo ?? null : null;
    return { tipo, local };
  }

  private async nomeUsuario(sql: Sql, id: string): Promise<string | null> {
    return (await sql<Array<{ nome: string }>>`SELECT nome FROM users WHERE id = ${id}`)[0]?.nome ?? null;
  }
}
