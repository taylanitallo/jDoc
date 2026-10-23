'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  MessagesSquare,
  Plus,
  Printer,
  Search,
  Timer,
  X,
} from 'lucide-react';
import {
  CANAIS_ATENDIMENTO,
  CANAL_LABEL,
  FORMAS_ACESSO,
  FORMA_ACESSO_LABEL,
  LAI_ALERTA_DIAS,
  VINCULOS_SOLICITANTE,
  TIPOS_ATENDIMENTO,
  TIPO_ATENDIMENTO_LABEL,
  DIREITOS_LGPD,
  DIREITO_LGPD_LABEL,
  VINCULO_LABEL,
  type AtendimentoCreateInput,
  type AtendimentoResumo,
  type AtendimentosPage,
  type AtendimentoView,
  type DocumentPage,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Pagination,
  SelectMenu,
  StatCard,
  Tabs,
  Textarea,
  TONE_VIVID,
  inputCls,
  type Tone,
} from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import { fmtDate } from '@/lib/format';

type Situacao = 'abertos' | 'atrasados' | 'concluidos' | 'todos';
const dataBr = (iso: string | null) => fmtDate(iso, '—');
const STATUS: Record<AtendimentoView['status'], { label: string; tone: Tone }> = {
  aberto: { label: 'Em andamento', tone: 'info' },
  atendido: { label: 'Atendido', tone: 'success' },
  indeferido: { label: 'Indeferido', tone: 'danger' },
  cancelado: { label: 'Cancelado', tone: 'neutral' },
};

/** Selo do prazo: verde folgado, amarelo vencendo, vermelho atrasado. */
function Prazo({ a }: { a: AtendimentoView }) {
  if (a.diasRestantes === null) return <span className="text-xs text-ink-500">Concluído em {dataBr(a.concluidoEm)}</span>;
  const d = a.diasRestantes;
  const tone: Tone = d < 0 ? 'danger' : d <= LAI_ALERTA_DIAS ? 'warning' : 'success';
  return (
    <Badge tone={tone}>
      {d < 0 ? `${Math.abs(d)} dia(s) de atraso` : d === 0 ? 'Vence hoje' : `${d} dia(s) restante(s)`}
    </Badge>
  );
}

export default function AtendimentoPage() {
  const { slug } = useParams<{ slug: string }>();
  const [situacao, setSituacao] = useState<Situacao>('abertos');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(busca.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  const { data: resumo } = useQuery<AtendimentoResumo>({
    queryKey: ['atendimentos', 'resumo', slug],
    queryFn: () => api(`/t/${slug}/atendimentos/resumo`),
  });
  const { data, isLoading, error } = useQuery<AtendimentosPage>({
    queryKey: ['atendimentos', 'lista', slug, situacao, q, page],
    queryFn: () => api(`/t/${slug}/atendimentos?situacao=${situacao}&page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (p) => p,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.pink.chip)}>
            <MessagesSquare className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Atendimento e consultas</h1>
            <p className="mt-0.5 text-sm text-ink-500">Pedidos de acesso ao acervo, com o prazo da Lei de Acesso à Informação (20 dias, prorrogáveis por 10).</p>
          </div>
        </div>
        <Button onClick={() => setNovo(true)} leftIcon={<Plus aria-hidden />}>
          Novo atendimento
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Em andamento" value={resumo?.abertos ?? 0} icon={Clock} tone="info" loading={!resumo} />
        <StatCard label={`Vencendo (${LAI_ALERTA_DIAS} dias)`} value={resumo?.vencendo ?? 0} icon={Timer} tone={(resumo?.vencendo ?? 0) > 0 ? 'warning' : 'neutral'} loading={!resumo} />
        <StatCard label="Atrasados" value={resumo?.atrasados ?? 0} icon={AlarmClock} tone={(resumo?.atrasados ?? 0) > 0 ? 'danger' : 'neutral'} loading={!resumo} hint={(resumo?.atrasados ?? 0) > 0 ? 'Fora do prazo da LAI' : 'Nenhum fora do prazo'} />
        <StatCard
          label="Concluídos no mês"
          value={resumo?.concluidosNoMes ?? 0}
          icon={CheckCircle2}
          tone="success"
          loading={!resumo}
          hint={resumo?.mediaDiasResposta != null ? `Média de ${resumo.mediaDiasResposta.toLocaleString('pt-BR')} dias para responder` : undefined}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={situacao}
            onChange={(s) => {
              setSituacao(s);
              setPage(1);
            }}
            items={[
              { id: 'abertos', label: 'Em andamento', count: resumo?.abertos },
              { id: 'atrasados', label: 'Atrasados', count: resumo?.atrasados },
              { id: 'concluidos', label: 'Concluídos' },
              { id: 'todos', label: 'Todos' },
            ]}
          />
          <div className="relative lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input type="search" aria-label="Buscar atendimento" placeholder="Solicitante, finalidade ou nº" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        {error ? (
          <div className="p-5">
            <EmptyState icon={Lock} title="Sem acesso" description={error instanceof ApiError ? error.message : 'Falha ao carregar'} />
          </div>
        ) : isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((k) => (
              <div key={k} className="h-14 animate-pulse rounded-[10px] bg-ink-100" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={MessagesSquare}
              title={situacao === 'atrasados' ? 'Nenhum pedido atrasado' : 'Nenhum atendimento'}
              description={q ? 'Nada encontrado com essa busca.' : 'Registre cada pedido de consulta ou cópia para acompanhar o prazo e ter o histórico de quem acessou cada documento.'}
            />
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setAberto(a.id)} className="flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors hover:bg-brand-50/40 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-ink-500">{a.protocolo}</span>
                      <span className="font-semibold text-ink-900">{a.solicitanteNome}</span>
                      {a.tipo === 'lgpd' && <Badge tone="violet">LGPD</Badge>}
                      <Badge tone="neutral">{VINCULO_LABEL[a.vinculo]}</Badge>
                      {a.documentos.some((d) => d.restrito) && <Badge tone="danger">Restrito</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-600">{a.finalidade}</p>
                    <p className="text-xs text-ink-400">
                      {dataBr(a.dataPedido)} · {CANAL_LABEL[a.canal]} · {FORMA_ACESSO_LABEL[a.formaAcesso]} · {a.documentos.length + (a.documentosNaoCadastrados ? 1 : 0)} item(ns)
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Prazo a={a} />
                    <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 0 && (
          <div className="border-t border-ink-100 px-5 py-3">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </div>
        )}
      </Card>

      {novo && <NovoAtendimento slug={String(slug)} onClose={() => setNovo(false)} onCriado={(id) => { setNovo(false); setAberto(id); }} />}
      {aberto && <DetalheAtendimento slug={String(slug)} id={aberto} onClose={() => setAberto(null)} />}
    </div>
  );
}

function NovoAtendimento({ slug, onClose, onCriado }: { slug: string; onClose: () => void; onCriado: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Omit<AtendimentoCreateInput, 'documentIds' | 'dataPedido'> & { dataPedido: string }>({
    tipo: 'lai',
    solicitanteNome: '',
    solicitanteDocumento: '',
    solicitanteContato: '',
    vinculo: 'cidadao',
    setorOrgao: '',
    canal: 'presencial',
    finalidade: '',
    formaAcesso: 'consulta_local',
    documentosNaoCadastrados: '',
    justificativaRestrito: '',
    dataPedido: '',
  });
  const [docs, setDocs] = useState<Array<{ id: string; titulo: string; restrito: boolean }>>([]);
  const [termo, setTermo] = useState('');
  const [termoDeb, setTermoDeb] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTermoDeb(termo.trim()), 350);
    return () => clearTimeout(t);
  }, [termo]);
  const { data: achados, isFetching } = useQuery<DocumentPage>({
    queryKey: ['atendimento', 'busca-doc', slug, termoDeb],
    queryFn: () => api(`/t/${slug}/documents?module=acervo&pageSize=8&q=${encodeURIComponent(termoDeb)}`),
    enabled: termoDeb.length >= 2,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const temRestrito = docs.some((d) => d.restrito);

  const criar = useMutation({
    mutationFn: () =>
      api<AtendimentoView>(`/t/${slug}/atendimentos`, {
        method: 'POST',
        body: {
          ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')),
          documentIds: docs.map((d) => d.id),
          ...(f.dataPedido ? { dataPedido: new Date(`${f.dataPedido}T12:00:00`).toISOString() } : {}),
        },
      }),
    onSuccess: (a) => {
      toast.success(`Atendimento ${a.protocolo} registrado.`);
      qc.invalidateQueries({ queryKey: ['atendimentos'] });
      onCriado(a.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao registrar'),
  });

  return (
    <Modal
      open
      size="lg"
      onClose={() => !criar.isPending && onClose()}
      title="Novo atendimento"
      subtitle={
        f.tipo === 'lgpd'
          ? 'Pedido do titular de dados: a LGPD dá 15 dias para a resposta completa'
          : 'Registre o pedido: o prazo de 20 dias começa na data do pedido'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} loading={criar.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tipo de pedido" htmlFor="at-tipo">
          <SelectMenu id="at-tipo" className={inputCls} value={f.tipo} onChange={(e) => set('tipo', e.target.value as typeof f.tipo)}>
            {TIPOS_ATENDIMENTO.map((t) => (
              <option key={t} value={t}>{TIPO_ATENDIMENTO_LABEL[t]}</option>
            ))}
          </SelectMenu>
        </Field>
        {f.tipo === 'lgpd' ? (
          <Field label="Direito exercido" htmlFor="at-direito" required>
            <SelectMenu id="at-direito" className={inputCls} value={f.direitoLgpd ?? ''} onChange={(e) => set('direitoLgpd', (e.target.value || undefined) as typeof f.direitoLgpd)}>
              <option value="">Selecione…</option>
              {DIREITOS_LGPD.map((d) => (
                <option key={d} value={d}>{DIREITO_LGPD_LABEL[d]}</option>
              ))}
            </SelectMenu>
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label={f.tipo === 'lgpd' ? 'Titular dos dados' : 'Solicitante'} htmlFor="at-nome" required className="sm:col-span-2">
          <Input id="at-nome" value={f.solicitanteNome} onChange={(e) => set('solicitanteNome', e.target.value)} placeholder="Nome completo" />
        </Field>
        <Field label="CPF/RG" htmlFor="at-doc">
          <Input id="at-doc" value={f.solicitanteDocumento} onChange={(e) => set('solicitanteDocumento', e.target.value)} />
        </Field>
        <Field label="Contato" htmlFor="at-contato">
          <Input id="at-contato" value={f.solicitanteContato} onChange={(e) => set('solicitanteContato', e.target.value)} placeholder="E-mail ou telefone" />
        </Field>
        <Field label="Vínculo" htmlFor="at-vinculo">
          <SelectMenu id="at-vinculo" className={inputCls} value={f.vinculo} onChange={(e) => set('vinculo', e.target.value as typeof f.vinculo)}>
            {VINCULOS_SOLICITANTE.map((v) => (
              <option key={v} value={v}>{VINCULO_LABEL[v]}</option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Setor / órgão do solicitante" htmlFor="at-setor">
          <Input id="at-setor" value={f.setorOrgao} onChange={(e) => set('setorOrgao', e.target.value)} />
        </Field>
        <Field label="Canal" htmlFor="at-canal">
          <SelectMenu id="at-canal" className={inputCls} value={f.canal} onChange={(e) => set('canal', e.target.value as typeof f.canal)}>
            {CANAIS_ATENDIMENTO.map((c) => (
              <option key={c} value={c}>{CANAL_LABEL[c]}</option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Data do pedido" htmlFor="at-data" hint="Deixe em branco para hoje">
          <Input id="at-data" type="date" value={f.dataPedido} onChange={(e) => set('dataPedido', e.target.value)} />
        </Field>
        <Field label="Finalidade" htmlFor="at-fin" required className="sm:col-span-2">
          <Textarea id="at-fin" rows={2} value={f.finalidade} onChange={(e) => set('finalidade', e.target.value)} placeholder="Ex.: pesquisa acadêmica, comprovação de tempo de serviço, processo judicial…" />
        </Field>
        <Field label="Forma de acesso" htmlFor="at-forma" className="sm:col-span-2">
          <SelectMenu id="at-forma" className={inputCls} value={f.formaAcesso} onChange={(e) => set('formaAcesso', e.target.value as typeof f.formaAcesso)}>
            {FORMAS_ACESSO.map((x) => (
              <option key={x} value={x}>{FORMA_ACESSO_LABEL[x]}</option>
            ))}
          </SelectMenu>
        </Field>

        <div className="space-y-2 sm:col-span-2">
          <p className="text-[13px] font-semibold text-ink-700">Documentos do acervo</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar documento" placeholder="Buscar por título, número, ementa…" className="pl-9" value={termo} onChange={(e) => setTermo(e.target.value)} />
          </div>
          {termoDeb.length >= 2 && (
            <ul className="max-h-48 overflow-y-auto rounded-[10px] border border-ink-200/70">
              {isFetching && <li className="px-3 py-2 text-xs text-ink-500">Buscando…</li>}
              {achados?.items.length === 0 && <li className="px-3 py-2 text-xs text-ink-500">Nenhum documento encontrado.</li>}
              {achados?.items.map((d) => {
                const ja = docs.some((x) => x.id === d.id);
                const titulo = d.descricao || d.originalName;
                return (
                  <li key={d.id} className="flex items-center gap-2 border-b border-ink-100 px-3 py-2 last:border-0">
                    <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{titulo}</span>
                    {d.nivelAcesso === 'restrito' && <Badge tone="danger">Restrito</Badge>}
                    <Button size="sm" variant={ja ? 'secondary' : 'outline'} disabled={ja} onClick={() => setDocs((xs) => [...xs, { id: d.id, titulo, restrito: d.nivelAcesso === 'restrito' }])}>
                      {ja ? 'Incluído' : 'Incluir'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {docs.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {docs.map((d) => (
                <span key={d.id} className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-3 pr-1 text-xs font-medium ring-1 ring-inset', d.restrito ? 'bg-danger-50 text-danger-600 ring-danger-600/20' : 'bg-brand-50 text-brand-600 ring-brand-600/15')}>
                  {d.restrito && <Lock className="h-3 w-3" aria-hidden />}
                  <span className="truncate">{d.titulo}</span>
                  <button type="button" aria-label={`Remover ${d.titulo}`} onClick={() => setDocs((xs) => xs.filter((x) => x.id !== d.id))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/60">
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {temRestrito && (
          <Field label="Justificativa do acesso a documento restrito" htmlFor="at-just" required className="sm:col-span-2" hint="Ex.: pedido do próprio titular, identidade conferida; ordem judicial nº…">
            <Textarea id="at-just" rows={2} value={f.justificativaRestrito} onChange={(e) => set('justificativaRestrito', e.target.value)} />
          </Field>
        )}
        <Field label="Documentos não cadastrados no sistema" htmlFor="at-outros" className="sm:col-span-2" hint="Ex.: caixa 12 de 1978, ainda não digitalizada">
          <Textarea id="at-outros" rows={2} value={f.documentosNaoCadastrados} onChange={(e) => set('documentosNaoCadastrados', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function DetalheAtendimento({ slug, id, onClose }: { slug: string; id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [acao, setAcao] = useState<'concluir' | 'prorrogar' | null>(null);
  const [status, setStatus] = useState<'atendido' | 'indeferido' | 'cancelado'>('atendido');
  const [textoAcao, setTextoAcao] = useState('');
  const [imprimindo, setImprimindo] = useState(false);
  const { data: a } = useQuery<AtendimentoView>({
    queryKey: ['atendimentos', 'item', slug, id],
    queryFn: () => api(`/t/${slug}/atendimentos/${id}`),
  });
  const executar = useMutation({
    mutationFn: () =>
      acao === 'prorrogar'
        ? api<AtendimentoView>(`/t/${slug}/atendimentos/${id}/prorrogar`, { method: 'POST', body: { justificativa: textoAcao.trim() } })
        : api<AtendimentoView>(`/t/${slug}/atendimentos/${id}/concluir`, { method: 'POST', body: { status, resposta: textoAcao.trim() } }),
    onSuccess: () => {
      toast.success(acao === 'prorrogar' ? 'Prazo prorrogado por 10 dias.' : 'Atendimento concluído.');
      setAcao(null);
      setTextoAcao('');
      qc.invalidateQueries({ queryKey: ['atendimentos'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha'),
  });
  const comprovante = async () => {
    setImprimindo(true);
    const aba = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(`/t/${slug}/atendimentos/${id}/comprovante`);
      if (aba) aba.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      aba?.close();
      toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar o comprovante');
    } finally {
      setImprimindo(false);
    }
  };
  const linha = (rotulo: string, valor: string | null | undefined) => (
    <div>
      <dt className="label-caps">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-ink-900">{valor || '—'}</dd>
    </div>
  );

  return (
    <Modal
      open
      size="lg"
      onClose={() => !executar.isPending && onClose()}
      title={a ? `Atendimento ${a.protocolo}` : 'Atendimento'}
      subtitle={a ? `${a.solicitanteNome} · ${STATUS[a.status].label}` : undefined}
      footer={
        a && (
          <div className="flex w-full flex-wrap justify-between gap-2">
            <Button variant="outline" leftIcon={<Printer aria-hidden />} onClick={() => void comprovante()} loading={imprimindo}>
              Comprovante
            </Button>
            {a.status === 'aberto' && !acao && (
              <div className="flex flex-wrap gap-2">
                {!a.prorrogado && a.tipo !== 'lgpd' && (
                  <Button variant="outline" leftIcon={<CalendarClock aria-hidden />} onClick={() => setAcao('prorrogar')}>
                    Prorrogar +10 dias
                  </Button>
                )}
                <Button leftIcon={<CheckCircle2 aria-hidden />} onClick={() => setAcao('concluir')}>
                  Concluir
                </Button>
              </div>
            )}
            {acao && (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setAcao(null)}>
                  Voltar
                </Button>
                <Button variant={acao === 'concluir' && status === 'indeferido' ? 'danger' : 'primary'} onClick={() => executar.mutate()} loading={executar.isPending}>
                  {acao === 'prorrogar' ? 'Confirmar prorrogação' : status === 'atendido' ? 'Marcar como atendido' : status === 'indeferido' ? 'Indeferir' : 'Cancelar pedido'}
                </Button>
              </div>
            )}
          </div>
        )
      }
    >
      {!a ? (
        <div className="h-40 animate-pulse rounded-[12px] bg-ink-100" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
            <Prazo a={a} />
            {a.prorrogado && <Badge tone="warning">Prorrogado</Badge>}
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {linha('Vínculo', VINCULO_LABEL[a.vinculo])}
            {linha('CPF/RG', a.solicitanteDocumento)}
            {linha('Contato', a.solicitanteContato)}
            {linha('Setor / órgão', a.setorOrgao)}
            {linha('Canal', CANAL_LABEL[a.canal])}
            {linha('Forma de acesso', FORMA_ACESSO_LABEL[a.formaAcesso])}
            {linha('Data do pedido', dataBr(a.dataPedido))}
            {linha('Prazo final', dataBr(a.prazoFinal))}
            {linha('Registrado por', a.registradoPor)}
          </dl>
          <div>
            <p className="label-caps">Finalidade</p>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-800">{a.finalidade}</p>
          </div>
          <div>
            <p className="label-caps">Documentos</p>
            <ul className="mt-1 space-y-1">
              {a.documentos.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm text-ink-800">
                  {d.restrito ? <Lock className="h-4 w-4 text-danger-600" aria-hidden /> : <FileText className="h-4 w-4 text-ink-400" aria-hidden />}
                  {d.identificacao}
                </li>
              ))}
              {a.documentosNaoCadastrados && <li className="text-sm text-ink-600">Fora do sistema: {a.documentosNaoCadastrados}</li>}
            </ul>
            {a.justificativaRestrito && <p className="mt-2 rounded-[8px] bg-danger-50 px-3 py-2 text-xs text-danger-600">Autorização de acesso restrito: {a.justificativaRestrito}</p>}
          </div>
          {a.justificativaProrrogacao && (
            <p className="rounded-[8px] bg-warning-50 px-3 py-2 text-xs text-warning-600">Prorrogação: {a.justificativaProrrogacao}</p>
          )}
          {a.resposta && (
            <div className={cn('rounded-[12px] px-4 py-3', a.status === 'indeferido' ? 'bg-danger-50' : 'bg-success-50')}>
              <p className="label-caps">{a.status === 'indeferido' ? 'Fundamentação' : 'Resposta'}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-800">{a.resposta}</p>
              <p className="mt-1 text-xs text-ink-500">
                {a.concluidoPor} · {dataBr(a.concluidoEm)}
              </p>
            </div>
          )}
          {acao && (
            <div className="space-y-3 rounded-[12px] border border-ink-200/70 p-4">
              {acao === 'concluir' && (
                <Tabs
                  value={status}
                  onChange={setStatus}
                  items={[
                    { id: 'atendido', label: 'Atendido' },
                    { id: 'indeferido', label: 'Indeferido' },
                    { id: 'cancelado', label: 'Cancelado' },
                  ]}
                />
              )}
              <Field
                label={acao === 'prorrogar' ? 'Justificativa da prorrogação' : status === 'indeferido' ? 'Fundamentação legal do indeferimento' : status === 'cancelado' ? 'Motivo do cancelamento' : 'O que foi entregue'}
                htmlFor="at-acao"
                required
                hint={status === 'indeferido' && acao === 'concluir' ? 'A LAI exige fundamentação e o solicitante pode recorrer em 10 dias.' : undefined}
              >
                <Textarea id="at-acao" rows={3} value={textoAcao} onChange={(e) => setTextoAcao(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
