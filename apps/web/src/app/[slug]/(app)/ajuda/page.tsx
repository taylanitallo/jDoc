'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronDown, Download, ExternalLink, GraduationCap, Plus, Printer, Search, Trash2, Users } from 'lucide-react';
import { MANUAL, buscarNoManual, type TopicoManual, type TreinamentoInput, type TreinamentoView } from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, SelectMenu, Tabs, Textarea, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { SkeletonTable } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

type Aba = 'manual' | 'treinamentos';

async function abrirPdf(path: string, onErro: (m: string) => void): Promise<void> {
  const aba = window.open('', '_blank');
  try {
    const url = await apiBlobUrl(path);
    if (aba) aba.location.href = url;
  } catch (e) {
    aba?.close();
    onErro(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão.' : e.message) : 'Não foi possível gerar o PDF.');
  }
}

export default function AjudaPage() {
  const { slug } = useParams<{ slug: string }>();
  const [aba, setAba] = useState<Aba>('manual');
  return (
    <div className="space-y-5">
      <PageHeader title="Ajuda" description="Manual de cada tela, passo a passo, e o registro das capacitações dos servidores." />
      <Tabs<Aba>
        value={aba}
        onChange={setAba}
        items={[
          { id: 'manual', label: 'Manual', icon: BookOpen },
          { id: 'treinamentos', label: 'Treinamentos', icon: GraduationCap },
        ]}
      />
      {aba === 'manual' ? <Manual slug={String(slug)} /> : <Treinamentos slug={String(slug)} />}
    </div>
  );
}

function Manual({ slug }: { slug: string }) {
  const toast = useToast();
  const [termo, setTermo] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);
  const topicos = useMemo(() => buscarNoManual(termo), [termo]);
  const areas = [...new Set(MANUAL.map((t) => t.area))];
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input aria-label="Procurar no manual" className="pl-9" placeholder="Procurar no manual (ex.: lote, sigiloso, senha)" value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        <Button
          variant="outline"
          leftIcon={<Download aria-hidden />}
          loading={baixando}
          onClick={async () => {
            setBaixando(true);
            await abrirPdf(`/t/${slug}/ajuda/manual.pdf`, toast.error);
            setBaixando(false);
          }}
        >
          Manual em PDF
        </Button>
      </div>
      {topicos.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nada encontrado" description="Tente outra palavra ou abra um chamado em Suporte." />
      ) : (
        areas
          .filter((a) => topicos.some((t) => t.area === a))
          .map((area) => (
            <section key={area} className="space-y-2">
              <h2 className="label-caps">{area}</h2>
              <div className="space-y-2">
                {topicos
                  .filter((t) => t.area === area)
                  .map((t) => (
                    <Topico key={t.id} slug={slug} t={t} aberto={aberto === t.id || !!termo.trim()} onToggle={() => setAberto(aberto === t.id ? null : t.id)} />
                  ))}
              </div>
            </section>
          ))
      )}
    </div>
  );
}

function Topico({ slug, t, aberto, onToggle }: { slug: string; t: TopicoManual; aberto: boolean; onToggle: () => void }) {
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={aberto} className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-ink-50/60">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-900">{t.titulo}</p>
          <p className="text-sm text-ink-500">{t.resumo}</p>
        </div>
        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-ink-400 transition', aberto && 'rotate-180')} aria-hidden />
      </button>
      {aberto && (
        <div className="space-y-3 border-t border-ink-100 px-5 py-4">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-800">
            {t.passos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
          {t.dicas?.map((d) => (
            <p key={d} className="rounded-[10px] bg-brand-50 px-3 py-2 text-xs text-brand-700">
              {d}
            </p>
          ))}
          {t.tela && (
            <Link href={`/${slug}${t.tela}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
              Abrir a tela <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

function Treinamentos({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editando, setEditando] = useState<TreinamentoView | 'novo' | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['treinamentos', slug],
    queryFn: () => api<TreinamentoView[]>(`/t/${slug}/ajuda/treinamentos`),
    retry: false,
  });
  const excluir = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/ajuda/treinamentos/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['treinamentos', slug] }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível excluir.'),
  });
  if (error instanceof ApiError && error.status === 403) {
    return <EmptyState icon={GraduationCap} title="Sem acesso" description="Peça ao administrador a permissão Treinamentos." />;
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button leftIcon={<Plus aria-hidden />} onClick={() => setEditando('novo')}>
          Registrar treinamento
        </Button>
      </div>
      {isLoading ? (
        <SkeletonTable rows={4} columns={3} label="Carregando treinamentos" />
      ) : !data?.length ? (
        <EmptyState icon={GraduationCap} title="Nenhum treinamento registrado" description="Registre as capacitações com a lista de participantes." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {data.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditando(t)}>
                  <p className="font-semibold text-ink-900">{t.titulo}</p>
                  <p className="text-xs text-ink-500">
                    {fmtDate(t.data)}
                    {t.cargaHoraria ? ` · ${t.cargaHoraria} h` : ''} · {t.modalidade === 'remoto' ? 'Remoto' : 'Presencial'}
                    {t.instrutor ? ` · ${t.instrutor}` : ''}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <Badge tone="info">
                    <Users className="mr-1 inline h-3 w-3" aria-hidden />
                    {t.participantes.length}
                  </Badge>
                  <Button size="sm" variant="outline" leftIcon={<Printer aria-hidden />} onClick={() => void abrirPdf(`/t/${slug}/ajuda/treinamentos/${t.id}/lista-presenca`, toast.error)}>
                    Lista de presença
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Excluir ${t.titulo}`}
                    onClick={() => window.confirm(`Excluir o treinamento "${t.titulo}"?`) && excluir.mutate(t.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editando && <TreinamentoModal slug={slug} atual={editando === 'novo' ? null : editando} onClose={() => setEditando(null)} />}
    </div>
  );
}

function TreinamentoModal({ slug, atual, onClose }: { slug: string; atual: TreinamentoView | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<TreinamentoInput>({
    titulo: atual?.titulo ?? '',
    data: atual?.data ?? new Date().toISOString().slice(0, 10),
    cargaHoraria: atual?.cargaHoraria ?? null,
    instrutor: atual?.instrutor ?? '',
    local: atual?.local ?? '',
    conteudo: atual?.conteudo ?? '',
    modalidade: atual?.modalidade ?? 'presencial',
    participantes: atual?.participantes ?? [],
  });
  const set = <K extends keyof TreinamentoInput>(k: K, v: TreinamentoInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setP = (i: number, k: 'nome' | 'cargo' | 'secretaria', v: string) =>
    set('participantes', f.participantes.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const salvar = useMutation({
    mutationFn: () => {
      const body = { ...f, participantes: f.participantes.filter((p) => p.nome.trim().length >= 2) };
      return atual ? api(`/t/${slug}/ajuda/treinamentos/${atual.id}`, { method: 'PATCH', body }) : api(`/t/${slug}/ajuda/treinamentos`, { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success('Treinamento salvo.');
      qc.invalidateQueries({ queryKey: ['treinamentos', slug] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={atual ? 'Treinamento' : 'Registrar treinamento'}
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
        <Field label="Título" htmlFor="tr-titulo" required className="sm:col-span-2">
          <Input id="tr-titulo" value={f.titulo} onChange={(e) => set('titulo', e.target.value)} />
        </Field>
        <Field label="Data" htmlFor="tr-data" required>
          <Input id="tr-data" type="date" value={f.data} onChange={(e) => set('data', e.target.value)} />
        </Field>
        <Field label="Carga horária (h)" htmlFor="tr-ch">
          <Input id="tr-ch" type="number" min={0} step="0.5" value={f.cargaHoraria ?? ''} onChange={(e) => set('cargaHoraria', e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Instrutor(a)" htmlFor="tr-inst">
          <Input id="tr-inst" value={f.instrutor ?? ''} onChange={(e) => set('instrutor', e.target.value)} />
        </Field>
        <Field label="Modalidade" htmlFor="tr-mod">
          <SelectMenu id="tr-mod" className={inputCls} value={f.modalidade} onChange={(e) => set('modalidade', e.target.value as TreinamentoInput['modalidade'])}>
            <option value="presencial">Presencial</option>
            <option value="remoto">Remoto</option>
          </SelectMenu>
        </Field>
        <Field label="Local" htmlFor="tr-local" className="sm:col-span-2">
          <Input id="tr-local" value={f.local ?? ''} onChange={(e) => set('local', e.target.value)} />
        </Field>
        <Field label="Conteúdo" htmlFor="tr-cont" className="sm:col-span-2">
          <Textarea id="tr-cont" rows={2} value={f.conteudo ?? ''} onChange={(e) => set('conteudo', e.target.value)} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-[13px] font-semibold text-ink-700">Participantes</p>
          {f.participantes.map((p, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <Input aria-label="Nome" placeholder="Nome" value={p.nome} onChange={(e) => setP(i, 'nome', e.target.value)} />
              <Input aria-label="Cargo" placeholder="Cargo" value={p.cargo ?? ''} onChange={(e) => setP(i, 'cargo', e.target.value)} />
              <Input aria-label="Secretaria" placeholder="Secretaria" value={p.secretaria ?? ''} onChange={(e) => setP(i, 'secretaria', e.target.value)} />
              <Button variant="ghost" size="icon" aria-label="Remover participante" onClick={() => set('participantes', f.participantes.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" leftIcon={<Plus aria-hidden />} onClick={() => set('participantes', [...f.participantes, { nome: '', cargo: '', secretaria: '' }])}>
            Participante
          </Button>
        </div>
      </div>
    </Modal>
  );
}
