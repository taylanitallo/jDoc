'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FilePenLine, FileText, GitBranch, History, Lock, Plus, Printer, Scale, Search, Trash2, Undo2, X } from 'lucide-react';
import {
  AGRUPADORES,
  SITUACAO_NORMA_LABEL,
  TIPOS_DISPOSITIVO,
  TIPO_DISPOSITIVO_LABEL,
  hojeIso,
  rotuloNormaCurto,
  type AlteracoesInput,
  type NoCompilado,
  type NormasPage,
  type NormaView,
  type TipoDispositivo,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, SelectMenu, Switch, Textarea, TONE_VIVID, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { SITUACAO_TOM, TextoCompilado, agruparRelacoes } from '@/components/legislacao/compilado';
import { cn } from '@/lib/cn';

const br = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

export default function NormaPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [data, setData] = useState('');
  const [historico, setHistorico] = useState(true);
  const [alterando, setAlterando] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);

  const { data: n, error, isLoading } = useQuery<NormaView>({
    queryKey: ['norma', slug, id, data],
    queryFn: () => api(`/t/${slug}/legislacao/normas/${id}${data ? `?data=${data}` : ''}`),
    placeholderData: (p) => p,
  });

  const publicar = useMutation({
    mutationFn: (publicada: boolean) => api<NormaView>(`/t/${slug}/legislacao/normas/${id}`, { method: 'PATCH', body: { publicada } }),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['norma', slug, id] });
      qc.invalidateQueries({ queryKey: ['normas'] });
      toast.success(v.publicada ? 'Publicada no portal da legislação.' : 'Retirada do portal.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para publicar.' : e.message) : 'Falha'),
  });

  const abrir = async (path: string, blob: boolean) => {
    setImprimindo(true);
    const w = window.open('', '_blank');
    try {
      const url = blob ? await apiBlobUrl(path) : (await api<{ url: string }>(path)).url;
      if (w) w.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      w?.close();
      toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir');
    } finally {
      setImprimindo(false);
    }
  };

  const voltar = (
    <Link href={`/${slug}/normas`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-600">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Legislação
    </Link>
  );
  if (error) {
    return (
      <div className="space-y-4">
        {voltar}
        <EmptyState icon={Lock} title="Não disponível" description={error instanceof ApiError ? error.message : 'Falha ao carregar'} />
      </div>
    );
  }
  if (isLoading || !n) {
    return (
      <div className="space-y-4">
        {voltar}
        <div className="h-40 animate-pulse rounded-[16px] bg-ink-100" />
      </div>
    );
  }

  const tom = TONE_VIVID[SITUACAO_TOM[n.situacao]];
  return (
    <div className="space-y-6">
      {voltar}
      <Card className="overflow-hidden">
        <span aria-hidden className={cn('block h-1', tom.barra)} />
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', tom.chip)}>
              <Scale className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight text-ink-900">{n.rotulo}</h1>
                <Badge tone={SITUACAO_TOM[n.situacao]}>{SITUACAO_NORMA_LABEL[n.situacao]}</Badge>
              </div>
              <p className="mt-1 max-w-3xl text-sm italic text-ink-600">{n.ementa}</p>
              {n.revisadaPor && (
                <p className="mt-1 text-xs text-ink-400">
                  Texto estruturado e revisado por {n.revisadaPor}
                  {n.revisadaEm ? ` em ${new Date(n.revisadaEm).toLocaleDateString('pt-BR')}` : ''}
                </p>
              )}
            </div>
          </div>
          <label className="flex shrink-0 items-center gap-3 rounded-[12px] border border-ink-200 px-3 py-2 text-sm">
            <span>
              <span className="block font-semibold text-ink-800">Publicada no portal</span>
              <span className="block text-xs text-ink-500">Visível para o cidadão sem login</span>
            </span>
            <Switch checked={n.publicada} onChange={(v) => publicar.mutate(v)} disabled={publicar.isPending} label="Publicada no portal" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-ink-100 bg-ink-50/50 px-3 py-2">
          <Button size="sm" variant="ghost" leftIcon={<Printer aria-hidden />} loading={imprimindo} onClick={() => abrir(`/t/${slug}/legislacao/normas/${id}/compilado.pdf${data ? `?data=${data}` : ''}`, true)}>
            PDF do texto compilado
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<FileText aria-hidden />} onClick={() => abrir(`/t/${slug}/documents/${n.documentId}/url`, false)}>
            PDF original publicado
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<GitBranch aria-hidden />} onClick={() => setAlterando(true)}>
            Esta norma altera outra
          </Button>
          {!n.temAlteracoes && (
            <Link href={`/${slug}/normas/estruturar/${n.documentId}`} className="inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-ink-700 hover:bg-ink-100">
              <FilePenLine className="h-4 w-4" aria-hidden /> Corrigir estrutura
            </Link>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4 text-ink-400" aria-hidden />
              <span className="text-ink-600">Texto vigente em</span>
              <Input type="date" aria-label="Data" className="w-40" value={data || n.data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
              {data && data !== hojeIso() && (
                <Button size="sm" variant="ghost" leftIcon={<Undo2 aria-hidden />} onClick={() => setData('')}>
                  Hoje
                </Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-600">
              <Switch checked={historico} onChange={setHistorico} label="Mostrar redações anteriores" />
              Mostrar redações anteriores (riscadas)
            </label>
          </div>
          <div className="px-6 py-6 sm:px-10">
            <TextoCompilado nos={n.compilado} mostrarHistorico={historico} linkNorma={(r) => `/${slug}/normas/${r.id}`} />
          </div>
        </Card>

        <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title="Relações" icon={GitBranch} description="Normas que alteram ou são alteradas por esta" />
            <div className="space-y-4 p-4 text-sm">
              <Relacoes titulo="Alterada por" itens={n.alteradaPor} slug={String(slug)} vazio="Nenhuma norma alterou esta." />
              <Relacoes titulo="Altera" itens={n.altera} slug={String(slug)} vazio="Esta norma não alterou outras." />
            </div>
          </Card>
          <Card>
            <CardHeader title="Estrutura" icon={FileText} />
            <dl className="divide-y divide-ink-100 px-4 py-2 text-sm">
              <div className="flex justify-between py-1.5">
                <dt className="text-ink-500">Publicação</dt>
                <dd className="font-medium text-ink-800">{br(n.dataPublicacao)}</dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-ink-500">Dispositivos</dt>
                <dd className="font-medium text-ink-800">{n.totalDispositivos}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {alterando && <AlterarModal slug={String(slug)} alteradora={n} onClose={() => setAlterando(false)} />}
    </div>
  );
}

function Relacoes({ titulo, itens, slug, vazio }: { titulo: string; itens: NormaView['alteradaPor']; slug: string; vazio: string }) {
  const grupos = agruparRelacoes(itens);
  return (
    <div>
      <p className="label-caps mb-1.5">{titulo}</p>
      {itens.length === 0 ? (
        <p className="text-xs text-ink-400">{vazio}</p>
      ) : (
        <ul className="space-y-1.5">
          {grupos.map((r) => (
            <li key={r.norma.id}>
              <Link href={`/${slug}/normas/${r.norma.id}`} className="block rounded-[8px] px-2 py-1.5 hover:bg-ink-50">
                <span className="font-semibold text-brand-600">{rotuloNormaCurto(r.norma)}</span>
                <span className="ml-1.5 text-xs text-ink-500">({r.tipos})</span>
                <span className="block truncate text-xs text-ink-500">{r.norma.ementa}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registrar alteracao: a norma aberta (alteradora) muda dispositivos de outra.
// ---------------------------------------------------------------------------

interface Linha {
  id: string;
  parentId: string | null;
  tipo: TipoDispositivo;
  rotulo: string;
  texto: string | null;
  revogado: boolean;
  nivel: number;
}

function achatar(nos: NoCompilado[], parentId: string | null = null, nivel = 0, out: Linha[] = []): Linha[] {
  for (const n of nos) {
    out.push({ id: n.id, parentId, tipo: n.tipo, rotulo: n.rotulo, texto: n.texto, revogado: n.revogado, nivel });
    achatar(n.filhos, n.id, nivel + 1, out);
  }
  return out;
}

type Item = AlteracoesInput['itens'][number];

function AlterarModal({ slug, alteradora, onClose }: { slug: string; alteradora: NormaView; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [alvoId, setAlvoId] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [editando, setEditando] = useState<{ linha: Linha; acao: 'redacao' | 'inclusao' } | null>(null);
  const [vigencia, setVigencia] = useState(alteradora.dataPublicacao ?? hojeIso());
  const [revogacaoTotal, setRevogacaoTotal] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const { data: lista } = useQuery<NormasPage>({
    queryKey: ['normas', 'alvo', slug, buscaDeb],
    queryFn: () => api(`/t/${slug}/legislacao/normas?pageSize=15${buscaDeb ? `&q=${encodeURIComponent(buscaDeb)}` : ''}`),
    enabled: !alvoId,
  });
  const { data: alvo } = useQuery<NormaView>({
    queryKey: ['norma', slug, alvoId, ''],
    queryFn: () => api(`/t/${slug}/legislacao/normas/${alvoId}`),
    enabled: !!alvoId,
  });
  const linhas = useMemo(() => (alvo ? achatar(alvo.compilado) : []), [alvo]);

  const salvar = useMutation({
    mutationFn: () =>
      api<NormaView>(`/t/${slug}/legislacao/normas/${alteradora.id}/alteracoes`, {
        method: 'POST',
        body: { alvoId, vigenciaInicio: vigencia, revogacaoTotal: revogacaoTotal || undefined, itens },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['norma'] });
      qc.invalidateQueries({ queryKey: ['normas'] });
      toast.success('Alterações registradas. O texto compilado já foi atualizado.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para registrar alterações.' : e.message) : 'Falha'),
  });

  const pendente = (id: string) => itens.find((i) => i.dispositivoId === id || i.inserirAposId === id);
  const remover = (i: Item) => setItens((xs) => xs.filter((x) => x !== i));

  return (
    <Modal
      open
      size="xl"
      onClose={() => !salvar.isPending && onClose()}
      title="Registrar alteração de outra norma"
      subtitle={`${rotuloNormaCurto(alteradora)} altera…`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={!alvoId || (itens.length === 0 && !revogacaoTotal)}>
            Registrar {itens.length ? `(${itens.length})` : ''}
          </Button>
        </>
      }
    >
      {!alvoId ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">Escolha a norma que está sendo alterada ou revogada.</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar norma" autoFocus placeholder="Número ou ementa" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto rounded-[10px] border border-ink-200/70">
            {(lista?.items ?? [])
              .filter((x) => x.id !== alteradora.id)
              .map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => setAlvoId(x.id)} className="block w-full px-3 py-2 text-left hover:bg-brand-50/50">
                    <span className="font-semibold text-ink-900">{x.rotulo}</span>
                    <span className="block truncate text-xs text-ink-500">{x.ementa}</span>
                  </button>
                </li>
              ))}
            {lista && lista.items.filter((x) => x.id !== alteradora.id).length === 0 && <li className="px-3 py-3 text-sm text-ink-500">Nenhuma norma encontrada.</li>}
          </ul>
        </div>
      ) : !alvo ? (
        <div className="h-40 animate-pulse rounded-[12px] bg-ink-100" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4 rounded-[12px] bg-ink-50 p-3">
            <div className="min-w-0 flex-1">
              <p className="label-caps">Norma alterada</p>
              <p className="font-semibold text-ink-900">{alvo.rotulo}</p>
            </div>
            <Field label="Vigência das mudanças" htmlFor="alt-vig">
              <Input id="alt-vig" type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm text-ink-700">
              <Switch checked={revogacaoTotal} onChange={setRevogacaoTotal} label="Revoga a norma inteira" />
              Revoga a norma inteira
            </label>
            <Button size="sm" variant="ghost" onClick={() => { setAlvoId(''); setItens([]); }}>
              Trocar norma
            </Button>
          </div>

          {itens.length > 0 && (
            <div className="rounded-[12px] border border-brand-200 bg-brand-50/50 p-3">
              <p className="label-caps mb-2">Alterações a registrar</p>
              <ul className="space-y-1.5 text-sm">
                {itens.map((i, k) => {
                  const l = linhas.find((x) => x.id === (i.dispositivoId ?? i.inserirAposId));
                  return (
                    <li key={k} className="flex items-start gap-2">
                      <Badge tone={i.acao === 'revogacao' ? 'danger' : i.acao === 'inclusao' ? 'success' : 'info'}>
                        {i.acao === 'revogacao' ? 'Revoga' : i.acao === 'inclusao' ? 'Inclui' : 'Nova redação'}
                      </Badge>
                      <span className="min-w-0 flex-1 text-ink-700">
                        {i.acao === 'inclusao' ? `${i.rotulo} (após ${l?.rotulo})` : l?.rotulo}
                        {i.texto ? <span className="block truncate text-xs text-ink-500">{i.texto}</span> : null}
                      </span>
                      <button type="button" aria-label="Remover" onClick={() => remover(i)} className="rounded p-1 text-ink-400 hover:bg-white hover:text-danger-600">
                        <X className="h-4 w-4" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="text-sm text-ink-600">Clique na ação ao lado de cada dispositivo alterado por {rotuloNormaCurto(alteradora)}.</p>
          <ul className="max-h-[45vh] divide-y divide-ink-100 overflow-y-auto rounded-[10px] border border-ink-200/70">
            {linhas.map((l) => {
              const agrupador = AGRUPADORES.includes(l.tipo);
              const p = pendente(l.id);
              return (
                <li key={l.id} className={cn('flex items-start gap-2 px-3 py-2', p && 'bg-brand-50/60')} style={{ paddingLeft: `${0.75 + Math.min(l.nivel, 5) * 1}rem` }}>
                  <div className="min-w-0 flex-1 text-sm">
                    <span className={cn('font-semibold', agrupador ? 'uppercase text-ink-800' : 'text-ink-900')}>{l.rotulo}</span>{' '}
                    <span className={cn(l.revogado ? 'italic text-ink-400' : 'text-ink-600')}>{l.revogado ? '(Revogado)' : l.texto}</span>
                  </div>
                  {p ? (
                    <Badge tone="info">Na lista</Badge>
                  ) : !l.revogado && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" title="Nova redação" onClick={() => setEditando({ linha: l, acao: 'redacao' })} className="rounded-[8px] p-1.5 text-ink-500 hover:bg-info-50 hover:text-info-600">
                        <FilePenLine className="h-4 w-4" aria-hidden />
                      </button>
                      {!agrupador && l.tipo !== 'preambulo' && l.tipo !== 'fecho' && (
                        <button type="button" title="Revogar" onClick={() => setItens((xs) => [...xs, { acao: 'revogacao', dispositivoId: l.id }])} className="rounded-[8px] p-1.5 text-ink-500 hover:bg-danger-50 hover:text-danger-600">
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                      <button type="button" title="Incluir dispositivo depois deste" onClick={() => setEditando({ linha: l, acao: 'inclusao' })} className="rounded-[8px] p-1.5 text-ink-500 hover:bg-success-50 hover:text-success-600">
                        <Plus className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editando && (
        <EditarDispositivo
          linha={editando.linha}
          acao={editando.acao}
          linhas={linhas}
          onClose={() => setEditando(null)}
          onOk={(item) => {
            setItens((xs) => [...xs, item]);
            setEditando(null);
          }}
        />
      )}
    </Modal>
  );
}

function EditarDispositivo({
  linha,
  acao,
  linhas,
  onClose,
  onOk,
}: {
  linha: Linha;
  acao: 'redacao' | 'inclusao';
  linhas: Linha[];
  onClose: () => void;
  onOk: (i: Item) => void;
}) {
  const [texto, setTexto] = useState(acao === 'redacao' ? (linha.texto ?? '') : '');
  const [tipo, setTipo] = useState<TipoDispositivo>(linha.tipo);
  const [rotulo, setRotulo] = useState(acao === 'inclusao' ? sugerirRotulo(linha) : linha.rotulo);
  // Pai do incluido: o mesmo do dispositivo de referencia (irmao) — ou o proprio, se for filho dele.
  const [parentId, setParentId] = useState<string | null>(linha.parentId);
  const possiveisPais = linhas.filter((l) => l.id === linha.parentId || l.id === linha.id || AGRUPADORES.includes(l.tipo));

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={acao === 'redacao' ? `Nova redação — ${linha.rotulo}` : `Incluir dispositivo após ${linha.rotulo}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!texto.trim() || (acao === 'inclusao' && !rotulo.trim())}
            onClick={() =>
              onOk(
                acao === 'redacao'
                  ? { acao: 'redacao', dispositivoId: linha.id, texto: texto.trim() }
                  : { acao: 'inclusao', inserirAposId: linha.id, parentId, tipo, rotulo: rotulo.trim(), texto: texto.trim() },
              )
            }
          >
            Adicionar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {acao === 'inclusao' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Tipo" htmlFor="inc-tipo">
              <SelectMenu id="inc-tipo" className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value as TipoDispositivo)}>
                {TIPOS_DISPOSITIVO.filter((t) => t !== 'preambulo' && t !== 'fecho').map((t) => (
                  <option key={t} value={t}>{TIPO_DISPOSITIVO_LABEL[t]}</option>
                ))}
              </SelectMenu>
            </Field>
            <Field label="Rótulo" htmlFor="inc-rot" hint="Ex.: Art. 4º-A, § 3º, V">
              <Input id="inc-rot" value={rotulo} onChange={(e) => setRotulo(e.target.value)} />
            </Field>
            <Field label="Fica dentro de" htmlFor="inc-pai">
              <SelectMenu id="inc-pai" className={inputCls} value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
                <option value="">Raiz da norma</option>
                {possiveisPais.map((l) => (
                  <option key={l.id} value={l.id}>{l.rotulo}</option>
                ))}
              </SelectMenu>
            </Field>
          </div>
        )}
        {acao === 'redacao' && linha.texto && (
          <div className="rounded-[10px] bg-ink-50 px-3 py-2 text-sm text-ink-500">
            <span className="label-caps block">Texto atual</span>
            <span className="line-through">{linha.texto}</span>
          </div>
        )}
        <Field label={acao === 'redacao' ? 'Nova redação' : 'Texto'} htmlFor="alt-texto" required>
          <Textarea id="alt-texto" rows={6} autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Sugestao de rotulo para o incluido: "Art. 4º" -> "Art. 4º-A". */
function sugerirRotulo(l: Linha): string {
  if (l.tipo === 'artigo' || l.tipo === 'paragrafo') return /-[A-Z]$/.test(l.rotulo) ? l.rotulo.replace(/-([A-Z])$/, (_, c: string) => `-${String.fromCharCode(c.charCodeAt(0) + 1)}`) : `${l.rotulo}-A`;
  return '';
}
