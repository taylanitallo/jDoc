'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardPaste, FileText, Merge, Plus, Save, Scale, Trash2, Wand2 } from 'lucide-react';
import {
  AGRUPADORES,
  TIPOS_DISPOSITIVO,
  TIPOS_NORMA,
  TIPO_DISPOSITIVO_LABEL,
  TIPO_NORMA_LABEL,
  type DispositivoInput,
  type DispositivoParse,
  type NormaCreateInput,
  type NormaView,
  type TipoDispositivo,
  type TipoNorma,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardHeader, Field, Input, SelectMenu, Switch, Textarea, TONE_VIVID, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

interface Linha {
  key: string;
  nivel: number;
  tipo: TipoDispositivo;
  rotulo: string;
  texto: string;
}

interface Estruturado {
  dispositivos: DispositivoParse[];
  sugestao: Partial<NormaCreateInput>;
  normaExistenteId: string | null;
}

let seq = 0;
const novaChave = () => `k${Date.now().toString(36)}${++seq}`;

/** Arvore do parser -> linhas com nivel (profundidade), que e o que o servidor edita. */
function paraLinhas(ds: DispositivoParse[]): Linha[] {
  const nivel = new Map<string, number>();
  return ds.map((d) => {
    const n = d.parentRef ? (nivel.get(d.parentRef) ?? 0) + 1 : 0;
    nivel.set(d.ref, n);
    return { key: novaChave(), nivel: n, tipo: d.tipo, rotulo: d.rotulo, texto: d.texto };
  });
}

/** Linhas -> arvore: o pai e a linha anterior mais proxima com nivel um abaixo. */
function paraDispositivos(linhas: Linha[]): DispositivoInput[] {
  const pilha: string[] = [];
  return linhas.map((l, i) => {
    const ref = `d${i + 1}`;
    pilha.length = l.nivel;
    const parentRef = l.nivel > 0 ? (pilha[l.nivel - 1] ?? null) : null;
    pilha[l.nivel] = ref;
    return { ref, parentRef, tipo: l.tipo, rotulo: l.rotulo.trim() || TIPO_DISPOSITIVO_LABEL[l.tipo], texto: l.texto };
  });
}

export default function EstruturarPage() {
  const { slug, documentId } = useParams<{ slug: string; documentId: string }>();
  const router = useRouter();
  const toast = useToast();
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [meta, setMeta] = useState({ tipo: 'lei' as TipoNorma, numero: '', ano: '', dataPublicacao: '', ementa: '', publicada: true });
  const [existente, setExistente] = useState<string | null>(null);
  const [colar, setColar] = useState(false);
  const [textoColado, setTextoColado] = useState('');
  const [erroExtracao, setErroExtracao] = useState<string | null>(null);

  const estruturar = useMutation({
    mutationFn: (texto?: string) => api<Estruturado>(`/t/${slug}/legislacao/documentos/${documentId}/estruturar`, { method: 'POST', body: texto ? { texto } : {} }),
    onSuccess: (r) => {
      setLinhas(paraLinhas(r.dispositivos));
      setExistente(r.normaExistenteId);
      setMeta((m) => ({
        ...m,
        tipo: (r.sugestao.tipo as TipoNorma) ?? m.tipo,
        numero: r.sugestao.numero ?? m.numero,
        ano: r.sugestao.ano ? String(r.sugestao.ano) : m.ano,
        dataPublicacao: r.sugestao.dataPublicacao ?? m.dataPublicacao,
        ementa: r.sugestao.ementa ?? m.ementa,
      }));
      setErroExtracao(null);
      setColar(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) {
        setErroExtracao(e.message);
        setColar(true);
      } else toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para estruturar normas.' : e.message) : 'Falha');
    },
  });
  // Primeira tentativa: texto ja extraido do PDF.
  useEffect(() => {
    estruturar.mutate(undefined);
  }, [documentId]);

  const salvar = useMutation({
    mutationFn: async () => {
      const dispositivos = paraDispositivos(linhas!);
      const dados = {
        tipo: meta.tipo,
        numero: meta.numero.trim(),
        ano: Number(meta.ano),
        dataPublicacao: meta.dataPublicacao || null,
        ementa: meta.ementa.trim(),
        publicada: meta.publicada,
      };
      if (existente) {
        await api(`/t/${slug}/legislacao/normas/${existente}`, { method: 'PATCH', body: dados });
        return api<NormaView>(`/t/${slug}/legislacao/normas/${existente}/dispositivos`, { method: 'PUT', body: { dispositivos } });
      }
      return api<NormaView>(`/t/${slug}/legislacao/normas`, { method: 'POST', body: { documentId, ...dados, dispositivos } });
    },
    onSuccess: (n) => {
      toast.success(`${n.rotulo} salva${n.publicada ? ' e publicada no portal' : ''}.`);
      router.push(`/${slug}/normas/${n.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao salvar'),
  });

  const upd = (i: number, parcial: Partial<Linha>) => setLinhas((ls) => ls!.map((l, k) => (k === i ? { ...l, ...parcial } : l)));
  const nivelMax = (i: number) => (i === 0 ? 0 : linhas![i - 1]!.nivel + 1);
  const contagem = useMemo(() => {
    const c: Partial<Record<TipoDispositivo, number>> = {};
    for (const l of linhas ?? []) c[l.tipo] = (c[l.tipo] ?? 0) + 1;
    return c;
  }, [linhas]);
  const valido = !!linhas?.length && meta.numero.trim() && /^\d{4}$/.test(meta.ano) && meta.ementa.trim().length >= 3;

  const abrirPdf = async () => {
    const w = window.open('', '_blank');
    try {
      const { url } = await api<{ url: string }>(`/t/${slug}/documents/${documentId}/url`);
      if (w) w.location.href = url;
    } catch (e) {
      w?.close();
      toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir o PDF');
    }
  };

  return (
    <div className="space-y-6">
      <Link href={`/${slug}/normas`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Legislação
      </Link>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.brand.chip)}>
            <Wand2 className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">{existente ? 'Corrigir estrutura do texto' : 'Estruturar texto da norma'}</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              O sistema separou o texto em artigos, parágrafos, incisos e alíneas. Confira com o PDF, corrija o que precisar e salve.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" leftIcon={<FileText aria-hidden />} onClick={abrirPdf}>
            Abrir PDF
          </Button>
          <Button variant="outline" leftIcon={<ClipboardPaste aria-hidden />} onClick={() => setColar((v) => !v)}>
            Colar texto
          </Button>
          <Button leftIcon={<Save aria-hidden />} loading={salvar.isPending} disabled={!valido} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        </div>
      </div>

      {colar && (
        <Card>
          <CardHeader title="Colar o texto da norma" icon={ClipboardPaste} description={erroExtracao ?? 'Use quando o PDF é imagem sem OCR ou o texto extraído veio ruim.'} />
          <div className="space-y-3 p-5">
            <Textarea rows={10} value={textoColado} onChange={(e) => setTextoColado(e.target.value)} placeholder={'Art. 1º ...\nArt. 2º ...\nI - ...\n§ 1º ...'} />
            <Button leftIcon={<Wand2 aria-hidden />} loading={estruturar.isPending} disabled={textoColado.trim().length < 10} onClick={() => estruturar.mutate(textoColado)}>
              Estruturar este texto
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Dados da norma" icon={Scale} />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Tipo" htmlFor="n-tipo" required>
            <SelectMenu id="n-tipo" className={inputCls} value={meta.tipo} onChange={(e) => setMeta({ ...meta, tipo: e.target.value as TipoNorma })}>
              {TIPOS_NORMA.map((t) => (
                <option key={t} value={t}>{TIPO_NORMA_LABEL[t]}</option>
              ))}
            </SelectMenu>
          </Field>
          <Field label="Número" htmlFor="n-num" required>
            <Input id="n-num" value={meta.numero} onChange={(e) => setMeta({ ...meta, numero: e.target.value })} placeholder="1.234" />
          </Field>
          <Field label="Ano" htmlFor="n-ano" required>
            <Input id="n-ano" inputMode="numeric" value={meta.ano} onChange={(e) => setMeta({ ...meta, ano: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </Field>
          <Field label="Publicação" htmlFor="n-data">
            <Input id="n-data" type="date" value={meta.dataPublicacao} onChange={(e) => setMeta({ ...meta, dataPublicacao: e.target.value })} />
          </Field>
          <label className="flex items-center gap-3 pt-6 text-sm">
            <Switch checked={meta.publicada} onChange={(v) => setMeta({ ...meta, publicada: v })} label="Publicar no portal" />
            <span>
              <span className="block font-semibold text-ink-800">Publicar no portal</span>
              <span className="block text-xs text-ink-500">Só se o documento for público</span>
            </span>
          </label>
          <Field label="Ementa" htmlFor="n-ementa" required className="sm:col-span-2 xl:col-span-5">
            <Textarea id="n-ementa" rows={2} value={meta.ementa} onChange={(e) => setMeta({ ...meta, ementa: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Dispositivos"
          icon={FileText}
          description={
            linhas
              ? `${contagem.artigo ?? 0} artigo(s), ${contagem.paragrafo ?? 0} parágrafo(s), ${contagem.inciso ?? 0} inciso(s), ${contagem.alinea ?? 0} alínea(s). Use as setas para mudar o nível.`
              : undefined
          }
        />
        {estruturar.isPending && !linhas ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3, 4].map((k) => (
              <div key={k} className="h-12 animate-pulse rounded-[10px] bg-ink-100" />
            ))}
          </div>
        ) : !linhas || linhas.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={FileText} title="Nenhum dispositivo" description="Cole o texto da norma para o sistema separar os artigos." />
          </div>
        ) : (
          <ol className="divide-y divide-ink-100">
            {linhas.map((l, i) => {
              const agrupador = AGRUPADORES.includes(l.tipo);
              return (
                <li key={l.key} className={cn('group flex gap-2 py-2 pr-3', agrupador && 'bg-ink-50/60')} style={{ paddingLeft: `${0.75 + l.nivel * 1.5}rem` }}>
                  <div className="flex shrink-0 flex-col gap-1 pt-1">
                    {/* select nativo de proposito: normas longas tem centenas de linhas. */}
                    <select
                      aria-label="Tipo"
                      value={l.tipo}
                      onChange={(e) => upd(i, { tipo: e.target.value as TipoDispositivo })}
                      className="h-8 w-28 rounded-[8px] border border-ink-200 bg-surface px-1.5 text-xs text-ink-700"
                    >
                      {TIPOS_DISPOSITIVO.map((t) => (
                        <option key={t} value={t}>{TIPO_DISPOSITIVO_LABEL[t]}</option>
                      ))}
                    </select>
                    <input
                      aria-label="Rótulo"
                      value={l.rotulo}
                      onChange={(e) => upd(i, { rotulo: e.target.value })}
                      className="h-8 w-28 rounded-[8px] border border-ink-200 bg-surface px-2 text-xs font-semibold text-ink-900"
                    />
                  </div>
                  <textarea
                    aria-label={`Texto de ${l.rotulo}`}
                    value={l.texto}
                    rows={Math.min(8, Math.max(2, Math.ceil(l.texto.length / 110)))}
                    onChange={(e) => upd(i, { texto: e.target.value })}
                    className={cn(
                      'min-w-0 flex-1 resize-y rounded-[8px] border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink-800 hover:border-ink-200 focus:border-brand-400 focus:bg-surface focus:outline-none',
                      agrupador && 'font-semibold uppercase',
                    )}
                  />
                  <div className="flex shrink-0 flex-col gap-0.5 opacity-60 group-hover:opacity-100">
                    <div className="flex gap-0.5">
                      <button type="button" title="Subir um nível" disabled={l.nivel === 0} onClick={() => upd(i, { nivel: l.nivel - 1 })} className="rounded p-1 text-ink-500 hover:bg-ink-100 disabled:opacity-30">
                        <ChevronLeft className="h-4 w-4" aria-hidden />
                      </button>
                      <button type="button" title="Descer um nível (ficar dentro do anterior)" disabled={l.nivel >= nivelMax(i)} onClick={() => upd(i, { nivel: l.nivel + 1 })} className="rounded p-1 text-ink-500 hover:bg-ink-100 disabled:opacity-30">
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        title="Juntar com o anterior (texto quebrado errado)"
                        disabled={i === 0}
                        onClick={() =>
                          setLinhas((ls) => {
                            const n = [...ls!];
                            n[i - 1] = { ...n[i - 1]!, texto: `${n[i - 1]!.texto} ${l.rotulo} ${l.texto}`.replace(/\s+/g, ' ').trim() };
                            n.splice(i, 1);
                            return n;
                          })
                        }
                        className="rounded p-1 text-ink-500 hover:bg-ink-100 disabled:opacity-30"
                      >
                        <Merge className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Inserir dispositivo abaixo"
                        onClick={() => setLinhas((ls) => [...ls!.slice(0, i + 1), { key: novaChave(), nivel: l.nivel, tipo: l.tipo, rotulo: '', texto: '' }, ...ls!.slice(i + 1)])}
                        className="rounded p-1 text-ink-500 hover:bg-ink-100"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    <button type="button" title="Excluir" onClick={() => setLinhas((ls) => ls!.filter((_, k) => k !== i))} className="rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {linhas && linhas.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-ink-100 px-5 py-3">
            <p className="text-xs text-ink-500">
              <Badge tone="info">Dica</Badge> Incisos depois de um parágrafo ficam dentro dele; use as setas se o sistema errou o nível.
            </p>
            <Button leftIcon={<Save aria-hidden />} loading={salvar.isPending} disabled={!valido} onClick={() => salvar.mutate()}>
              Salvar
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
