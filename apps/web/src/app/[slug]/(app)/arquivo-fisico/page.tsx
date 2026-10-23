'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Archive, Boxes, Building2, DoorOpen, FileCheck2, Library, Package, FileText, HandHelping, Pencil, PieChart, Plus, Printer, Rows3, Tag, Trash2, Undo2, Warehouse, type LucideIcon } from 'lucide-react';
import {
  TIPOS_LOCAL,
  TIPO_LOCAL_LABEL,
  caminhoLocal,
  podeConter,
  type ArquivoFisicoResumo,
  type ConteudoLocal,
  type EmprestimoView,
  type LocalFisicoView,
  type TipoLocal,
  hojeIso,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls, StatCard, Tabs, TONE_VIVID, type Tone, SelectMenu } from '@/components/ui';
import { Colunas, Rosca, agruparOutros } from '@/components/charts';
import { cn } from '@/lib/cn';
import { TabButton } from '@/components/tab-button';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { fmtDate } from '@/lib/format';

const ICONE_LOCAL: Record<LocalFisicoView['tipo'], LucideIcon> = { predio: Building2, sala: DoorOpen, estante: Library, prateleira: Rows3, caixa: Archive };
const fmtData = (iso: string | null) => fmtDate(iso, '—');

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

/** Ordena a arvore em profundidade (pai antes dos filhos) com o nivel para indentar. */
function arvore(locais: LocalFisicoView[]): Array<LocalFisicoView & { nivel: number }> {
  const filhos = new Map<string | null, LocalFisicoView[]>();
  for (const l of locais) {
    const k = l.parentId && locais.some((x) => x.id === l.parentId) ? l.parentId : null;
    filhos.set(k, [...(filhos.get(k) ?? []), l]);
  }
  const out: Array<LocalFisicoView & { nivel: number }> = [];
  const visitar = (pai: string | null, nivel: number) => {
    for (const l of filhos.get(pai) ?? []) {
      out.push({ ...l, nivel });
      if (nivel < 10) visitar(l.id, nivel + 1);
    }
  };
  visitar(null, 0);
  return out;
}

export default function ArquivoFisicoPage() {
  // useSearchParams exige Suspense no App Router (?local=<id> vem do QR da etiqueta).
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-[16px] bg-ink-100" />}>
      <ArquivoFisico />
    </Suspense>
  );
}

function ArquivoFisico() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [aba, setAba] = useState<'locais' | 'emprestimos'>('locais');
  const [selecionado, setSelecionado] = useState<string | null>(searchParams.get('local'));
  const [editando, setEditando] = useState<{ local: LocalFisicoView | null; parentId: string | null } | null>(null);
  const [emprestando, setEmprestando] = useState<{ documentId?: string; localFisicoId?: string; rotulo: string } | null>(null);

  useEffect(() => {
    const l = searchParams.get('local');
    if (l) {
      setSelecionado(l);
      setAba('locais');
    }
  }, [searchParams]);

  const { data: resumo } = useQuery<ArquivoFisicoResumo>({
    queryKey: ['arquivo-fisico', 'resumo', slug],
    queryFn: () => api(`/t/${slug}/arquivo-fisico/resumo`),
  });
  const { data: locais = [] } = useQuery<LocalFisicoView[]>({
    queryKey: ['arquivo-fisico', 'locais', slug],
    queryFn: () => api(`/t/${slug}/arquivo-fisico/locais`),
  });
  const lista = useMemo(() => arvore(locais), [locais]);
  const local = locais.find((l) => l.id === selecionado) ?? null;
  useEffect(() => {
    if (!selecionado && lista.length > 0) setSelecionado(lista[0]!.id);
  }, [selecionado, lista]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['arquivo-fisico'] });

  const pdf = (path: string) => abrirPdf(path).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar PDF'));

  const cards = [
    { label: 'Caixas', valor: resumo?.caixas, tone: 'brand' as Tone, icon: Package },
    { label: 'Documentos com original', valor: resumo?.documentosComOriginal, tone: 'success' as Tone, icon: FileCheck2 },
    { label: 'Empréstimos abertos', valor: resumo?.emprestimosAbertos, tone: 'info' as Tone, icon: HandHelping },
    {
      label: 'Empréstimos atrasados',
      valor: resumo?.emprestimosAtrasados,
      tone: ((resumo?.emprestimosAtrasados ?? 0) > 0 ? 'danger' : 'neutral') as Tone,
      icon: AlarmClock,
    },
  ];

  // Documentos na subarvore de cada local (a contagem da API e direta).
  const totalSub = useMemo(() => {
    const m = new Map<string, number>();
    const porId = new Map(locais.map((l) => [l.id, l]));
    for (const l of locais) {
      let atual: LocalFisicoView | undefined = l;
      let guarda = 0;
      while (atual && guarda++ < 12) {
        m.set(atual.id, (m.get(atual.id) ?? 0) + l.totalDocumentos);
        atual = atual.parentId ? porId.get(atual.parentId) : undefined;
      }
    }
    return m;
  }, [locais]);
  // Rosca: nivel mais alto com mais de um local (predios; se so ha um predio, as salas dele).
  const distribuicao = useMemo(() => {
    let nivel = lista.filter((l) => l.nivel === 0);
    for (let n = 1; nivel.length === 1 && n < 5; n++) {
      const paiId = nivel[0]!.id;
      const filhos = lista.filter((l) => l.nivel === n && l.parentId === paiId);
      if (filhos.length === 0) break;
      nivel = filhos;
    }
    return agruparOutros(nivel.map((l) => ({ rotulo: `${TIPO_LOCAL_LABEL[l.tipo]} ${l.codigo}`, valor: totalSub.get(l.id) ?? 0 })));
  }, [lista, totalSub]);
  const caixas = locais.filter((l) => l.tipo === 'caixa' && l.ativo);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.orange.chip)}>
            <Warehouse className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Arquivo físico</h1>
            <p className="mt-0.5 text-sm text-ink-500">Onde está o original em papel de cada documento, e quem está com ele.</p>
          </div>
        </div>
        <Button onClick={() => setEditando({ local: null, parentId: null })} leftIcon={<Plus aria-hidden />}>
          Novo local
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} icon={c.icon} tone={c.tone} value={c.valor ?? 0} loading={!resumo} />
        ))}
      </div>

      {(resumo?.documentosComOriginal ?? 0) > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader title="Originais por local" description="Documentos em cada prédio ou sala" icon={PieChart} />
            <CardBody>
              <Rosca fatias={distribuicao} rotuloCentro="documentos" />
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader
              title="Documentos por caixa"
              description={caixas.some((c) => c.capacidade) ? 'Ocupação em relação à capacidade' : 'Quantidade de documentos em cada caixa'}
              icon={Package}
            />
            <CardBody>
              {caixas.length === 0 ? (
                <p className="text-sm text-ink-500">Nenhuma caixa cadastrada.</p>
              ) : caixas.some((c) => c.capacidade) ? (
                <ul className="space-y-3">
                  {caixas.slice(0, 12).map((c) => {
                    const ocup = c.capacidade ? Math.min(100, (c.totalDocumentos / c.capacidade) * 100) : 0;
                    return (
                      <li key={c.id}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-medium text-ink-800">Caixa {c.codigo}</span>
                          <span className="tabular-nums text-ink-500">
                            <strong className="text-ink-900">{c.totalDocumentos}</strong>
                            {c.capacidade ? ` / ${c.capacidade}` : ''}
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className={cn('h-full rounded-full', ocup >= 90 ? 'bg-danger-500' : ocup >= 70 ? 'bg-warning-500' : 'bg-orange-500')}
                            style={{ width: `${Math.max(2, ocup)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Colunas cor="var(--color-orange-500)" dados={caixas.slice(0, 24).map((c) => ({ rotulo: c.codigo, valor: c.totalDocumentos }))} />
              )}
            </CardBody>
          </Card>
        </div>
      )}

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'locais', label: 'Locais e caixas', icon: Boxes },
          { id: 'emprestimos', label: 'Empréstimos', icon: HandHelping, count: resumo?.emprestimosAbertos || undefined },
        ]}
      />

      {aba === 'locais' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <Card className="self-start">
            <CardHeader title="Locais" description={`${locais.length} cadastrado(s)`} icon={Warehouse} />
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {lista.length === 0 ? (
                <div className="p-3">
                  <EmptyState icon={Boxes} title="Nenhum local" description="Cadastre prédio, salas, estantes e caixas do arquivo." />
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {lista.map((l) => {
                    const Icone = ICONE_LOCAL[l.tipo];
                    const qtd = totalSub.get(l.id) ?? 0;
                    return (
                      <li key={l.id}>
                        <button
                          type="button"
                          onClick={() => setSelecionado(l.id)}
                          style={{ paddingLeft: `${0.5 + l.nivel * 1.1}rem` }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-[8px] py-1.5 pr-2 text-left text-sm transition-colors',
                            selecionado === l.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-ink-50',
                            l.ativo ? 'text-ink-800' : 'text-ink-500 line-through',
                          )}
                        >
                          <Icone className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="text-xs text-ink-500">{TIPO_LOCAL_LABEL[l.tipo]}</span> <span className="font-medium">{l.codigo}</span>
                          </span>
                          {l.emprestado && <Badge tone="orange">Emprestada</Badge>}
                          {qtd > 0 && <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-600">{qtd}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>

          <div className="min-w-0">
            {local ? (
              <PainelLocal
                slug={String(slug)}
                local={local}
                caminho={caminhoLocal(local.id, locais)}
                onEditar={() => setEditando({ local, parentId: local.parentId })}
                onNovoSub={() => setEditando({ local: null, parentId: local.id })}
                onPdf={pdf}
                onEmprestar={(alvo) => setEmprestando(alvo)}
                onChanged={invalidate}
              />
            ) : (
              <Card>
                <div className="p-8">
                  <EmptyState icon={Tag} title="Selecione um local" description="Veja o conteúdo, imprima etiqueta e espelho da caixa, ou registre empréstimo." />
                </div>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <Emprestimos slug={String(slug)} onPdf={pdf} />
      )}

      {editando && (
        <LocalModal
          slug={String(slug)}
          local={editando.local}
          parentIdInicial={editando.parentId}
          locais={locais}
          onClose={() => setEditando(null)}
          onDone={(id) => {
            invalidate();
            if (id) setSelecionado(id);
          }}
        />
      )}
      {emprestando && (
        <EmprestimoModal slug={String(slug)} alvo={emprestando} onClose={() => setEmprestando(null)} onDone={invalidate} onPdf={pdf} />
      )}
    </div>
  );
}

function PainelLocal({
  slug,
  local,
  caminho,
  onEditar,
  onNovoSub,
  onPdf,
  onEmprestar,
  onChanged,
}: {
  slug: string;
  local: LocalFisicoView;
  caminho: string;
  onEditar: () => void;
  onNovoSub: () => void;
  onPdf: (path: string) => void;
  onEmprestar: (alvo: { documentId?: string; localFisicoId?: string; rotulo: string }) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { data: conteudo } = useQuery<ConteudoLocal>({
    queryKey: ['arquivo-fisico', 'conteudo', slug, local.id],
    queryFn: () => api(`/t/${slug}/arquivo-fisico/locais/${local.id}/conteudo`),
  });
  const excluir = useMutation({
    mutationFn: () => api<{ inativado: boolean }>(`/t/${slug}/arquivo-fisico/locais/${local.id}`, { method: 'DELETE' }),
    onSuccess: (r) => {
      toast.success(r.inativado ? 'Local em uso: foi inativado (histórico preservado).' : 'Local excluído.');
      onChanged();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao excluir'),
  });
  const base = `/t/${slug}/arquivo-fisico/locais/${local.id}`;

  return (
    <Card className="overflow-hidden">
      <span aria-hidden className="block h-1 bg-orange-500" />
      <div className="p-5">
        <p className="text-xs text-ink-400">{caminho}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-extrabold tracking-tight text-ink-900">
            {TIPO_LOCAL_LABEL[local.tipo]} {local.codigo}
          </h2>
          {local.emprestado && <Badge tone="orange">Emprestada</Badge>}
          {!local.ativo && <Badge tone="neutral">Inativo</Badge>}
        </div>
        {local.descricao && <p className="text-sm text-ink-500">{local.descricao}</p>}
        {local.capacidade ? (
          <div className="mt-3 max-w-sm">
            <div className="flex justify-between text-xs text-ink-500">
              <span>Ocupação</span>
              <span className="tabular-nums">
                {local.totalDocumentos} / {local.capacidade}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, (local.totalDocumentos / local.capacidade) * 100)}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1 border-y border-ink-100 bg-ink-50/50 px-3 py-2">
        <Button size="sm" variant="ghost" leftIcon={<Tag aria-hidden />} onClick={() => onPdf(`${base}/etiqueta`)}>
          Etiqueta
        </Button>
        <Button size="sm" variant="ghost" leftIcon={<Printer aria-hidden />} onClick={() => onPdf(`${base}/espelho`)}>
          Espelho
        </Button>
        {local.tipo === 'caixa' && !local.emprestado && (
          <Button size="sm" variant="ghost" leftIcon={<HandHelping aria-hidden />} onClick={() => onEmprestar({ localFisicoId: local.id, rotulo: `Caixa ${local.codigo}` })}>
            Emprestar caixa
          </Button>
        )}
        {local.tipo !== 'caixa' && (
          <Button size="sm" variant="ghost" leftIcon={<Plus aria-hidden />} onClick={onNovoSub}>
            Sublocal
          </Button>
        )}
        <Button size="sm" variant="ghost" leftIcon={<Pencil aria-hidden />} onClick={onEditar}>
          Editar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-danger-600"
          leftIcon={<Trash2 aria-hidden />}
          onClick={() => window.confirm(`Excluir ${TIPO_LOCAL_LABEL[local.tipo]} ${local.codigo}? Se estiver em uso, será inativado.`) && excluir.mutate()}
        >
          Excluir
        </Button>
      </div>
      <div className="p-5">
        <h3 className="mb-2 label-caps">
          Conteúdo {conteudo ? `(${conteudo.itens.length}${conteudo.ocultos ? ` + ${conteudo.ocultos} restritos` : ''})` : ''}
        </h3>
        {!conteudo ? (
          <div className="h-16 animate-pulse rounded-[10px] bg-ink-100" />
        ) : conteudo.itens.length === 0 ? (
          <p className="text-sm text-ink-500">
            Nenhum documento aqui. Vincule pelo botão “Editar” do documento (campo Localização física).
          </p>
        ) : (
          <ul className="divide-y divide-ink-200">
            {conteudo.itens.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="mr-2 font-mono text-xs text-ink-500">{d.classificacaoCodigo ?? '—'}</span>
                  <span className="text-ink-800">{d.descricao}</span>
                  <span className="ml-2 text-xs text-ink-500">{fmtData(d.documentDate)} · {d.exercicio}</span>
                </span>
                <button
                  type="button"
                  title="Emprestar documento"
                  className="shrink-0 text-ink-500 hover:text-accent"
                  onClick={() => onEmprestar({ documentId: d.id, rotulo: d.descricao })}
                >
                  <HandHelping className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function LocalModal({
  slug,
  local,
  parentIdInicial,
  locais,
  onClose,
  onDone,
}: {
  slug: string;
  local: LocalFisicoView | null;
  parentIdInicial: string | null;
  locais: LocalFisicoView[];
  onClose: () => void;
  onDone: (id?: string) => void;
}) {
  const pai = locais.find((l) => l.id === parentIdInicial) ?? null;
  const tipoInicial: TipoLocal = local?.tipo ?? (pai ? TIPOS_LOCAL[Math.min(TIPOS_LOCAL.indexOf(pai.tipo) + 1, 4)]! : 'predio');
  const [tipo, setTipo] = useState<TipoLocal>(tipoInicial);
  const [parentId, setParentId] = useState(local?.parentId ?? parentIdInicial ?? '');
  const [codigo, setCodigo] = useState(local?.codigo ?? '');
  const [descricao, setDescricao] = useState(local?.descricao ?? '');
  const [capacidade, setCapacidade] = useState(local?.capacidade ? String(local.capacidade) : '');
  const [error, setError] = useState<string | null>(null);
  const paisPossiveis = locais.filter((l) => l.ativo && l.id !== local?.id && podeConter(l.tipo, tipo));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        tipo,
        parentId: parentId || null,
        codigo: codigo.trim(),
        descricao: descricao.trim() || null,
        capacidade: capacidade ? Number(capacidade) : null,
      };
      return local
        ? api(`/t/${slug}/arquivo-fisico/locais/${local.id}`, { method: 'PATCH', body }).then(() => ({ id: local.id }))
        : api<{ id: string }>(`/t/${slug}/arquivo-fisico/locais`, { method: 'POST', body });
    },
    onSuccess: (r) => {
      onDone(r.id);
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar local'),
  });

  return (
    <Modal title={local ? 'Local — Edição' : 'Local — Inclusão'} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="lf-tipo">Tipo<span className="ml-0.5 text-danger-600">*</span></label>
            <SelectMenu id="lf-tipo" className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoLocal)}>
              {TIPOS_LOCAL.map((t) => (
                <option key={t} value={t}>{TIPO_LOCAL_LABEL[t]}</option>
              ))}
            </SelectMenu>
          </div>
          <div>
            <label className={labelCls} htmlFor="lf-codigo">Código<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="lf-codigo" className={inputCls} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ex.: CX-0012" />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="lf-pai">Dentro de</label>
          <SelectMenu id="lf-pai" className={inputCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— Nenhum (raiz) —</option>
            {paisPossiveis.map((l) => (
              <option key={l.id} value={l.id}>{caminhoLocal(l.id, locais)}</option>
            ))}
          </SelectMenu>
        </div>
        <div>
          <label className={labelCls} htmlFor="lf-desc">Descrição</label>
          <input id="lf-desc" className={inputCls} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: Contratos 2019–2020" />
        </div>
        {tipo === 'caixa' && (
          <div>
            <label className={labelCls} htmlFor="lf-cap">Capacidade (documentos)</label>
            <input id="lf-cap" type="number" min={1} className={inputCls} value={capacidade} onChange={(e) => setCapacidade(e.target.value)} />
          </div>
        )}
        {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="button" className={btnPrimary} disabled={save.isPending || !codigo.trim()} onClick={() => save.mutate()}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EmprestimoModal({
  slug,
  alvo,
  onClose,
  onDone,
  onPdf,
}: {
  slug: string;
  alvo: { documentId?: string; localFisicoId?: string; rotulo: string };
  onClose: () => void;
  onDone: () => void;
  onPdf: (path: string) => void;
}) {
  const toast = useToast();
  const emSete = hojeIso(new Date(Date.now() + 7 * 86400_000));
  const [nome, setNome] = useState('');
  const [setor, setSetor] = useState('');
  const [finalidade, setFinalidade] = useState('');
  const [prazo, setPrazo] = useState(emSete);
  const [error, setError] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: () =>
      api<EmprestimoView>(`/t/${slug}/arquivo-fisico/emprestimos`, {
        method: 'POST',
        body: {
          documentId: alvo.documentId ?? null,
          localFisicoId: alvo.localFisicoId ?? null,
          solicitanteNome: nome.trim(),
          solicitanteSetor: setor.trim(),
          finalidade: finalidade.trim() || null,
          prazoDevolucao: prazo,
        },
      }),
    onSuccess: (e) => {
      toast.success(`Empréstimo nº ${String(e.numero).padStart(3, '0')}/${e.ano} registrado.`);
      onDone();
      onClose();
      onPdf(`/t/${slug}/arquivo-fisico/emprestimos/${e.id}/termo`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao registrar empréstimo'),
  });

  return (
    <Modal title="Registrar empréstimo" subtitle={alvo.rotulo} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="em-nome">Solicitante<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="em-nome" className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <label className={labelCls} htmlFor="em-setor">Setor<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="em-setor" className={inputCls} value={setor} onChange={(e) => setSetor(e.target.value)} placeholder="ex.: Procuradoria" />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="em-fin">Finalidade</label>
          <input id="em-fin" className={inputCls} value={finalidade} onChange={(e) => setFinalidade(e.target.value)} placeholder="ex.: Instruir processo administrativo" />
        </div>
        <div>
          <label className={labelCls} htmlFor="em-prazo">Devolver até<span className="ml-0.5 text-danger-600">*</span></label>
          <input id="em-prazo" type="date" className={inputCls} value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className={btnPrimary}
            disabled={salvar.isPending || nome.trim().length < 3 || setor.trim().length < 2 || !prazo}
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? 'Registrando…' : 'Registrar e imprimir termo'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Emprestimos({ slug, onPdf }: { slug: string; onPdf: (path: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<'abertos' | 'atrasados' | 'todos'>('abertos');
  const { data = [], isLoading } = useQuery<EmprestimoView[]>({
    queryKey: ['arquivo-fisico', 'emprestimos', slug, status],
    queryFn: () => api(`/t/${slug}/arquivo-fisico/emprestimos?status=${status}`),
  });
  const devolver = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/arquivo-fisico/emprestimos/${id}/devolucao`, { method: 'POST', body: { observacao: null } }),
    onSuccess: () => {
      toast.success('Devolução registrada.');
      qc.invalidateQueries({ queryKey: ['arquivo-fisico'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao registrar devolução'),
  });

  return (
    <div className={`${cardCls} p-4`}>
      <div className="mb-3 flex gap-2">
        {(['abertos', 'atrasados', 'todos'] as const).map((s) => (
          <TabButton key={s} active={status === s} onClick={() => setStatus(s)}>
            {s === 'abertos' ? 'Em aberto' : s === 'atrasados' ? 'Atrasados' : 'Histórico'}
          </TabButton>
        ))}
      </div>
      {isLoading ? (
        <div className="h-16 animate-pulse rounded-[10px] bg-ink-100" />
      ) : data.length === 0 ? (
        <EmptyState icon={HandHelping} title="Nenhum empréstimo" description="Empreste pelo painel da caixa (caixa inteira ou documento)." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr className="border-b border-ink-200 text-left label-caps">
                <th className="px-2 py-2">Nº</th>
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2">Solicitante</th>
                <th className="px-2 py-2">Saída</th>
                <th className="px-2 py-2">Devolver até</th>
                <th className="px-2 py-2">Situação</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-b border-ink-200 last:border-0">
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{String(e.numero).padStart(3, '0')}/{e.ano}</td>
                  <td className="max-w-xs truncate px-2 py-2 text-ink-800">{e.localCodigo ? `Caixa ${e.localCodigo}` : e.documentoDescricao}</td>
                  <td className="px-2 py-2 text-ink-800">
                    {e.solicitanteNome}
                    <span className="block text-xs text-ink-500">{e.solicitanteSetor}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-500">{fmtData(e.dataSaida)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-ink-500">{fmtData(e.prazoDevolucao)}</td>
                  <td className="px-2 py-2">
                    {e.status === 'devolvido' ? (
                      <Badge color="gray">Devolvido {fmtData(e.dataDevolucao)}</Badge>
                    ) : e.atrasado ? (
                      <Badge color="red">Atrasado</Badge>
                    ) : (
                      <Badge color="blue">Em aberto</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <button type="button" title="Termo de empréstimo" className="mr-2 text-ink-500 hover:text-accent" onClick={() => onPdf(`/t/${slug}/arquivo-fisico/emprestimos/${e.id}/termo`)}>
                      <FileText className="h-4 w-4" aria-hidden />
                    </button>
                    {e.status === 'aberto' && (
                      <button
                        type="button"
                        title="Registrar devolução"
                        className="text-ink-500 hover:text-success-600"
                        disabled={devolver.isPending}
                        onClick={() => window.confirm('Confirmar devolução?') && devolver.mutate(e.id)}
                      >
                        <Undo2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
