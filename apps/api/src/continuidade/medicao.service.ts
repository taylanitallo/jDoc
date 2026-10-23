import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FUSO_ORGAO,
  META_DISPONIBILIDADE,
  SCHEMA_NAME_REGEX,
  calcularLinha,
  type ContratoItemInput,
  type ContratoItemView,
  type LinhaMedicao,
  type MedicaoView,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { gerarPdfTabela, type ColunaExport } from '../common/exportacao';
import { ContinuidadeService } from './continuidade.service';

interface TenantRow {
  id: string;
  nome: string;
  schema_name: string;
  contrato: unknown;
}

interface ItemRow {
  id: string;
  numero: number;
  orgao_codigo: string | null;
  descricao: string;
  valor_mensal_ged: string;
  valor_pagina: string;
  paginas_contratadas: number;
  ativo: boolean;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Itens do contrato (um por secretaria) e boletim mensal. Paginas entram no
 * mes do aceite do fiscal; medicao fechada fica gravada e as paginas dela
 * contam como "anteriores" para o saldo dos meses seguintes.
 */
@Injectable()
export class MedicaoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly continuidade: ContinuidadeService,
  ) {}

  private async tenant(tenantId: string): Promise<TenantRow> {
    const [t] = await this.db.catalog()<TenantRow[]>`SELECT id, nome, schema_name, contrato FROM public.tenants WHERE id = ${tenantId}`;
    if (!t || !SCHEMA_NAME_REGEX.test(t.schema_name)) throw new NotFoundException('Órgão não encontrado');
    return t;
  }

  private async nomesSecretarias(schema: string): Promise<Map<string, string>> {
    const rows = await this.db.tenant(schema)<Array<{ codigo: string; descricao: string }>>`
      SELECT DISTINCT ON (codigo) codigo, descricao FROM orgaos WHERE deleted_at IS NULL ORDER BY codigo, exercicio DESC
    `;
    return new Map(rows.map((r) => [r.codigo, r.descricao]));
  }

  async itens(tenantId: string): Promise<ContratoItemView[]> {
    const t = await this.tenant(tenantId);
    const nomes = await this.nomesSecretarias(t.schema_name);
    const rows = await this.db.catalog()<ItemRow[]>`SELECT * FROM platform.contrato_itens WHERE tenant_id = ${tenantId} ORDER BY numero`;
    return rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      orgaoCodigo: r.orgao_codigo,
      orgaoNome: r.orgao_codigo ? (nomes.get(r.orgao_codigo) ?? null) : null,
      descricao: r.descricao,
      valorMensalGed: Number(r.valor_mensal_ged),
      valorPagina: Number(r.valor_pagina),
      paginasContratadas: r.paginas_contratadas,
      ativo: r.ativo,
    }));
  }

  /** Substitui a lista de itens (a tela edita a tabela inteira). */
  async salvarItens(tenantId: string, itens: ContratoItemInput[]): Promise<{ antes: ContratoItemView[]; depois: ContratoItemView[] }> {
    const antes = await this.itens(tenantId);
    await this.db.catalog().begin(async (tx) => {
      await tx`DELETE FROM platform.contrato_itens WHERE tenant_id = ${tenantId}`;
      for (const i of itens) {
        await tx`
          INSERT INTO platform.contrato_itens (tenant_id, numero, orgao_codigo, descricao, valor_mensal_ged, valor_pagina, paginas_contratadas, ativo)
          VALUES (${tenantId}, ${i.numero}, ${i.orgaoCodigo}, ${i.descricao}, ${i.valorMensalGed}, ${i.valorPagina}, ${i.paginasContratadas}, ${i.ativo})
        `;
      }
    });
    return { antes, depois: await this.itens(tenantId) };
  }

  async listar(tenantId: string): Promise<Array<{ mes: string; total: number; fechadaEm: string; fechadaPor: string }>> {
    const rows = await this.db.catalog()<Array<{ mes: string; totais: unknown; fechada_em: Date; fechada_por: string }>>`
      SELECT mes, totais, fechada_em, fechada_por FROM platform.medicoes WHERE tenant_id = ${tenantId} ORDER BY mes DESC
    `;
    return rows.map((r) => {
      const t = (typeof r.totais === 'string' ? JSON.parse(r.totais) : r.totais) as MedicaoView['totais'];
      return { mes: r.mes, total: t.total, fechadaEm: r.fechada_em.toISOString(), fechadaPor: r.fechada_por };
    });
  }

  async medicao(tenantId: string, mes: string): Promise<MedicaoView> {
    const t = await this.tenant(tenantId);
    const contrato = ((typeof t.contrato === 'string' ? JSON.parse(t.contrato) : t.contrato) ?? {}) as Record<string, string | null>;
    const base = {
      contrato: {
        numero: contrato.numero ?? null,
        vigenciaInicio: contrato.vigenciaInicio ?? null,
        vigenciaFim: contrato.vigenciaFim ?? null,
        fiscal: contrato.fiscal ?? null,
        preposto: contrato.preposto ?? null,
      },
      metaDisponibilidade: META_DISPONIBILIDADE,
    };
    const [fechada] = await this.db.catalog()<Array<{ itens: unknown; totais: unknown; disponibilidade: string | null; observacao: string | null; fechada_por: string; fechada_em: Date }>>`
      SELECT itens, totais, disponibilidade, observacao, fechada_por, fechada_em FROM platform.medicoes WHERE tenant_id = ${tenantId} AND mes = ${mes}
    `;
    if (fechada) {
      const snap = (typeof fechada.itens === 'string' ? JSON.parse(fechada.itens) : fechada.itens) as { linhas: LinhaMedicao[]; paginasSemItem: number };
      return {
        ...base,
        mes,
        fechada: true,
        fechadaPor: fechada.fechada_por,
        fechadaEm: fechada.fechada_em.toISOString(),
        observacao: fechada.observacao,
        disponibilidade: fechada.disponibilidade === null ? null : Number(fechada.disponibilidade),
        linhas: snap.linhas,
        paginasSemItem: snap.paginasSemItem ?? 0,
        totais: (typeof fechada.totais === 'string' ? JSON.parse(fechada.totais) : fechada.totais) as MedicaoView['totais'],
      };
    }

    const itens = (await this.itens(tenantId)).filter((i) => i.ativo);
    const inicio = `${mes}-01`;
    const porSecretaria = await this.db.tenant(t.schema_name)<Array<{ orgao_codigo: string | null; paginas: number }>>`
      SELECT orgao_codigo, coalesce(sum(paginas_aceitas), 0)::int AS paginas FROM digit_lotes
      WHERE aceite_em IS NOT NULL
        AND (aceite_em AT TIME ZONE ${FUSO_ORGAO})::date >= ${inicio}::date
        AND (aceite_em AT TIME ZONE ${FUSO_ORGAO})::date < (${inicio}::date + interval '1 month')
      GROUP BY orgao_codigo
    `;
    const anteriores = await this.db.catalog()<Array<{ itens: unknown }>>`
      SELECT itens FROM platform.medicoes WHERE tenant_id = ${tenantId} AND mes < ${mes}
    `;
    const jaMedidas = new Map<number, number>();
    for (const a of anteriores) {
      const snap = (typeof a.itens === 'string' ? JSON.parse(a.itens) : a.itens) as { linhas: LinhaMedicao[] };
      for (const l of snap.linhas) jaMedidas.set(l.numero, (jaMedidas.get(l.numero) ?? 0) + l.paginasMedidas);
    }
    // GED cobra o mes que tenha ao menos um dia dentro da vigencia (sem vigencia cadastrada: cobra).
    const fimMes = new Date(`${inicio}T12:00:00`);
    fimMes.setMonth(fimMes.getMonth() + 1);
    fimMes.setDate(0);
    const fimIso = fimMes.toISOString().slice(0, 10);
    const gedNoMes =
      (!base.contrato.vigenciaInicio || base.contrato.vigenciaInicio <= fimIso) && (!base.contrato.vigenciaFim || base.contrato.vigenciaFim >= inicio);

    const usados = new Set<string>();
    const linhas: LinhaMedicao[] = itens.map((i) => {
      const chave = i.orgaoCodigo ?? '';
      usados.add(chave);
      const paginasMes = porSecretaria.filter((p) => (p.orgao_codigo ?? '') === chave).reduce((s, p) => s + p.paginas, 0);
      const anteriorItem = jaMedidas.get(i.numero) ?? 0;
      return {
        numero: i.numero,
        descricao: i.descricao,
        orgaoCodigo: i.orgaoCodigo,
        orgaoNome: i.orgaoNome,
        paginasMes,
        paginasAnteriores: anteriorItem,
        paginasContratadas: i.paginasContratadas,
        valorPagina: i.valorPagina,
        ...calcularLinha(i, paginasMes, anteriorItem, gedNoMes),
      };
    });
    const dias = await this.continuidade.disponibilidade(31, mes);
    const disponibilidade = dias.length ? Math.round((dias.reduce((s, d) => s + d.percentual, 0) / dias.length) * 100) / 100 : null;
    return {
      ...base,
      mes,
      fechada: false,
      fechadaPor: null,
      fechadaEm: null,
      observacao: null,
      disponibilidade,
      linhas,
      paginasSemItem: porSecretaria.filter((p) => !usados.has(p.orgao_codigo ?? '')).reduce((s, p) => s + p.paginas, 0),
      totais: {
        ged: Math.round(linhas.reduce((s, l) => s + l.valorMensalGed, 0) * 100) / 100,
        servico: Math.round(linhas.reduce((s, l) => s + l.valorServico, 0) * 100) / 100,
        total: Math.round(linhas.reduce((s, l) => s + l.valorTotal, 0) * 100) / 100,
        paginasMedidas: linhas.reduce((s, l) => s + l.paginasMedidas, 0),
      },
    };
  }

  /** Fecha o mes: grava o boletim e nao recalcula mais. */
  async fechar(tenantId: string, mes: string, autor: string, observacao?: string): Promise<MedicaoView> {
    const m = await this.medicao(tenantId, mes);
    if (m.fechada) throw new ConflictException('Medição deste mês já foi fechada');
    const hoje = new Date().toLocaleDateString('en-CA', { timeZone: FUSO_ORGAO }).slice(0, 7);
    if (mes > hoje) throw new ConflictException('Não é possível fechar um mês que ainda não começou');
    if (!m.linhas.length) throw new ConflictException('Cadastre os itens do contrato antes de fechar a medição');
    await this.db.catalog()`
      INSERT INTO platform.medicoes (tenant_id, mes, itens, totais, disponibilidade, observacao, fechada_por)
      VALUES (${tenantId}, ${mes}, ${this.db.catalog().json({ linhas: m.linhas, paginasSemItem: m.paginasSemItem } as never)},
              ${this.db.catalog().json(m.totais as never)}, ${m.disponibilidade}, ${observacao ?? null}, ${autor})
    `;
    return this.medicao(tenantId, mes);
  }

  async boletimPdf(tenantId: string, mes: string): Promise<{ arquivo: Buffer; nome: string }> {
    const t = await this.tenant(tenantId);
    const m = await this.medicao(tenantId, mes);
    const [ano, mm] = mes.split('-');
    const colunas: ColunaExport<LinhaMedicao>[] = [
      { titulo: 'Item', peso: 4, valor: (l) => l.numero, alinhar: 'center' },
      { titulo: 'Secretaria / descrição', peso: 26, valor: (l) => `${l.orgaoNome ?? l.orgaoCodigo ?? 'Geral'} — ${l.descricao}` },
      { titulo: 'GED (mensal)', peso: 11, valor: (l) => brl(l.valorMensalGed), alinhar: 'right' },
      { titulo: 'Págs. aceitas no mês', peso: 9, valor: (l) => l.paginasMes, alinhar: 'right' },
      { titulo: 'Págs. medidas', peso: 8, valor: (l) => l.paginasMedidas, alinhar: 'right' },
      { titulo: 'Saldo após', peso: 9, valor: (l) => Math.max(0, l.paginasContratadas - l.paginasAnteriores - l.paginasMedidas), alinhar: 'right' },
      { titulo: 'R$/pág.', peso: 7, valor: (l) => l.valorPagina.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }), alinhar: 'right' },
      { titulo: 'Serviço', peso: 11, valor: (l) => brl(l.valorServico), alinhar: 'right' },
      { titulo: 'Total do item', peso: 12, valor: (l) => brl(l.valorTotal), alinhar: 'right' },
    ];
    const arquivo = await gerarPdfTabela(
      {
        orgao: t.nome,
        titulo: `Boletim de Medição — ${mm}/${ano}${m.fechada ? '' : ' (prévia, não fechada)'}`,
        detalhes: [
          `Contrato ${m.contrato.numero ?? '—'} · vigência ${m.contrato.vigenciaInicio?.split('-').reverse().join('/') ?? '—'} a ${m.contrato.vigenciaFim?.split('-').reverse().join('/') ?? '—'} · fiscal ${m.contrato.fiscal ?? '—'} · preposto ${m.contrato.preposto ?? '—'}`,
          `Total do mês: ${brl(m.totais.total)} (GED ${brl(m.totais.ged)} + serviço ${brl(m.totais.servico)}) · ${m.totais.paginasMedidas.toLocaleString('pt-BR')} página(s) medida(s)` +
            ` · disponibilidade ${m.disponibilidade === null ? 'sem medição' : `${m.disponibilidade.toFixed(2)}%`} (meta ${m.metaDisponibilidade}%)`,
          ...(m.paginasSemItem ? [`Atenção: ${m.paginasSemItem} página(s) aceita(s) de secretaria sem item no contrato não foram medidas.`] : []),
          ...(m.fechada ? [`Fechado por ${m.fechadaPor} em ${new Date(m.fechadaEm!).toLocaleString('pt-BR', { timeZone: FUSO_ORGAO })}${m.observacao ? ` — ${m.observacao}` : ''}`] : []),
        ],
      },
      [{ subtitulo: 'Itens', colunas, linhas: m.linhas, rodape: 'Páginas: somente lotes com aceite formal do fiscal no mês. Páginas acima do saldo contratado não são medidas.' }],
    );
    return { arquivo, nome: `boletim-medicao-${mes}.pdf` };
  }
}
