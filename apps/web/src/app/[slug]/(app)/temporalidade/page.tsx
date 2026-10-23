'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowRightLeft, FileText, Landmark, Tags, Trash2 } from 'lucide-react';
import type { TemporalidadeItem, TemporalidadeLista, TemporalidadeResumo } from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Modal, btnGhost, btnPrimary, cardClasses, cardCls, inputCls, labelCls, PageHeader, TONE_SOFT, type Tone, Pagination } from '@/components/ui';
import { cn } from '@/lib/cn';
import { TabButton } from '@/components/tab-button';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { Eliminacoes, incluirNaListagem } from './eliminacoes';
import { fmtDate } from '@/lib/format';

const LISTAS: { id: TemporalidadeLista; label: string; ajuda: string }[] = [
  {
    id: 'a_transferir',
    label: 'A transferir',
    ajuda: 'Prazo no arquivo corrente venceu: transfira para o arquivo intermediário (gera Guia de Transferência).',
  },
  {
    id: 'a_recolher',
    label: 'A recolher',
    ajuda: 'Prazo total venceu e a destinação é guarda permanente: recolha ao arquivo permanente (gera Guia de Recolhimento).',
  },
  {
    id: 'a_eliminar',
    label: 'A eliminar',
    ajuda: 'Prazo total venceu e a destinação é eliminação. Selecione e inclua numa listagem: a eliminação só acontece pelo fluxo legal (listagem, CPAD, edital e termo), mais abaixo.',
  },
  {
    id: 'sem_classificacao',
    label: 'Sem classificação',
    ajuda: 'Documentos sem classe no Plano de Classificação — sem classe não há controle de prazo.',
  },
];

const MODULO_LABELS: Record<string, string> = {
  receitas: 'Receitas',
  despesas: 'Despesas',
  balancete: 'Balancete',
  extrato: 'Extrato',
  outros: 'Outros',
  acervo: 'Acervo',
};

const fmtData = (iso: string | null): string => fmtDate(iso, '—');

async function abrirPdf(path: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const url = await apiBlobUrl(path);
    if (win) win.location.href = url;
    else window.open(url, '_blank');
  } catch (e) {
    win?.close();
    throw e;
  }
}

export default function TemporalidadePage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [lista, setLista] = useState<TemporalidadeLista>('a_transferir');
  const [page, setPage] = useState(1);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [movendo, setMovendo] = useState<'transferir' | 'recolher' | null>(null);
  const pageSize = 50;

  const { data: resumo } = useQuery<TemporalidadeResumo>({
    queryKey: ['arquivistica', 'resumo'],
    queryFn: () => api(`/t/${slug}/arquivistica/temporalidade/resumo`),
  });
  const { data, isLoading } = useQuery<{ items: TemporalidadeItem[]; total: number }>({
    queryKey: ['arquivistica', 'lista', lista, page],
    queryFn: () => api(`/t/${slug}/arquivistica/temporalidade?lista=${lista}&page=${page}&pageSize=${pageSize}`),
  });
  const { data: guias } = useQuery<Array<{ id: string; numero: number; ano: number; tipo: string; total: number; criadoEm: string; criadoPor: string | null }>>({
    queryKey: ['arquivistica', 'guias'],
    queryFn: () => api(`/t/${slug}/arquivistica/guias`),
  });

  const invalidate = () => {
    setSelecionados(new Set());
    qc.invalidateQueries({ queryKey: ['arquivistica'] });
  };

  const aplicarPadrao = useMutation({
    mutationFn: () => api<{ atualizados: number }>(`/t/${slug}/arquivistica/temporalidade/aplicar-padrao`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`${r.atualizados} documento(s) classificados pela classe padrão do módulo.`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao aplicar classe padrão'),
  });

  const trocarLista = (l: TemporalidadeLista) => {
    setLista(l);
    setPage(1);
    setSelecionados(new Set());
  };

  const toggle = (id: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const itens = data?.items ?? [];
  const todosMarcados = itens.length > 0 && itens.every((i) => selecionados.has(i.id));
  const selecionavel = lista === 'a_transferir' || lista === 'a_recolher' || lista === 'a_eliminar';
  const ajuda = LISTAS.find((l) => l.id === lista)?.ajuda;

  const cards = [
    { id: 'a_transferir' as const, label: 'A transferir', valor: resumo?.aTransferir, tone: 'info' as Tone, icon: ArrowRightLeft },
    { id: 'a_recolher' as const, label: 'A recolher (permanente)', valor: resumo?.aRecolher, tone: 'success' as Tone, icon: Landmark },
    { id: 'a_eliminar' as const, label: 'A eliminar', valor: resumo?.aEliminar, tone: 'orange' as Tone, icon: Trash2 },
    { id: 'sem_classificacao' as const, label: 'Sem classificação', valor: resumo?.semClassificacao, tone: 'warning' as Tone, icon: Tags },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Temporalidade"
        description={<>Controle dos prazos de guarda do acervo — {resumo?.totalAtivos ?? '…'} documentos ativos.</>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={lista === c.id}
            onClick={() => trocarLista(c.id)}
            className={cn(
              cardClasses,
              'p-5 text-left transition hover:border-ink-300 hover:shadow-sm',
              lista === c.id && 'border-brand-500 ring-2 ring-brand-500/20',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="label-caps">{c.label}</p>
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]', TONE_SOFT[c.tone])}>
                <c.icon className="h-5 w-5" aria-hidden />
              </span>
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight text-ink-900 tabular-nums">{c.valor ?? '…'}</p>
          </button>
        ))}
      </div>

      <div className={`${cardCls} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 pb-3">
          <div className="flex flex-wrap gap-2">
            {LISTAS.map((l) => (
              <TabButton key={l.id} active={lista === l.id} onClick={() => trocarLista(l.id)}>
                {l.label}
              </TabButton>
            ))}
          </div>
          <div className="flex gap-2">
            {lista === 'a_transferir' && (
              <button type="button" className={btnPrimary} disabled={selecionados.size === 0} onClick={() => setMovendo('transferir')}>
                Transferir selecionados ({selecionados.size})
              </button>
            )}
            {lista === 'a_eliminar' && (
              <button
                type="button"
                className={btnPrimary}
                disabled={selecionados.size === 0}
                onClick={() =>
                  incluirNaListagem(String(slug), [...selecionados])
                    .then((e) => {
                      toast.success(`${selecionados.size} documento(s) incluídos na listagem nº ${String(e.numero).padStart(3, '0')}/${e.ano}.`);
                      invalidate();
                    })
                    .catch((err) => toast.error(err instanceof ApiError ? err.message : 'Falha ao incluir na listagem'))
                }
              >
                Incluir em listagem ({selecionados.size})
              </button>
            )}
            {lista === 'a_recolher' && (
              <button type="button" className={btnPrimary} disabled={selecionados.size === 0} onClick={() => setMovendo('recolher')}>
                Recolher selecionados ({selecionados.size})
              </button>
            )}
            {lista === 'sem_classificacao' && (
              <button type="button" className={btnPrimary} disabled={aplicarPadrao.isPending || !data?.total} onClick={() => aplicarPadrao.mutate()}>
                {aplicarPadrao.isPending ? 'Aplicando…' : 'Aplicar classe padrão dos módulos'}
              </button>
            )}
          </div>
        </div>
        {ajuda && <p className="mt-3 text-xs text-ink-500">{ajuda}</p>}

        {isLoading ? (
          <p className="py-6 text-sm text-ink-500">Carregando...</p>
        ) : itens.length === 0 ? (
          <EmptyState icon={Archive} title="Nada nesta lista" description="Nenhum documento nesta situação hoje." />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60">
                <tr className="border-b border-ink-200 text-left label-caps">
                  {selecionavel && (
                    <th className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos da página"
                        checked={todosMarcados}
                        onChange={() => setSelecionados(todosMarcados ? new Set() : new Set(itens.map((i) => i.id)))}
                      />
                    </th>
                  )}
                  <th className="px-2 py-2">Classe</th>
                  <th className="px-2 py-2">Documento</th>
                  <th className="px-2 py-2">Módulo</th>
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Fase</th>
                  <th className="px-2 py-2">Transferência</th>
                  <th className="px-2 py-2">Destinação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.id} className="border-b border-ink-200 last:border-0">
                    {selecionavel && (
                      <td className="px-2 py-2">
                        <input type="checkbox" aria-label={`Selecionar ${i.descricao}`} checked={selecionados.has(i.id)} onChange={() => toggle(i.id)} />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-ink-800" title={i.classificacaoDescricao ?? ''}>
                      {i.classificacaoCodigo ?? '—'}
                    </td>
                    <td className="max-w-md truncate px-2 py-2 text-ink-800" title={i.descricao}>{i.descricao}</td>
                    <td className="px-2 py-2 text-xs text-ink-500">{MODULO_LABELS[i.module] ?? i.module}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-500">{fmtData(i.documentDate) !== '—' ? fmtData(i.documentDate) : i.exercicio}</td>
                    <td className="px-2 py-2 text-xs capitalize text-ink-500">{i.fase}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-500">{fmtData(i.dataPrevistaTransferencia)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-500">{fmtData(i.dataPrevistaDestinacao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} className="mt-3" />
          </div>
        )}
      </div>

      <Eliminacoes slug={String(slug)} />

      <div className={`${cardCls} p-4`}>
        <h2 className="mb-3 text-sm font-bold text-ink-800">Guias emitidas</h2>
        {!guias || guias.length === 0 ? (
          <p className="text-xs text-ink-500">Nenhuma guia emitida ainda.</p>
        ) : (
          <ul className="divide-y divide-ink-200">
            {guias.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink-800">
                  {g.tipo === 'transferencia' ? 'Guia de Transferência' : 'Guia de Recolhimento'} nº{' '}
                  {String(g.numero).padStart(3, '0')}/{g.ano}
                  <span className="ml-2 text-xs text-ink-500">
                    {g.total} doc(s) · {fmtDate(g.criadoEm)} · {g.criadoPor ?? '—'}
                  </span>
                </span>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                  onClick={() => abrirPdf(`/t/${slug}/arquivistica/guias/${g.id}/pdf`).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir guia'))}
                >
                  <FileText className="h-4 w-4" aria-hidden /> PDF
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {movendo && (
        <MovimentarModal
          slug={String(slug)}
          tipo={movendo}
          ids={[...selecionados]}
          onClose={() => setMovendo(null)}
          onDone={(guiaId) => {
            invalidate();
            abrirPdf(`/t/${slug}/arquivistica/guias/${guiaId}/pdf`).catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

function MovimentarModal({
  slug,
  tipo,
  ids,
  onClose,
  onDone,
}: {
  slug: string;
  tipo: 'transferir' | 'recolher';
  ids: string[];
  onClose: () => void;
  onDone: (guiaId: string) => void;
}) {
  const toast = useToast();
  const [observacoes, setObservacoes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mover = useMutation({
    mutationFn: () =>
      api<{ guiaId: string; numero: number; ano: number; total: number }>(`/t/${slug}/arquivistica/temporalidade/${tipo}`, {
        method: 'POST',
        body: { ids, observacoes: observacoes.trim() || null },
      }),
    onSuccess: (r) => {
      toast.success(`Guia nº ${String(r.numero).padStart(3, '0')}/${r.ano} emitida com ${r.total} documento(s).`);
      onDone(r.guiaId);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Falha ao emitir guia'),
  });
  const titulo = tipo === 'transferir' ? 'Transferir para o arquivo intermediário' : 'Recolher ao arquivo permanente';

  return (
    <Modal title={titulo} subtitle={`${ids.length} documento(s) selecionado(s)`} open onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-800">
          Será emitida uma {tipo === 'transferir' ? 'Guia de Transferência' : 'Guia de Recolhimento'} numerada. Após a
          movimentação, os documentos não podem mais ser excluídos pela lixeira.
        </p>
        <div>
          <label className={labelCls} htmlFor="mov-obs">Observações</label>
          <textarea id="mov-obs" rows={3} className={inputCls} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="ex.: Caixas 12 a 15 entregues ao Arquivo Municipal" />
        </div>
        {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="button" className={btnPrimary} disabled={mover.isPending} onClick={() => mover.mutate()}>
            {mover.isPending ? 'Emitindo…' : 'Confirmar e emitir guia'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
