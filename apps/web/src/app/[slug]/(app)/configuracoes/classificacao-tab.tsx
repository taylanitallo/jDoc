'use client';

import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Download, Flame, FolderTree, Landmark, Pencil, Plus, Search, Trash2, Upload, Wand2 } from 'lucide-react';
import {
  EVENTOS_CONTAGEM,
  classeTemTemporalidade,
  type ClassificacaoPadraoPorModulo,
  type ClassificacaoView,
  type Destinacao,
  type EventoContagem,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Badge, Button, Card, Input, Modal, StatCard, btnGhost, btnPrimary, cardCls, inputCls, labelCls, SelectMenu } from '@/components/ui';
import { useModulo } from '@/components/branding';
import { useModuloAtivo } from '@/components/modulo-ativo';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';

export const EVENTO_LABELS: Record<EventoContagem, string> = {
  data_documento: 'Data do documento',
  fim_exercicio: 'Fim do exercício',
  manual: 'Evento informado (ex.: fim do contrato)',
};

const MODULOS_PADRAO = [
  { id: 'receitas', label: 'Receitas' },
  { id: 'despesas', label: 'Despesas' },
  { id: 'balancete', label: 'Balancete' },
  { id: 'extrato', label: 'Extrato de Contas' },
  { id: 'outros', label: 'Outros Arquivos' },
] as const;

export function prazoLabel(c: Pick<ClassificacaoView, 'prazoCorrenteAnos' | 'prazoIntermediarioAnos'>): string {
  if (c.prazoCorrenteAnos === null || c.prazoIntermediarioAnos === null) return '—';
  return `${c.prazoCorrenteAnos}a corrente + ${c.prazoIntermediarioAnos}a intermediário`;
}

export function DestinacaoBadge({ destinacao }: { destinacao: Destinacao | null }) {
  if (destinacao === 'guarda_permanente') return <Badge tone="violet">Guarda permanente</Badge>;
  if (destinacao === 'eliminacao') return <Badge tone="orange">Eliminação</Badge>;
  return <Badge tone="neutral">Agrupadora</Badge>;
}

/** Linha do tempo da guarda: corrente (azul) + intermediaria (amarelo), proporcional aos anos. */
function PrazoBarra({ c, maxAnos }: { c: ClassificacaoView; maxAnos: number }) {
  if (c.prazoCorrenteAnos === null || c.prazoIntermediarioAnos === null) return <span className="text-xs text-ink-400">—</span>;
  const total = c.prazoCorrenteAnos + c.prazoIntermediarioAnos;
  const escala = (anos: number) => `${(anos / Math.max(1, maxAnos)) * 100}%`;
  return (
    <div className="min-w-[150px]">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-100" title={prazoLabel(c)}>
        <span className="bg-info-500" style={{ width: escala(c.prazoCorrenteAnos) }} />
        <span className="bg-warning-500" style={{ width: escala(c.prazoIntermediarioAnos) }} />
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-ink-500">
        <strong className="text-ink-800">{c.prazoCorrenteAnos}</strong> corrente + <strong className="text-ink-800">{c.prazoIntermediarioAnos}</strong> intermediário ={' '}
        {total} {total === 1 ? 'ano' : 'anos'}
      </p>
    </div>
  );
}

export function ClassificacaoTab() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<ClassificacaoView | 'new' | null>(null);

  const { ativo: moduloAtivo } = useModuloAtivo();
  const temFinanceiro = useModulo('financeiro');
  const [busca, setBusca] = useState('');
  const { data: classes, isLoading } = useQuery<ClassificacaoView[]>({
    queryKey: ['arquivistica', 'classificacoes'],
    queryFn: () => api(`/t/${slug}/arquivistica/classificacoes`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['arquivistica'] });

  const carregarModelo = useMutation({
    mutationFn: () => api<{ criadas: number }>(`/t/${slug}/arquivistica/classificacoes/modelo`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`Modelo carregado: ${r.criadas} classes. Revise os prazos com a comissão de avaliação.`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao carregar o modelo'),
  });

  const remover = useMutation({
    mutationFn: (id: string) => api<{ inativada: boolean }>(`/t/${slug}/arquivistica/classificacoes/${id}`, { method: 'DELETE' }),
    onSuccess: (r) => {
      toast.success(r.inativada ? 'Classe em uso: foi inativada (histórico preservado).' : 'Classe excluída.');
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao excluir'),
  });

  const importar = useMutation({
    mutationFn: (conteudo: string) =>
      api<{ criadas: number; atualizadas: number }>(`/t/${slug}/arquivistica/classificacoes/csv`, {
        method: 'POST',
        body: { conteudo },
      }),
    onSuccess: (r) => {
      toast.success(`Importação concluída: ${r.criadas} criadas, ${r.atualizadas} atualizadas.`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao importar CSV'),
  });

  const exportar = async () => {
    try {
      const url = await apiBlobUrl(`/t/${slug}/arquivistica/classificacoes/csv`);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plano-classificacao.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao exportar');
    }
  };

  const maxAnos = Math.max(1, ...(classes ?? []).map((c) => (c.prazoCorrenteAnos ?? 0) + (c.prazoIntermediarioAnos ?? 0)));
  const termo = busca.trim().toLowerCase();
  const visiveis = (classes ?? []).filter((c) => !termo || c.codigo.toLowerCase().includes(termo) || c.descricao.toLowerCase().includes(termo));

  const onArquivo = async (f: File | undefined) => {
    if (!f) return;
    importar.mutate(await f.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold tracking-tight text-ink-900">Plano de Classificação e Tabela de Temporalidade</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            Classe de cada documento, quanto tempo fica em cada fase e se será eliminado ou guardado para sempre (CONARQ).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" leftIcon={<Download aria-hidden />} onClick={exportar} disabled={!classes?.length}>
            Exportar CSV
          </Button>
          <Button variant="outline" leftIcon={<Upload aria-hidden />} onClick={() => fileRef.current?.click()} loading={importar.isPending}>
            Importar CSV
          </Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onArquivo(e.target.files?.[0])} />
          <Button leftIcon={<Plus aria-hidden />} onClick={() => setEditing('new')}>
            Nova classe
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-500">Carregando...</p>
      ) : !classes || classes.length === 0 ? (
        <div className={`${cardCls} p-6`}>
          <EmptyState
            icon={FolderTree}
            title="Nenhuma classe cadastrada"
            description="Comece pelo modelo base (estrutura CONARQ + financeiro + atos normativos) e ajuste com a comissão de avaliação de documentos do órgão."
          />
          <div className="mt-4 flex justify-center">
            <button type="button" className={btnPrimary} onClick={() => carregarModelo.mutate()} disabled={carregarModelo.isPending}>
              <span className="flex items-center gap-2">
                <Wand2 className="h-4 w-4" aria-hidden /> {carregarModelo.isPending ? 'Carregando…' : 'Carregar modelo base'}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label="Classes" value={classes.length} icon={FolderTree} tone="brand" hint={`${classes.filter((c) => !classeTemTemporalidade(c)).length} agrupadoras`} />
            <StatCard label="Com temporalidade" value={classes.filter((c) => classeTemTemporalidade(c)).length} icon={Clock} tone="info" hint="recebem documentos" />
            <StatCard label="Guarda permanente" value={classes.filter((c) => c.destinacao === 'guarda_permanente').length} icon={Landmark} tone="violet" hint="vão para o arquivo permanente" />
            <StatCard label="Eliminação" value={classes.filter((c) => c.destinacao === 'eliminacao').length} icon={Flame} tone="orange" hint="eliminadas após o prazo, com edital" />
          </div>

          {temFinanceiro && moduloAtivo !== 'arquivo' && <PadroesPorModulo slug={String(slug)} classes={classes} />}

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative sm:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
                <Input aria-label="Buscar classe" placeholder="Buscar por código ou descrição" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-ink-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-full bg-info-500" /> Corrente
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-full bg-warning-500" /> Intermediário
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50/60">
                  <tr className="label-caps border-b border-ink-200 text-left">
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-3 py-3">Prazos de guarda</th>
                    <th className="px-3 py-3">Contagem</th>
                    <th className="px-3 py-3">Destinação</th>
                    <th className="px-3 py-3 text-right">Docs</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {visiveis.map((c) => {
                    const grupo = !classeTemTemporalidade(c);
                    return (
                      <tr key={c.id} className={cn('group transition-colors hover:bg-brand-50/30', grupo && 'bg-ink-50/50', !c.ativo && 'opacity-55')}>
                        <td className="py-2.5 pr-3" style={{ paddingLeft: `${1 + (c.nivel - 1) * 1.25}rem` }}>
                          <div className="flex items-start gap-2.5">
                            <span
                              className={cn(
                                'mt-0.5 shrink-0 rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-semibold',
                                grupo ? 'bg-ink-800 text-white dark:bg-ink-200 dark:text-ink-900' : 'bg-ink-100 text-ink-700',
                              )}
                            >
                              {c.codigo}
                            </span>
                            <div className="min-w-0">
                              <p className={cn('text-ink-900', grupo ? 'font-bold' : 'font-medium')}>
                                {c.descricao}
                                {!c.ativo && <span className="ml-2 text-xs font-normal text-ink-400">(inativa)</span>}
                              </p>
                              {c.observacoes && <p className="text-xs text-ink-500">{c.observacoes}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{grupo ? <span className="text-xs text-ink-400">—</span> : <PrazoBarra c={c} maxAnos={maxAnos} />}</td>
                        <td className="px-3 py-2.5 text-xs text-ink-600">{grupo ? '—' : EVENTO_LABELS[c.eventoContagem]}</td>
                        <td className="px-3 py-2.5">{grupo ? <span className="text-xs text-ink-400">Agrupadora</span> : <DestinacaoBadge destinacao={c.destinacao} />}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-600">{c.totalDocumentos}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <button
                            type="button"
                            aria-label={`Editar classe ${c.codigo}`}
                            onClick={() => setEditing(c)}
                            className="rounded-[8px] p-1.5 text-ink-500 hover:bg-ink-100 hover:text-brand-600"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={`Excluir classe ${c.codigo}`}
                            onClick={() => {
                              if (window.confirm(`Excluir a classe ${c.codigo} — ${c.descricao}? Se estiver em uso, será apenas inativada.`)) {
                                remover.mutate(c.id);
                              }
                            }}
                            className="rounded-[8px] p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
                        Nenhuma classe encontrada para “{busca}”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {editing && (
        <ClassificacaoModal
          slug={String(slug)}
          classe={editing === 'new' ? null : editing}
          classes={classes ?? []}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function PadroesPorModulo({ slug, classes }: { slug: string; classes: ClassificacaoView[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<ClassificacaoPadraoPorModulo>({
    queryKey: ['arquivistica', 'padroes'],
    queryFn: () => api(`/t/${slug}/arquivistica/padroes`),
  });
  const salvar = useMutation({
    mutationFn: (body: ClassificacaoPadraoPorModulo) => api(`/t/${slug}/arquivistica/padroes`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('Classe padrão atualizada.');
      qc.invalidateQueries({ queryKey: ['arquivistica', 'padroes'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao salvar'),
  });
  const utilizaveis = classes.filter((c) => c.ativo && classeTemTemporalidade(c));

  return (
    <div className={`${cardCls} p-5`}>
      <h3 className="text-sm font-bold text-ink-800">Classe padrão dos módulos financeiros</h3>
      <p className="mb-3 text-xs text-ink-500">
        Documentos incluídos nesses módulos recebem a classe automaticamente — o operador não precisa escolher.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {MODULOS_PADRAO.map((m) => (
          <div key={m.id}>
            <label className={labelCls} htmlFor={`padrao-${m.id}`}>{m.label}</label>
            <SelectMenu
              id={`padrao-${m.id}`}
              className={inputCls}
              value={data?.[m.id] ?? ''}
              disabled={salvar.isPending}
              onChange={(e) => salvar.mutate({ ...(data ?? {}), [m.id]: e.target.value || null })}
            >
              <option value="">— Sem classe padrão —</option>
              {utilizaveis.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>
              ))}
            </SelectMenu>
          </div>
        ))}
      </div>
    </div>
  );
}

function ClassificacaoModal({
  slug,
  classe,
  classes,
  onClose,
  onDone,
}: {
  slug: string;
  classe: ClassificacaoView | null;
  classes: ClassificacaoView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [codigo, setCodigo] = useState(classe?.codigo ?? '');
  const [descricao, setDescricao] = useState(classe?.descricao ?? '');
  const [parentId, setParentId] = useState(classe?.parentId ?? '');
  const [agrupadora, setAgrupadora] = useState(classe ? !classeTemTemporalidade(classe) : false);
  const [pc, setPc] = useState(String(classe?.prazoCorrenteAnos ?? 5));
  const [pi, setPi] = useState(String(classe?.prazoIntermediarioAnos ?? 5));
  const [destinacao, setDestinacao] = useState<Destinacao>(classe?.destinacao ?? 'guarda_permanente');
  const [evento, setEvento] = useState<EventoContagem>(classe?.eventoContagem ?? 'data_documento');
  const [observacoes, setObservacoes] = useState(classe?.observacoes ?? '');
  const [ativo, setAtivo] = useState(classe?.ativo ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        codigo: codigo.trim(),
        descricao: descricao.trim(),
        parentId: parentId || null,
        prazoCorrenteAnos: agrupadora ? null : Number(pc),
        prazoIntermediarioAnos: agrupadora ? null : Number(pi),
        destinacao: agrupadora ? null : destinacao,
        eventoContagem: evento,
        observacoes: observacoes.trim() || null,
        ativo,
      };
      return classe
        ? api(`/t/${slug}/arquivistica/classificacoes/${classe.id}`, { method: 'PATCH', body })
        : api(`/t/${slug}/arquivistica/classificacoes`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar classe'),
  });

  const prazosValidos = agrupadora || (/^\d{1,3}$/.test(pc) && /^\d{1,3}$/.test(pi));

  return (
    <Modal
      title={classe ? 'Classe — Edição' : 'Classe — Inclusão'}
      subtitle="Alterar prazos recalcula as datas de todos os documentos desta classe"
      open
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls} htmlFor="cl-codigo">Código<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="cl-codigo" className={inputCls} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ex.: 052.21" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="cl-pai">Classe superior</label>
            <SelectMenu id="cl-pai" className={inputCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— Nenhuma (raiz) —</option>
              {classes
                .filter((c) => c.id !== classe?.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>
                ))}
            </SelectMenu>
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="cl-desc">Descrição<span className="ml-0.5 text-danger-600">*</span></label>
          <input id="cl-desc" className={inputCls} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: Contratos de prestação de serviços" />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" checked={agrupadora} onChange={(e) => setAgrupadora(e.target.checked)} />
          Classe apenas agrupadora (sem temporalidade própria — documentos usam as subclasses)
        </label>

        {!agrupadora && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="cl-pc">Arquivo corrente (anos)<span className="ml-0.5 text-danger-600">*</span></label>
                <input id="cl-pc" type="number" min={0} className={inputCls} value={pc} onChange={(e) => setPc(e.target.value)} />
              </div>
              <div>
                <label className={labelCls} htmlFor="cl-pi">Arquivo intermediário (anos)<span className="ml-0.5 text-danger-600">*</span></label>
                <input id="cl-pi" type="number" min={0} className={inputCls} value={pi} onChange={(e) => setPi(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="cl-dest">Destinação final<span className="ml-0.5 text-danger-600">*</span></label>
                <SelectMenu id="cl-dest" className={inputCls} value={destinacao} onChange={(e) => setDestinacao(e.target.value as Destinacao)}>
                  <option value="guarda_permanente">Guarda permanente</option>
                  <option value="eliminacao">Eliminação</option>
                </SelectMenu>
              </div>
              <div>
                <label className={labelCls} htmlFor="cl-ev">Contagem a partir de<span className="ml-0.5 text-danger-600">*</span></label>
                <SelectMenu id="cl-ev" className={inputCls} value={evento} onChange={(e) => setEvento(e.target.value as EventoContagem)}>
                  {EVENTOS_CONTAGEM.map((ev) => (
                    <option key={ev} value={ev}>{EVENTO_LABELS[ev]}</option>
                  ))}
                </SelectMenu>
              </div>
            </div>
          </>
        )}

        <div>
          <label className={labelCls} htmlFor="cl-obs">Observações</label>
          <textarea id="cl-obs" rows={2} className={inputCls} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="ex.: Eliminar somente após aprovação das contas pelo TCE" />
        </div>

        {classe && (
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativa
          </label>
        )}

        {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => save.mutate()}
            disabled={save.isPending || !codigo.trim() || !descricao.trim() || !prazosValidos}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
