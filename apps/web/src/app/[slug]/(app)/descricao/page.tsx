'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderKanban,
  Library,
  Link2,
  Plus,
  Printer,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AREAS_NOBRADE,
  ELEMENTOS_NOBRADE,
  FILHOS_PERMITIDOS,
  NIVEL_DESCRICAO_LABEL,
  type DocumentPage,
  type DossiesPage,
  type ElementoOpcional,
  type NivelDescricao,
  type UnidadeDescricaoCreateInput,
  type UnidadeDescricaoNo,
  type UnidadeDescricaoView,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, SelectMenu, StatCard, Tabs, Textarea, TONE_VIVID, inputCls, type Tone } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

const NIVEL_CURTO: Record<NivelDescricao, string> = {
  acervo: 'Acervo',
  fundo: 'Fundo',
  colecao: 'Coleção',
  secao: 'Seção',
  subsecao: 'Subseção',
  serie: 'Série',
  subserie: 'Subsérie',
  dossie: 'Dossiê',
  item: 'Item',
};
const NIVEL_TOM: Record<NivelDescricao, Tone> = {
  acervo: 'brand',
  fundo: 'violet',
  colecao: 'violet',
  secao: 'info',
  subsecao: 'info',
  serie: 'teal',
  subserie: 'teal',
  dossie: 'orange',
  item: 'neutral',
};
const ELEMENTO_POR_CHAVE = Object.fromEntries(ELEMENTOS_NOBRADE.map((e) => [e.chave, e]));
const ELEMENTO_POR_ID = Object.fromEntries(ELEMENTOS_NOBRADE.map((e) => [e.id, e]));
const br = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : 's/d');

type Aba = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | 'vinculos';
const ABAS: Array<{ id: Aba; label: string }> = [
  { id: '1', label: 'Identificação' },
  { id: '2', label: 'Contexto' },
  { id: '3', label: 'Conteúdo' },
  { id: '4', label: 'Acesso e uso' },
  { id: '5', label: 'Fontes' },
  { id: '6', label: 'Notas' },
  { id: '7', label: 'Controle' },
  { id: '8', label: 'Pontos de acesso' },
  { id: 'vinculos', label: 'Documentos' },
];

export default function DescricaoPage() {
  // useSearchParams exige Suspense no App Router (?u=<id> guarda a unidade aberta).
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-[16px] bg-ink-100" />}>
      <Descricao />
    </Suspense>
  );
}

function Descricao() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const selecionada = params.get('u');
  const [nova, setNova] = useState<{ parent: UnidadeDescricaoNo | null } | null>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const { data: nos, isLoading, error } = useQuery<UnidadeDescricaoNo[]>({
    queryKey: ['descricao', slug],
    queryFn: () => api(`/t/${slug}/descricao`),
  });
  const selecionar = (id: string | null) => router.replace(id ? `/${slug}/descricao?u=${id}` : `/${slug}/descricao`, { scroll: false });

  const guia = async () => {
    setImprimindo(true);
    const aba = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(`/t/${slug}/descricao/guia`);
      if (aba) aba.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      aba?.close();
      toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar o guia');
    } finally {
      setImprimindo(false);
    }
  };

  const incompletas = (nos ?? []).filter((n) => !n.completa).length;
  const fundos = (nos ?? []).filter((n) => n.nivel === 'fundo' || n.nivel === 'colecao').length;
  const vinculados = (nos ?? []).reduce((t, n) => t + n.totalDocumentos + n.totalDossies, 0);
  // Abre direto a raiz (acervo ou primeiro fundo): tela vazia a direita nao ajuda ninguem.
  useEffect(() => {
    if (selecionada || !nos?.length) return;
    const raiz = [...nos].filter((n) => !n.parentId).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))[0];
    if (raiz) selecionar(raiz.id);
  }, [nos, selecionada]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.violet.chip)}>
            <BookOpenText className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Descrição arquivística</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              Fundos, séries e dossiês descritos pela NOBRADE (28 elementos, 7 obrigatórios), com guia, inventário e catálogo.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={guia} loading={imprimindo} leftIcon={<Printer aria-hidden />} disabled={!nos?.length}>
            Guia do acervo
          </Button>
          <Button onClick={() => setNova({ parent: null })} leftIcon={<Plus aria-hidden />}>
            Nova unidade
          </Button>
        </div>
      </div>

      {nos && nos.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Unidades descritas" value={nos.length} icon={BookOpenText} tone="violet" hint="todos os níveis" />
          <StatCard label="Fundos e coleções" value={fundos} icon={Library} tone="brand" hint="nível 1" />
          <StatCard label="Obrigatórios pendentes" value={incompletas} icon={AlertTriangle} tone={incompletas ? 'warning' : 'success'} hint={incompletas ? 'unidades com campo faltando' : 'tudo conforme a NOBRADE'} />
          <StatCard label="Documentos e dossiês" value={vinculados} icon={FileText} tone="teal" hint="vinculados às unidades" />
        </div>
      )}

      {error ? (
        <EmptyState icon={AlertTriangle} title="Sem acesso" description={error instanceof ApiError ? error.message : 'Falha ao carregar'} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <Card className="self-start lg:sticky lg:top-4">
            <CardHeader
              title="Quadro de arranjo"
              description={nos ? `${nos.length} unidade(s)${incompletas ? ` · ${incompletas} com obrigatório pendente` : ''}` : undefined}
            />
            <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">
              {isLoading ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((k) => (
                    <div key={k} className="h-8 animate-pulse rounded-[8px] bg-ink-100" />
                  ))}
                </div>
              ) : !nos || nos.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    icon={BookOpenText}
                    title="Nada descrito ainda"
                    description="Comece pelo acervo da entidade (nível 0) ou direto pelos fundos, um por órgão produtor."
                  />
                </div>
              ) : (
                <Arvore nos={nos} selecionada={selecionada} onSelect={selecionar} />
              )}
            </div>
          </Card>

          {selecionada ? (
            <Editor
              key={selecionada}
              slug={String(slug)}
              id={selecionada}
              onNovaAbaixo={(parent) => setNova({ parent })}
              onExcluida={() => selecionar(null)}
            />
          ) : (
            <Card>
              <div className="p-8">
                <EmptyState icon={BookOpenText} title="Selecione uma unidade" description="Escolha no quadro de arranjo para descrever, vincular documentos ou gerar inventário e catálogo." />
              </div>
            </Card>
          )}
        </div>
      )}

      {nova && (
        <NovaUnidade
          slug={String(slug)}
          parent={nova.parent}
          temAcervo={(nos ?? []).some((n) => n.nivel === 'acervo')}
          onClose={() => setNova(null)}
          onCriada={(id) => {
            setNova(null);
            selecionar(id);
          }}
        />
      )}
    </div>
  );
}

function Arvore({ nos, selecionada, onSelect }: { nos: UnidadeDescricaoNo[]; selecionada: string | null; onSelect: (id: string) => void }) {
  const filhos = useMemo(() => {
    const m = new Map<string | null, UnidadeDescricaoNo[]>();
    for (const n of nos) {
      const l = m.get(n.parentId) ?? [];
      l.push(n);
      m.set(n.parentId, l);
    }
    for (const l of m.values()) l.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
    return m;
  }, [nos]);
  // Abre o caminho ate a selecionada.
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setFechados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const render = (pai: string | null, nivel: number): React.ReactNode =>
    (filhos.get(pai) ?? []).map((n) => {
      const temFilhos = (filhos.get(n.id)?.length ?? 0) > 0;
      const aberto = !fechados.has(n.id);
      return (
        <li key={n.id}>
          <div
            className={cn(
              'group flex items-center gap-1 rounded-[8px] py-1.5 pr-2 text-sm transition-colors',
              selecionada === n.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-ink-50',
            )}
            style={{ paddingLeft: 4 + nivel * 14 }}
          >
            <button
              type="button"
              aria-label={aberto ? 'Recolher' : 'Expandir'}
              onClick={() => toggle(n.id)}
              className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 hover:text-ink-700', !temFilhos && 'invisible')}
            >
              {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={() => onSelect(n.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <Badge tone={NIVEL_TOM[n.nivel]} className="shrink-0">
                {NIVEL_CURTO[n.nivel]}
              </Badge>
              <span className="shrink-0 font-mono text-xs font-semibold text-ink-500">{n.codigo}</span>
              <span className="min-w-0 truncate font-medium text-ink-800">{n.titulo}</span>
            </button>
            {n.completa ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success-500" aria-label="Obrigatórios completos" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning-500" aria-label="Obrigatório pendente" />
            )}
          </div>
          {temFilhos && aberto && <ul>{render(n.id, nivel + 1)}</ul>}
        </li>
      );
    });

  return <ul className="space-y-0.5">{render(null, 0)}</ul>;
}

type Form = {
  codigo: string;
  titulo: string;
  datas: string;
  dimensaoSuporte: string;
  produtor: string;
  condicoesAcesso: string;
  elementos: Partial<Record<ElementoOpcional, string>>;
  pontosAcesso: string[];
};

function paraForm(v: UnidadeDescricaoView): Form {
  return {
    codigo: v.codigo,
    titulo: v.titulo,
    datas: v.datas ?? '',
    dimensaoSuporte: v.dimensaoSuporte ?? '',
    produtor: v.produtor ?? '',
    condicoesAcesso: v.condicoesAcesso ?? '',
    elementos: { ...v.elementos },
    pontosAcesso: [...v.pontosAcesso],
  };
}

function Editor({ slug, id, onNovaAbaixo, onExcluida }: { slug: string; id: string; onNovaAbaixo: (p: UnidadeDescricaoNo) => void; onExcluida: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [aba, setAba] = useState<Aba>('1');
  const [form, setForm] = useState<Form | null>(null);
  const [vincular, setVincular] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [termo, setTermo] = useState('');
  const [imprimindo, setImprimindo] = useState<string | null>(null);
  const { data: v, error } = useQuery<UnidadeDescricaoView>({
    queryKey: ['descricao', slug, id],
    queryFn: () => api(`/t/${slug}/descricao/${id}`),
  });
  useEffect(() => {
    if (v && !form) setForm(paraForm(v));
  }, [v, form]);

  const alterado = v && form && JSON.stringify(paraForm(v)) !== JSON.stringify(form);
  const aplicar = (nv: UnidadeDescricaoView) => {
    qc.setQueryData(['descricao', slug, id], nv);
    qc.invalidateQueries({ queryKey: ['descricao', slug], exact: true });
    setForm(paraForm(nv));
  };

  const salvar = useMutation({
    mutationFn: () => {
      const f = form!;
      const elementos: Record<string, string | null> = {};
      for (const k of Object.keys({ ...v!.elementos, ...f.elementos }) as ElementoOpcional[]) elementos[k] = f.elementos[k]?.trim() || null;
      return api<UnidadeDescricaoView>(`/t/${slug}/descricao/${id}`, {
        method: 'PATCH',
        body: {
          codigo: f.codigo.trim(),
          titulo: f.titulo.trim(),
          datas: f.datas.trim() || null,
          dimensaoSuporte: f.dimensaoSuporte.trim() || null,
          produtor: f.produtor.trim() || null,
          condicoesAcesso: f.condicoesAcesso.trim() || null,
          elementos,
          pontosAcesso: f.pontosAcesso,
        },
      });
    },
    onSuccess: (nv) => {
      aplicar(nv);
      toast.success(nv.faltantes.length ? 'Salvo. Ainda há elemento obrigatório pendente.' : 'Descrição salva.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para editar a descrição.' : e.message) : 'Falha ao salvar'),
  });
  const desvincular = useMutation({
    mutationFn: (body: { documentIds?: string[]; dossieIds?: string[] }) => api<UnidadeDescricaoView>(`/t/${slug}/descricao/${id}/desvincular`, { method: 'POST', body }),
    onSuccess: (nv) => {
      aplicar(nv);
      toast.success('Vínculo removido.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha'),
  });
  const remover = useMutation({
    mutationFn: () => api(`/t/${slug}/descricao/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['descricao', slug], exact: true });
      toast.success('Unidade excluída.');
      onExcluida();
    },
    onError: (e) => {
      setExcluir(false);
      toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para excluir.' : e.message) : 'Falha');
    },
  });

  const pdf = async (tipo: 'inventario' | 'catalogo') => {
    setImprimindo(tipo);
    const janela = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(`/t/${slug}/descricao/${id}/instrumento?tipo=${tipo}`);
      if (janela) janela.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      janela?.close();
      toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar o PDF');
    } finally {
      setImprimindo(null);
    }
  };

  if (error) return <EmptyState icon={AlertTriangle} title="Não disponível" description={error instanceof ApiError ? error.message : 'Falha ao carregar'} />;
  if (!v || !form) return <div className="h-96 animate-pulse rounded-[14px] bg-ink-100" />;

  const set = <K extends keyof Form>(k: K, val: Form[K]) => setForm((f) => (f ? { ...f, [k]: val } : f));
  const setEl = (k: ElementoOpcional, val: string) => setForm((f) => (f ? { ...f, elementos: { ...f.elementos, [k]: val } } : f));
  const falta = (elId: string) => v.faltantes.includes(elId);
  const podeFilhos = FILHOS_PERMITIDOS[v.nivel].length > 0;

  const campo = (chave: string, conteudo: React.ReactNode, extra?: React.ReactNode) => {
    const el = ELEMENTO_POR_CHAVE[chave]!;
    return (
      <Field
        key={chave}
        label={
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-ink-400">{el.id}</span> {el.nome}
            {falta(el.id) && <Badge tone="warning">obrigatório</Badge>}
          </span>
        }
        htmlFor={`el-${chave}`}
        hint={
          <>
            {el.ajuda}
            {extra}
          </>
        }
      >
        {conteudo}
      </Field>
    );
  };
  const textoLongo = (k: ElementoOpcional) =>
    campo(k, <Textarea id={`el-${k}`} rows={3} value={form.elementos[k] ?? ''} onChange={(e) => setEl(k, e.target.value)} />);
  const sugestao = (valor: string | null, atual: string, onUsar: () => void) =>
    valor && valor !== atual ? (
      <button type="button" onClick={onUsar} className="ml-1 inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
        <Sparkles className="h-3 w-3" aria-hidden /> usar “{valor}”
      </button>
    ) : null;

  const area = (n: number) => ELEMENTOS_NOBRADE.filter((e) => e.area === n);

  return (
    <div className="min-w-0 space-y-4">
      <Card className="overflow-hidden">
        <span aria-hidden className={cn('block h-1', TONE_VIVID[NIVEL_TOM[v.nivel]].barra)} />
        <div className="p-5">
          {v.caminho.length > 1 && (
            <nav aria-label="Caminho" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-ink-400">
              {v.caminho.slice(0, -1).map((c) => (
                <span key={c.id} className="flex items-center gap-1">
                  {c.titulo}
                  <ChevronRight className="h-3 w-3" aria-hidden />
                </span>
              ))}
            </nav>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={NIVEL_TOM[v.nivel]}>{NIVEL_DESCRICAO_LABEL[v.nivel]}</Badge>
            <span className="rounded-[6px] bg-ink-100 px-2 py-0.5 font-mono text-xs font-semibold text-ink-700">{v.codigoReferencia}</span>
            {v.faltantes.length === 0 ? (
              <Badge tone="success">Obrigatórios completos</Badge>
            ) : (
              <Badge tone="warning">{v.faltantes.length} obrigatório(s) pendente(s)</Badge>
            )}
          </div>
          <h2 className="mt-2 text-xl font-extrabold tracking-tight text-ink-900">{v.titulo}</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Atualizada em {new Date(v.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            {v.atualizadoPor ? ` por ${v.atualizadoPor}` : ''}
          </p>
          {v.faltantes.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-warning-50 px-3 py-2 text-sm text-warning-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Faltam: {v.faltantes.map((f) => `${f} ${ELEMENTO_POR_ID[f]?.nome ?? ''}`).join(' · ')}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-ink-100 bg-ink-50/50 px-3 py-2">
          {podeFilhos && (
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Plus aria-hidden />}
              onClick={() => onNovaAbaixo({ id: v.id, parentId: v.parentId, nivel: v.nivel, codigo: v.codigo, titulo: v.titulo, datas: v.datas, completa: true, totalDocumentos: 0, totalDossies: 0 })}
            >
              Unidade abaixo
            </Button>
          )}
          <Button size="sm" variant="ghost" leftIcon={<Printer aria-hidden />} loading={imprimindo === 'inventario'} onClick={() => pdf('inventario')}>
            Inventário (PDF)
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<Printer aria-hidden />} loading={imprimindo === 'catalogo'} onClick={() => pdf('catalogo')}>
            Catálogo (PDF)
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto text-danger-600" leftIcon={<Trash2 aria-hidden />} onClick={() => setExcluir(true)}>
            Excluir
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b border-ink-100 p-3">
          <Tabs
            value={aba}
            onChange={setAba}
            items={ABAS.map((a) => ({
              ...a,
              count: a.id === 'vinculos' ? v.totalDocumentos + v.dossies.length : undefined,
            }))}
          />
        </div>

        <div className="space-y-4 p-5">
          {aba !== 'vinculos' && (
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">{AREAS_NOBRADE[Number(aba) - 1]!.nome}</p>
          )}
          {aba === '1' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {campo(
                'codigo',
                <Input id="el-codigo" value={form.codigo} onChange={(e) => set('codigo', e.target.value)} />,
                <span className="block">Código completo: <strong className="font-mono">{v.codigoReferencia}</strong></span>,
              )}
              {campo('nivel', <Input id="el-nivel" value={NIVEL_DESCRICAO_LABEL[v.nivel]} disabled />)}
              <div className="sm:col-span-2">{campo('titulo', <Input id="el-titulo" value={form.titulo} onChange={(e) => set('titulo', e.target.value)} />)}</div>
              {campo(
                'datas',
                <Input id="el-datas" value={form.datas} onChange={(e) => set('datas', e.target.value)} placeholder="Ex.: 1952-1995" />,
                sugestao(v.sugestoes.datas, form.datas, () => set('datas', v.sugestoes.datas!)),
              )}
              {campo(
                'dimensaoSuporte',
                <Textarea id="el-dimensaoSuporte" rows={2} value={form.dimensaoSuporte} onChange={(e) => set('dimensaoSuporte', e.target.value)} />,
                sugestao(v.sugestoes.dimensaoSuporte, form.dimensaoSuporte, () => set('dimensaoSuporte', v.sugestoes.dimensaoSuporte!)),
              )}
            </div>
          )}
          {aba === '2' && (
            <div className="grid grid-cols-1 gap-4">
              {campo(
                'produtor',
                <Input id="el-produtor" value={form.produtor} onChange={(e) => set('produtor', e.target.value)} placeholder={v.produtorHerdado ?? ''} />,
                v.produtorHerdado && !form.produtor ? <span className="block">Herdado do nível superior: {v.produtorHerdado}</span> : null,
              )}
              {area(2)
                .filter((e) => e.chave !== 'produtor')
                .map((e) => textoLongo(e.chave as ElementoOpcional))}
            </div>
          )}
          {aba === '4' && (
            <div className="grid grid-cols-1 gap-4">
              {campo('condicoesAcesso', <Textarea id="el-condicoesAcesso" rows={3} value={form.condicoesAcesso} onChange={(e) => set('condicoesAcesso', e.target.value)} />)}
              {area(4)
                .filter((e) => e.chave !== 'condicoesAcesso')
                .map((e) => textoLongo(e.chave as ElementoOpcional))}
            </div>
          )}
          {['3', '5', '6', '7'].includes(aba) && (
            <div className="grid grid-cols-1 gap-4">{area(Number(aba)).map((e) => textoLongo(e.chave as ElementoOpcional))}</div>
          )}
          {aba === '8' && <PontosAcesso valor={form.pontosAcesso} onChange={(p) => set('pontosAcesso', p)} termo={termo} setTermo={setTermo} />}

          {aba === 'vinculos' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-600">
                  {v.totalDocumentos} documento(s) e {v.dossies.length} dossiê(s)/processo(s) descritos por esta unidade.
                </p>
                {v.nivel !== 'acervo' && (
                  <Button size="sm" leftIcon={<Link2 aria-hidden />} onClick={() => setVincular(true)}>
                    Vincular
                  </Button>
                )}
              </div>
              {v.dossies.length > 0 && (
                <ul className="divide-y divide-ink-100 rounded-[10px] border border-ink-200/70">
                  {v.dossies.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                      <FolderKanban className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                      <span className="font-mono text-xs font-semibold text-ink-600">{d.numero}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{d.assunto}</span>
                      <Button size="sm" variant="ghost" onClick={() => desvincular.mutate({ dossieIds: [d.id] })}>
                        Desvincular
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {v.documentos.length > 0 ? (
                <ul className="divide-y divide-ink-100 rounded-[10px] border border-ink-200/70">
                  {v.documentos.map((d) => (
                    <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                      <span className="shrink-0 text-xs text-ink-400">{br(d.dataDocumento)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{d.identificacao}</span>
                      {d.restrito && <Badge tone="danger">Restrito</Badge>}
                      <Button size="sm" variant="ghost" onClick={() => desvincular.mutate({ documentIds: [d.id] })}>
                        Desvincular
                      </Button>
                    </li>
                  ))}
                  {v.totalDocumentos > v.documentos.length && (
                    <li className="px-3 py-2 text-xs text-ink-400">Mostrando {v.documentos.length} de {v.totalDocumentos}. O catálogo em PDF traz todos.</li>
                  )}
                </ul>
              ) : (
                v.dossies.length === 0 && (
                  <EmptyState icon={FileText} title="Nenhum vínculo" description="Vincule os documentos do acervo e os dossiês que esta unidade descreve." />
                )
              )}
            </div>
          )}
        </div>

        {aba !== 'vinculos' && (
          <div className="flex items-center justify-end gap-2 border-t border-ink-100 px-5 py-3">
            {alterado && <span className="text-xs text-ink-500">Alterações não salvas</span>}
            <Button variant="outline" disabled={!alterado || salvar.isPending} onClick={() => setForm(paraForm(v))}>
              Descartar
            </Button>
            <Button leftIcon={<Save aria-hidden />} loading={salvar.isPending} disabled={!alterado || form.titulo.trim().length < 2 || !form.codigo.trim()} onClick={() => salvar.mutate()}>
              Salvar
            </Button>
          </div>
        )}
      </Card>

      {vincular && <VincularModal slug={slug} unidade={v} onClose={() => setVincular(false)} onFeito={aplicar} />}
      {excluir && (
        <Modal
          open
          size="sm"
          onClose={() => !remover.isPending && setExcluir(false)}
          title="Excluir unidade de descrição"
          footer={
            <>
              <Button variant="outline" onClick={() => setExcluir(false)} disabled={remover.isPending}>
                Cancelar
              </Button>
              <Button variant="danger" loading={remover.isPending} onClick={() => remover.mutate()}>
                Excluir
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-600">
            Excluir <strong className="text-ink-800">{v.codigoReferencia} — {v.titulo}</strong>? Só é possível sem unidades abaixo e sem documentos vinculados. Os documentos não são afetados.
          </p>
        </Modal>
      )}
    </div>
  );
}

function PontosAcesso({ valor, onChange, termo, setTermo }: { valor: string[]; onChange: (v: string[]) => void; termo: string; setTermo: (t: string) => void }) {
  const add = () => {
    const t = termo.trim();
    if (t && !valor.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...valor, t]);
    setTermo('');
  };
  const el = ELEMENTO_POR_CHAVE.pontosAcesso!;
  return (
    <div className="space-y-3">
      <Field label={<span><span className="font-mono text-[11px] text-ink-400">{el.id}</span> {el.nome}</span>} htmlFor="el-pontos" hint={`${el.ajuda} Enter para incluir.`}>
        <div className="flex gap-2">
          <Input
            id="el-pontos"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Ex.: Saúde pública; Hospital Municipal; Bairro Centro"
          />
          <Button variant="outline" onClick={add} disabled={!termo.trim()}>
            Incluir
          </Button>
        </div>
      </Field>
      {valor.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {valor.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 py-1 pl-3 pr-1 text-xs font-medium text-violet-600 ring-1 ring-inset ring-violet-600/15">
              {p}
              <button type="button" aria-label={`Remover ${p}`} onClick={() => onChange(valor.filter((x) => x !== p))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/60">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NovaUnidade({
  slug,
  parent,
  temAcervo,
  onClose,
  onCriada,
}: {
  slug: string;
  parent: UnidadeDescricaoNo | null;
  temAcervo: boolean;
  onClose: () => void;
  onCriada: (id: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const niveis = FILHOS_PERMITIDOS[parent?.nivel ?? 'raiz'].filter((n) => n !== 'acervo' || !temAcervo);
  const [f, setF] = useState({ nivel: niveis[0] ?? 'fundo', codigo: '', titulo: '', produtor: '' });
  const criar = useMutation({
    mutationFn: () => {
      const body: UnidadeDescricaoCreateInput = {
        nivel: f.nivel,
        codigo: f.codigo.trim(),
        titulo: f.titulo.trim(),
        ...(parent ? { parentId: parent.id } : {}),
        ...(f.produtor.trim() ? { produtor: f.produtor.trim() } : {}),
      };
      return api<UnidadeDescricaoView>(`/t/${slug}/descricao`, { method: 'POST', body });
    },
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['descricao', slug], exact: true });
      toast.success(`${NIVEL_DESCRICAO_LABEL[v.nivel]} ${v.codigoReferencia} criado.`);
      onCriada(v.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para criar unidades.' : e.message) : 'Falha'),
  });
  const dicaCodigo: Partial<Record<NivelDescricao, string>> = {
    acervo: 'Ex.: BR SPPMX (país + código CODEARQ da entidade)',
    fundo: 'Ex.: SAU (sigla do órgão produtor)',
    serie: 'Ex.: 01',
    dossie: 'Ex.: 001',
  };
  return (
    <Modal
      open
      onClose={() => !criar.isPending && onClose()}
      title="Nova unidade de descrição"
      subtitle={parent ? `Abaixo de ${parent.codigo} — ${parent.titulo}` : 'No topo do quadro de arranjo'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} loading={criar.isPending} disabled={!f.codigo.trim() || f.titulo.trim().length < 2}>
            Criar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nível de descrição" htmlFor="nu-nivel" required>
          <SelectMenu id="nu-nivel" className={inputCls} value={f.nivel} onChange={(e) => setF((x) => ({ ...x, nivel: e.target.value as NivelDescricao }))}>
            {niveis.map((n) => (
              <option key={n} value={n}>{NIVEL_DESCRICAO_LABEL[n]}</option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Código" htmlFor="nu-codigo" required hint={dicaCodigo[f.nivel]}>
          <Input id="nu-codigo" value={f.codigo} onChange={(e) => setF((x) => ({ ...x, codigo: e.target.value }))} />
        </Field>
        <Field label="Título" htmlFor="nu-titulo" required className="sm:col-span-2">
          <Input id="nu-titulo" value={f.titulo} onChange={(e) => setF((x) => ({ ...x, titulo: e.target.value }))} placeholder="Ex.: Secretaria Municipal de Saúde" />
        </Field>
        <Field label="Produtor" htmlFor="nu-produtor" className="sm:col-span-2" hint={parent ? 'Deixe em branco para herdar do nível superior' : 'Órgão, pessoa ou família que produziu os documentos'}>
          <Input id="nu-produtor" value={f.produtor} onChange={(e) => setF((x) => ({ ...x, produtor: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}

function VincularModal({ slug, unidade, onClose, onFeito }: { slug: string; unidade: UnidadeDescricaoView; onClose: () => void; onFeito: (v: UnidadeDescricaoView) => void }) {
  const toast = useToast();
  const [tipo, setTipo] = useState<'documentos' | 'dossies'>('documentos');
  const [termo, setTermo] = useState('');
  const [termoDeb, setTermoDeb] = useState('');
  const [sel, setSel] = useState<Array<{ id: string; titulo: string; tipo: 'doc' | 'dossie' }>>([]);
  useEffect(() => {
    const t = setTimeout(() => setTermoDeb(termo.trim()), 350);
    return () => clearTimeout(t);
  }, [termo]);
  const { data: docs, isFetching: buscandoDocs } = useQuery<DocumentPage>({
    queryKey: ['descricao', 'busca-doc', slug, termoDeb],
    queryFn: () => api(`/t/${slug}/documents?module=acervo&pageSize=10&q=${encodeURIComponent(termoDeb)}`),
    enabled: tipo === 'documentos' && termoDeb.length >= 2,
  });
  const { data: dossies, isFetching: buscandoDossies } = useQuery<DossiesPage>({
    queryKey: ['descricao', 'busca-dossie', slug, termoDeb],
    queryFn: () => api(`/t/${slug}/dossies?situacao=todos&pageSize=10${termoDeb ? `&q=${encodeURIComponent(termoDeb)}` : ''}`),
    enabled: tipo === 'dossies',
  });
  const executar = useMutation({
    mutationFn: () =>
      api<UnidadeDescricaoView>(`/t/${slug}/descricao/${unidade.id}/vincular`, {
        method: 'POST',
        body: {
          documentIds: sel.filter((s) => s.tipo === 'doc').map((s) => s.id),
          dossieIds: sel.filter((s) => s.tipo === 'dossie').map((s) => s.id),
        },
      }),
    onSuccess: (v) => {
      onFeito(v);
      toast.success(`${sel.length} vínculo(s) incluído(s).`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para vincular.' : e.message) : 'Falha'),
  });
  const ja = (id: string) => sel.some((s) => s.id === id) || unidade.documentos.some((d) => d.id === id) || unidade.dossies.some((d) => d.id === id);
  const itens =
    tipo === 'documentos'
      ? (docs?.items ?? []).map((d) => ({ id: d.id, titulo: d.descricao || d.originalName, tipo: 'doc' as const, extra: d.nivelAcesso === 'restrito' }))
      : (dossies?.items ?? []).map((d) => ({ id: d.id, titulo: `${d.numero} — ${d.assunto}`, tipo: 'dossie' as const, extra: d.nivelAcesso === 'restrito' }));
  const buscando = tipo === 'documentos' ? buscandoDocs : buscandoDossies;

  return (
    <Modal
      open
      size="lg"
      onClose={() => !executar.isPending && onClose()}
      title="Vincular à unidade de descrição"
      subtitle={`${unidade.codigoReferencia} — ${unidade.titulo}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={executar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => executar.mutate()} loading={executar.isPending} disabled={sel.length === 0}>
            Vincular {sel.length > 0 ? `(${sel.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Tabs
          value={tipo}
          onChange={(t) => {
            setTipo(t);
            setTermo('');
          }}
          items={[
            { id: 'documentos', label: 'Documentos do acervo', icon: FileText },
            { id: 'dossies', label: 'Dossiês e processos', icon: FolderKanban },
          ]}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input aria-label="Buscar" autoFocus placeholder={tipo === 'documentos' ? 'Buscar por título, número, ementa…' : 'Número, assunto ou interessado'} className="pl-9" value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        {(tipo === 'dossies' || termoDeb.length >= 2) && (
          <ul className="max-h-60 overflow-y-auto rounded-[10px] border border-ink-200/70">
            {buscando && <li className="px-3 py-2 text-xs text-ink-500">Buscando…</li>}
            {!buscando && itens.length === 0 && <li className="px-3 py-2 text-xs text-ink-500">Nada encontrado.</li>}
            {itens.map((it) => (
              <li key={it.id} className="flex items-center gap-2 border-b border-ink-100 px-3 py-2 last:border-0">
                {it.tipo === 'doc' ? <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-hidden /> : <FolderKanban className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />}
                <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{it.titulo}</span>
                {it.extra && <Badge tone="danger">Restrito</Badge>}
                <Button size="sm" variant={ja(it.id) ? 'secondary' : 'outline'} disabled={ja(it.id)} onClick={() => setSel((s) => [...s, { id: it.id, titulo: it.titulo, tipo: it.tipo }])}>
                  {ja(it.id) ? 'Incluído' : 'Incluir'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {sel.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {sel.map((s) => (
              <span key={s.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-xs font-medium text-brand-600 ring-1 ring-inset ring-brand-600/15">
                <span className="truncate">{s.titulo}</span>
                <button type="button" aria-label={`Remover ${s.titulo}`} onClick={() => setSel((x) => x.filter((y) => y.id !== s.id))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/60">
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-400">Um documento ou dossiê é descrito por uma única unidade: vincular aqui substitui um vínculo anterior.</p>
      </div>
    </Modal>
  );
}
