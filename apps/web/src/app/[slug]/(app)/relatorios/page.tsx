'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Boxes,
  Download,
  FileSpreadsheet,
  FileText,
  Files,
  Gauge,
  PieChart,
  Lock,
  ScanLine,
  Search,
  SlidersHorizontal,
  Tags,
  Warehouse,
  X,
} from 'lucide-react';
import {
  caminhoLocal,
  type ClassificacaoView,
  type InventarioFiltro,
  type InventarioPage,
  type LocalFisicoView,
  type QuantitativoArquivo,
  type QuantitativoLinha,
  hojeIso,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Pagination,
  SelectMenu,
  StatCard,
  Tabs,
  TONE_VIVID,
  formatBytes,
  inputCls,
  type Tone,
} from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { Anel, BarraEmpilhada, Colunas, Rosca, agruparOutros } from '@/components/charts';
import { useToast } from '@/components/toast';
import { useModulo } from '@/components/branding';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/format';

type Aba = 'inventario' | 'quantitativos' | 'topografico';

const FASES: Array<{ id: string; label: string }> = [
  { id: 'corrente', label: 'Corrente' },
  { id: 'intermediaria', label: 'Intermediária' },
  { id: 'permanente', label: 'Permanente' },
];
const COR_FASE: Record<string, string> = {
  corrente: 'var(--color-info-500)',
  intermediaria: 'var(--color-warning-500)',
  permanente: 'var(--color-violet-500)',
  eliminado: 'var(--color-ink-400)',
};
const FASE_TOM: Record<string, Tone> = { corrente: 'info', intermediaria: 'warning', permanente: 'violet', eliminado: 'neutral' };
const MODULOS = [
  { id: 'acervo', label: 'Acervo', sistema: 'arquivo' },
  { id: 'receitas', label: 'Receitas', sistema: 'financeiro' },
  { id: 'despesas', label: 'Despesas', sistema: 'financeiro' },
  { id: 'balancete', label: 'Balancete', sistema: 'financeiro' },
  { id: 'extrato', label: 'Extrato', sistema: 'financeiro' },
  { id: 'outros', label: 'Outros arquivos', sistema: 'financeiro' },
] as const;
const dataBr = (iso: string | null) => fmtDate(iso, '—');
const fmt = (n: number) => n.toLocaleString('pt-BR');

/** Filtro -> query string (so o que esta preenchido). */
function paraQuery(f: InventarioFiltro, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export default function RelatoriosPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();
  const temFinanceiro = useModulo('financeiro');
  const [aba, setAba] = useState<Aba>('inventario');
  const [filtro, setFiltro] = useState<InventarioFiltro>({});
  const [busca, setBusca] = useState('');
  const [page, setPage] = useState(1);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [baixando, setBaixando] = useState<string | null>(null);

  // Busca livre com atraso: nao dispara uma consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltro((f) => ({ ...f, q: busca.trim() || undefined }));
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  const alterar = (parcial: Partial<InventarioFiltro>) => {
    setFiltro((f) => ({ ...f, ...parcial }));
    setPage(1);
  };
  const ativos = Object.entries(filtro).filter(([k, v]) => k !== 'q' && v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)).length;
  const limpar = () => {
    setFiltro({});
    setBusca('');
    setPage(1);
  };

  const { data: classes } = useQuery<ClassificacaoView[]>({
    queryKey: ['arquivistica', 'classificacoes'],
    queryFn: () => api(`/t/${slug}/arquivistica/classificacoes`),
    staleTime: 60_000,
  });
  const { data: locais } = useQuery<LocalFisicoView[]>({
    queryKey: ['arquivo-fisico', 'locais', slug],
    queryFn: () => api(`/t/${slug}/arquivo-fisico/locais`),
    retry: false,
  });
  const { data: tipos } = useQuery<Array<{ id: string; nome: string }>>({
    queryKey: ['document-types', slug, 'relatorios'],
    queryFn: async () => {
      const acervo = await api<Array<{ id: string; nome: string }>>(`/t/${slug}/document-types?modulo=acervo`);
      const outros = temFinanceiro ? await api<Array<{ id: string; nome: string }>>(`/t/${slug}/document-types`).catch(() => []) : [];
      return [...acervo, ...outros].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },
  });

  const { data: inventario, isFetching: carregandoInv, error: erroInv } = useQuery<InventarioPage>({
    queryKey: ['relatorios', 'inventario', slug, filtro, page],
    queryFn: () => api(`/t/${slug}/relatorios-arquivo/inventario${paraQuery(filtro, { page, pageSize: 25 })}`),
    enabled: aba === 'inventario',
    placeholderData: (prev) => prev,
  });
  const { data: quant, isLoading: carregandoQuant } = useQuery<QuantitativoArquivo>({
    queryKey: ['relatorios', 'quantitativo', slug, filtro],
    queryFn: () => api(`/t/${slug}/relatorios-arquivo/quantitativo${paraQuery(filtro)}`),
    enabled: aba === 'quantitativos',
  });

  const locaisOrdenados = useMemo(
    () => (locais ?? []).map((l) => ({ id: l.id, rotulo: caminhoLocal(l.id, locais ?? []) })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    [locais],
  );

  const baixar = async (tipo: 'inventario' | 'quantitativo' | 'topografico', formato: 'pdf' | 'csv') => {
    const chave = `${tipo}-${formato}`;
    setBaixando(chave);
    const aba = formato === 'pdf' ? window.open('', '_blank') : null;
    try {
      const path =
        tipo === 'topografico'
          ? `/t/${slug}/relatorios-arquivo/topografico/pdf`
          : `/t/${slug}/relatorios-arquivo/${tipo}/${formato}${paraQuery(filtro)}`;
      const url = await apiBlobUrl(path);
      if (formato === 'pdf') {
        if (aba) aba.location.href = url;
        else window.open(url, '_blank');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tipo}-${hojeIso()}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      aba?.close();
      toast.error(
        e instanceof ApiError && e.status === 403
          ? 'Você não tem permissão para exportar relatórios (Acervo: exportar).'
          : e instanceof ApiError
            ? e.message
            : 'Falha ao gerar o relatório',
      );
    } finally {
      setBaixando(null);
    }
  };

  const botoesExportar = (tipo: 'inventario' | 'quantitativo') => (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" leftIcon={<FileSpreadsheet aria-hidden />} loading={baixando === `${tipo}-csv`} onClick={() => void baixar(tipo, 'csv')}>
        Planilha
      </Button>
      <Button leftIcon={<Download aria-hidden />} loading={baixando === `${tipo}-pdf`} onClick={() => void baixar(tipo, 'pdf')}>
        Baixar PDF
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 items-start gap-4">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.violet.chip)}>
          <BarChart3 className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Relatórios do acervo</h1>
          <p className="mt-0.5 text-sm text-ink-500">Inventário, quantitativos e localização dos originais, com exportação em PDF e planilha.</p>
        </div>
      </div>

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'inventario', label: 'Inventário', icon: Files },
          { id: 'quantitativos', label: 'Quantitativos', icon: BarChart3 },
          { id: 'topografico', label: 'Topográfico', icon: Warehouse },
        ]}
      />

      {aba !== 'topografico' && (
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input type="search" aria-label="Buscar" placeholder="Buscar por título, número, ementa, credor…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant={filtrosAbertos || ativos > 0 ? 'secondary' : 'outline'} onClick={() => setFiltrosAbertos((v) => !v)} leftIcon={<SlidersHorizontal aria-hidden />} aria-expanded={filtrosAbertos} className="flex-1 sm:flex-none">
                Filtros
                {ativos > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">{ativos}</span>}
              </Button>
              {(ativos > 0 || busca) && (
                <Button variant="ghost" onClick={limpar} leftIcon={<X aria-hidden />}>
                  Limpar
                </Button>
              )}
            </div>
          </div>
          {filtrosAbertos && (
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-ink-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Classe" htmlFor="r-classe">
                <SelectMenu
                  id="r-classe"
                  className={inputCls}
                  value={filtro.semClasse ? '__sem__' : (filtro.classe ?? '')}
                  onChange={(e) =>
                    alterar(e.target.value === '__sem__' ? { classe: undefined, semClasse: true } : { classe: e.target.value || undefined, semClasse: undefined })
                  }
                >
                  <option value="">Todas as classes</option>
                  <option value="__sem__">Sem classificação</option>
                  {(classes ?? []).map((c) => (
                    <option key={c.id} value={c.codigo}>
                      {c.codigo} — {c.descricao}
                    </option>
                  ))}
                </SelectMenu>
              </Field>
              <Field label="Fase" htmlFor="r-fase">
                <SelectMenu id="r-fase" className={inputCls} value={filtro.fase ?? ''} onChange={(e) => alterar({ fase: (e.target.value || undefined) as InventarioFiltro['fase'] })}>
                  <option value="">Todas as fases</option>
                  {FASES.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                  <option value="eliminado">Eliminados</option>
                </SelectMenu>
              </Field>
              <Field label="Tipo documental" htmlFor="r-tipo">
                <SelectMenu id="r-tipo" className={inputCls} value={filtro.tipoId ?? ''} onChange={(e) => alterar({ tipoId: e.target.value || undefined })}>
                  <option value="">Todos os tipos</option>
                  {(tipos ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.nome}</option>
                  ))}
                </SelectMenu>
              </Field>
              <Field label="Local físico" htmlFor="r-local">
                <SelectMenu id="r-local" className={inputCls} value={filtro.localId ?? ''} onChange={(e) => alterar({ localId: e.target.value || undefined })} disabled={!locais}>
                  <option value="">Qualquer local</option>
                  {locaisOrdenados.map((l) => (
                    <option key={l.id} value={l.id}>{l.rotulo}</option>
                  ))}
                </SelectMenu>
              </Field>
              {temFinanceiro && (
                <Field label="Módulo" htmlFor="r-modulo">
                  <SelectMenu id="r-modulo" className={inputCls} value={filtro.modulos?.[0] ?? ''} onChange={(e) => alterar({ modulos: e.target.value ? [e.target.value as (typeof MODULOS)[number]['id']] : undefined })}>
                    <option value="">Todos os módulos</option>
                    {MODULOS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </SelectMenu>
                </Field>
              )}
              <Field label="Acesso" htmlFor="r-acesso">
                <SelectMenu id="r-acesso" className={inputCls} value={filtro.nivelAcesso ?? ''} onChange={(e) => alterar({ nivelAcesso: (e.target.value || undefined) as InventarioFiltro['nivelAcesso'] })}>
                  <option value="">Público e restrito</option>
                  <option value="publico">Somente público</option>
                  <option value="restrito">Somente restrito</option>
                </SelectMenu>
              </Field>
              <Field label="Exercício — de" htmlFor="r-de">
                <Input id="r-de" type="number" inputMode="numeric" placeholder="ex.: 2010" value={filtro.exercicioDe ?? ''} onChange={(e) => alterar({ exercicioDe: e.target.value ? Number(e.target.value) : undefined })} />
              </Field>
              <Field label="Exercício — até" htmlFor="r-ate">
                <Input id="r-ate" type="number" inputMode="numeric" placeholder="ex.: 2024" value={filtro.exercicioAte ?? ''} onChange={(e) => alterar({ exercicioAte: e.target.value ? Number(e.target.value) : undefined })} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2 lg:col-span-4">
                <input type="checkbox" checked={!!filtro.incluirEliminados} onChange={(e) => alterar({ incluirEliminados: e.target.checked || undefined })} />
                Incluir documentos já eliminados (só os dados; os arquivos não existem mais)
              </label>
            </div>
          )}
        </Card>
      )}

      {aba === 'inventario' && (
        <Card>
          <CardHeader
            title="Inventário"
            description={inventario ? `${fmt(inventario.total)} documento(s) encontrados` : 'Listagem descritiva do acervo'}
            icon={Files}
            action={botoesExportar('inventario')}
          />
          {erroInv ? (
            <CardBody>
              <EmptyState icon={Lock} title="Sem acesso" description={erroInv instanceof ApiError ? erroInv.message : 'Não foi possível carregar o inventário.'} />
            </CardBody>
          ) : inventario && inventario.items.length === 0 ? (
            <CardBody>
              <EmptyState icon={Files} title="Nenhum documento" description={ativos > 0 || busca ? 'Nada encontrado com esses filtros.' : 'O acervo ainda não tem documentos.'} />
            </CardBody>
          ) : (
            <div className={cn('overflow-x-auto transition-opacity', carregandoInv && 'opacity-60')}>
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-ink-50/60">
                  <tr className="label-caps border-b border-ink-200 text-left">
                    <th className="px-5 py-3">Classe</th>
                    <th className="px-3 py-3">Identificação</th>
                    <th className="px-3 py-3">Data</th>
                    <th className="px-3 py-3">Fase</th>
                    <th className="px-3 py-3">Destinação</th>
                    <th className="px-3 py-3">Localização</th>
                    <th className="px-5 py-3 text-right">Págs.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {(inventario?.items ?? []).map((i) => (
                    <tr key={i.id} className="align-top transition-colors hover:bg-brand-50/40">
                      <td className="px-5 py-3">
                        {i.classeCodigo ? (
                          <span className="font-mono text-[13px] font-semibold text-ink-800" title={i.classeDescricao ?? undefined}>{i.classeCodigo}</span>
                        ) : (
                          <Badge tone="warning">Sem classe</Badge>
                        )}
                      </td>
                      <td className="max-w-[360px] px-3 py-3">
                        <p className="font-medium text-ink-900">{i.identificacao}</p>
                        <p className="text-xs text-ink-500">
                          {i.tipo ?? MODULOS.find((m) => m.id === i.modulo)?.label}
                          {i.exercicio ? ` · Exercício ${i.exercicio}` : ''}
                          {i.nivelAcesso === 'restrito' && <span className="ml-1 font-semibold text-danger-600">· Restrito</span>}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-ink-700">{dataBr(i.dataDocumento)}</td>
                      <td className="px-3 py-3">
                        <Badge tone={FASE_TOM[i.fase] ?? 'neutral'}>{i.fase === 'intermediaria' ? 'Intermediária' : i.fase}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-600">
                        {i.destinacao ? (i.destinacao === 'eliminacao' ? 'Eliminação' : 'Guarda permanente') : '—'}
                        {i.previsaoDestinacao && <span className="block text-ink-400">em {dataBr(i.previsaoDestinacao)}</span>}
                      </td>
                      <td className="min-w-[190px] px-3 py-3 text-xs text-ink-600 [overflow-wrap:normal]">{i.localizacao ?? <span className="text-ink-400">Sem original localizado</span>}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-700">{i.paginas ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {inventario && inventario.total > 0 && (
            <div className="border-t border-ink-100 px-5 py-3">
              <Pagination page={inventario.page} pageSize={inventario.pageSize} total={inventario.total} onPageChange={setPage} />
            </div>
          )}
        </Card>
      )}

      {aba === 'quantitativos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-500">Totais do acervo com os filtros acima.</p>
            {botoesExportar('quantitativo')}
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard label="Documentos" value={fmt(quant?.totais.documentos ?? 0)} icon={Files} tone="brand" loading={carregandoQuant} />
            <StatCard label="Páginas" value={fmt(quant?.totais.paginas ?? 0)} icon={FileText} tone="violet" loading={carregandoQuant} hint={quant ? `${formatBytes(quant.totais.bytes)} em arquivos` : undefined} />
            <StatCard label="Digitalizados" value={fmt(quant?.totais.digitalizados ?? 0)} icon={ScanLine} tone="teal" loading={carregandoQuant} hint="Com metadados do Decreto 10.278" />
            <StatCard label="Com original físico" value={fmt(quant?.totais.comOriginalFisico ?? 0)} icon={Boxes} tone="orange" loading={carregandoQuant} />
            <StatCard label="Restritos" value={fmt(quant?.totais.restritos ?? 0)} icon={Lock} tone="danger" loading={carregandoQuant} />
            <StatCard label="Sem classificação" value={fmt(quant?.totais.semClassificacao ?? 0)} icon={Tags} tone="warning" loading={carregandoQuant} hint="Precisam de classe do Plano" />
          </div>
          {quant && (
            <>
              <Card>
                <CardHeader title="Indicadores de gestão" description="Quanto do acervo já está tratado" icon={Gauge} />
                <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                  <Anel rotulo="Classificados" valor={quant.totais.documentos - quant.totais.semClassificacao} total={quant.totais.documentos} dica="com classe do Plano" cor="var(--color-success-500)" />
                  <Anel rotulo="Digitalizados" valor={quant.totais.digitalizados} total={quant.totais.documentos} dica="Decreto 10.278" cor="var(--color-teal-500)" />
                  <Anel rotulo="Com original físico" valor={quant.totais.comOriginalFisico} total={quant.totais.documentos} dica="papel localizado" cor="var(--color-orange-500)" />
                  <Anel rotulo="Acesso restrito" valor={quant.totais.restritos} total={quant.totais.documentos} dica="LGPD / sigilo" cor="var(--color-danger-500)" />
                </CardBody>
              </Card>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <Card>
                  <CardHeader title="Por fase" description="Ciclo de vida (teoria das três idades)" icon={PieChart} />
                  <CardBody>
                    <Rosca fatias={quant.porFase.map((l) => ({ rotulo: l.rotulo, valor: l.documentos, cor: COR_FASE[l.chave] }))} rotuloCentro="documentos" />
                  </CardBody>
                </Card>
                <Card className="xl:col-span-2">
                  <CardHeader title="Por exercício" description="Documentos por ano de produção" icon={BarChart3} />
                  <CardBody>
                    <Colunas
                      dados={[...quant.porExercicio]
                        .sort((a, b) => Number(a.chave || a.rotulo) - Number(b.chave || b.rotulo))
                        .map((l) => ({ rotulo: l.rotulo, valor: l.documentos, extra: `${fmt(l.paginas)} págs.` }))}
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Por tipo documental" description="Maiores grupos" icon={PieChart} />
                  <CardBody>
                    <Rosca fatias={agruparOutros(quant.porTipo.map((l) => ({ rotulo: l.rotulo, valor: l.documentos })))} rotuloCentro="documentos" />
                  </CardBody>
                </Card>
                <Barras
                  className="xl:col-span-2"
                  titulo="Por classe"
                  linhas={quant.porClasse.map((l) => ({ ...l, rotulo: l.chave ? `${l.chave} — ${l.rotulo}` : l.rotulo }))}
                  tone="violet"
                />
                {temFinanceiro && (
                  <Card className="xl:col-span-3">
                    <CardHeader title="Por módulo" description="Composição do acervo" icon={BarChart3} />
                    <CardBody>
                      <BarraEmpilhada fatias={quant.porModulo.map((l) => ({ rotulo: l.rotulo, valor: l.documentos }))} />
                    </CardBody>
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {aba === 'topografico' && (
        <Card>
          <CardHeader title="Inventário topográfico" description="Cada prédio, sala, estante e caixa, com a quantidade de documentos" icon={Warehouse} />
          <CardBody className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-sm text-ink-600">
              Mostra onde está o original em papel de cada conjunto documental, na ordem da árvore de locais do Arquivo físico. Útil
              para conferência periódica das caixas e para localizar um documento sem abrir o sistema.
            </p>
            <Button leftIcon={<Download aria-hidden />} loading={baixando === 'topografico-pdf'} onClick={() => void baixar('topografico', 'pdf')}>
              Gerar PDF
            </Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

const BARRA: Record<string, string> = {
  info: 'bg-info-500',
  brand: 'bg-brand-600',
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
};

/** Barras horizontais proporcionais (documentos) com paginas ao lado. */
function Barras({ titulo, linhas, tone, className }: { titulo: string; linhas: QuantitativoLinha[]; tone: keyof typeof BARRA; className?: string }) {
  const [todas, setTodas] = useState(false);
  const max = Math.max(1, ...linhas.map((l) => l.documentos));
  const visiveis = todas ? linhas : linhas.slice(0, 10);
  return (
    <Card className={className}>
      <CardHeader title={titulo} description={`${linhas.length} ${linhas.length === 1 ? 'grupo' : 'grupos'}`} icon={BarChart3} />
      <CardBody className="space-y-3">
        {linhas.length === 0 && <p className="text-sm text-ink-500">Sem dados.</p>}
        {visiveis.map((l) => (
          <div key={`${l.chave}-${l.rotulo}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink-700" title={l.rotulo}>{l.rotulo}</span>
              <span className="shrink-0 tabular-nums text-ink-900">
                <strong>{fmt(l.documentos)}</strong>
                <span className="ml-1 text-xs text-ink-400">· {fmt(l.paginas)} págs.</span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
              <div className={cn('h-full rounded-full', BARRA[tone])} style={{ width: `${Math.max(2, (l.documentos / max) * 100)}%` }} />
            </div>
          </div>
        ))}
        {linhas.length > 10 && (
          <Button variant="ghost" size="sm" onClick={() => setTodas((v) => !v)}>
            {todas ? 'Mostrar menos' : `Mostrar todos (${linhas.length})`}
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
