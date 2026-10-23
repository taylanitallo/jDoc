'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, ClipboardList, Download, FileSpreadsheet, Layers, Plus, ScanLine } from 'lucide-react';
import {
  ESTADOS_CONSERVACAO,
  ESTADO_CONSERVACAO_LABEL,
  ETAPAS_LOTE,
  ETAPA_LOTE_LABEL,
  type EtapaLote,
  type LoteCreateInput,
  type LoteResumoView,
  type Orgao,
  type PlanoInput,
  type PlanoView,
  type ProducaoResumo,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, SelectMenu, StatCard, Tabs, Textarea, inputCls } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { ETAPA_TOM } from '@/components/digitalizacao/etapa';

type Aba = 'lotes' | 'planos' | 'producao';


/** Secretarias (uma por codigo; o cadastro se repete por exercicio). */
function useSecretarias(slug: string) {
  const { data } = useQuery({
    queryKey: ['digit', 'secretarias', slug],
    queryFn: () => api<{ items: Orgao[] }>(`/t/${slug}/configuracoes/orgaos?pageSize=1000`),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const porCodigo = new Map<string, Orgao>();
  for (const o of data?.items ?? []) {
    const a = porCodigo.get(o.codigo);
    if (!a || o.exercicio > a.exercicio) porCodigo.set(o.codigo, o);
  }
  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
}

export default function DigitalizacaoPage() {
  const { slug } = useParams<{ slug: string }>();
  const [aba, setAba] = useState<Aba>('lotes');
  return (
    <div className="space-y-5">
      <PageHeader
        title="Digitalização"
        description="Plano de trabalho, lotes recebidos, cadeia de custódia, controle de qualidade, aceite do fiscal e produção por página."
      />
      <Tabs<Aba>
        value={aba}
        onChange={setAba}
        items={[
          { id: 'lotes', label: 'Lotes', icon: Layers },
          { id: 'planos', label: 'Planos de trabalho', icon: ClipboardList },
          { id: 'producao', label: 'Produção', icon: BarChart3 },
        ]}
      />
      {aba === 'lotes' && <Lotes slug={String(slug)} />}
      {aba === 'planos' && <Planos slug={String(slug)} />}
      {aba === 'producao' && <Producao slug={String(slug)} />}
    </div>
  );
}

function Lotes({ slug }: { slug: string }) {
  const [etapa, setEtapa] = useState<EtapaLote | ''>('');
  const [page, setPage] = useState(1);
  const [novo, setNovo] = useState(false);
  const qs = new URLSearchParams({ page: String(page), pageSize: '20', ...(etapa ? { etapa } : {}) });
  const { data, isLoading } = useQuery({
    queryKey: ['digit', 'lotes', slug, qs.toString()],
    queryFn: () => api<{ items: LoteResumoView[]; total: number }>(`/t/${slug}/digitalizacao/lotes?${qs}`),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Etapa" htmlFor="dg-etapa" className="w-full sm:w-64">
          <SelectMenu
            id="dg-etapa"
            className={inputCls}
            value={etapa}
            onChange={(e) => {
              setEtapa(e.target.value as EtapaLote | '');
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {ETAPAS_LOTE.map((e) => (
              <option key={e} value={e}>
                {ETAPA_LOTE_LABEL[e]}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <Button leftIcon={<Plus aria-hidden />} onClick={() => setNovo(true)}>
          Receber lote
        </Button>
      </div>
      {isLoading ? (
        <SkeletonTable rows={6} columns={4} label="Carregando lotes" />
      ) : !data?.items.length ? (
        <EmptyState icon={ScanLine} title="Nenhum lote" description="Registre o recebimento do primeiro lote de documentos para digitalizar." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {data.items.map((l) => (
              <li key={l.id}>
                <Link href={`/${slug}/digitalizacao/${l.id}`} className="flex flex-col gap-2 px-5 py-4 transition hover:bg-brand-50/40 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ink-500">{l.protocolo}</span>
                      <span className="font-semibold text-ink-900">{l.descricao}</span>
                      <Badge tone={ETAPA_TOM[l.etapa]}>{ETAPA_LOTE_LABEL[l.etapa]}</Badge>
                      {l.ncAbertas > 0 && <Badge tone="danger">{l.ncAbertas} não conformidade(s)</Badge>}
                      {l.sigiloso && <Badge tone="violet">Sigiloso</Badge>}
                      {l.fragil && <Badge tone="orange">Frágil</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {l.orgaoNome ? `${l.orgaoCodigo} — ${l.orgaoNome}` : (l.orgaoCodigo ?? 'Sem secretaria')} · {l.caixas} caixa(s) · {l.documentos} documento(s) ·{' '}
                      {l.paginas.toLocaleString('pt-BR')} página(s)
                      {l.paginasAceitas !== null ? ` · ${l.paginasAceitas.toLocaleString('pt-BR')} aceita(s)` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-500">Recebido em {fmtDate(l.criadoEm)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={page} pageSize={20} total={data.total} onPageChange={setPage} />
          </div>
        </Card>
      )}
      {novo && <NovoLote slug={slug} onClose={() => setNovo(false)} />}
    </div>
  );
}

function NovoLote({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const secretarias = useSecretarias(slug);
  const { data: planos } = useQuery({ queryKey: ['digit', 'planos', slug], queryFn: () => api<PlanoView[]>(`/t/${slug}/digitalizacao/planos`) });
  const [f, setF] = useState<LoteCreateInput>({
    descricao: '',
    caixas: 0,
    amostragemPct: 10,
    estadoConservacao: 'bom',
    sigiloso: false,
    fragil: false,
    grandeFormato: false,
    contaminado: false,
  });
  const set = <K extends keyof LoteCreateInput>(k: K, v: LoteCreateInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const criar = useMutation({
    mutationFn: () => api<{ id: string }>(`/t/${slug}/digitalizacao/lotes`, { method: 'POST', body: f }),
    onSuccess: () => {
      toast.success('Lote recebido. Agora inventarie as caixas e emita o termo de recebimento.');
      qc.invalidateQueries({ queryKey: ['digit', 'lotes'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível registrar.'),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Receber lote para digitalização"
      subtitle="Registra o recebimento e abre a cadeia de custódia"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={criar.isPending} disabled={f.descricao.trim().length < 3} onClick={() => criar.mutate()}>
            Registrar recebimento
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Descrição" htmlFor="nl-desc" required className="sm:col-span-2">
          <Input id="nl-desc" value={f.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Pastas funcionais 2010–2015" />
        </Field>
        <Field label="Secretaria" htmlFor="nl-sec">
          <SelectMenu id="nl-sec" className={inputCls} value={f.orgaoCodigo ?? ''} onChange={(e) => set('orgaoCodigo', e.target.value || null)}>
            <option value="">Sem secretaria</option>
            {secretarias.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {s.codigo} — {s.descricao}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Plano de trabalho" htmlFor="nl-plano">
          <SelectMenu id="nl-plano" className={inputCls} value={f.planoId ?? ''} onChange={(e) => set('planoId', e.target.value || null)}>
            <option value="">Sem plano</option>
            {(planos ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.titulo}
                {p.status === 'rascunho' ? ' (rascunho)' : ''}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Setor de origem" htmlFor="nl-setor">
          <Input id="nl-setor" value={f.setorOrigem ?? ''} onChange={(e) => set('setorOrigem', e.target.value)} />
        </Field>
        <Field label="Entregue por" htmlFor="nl-entrega">
          <Input id="nl-entrega" value={f.responsavelEntrega ?? ''} onChange={(e) => set('responsavelEntrega', e.target.value)} />
        </Field>
        <Field label="Caixas" htmlFor="nl-caixas">
          <Input id="nl-caixas" type="number" min={0} value={f.caixas} onChange={(e) => set('caixas', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Páginas estimadas" htmlFor="nl-pag">
          <Input
            id="nl-pag"
            type="number"
            min={0}
            value={f.paginasEstimadas ?? ''}
            onChange={(e) => set('paginasEstimadas', e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
        <Field label="Amostragem do controle de qualidade (%)" htmlFor="nl-amostra">
          <Input id="nl-amostra" type="number" min={1} max={100} value={f.amostragemPct} onChange={(e) => set('amostragemPct', Number(e.target.value) || 10)} />
        </Field>
        <Field label="Estado de conservação" htmlFor="nl-estado">
          <SelectMenu id="nl-estado" className={inputCls} value={f.estadoConservacao} onChange={(e) => set('estadoConservacao', e.target.value as LoteCreateInput['estadoConservacao'])}>
            {ESTADOS_CONSERVACAO.map((s) => (
              <option key={s} value={s}>
                {ESTADO_CONSERVACAO_LABEL[s]}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-700">Tratamento especial (segregação)</legend>
          <div className="flex flex-wrap gap-4 text-sm text-ink-800">
            {(
              [
                ['sigiloso', 'Sigiloso'],
                ['fragil', 'Frágil'],
                ['grandeFormato', 'Grande formato'],
                ['contaminado', 'Contaminado (fungo, umidade)'],
              ] as const
            ).map(([k, rotulo]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
                {rotulo}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Observações" htmlFor="nl-obs" className="sm:col-span-2">
          <Textarea id="nl-obs" rows={2} value={f.observacoes ?? ''} onChange={(e) => set('observacoes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Planos({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editando, setEditando] = useState<PlanoView | 'novo' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['digit', 'planos', slug], queryFn: () => api<PlanoView[]>(`/t/${slug}/digitalizacao/planos`) });
  const aprovar = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/digitalizacao/planos/${id}/aprovar`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Plano aprovado.');
      qc.invalidateQueries({ queryKey: ['digit', 'planos'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Só o fiscal do contrato aprova o plano.' : e.message) : 'Falha ao aprovar'),
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button leftIcon={<Plus aria-hidden />} onClick={() => setEditando('novo')}>
          Novo plano
        </Button>
      </div>
      {isLoading ? (
        <SkeletonTable rows={4} columns={3} label="Carregando planos" />
      ) : !data?.length ? (
        <EmptyState icon={ClipboardList} title="Nenhum plano de trabalho" description="Registre o diagnóstico, o volume, o cronograma e as metas de cada secretaria." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((p) => (
            <Card key={p.id} className="space-y-2 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-bold text-ink-900">{p.titulo}</p>
                <Badge tone={p.status === 'aprovado' ? 'success' : 'warning'}>{p.status === 'aprovado' ? 'Aprovado' : 'Rascunho'}</Badge>
              </div>
              <p className="text-xs text-ink-500">
                {p.orgaoNome ? `${p.orgaoCodigo} — ${p.orgaoNome}` : (p.orgaoCodigo ?? 'Todas as secretarias')}
                {p.inicio ? ` · ${fmtDate(p.inicio)} a ${fmtDate(p.fim)}` : ''}
              </p>
              <p className="text-sm text-ink-700">
                Meta: {p.volumeCaixas ?? '—'} caixa(s), {p.volumePaginas?.toLocaleString('pt-BR') ?? '—'} página(s) · {p.lotes} lote(s) ·{' '}
                <strong>{p.paginasAceitas.toLocaleString('pt-BR')}</strong> página(s) aceita(s)
              </p>
              {p.status === 'aprovado' ? (
                <p className="text-xs text-ink-500">
                  Aprovado por {p.aprovadoPor} em {fmtDate(p.aprovadoEm)}
                </p>
              ) : (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setEditando(p)}>
                    Editar
                  </Button>
                  <Button size="sm" leftIcon={<CheckCircle2 aria-hidden />} loading={aprovar.isPending && aprovar.variables === p.id} onClick={() => aprovar.mutate(p.id)}>
                    Aprovar (fiscal)
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {editando && <PlanoModal slug={slug} plano={editando === 'novo' ? null : editando} onClose={() => setEditando(null)} />}
    </div>
  );
}

function PlanoModal({ slug, plano, onClose }: { slug: string; plano: PlanoView | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const secretarias = useSecretarias(slug);
  const [f, setF] = useState<PlanoInput>({
    titulo: plano?.titulo ?? '',
    orgaoCodigo: plano?.orgaoCodigo ?? null,
    diagnostico: plano?.diagnostico ?? '',
    setores: plano?.setores ?? '',
    volumeCaixas: plano?.volumeCaixas ?? null,
    volumePaginas: plano?.volumePaginas ?? null,
    inicio: plano?.inicio ?? null,
    fim: plano?.fim ?? null,
    metas: plano?.metas ?? '',
  });
  const set = <K extends keyof PlanoInput>(k: K, v: PlanoInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const salvar = useMutation({
    mutationFn: () =>
      plano
        ? api(`/t/${slug}/digitalizacao/planos/${plano.id}`, { method: 'PATCH', body: f })
        : api(`/t/${slug}/digitalizacao/planos`, { method: 'POST', body: f }),
    onSuccess: () => {
      toast.success('Plano salvo.');
      qc.invalidateQueries({ queryKey: ['digit', 'planos'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  const num = (v: string) => (v ? Number(v) : null);
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={plano ? 'Editar plano de trabalho' : 'Novo plano de trabalho'}
      subtitle="Diagnóstico, volume, cronograma e metas. Depois de aprovado pelo fiscal, não muda mais."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={salvar.isPending} disabled={f.titulo.trim().length < 3} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título" htmlFor="pl-titulo" required className="sm:col-span-2">
          <Input id="pl-titulo" value={f.titulo} onChange={(e) => set('titulo', e.target.value)} />
        </Field>
        <Field label="Secretaria" htmlFor="pl-sec">
          <SelectMenu id="pl-sec" className={inputCls} value={f.orgaoCodigo ?? ''} onChange={(e) => set('orgaoCodigo', e.target.value || null)}>
            <option value="">Todas</option>
            {secretarias.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {s.codigo} — {s.descricao}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Setores envolvidos" htmlFor="pl-setores">
          <Input id="pl-setores" value={f.setores ?? ''} onChange={(e) => set('setores', e.target.value)} />
        </Field>
        <Field label="Volume (caixas)" htmlFor="pl-cx">
          <Input id="pl-cx" type="number" min={0} value={f.volumeCaixas ?? ''} onChange={(e) => set('volumeCaixas', num(e.target.value))} />
        </Field>
        <Field label="Volume (páginas)" htmlFor="pl-pg">
          <Input id="pl-pg" type="number" min={0} value={f.volumePaginas ?? ''} onChange={(e) => set('volumePaginas', num(e.target.value))} />
        </Field>
        <Field label="Início" htmlFor="pl-ini">
          <Input id="pl-ini" type="date" value={f.inicio ?? ''} onChange={(e) => set('inicio', e.target.value || null)} />
        </Field>
        <Field label="Término" htmlFor="pl-fim">
          <Input id="pl-fim" type="date" value={f.fim ?? ''} onChange={(e) => set('fim', e.target.value || null)} />
        </Field>
        <Field label="Diagnóstico do acervo" htmlFor="pl-diag" className="sm:col-span-2">
          <Textarea id="pl-diag" rows={3} value={f.diagnostico ?? ''} onChange={(e) => set('diagnostico', e.target.value)} placeholder="Situação encontrada, estado de conservação, riscos" />
        </Field>
        <Field label="Metas e cronograma" htmlFor="pl-metas" className="sm:col-span-2">
          <Textarea id="pl-metas" rows={3} value={f.metas ?? ''} onChange={(e) => set('metas', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Producao({ slug }: { slug: string }) {
  const toast = useToast();
  const secretarias = useSecretarias(slug);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [orgao, setOrgao] = useState('');
  const [baixando, setBaixando] = useState<string | null>(null);
  const qs = new URLSearchParams({ ...(de ? { de } : {}), ...(ate ? { ate } : {}), ...(orgao ? { orgaoCodigo: orgao } : {}) });
  const { data, isLoading } = useQuery({
    queryKey: ['digit', 'producao', slug, qs.toString()],
    queryFn: () => api<ProducaoResumo>(`/t/${slug}/digitalizacao/producao?${qs}`),
  });
  const baixar = async (formato: 'pdf' | 'csv') => {
    setBaixando(formato);
    const aba = formato === 'pdf' ? window.open('', '_blank') : null;
    try {
      const url = await apiBlobUrl(`/t/${slug}/digitalizacao/producao/${formato}?${qs}`);
      if (aba) aba.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'producao-digitalizacao.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      aba?.close();
      toast.error(e instanceof ApiError && e.status === 403 ? 'Você não tem permissão para exportar (Digitalização: exportar).' : 'Não foi possível gerar.');
    } finally {
      setBaixando(null);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="De" htmlFor="pr-de">
          <Input id="pr-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="pr-ate">
          <Input id="pr-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </Field>
        <Field label="Secretaria" htmlFor="pr-sec">
          <SelectMenu id="pr-sec" className={inputCls} value={orgao} onChange={(e) => setOrgao(e.target.value)}>
            <option value="">Todas</option>
            {secretarias.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {s.codigo} — {s.descricao}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <div className="flex items-end gap-2 lg:col-span-2 lg:justify-end">
          <Button variant="outline" leftIcon={<FileSpreadsheet aria-hidden />} loading={baixando === 'csv'} onClick={() => void baixar('csv')}>
            CSV
          </Button>
          <Button leftIcon={<Download aria-hidden />} loading={baixando === 'pdf'} onClick={() => void baixar('pdf')}>
            Relatório PDF
          </Button>
        </div>
      </div>
      {isLoading || !data ? (
        <SkeletonTable rows={5} columns={5} label="Carregando produção" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Lotes" value={data.totais.lotes} icon={Layers} tone="neutral" />
            <StatCard label="Páginas digitalizadas" value={data.totais.paginasDigitalizadas.toLocaleString('pt-BR')} icon={ScanLine} tone="brand" />
            <StatCard label="Páginas aceitas (medição)" value={data.totais.paginasAceitas.toLocaleString('pt-BR')} icon={CheckCircle2} tone="success" />
            <StatCard label="Não conformidades" value={data.totais.naoConformidades} icon={ClipboardList} tone="warning" />
          </div>
          {data.linhas.length === 0 ? (
            <EmptyState icon={BarChart3} title="Sem produção no período" description="Ajuste o período ou a secretaria." />
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                  <tr>
                    <th className="px-4 py-2 label-caps">Lote</th>
                    <th className="px-4 py-2 label-caps">Secretaria</th>
                    <th className="px-4 py-2 label-caps">Etapa</th>
                    <th className="px-4 py-2 text-right label-caps">Digitalizadas</th>
                    <th className="px-4 py-2 text-right label-caps">Aceitas</th>
                    <th className="px-4 py-2 text-right label-caps">NCs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {data.linhas.map((l) => (
                    <tr key={l.loteId}>
                      <td className="px-4 py-2">
                        <Link href={`/${slug}/digitalizacao/${l.loteId}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                          {l.protocolo}
                        </Link>
                        <p className="text-xs text-ink-500">{l.descricao}</p>
                      </td>
                      <td className="px-4 py-2 text-ink-700">{l.orgaoNome ?? l.orgaoCodigo ?? '—'}</td>
                      <td className="px-4 py-2">
                        <Badge tone={ETAPA_TOM[l.etapa]}>{ETAPA_LOTE_LABEL[l.etapa]}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.paginasDigitalizadas.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{l.paginasAceitas.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{l.naoConformidades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
