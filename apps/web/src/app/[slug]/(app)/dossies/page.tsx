'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, FolderOpen, Link2, Lock, Plus, Search } from 'lucide-react';
import {
  TIPOS_DOSSIE,
  TIPO_DOSSIE_LABEL,
  classeTemTemporalidade,
  type ClassificacaoView,
  type DossieCreateInput,
  type DossiesPage,
  type DossieView,
  type TipoDossie,
  type UsuarioAtual,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, Field, Input, Modal, Pagination, SelectMenu, Tabs, Textarea, TONE_VIVID, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

const br = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—');

export default function DossiesPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [situacao, setSituacao] = useState<'abertos' | 'encerrados' | 'todos'>('abertos');
  const [tipo, setTipo] = useState<TipoDossie | ''>('');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [novo, setNovo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(busca.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  const { data, isLoading, error } = useQuery<DossiesPage>({
    queryKey: ['dossies', slug, situacao, tipo, q, page],
    queryFn: () => api(`/t/${slug}/dossies?situacao=${situacao}&page=${page}&pageSize=20${tipo ? `&tipo=${tipo}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (p) => p,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.brand.chip)}>
            <FolderKanban className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Dossiês e processos</h1>
            <p className="mt-0.5 text-sm text-ink-500">Documentos agrupados em conjunto: a temporalidade conta do encerramento e o conjunto se move inteiro.</p>
          </div>
        </div>
        <Button onClick={() => setNovo(true)} leftIcon={<Plus aria-hidden />}>
          Abrir dossiê ou processo
        </Button>
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
              { id: 'abertos', label: 'Abertos' },
              { id: 'encerrados', label: 'Encerrados' },
              { id: 'todos', label: 'Todos' },
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <SelectMenu aria-label="Tipo" className={cn(inputCls, 'sm:w-44')} value={tipo} onChange={(e) => { setTipo(e.target.value as TipoDossie | ''); setPage(1); }}>
              <option value="">Dossiês e processos</option>
              {TIPOS_DOSSIE.map((t) => (
                <option key={t} value={t}>{TIPO_DOSSIE_LABEL[t]}s</option>
              ))}
            </SelectMenu>
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input type="search" aria-label="Buscar" placeholder="Número, assunto ou interessado" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
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
            <EmptyState icon={FolderOpen} title="Nenhum dossiê ou processo" description={q ? 'Nada encontrado com essa busca.' : 'Abra um processo (ex.: licitação) ou dossiê (ex.: pasta funcional) e junte os documentos.'} />
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.items.map((d) => (
              <li key={d.id}>
                <Link href={`/${slug}/dossies/${d.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-brand-50/40 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={d.tipo === 'processo' ? 'brand' : 'teal'}>{TIPO_DOSSIE_LABEL[d.tipo]}</Badge>
                      <span className="font-mono text-sm font-semibold text-ink-900">{d.numero}</span>
                      {d.nivelAcesso === 'restrito' && <Badge tone="danger">Restrito</Badge>}
                      {d.apensadoA && (
                        <span className="flex items-center gap-1 text-xs text-ink-500">
                          <Link2 className="h-3.5 w-3.5" aria-hidden />
                          apensado ao {d.apensadoA.numero}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-medium text-ink-800">{d.assunto}</p>
                    <p className="text-xs text-ink-400">
                      {d.interessado ? `${d.interessado} · ` : ''}
                      {d.classeCodigo ? `Classe ${d.classeCodigo} · ` : 'Sem classe · '}
                      {d.totalDocumentos} documento(s) · {d.totalPaginas} pág. · aberto em {br(d.dataAbertura)}
                      {d.totalApensos > 0 ? ` · ${d.totalApensos} apenso(s)` : ''}
                    </p>
                  </div>
                  <Badge tone={d.status === 'aberto' ? 'info' : 'neutral'}>{d.status === 'aberto' ? 'Aberto' : `Encerrado em ${br(d.dataEncerramento)}`}</Badge>
                </Link>
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

      {novo && <NovoDossie slug={String(slug)} onClose={() => setNovo(false)} onCriado={(id) => router.push(`/${slug}/dossies/${id}`)} />}
    </div>
  );
}

function NovoDossie({ slug, onClose, onCriado }: { slug: string; onClose: () => void; onCriado: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: usuario } = useQuery<UsuarioAtual>({ queryKey: ['auth', 'me', slug], queryFn: () => api(`/t/${slug}/auth/me`) });
  const { data: classes } = useQuery<ClassificacaoView[]>({ queryKey: ['arquivistica', 'classificacoes'], queryFn: () => api(`/t/${slug}/arquivistica/classificacoes`) });
  const [f, setF] = useState({ tipo: 'processo' as TipoDossie, numero: '', assunto: '', interessado: '', classificacaoId: '', nivelAcesso: '', dataAbertura: '', observacoes: '' });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // Ja vem restrito para quem ve restritos; quem nao ve so pode abrir publico.
  const nivel = (f.nivelAcesso || (usuario && !usuario.podeVerRestrito ? 'publico' : 'restrito')) as 'publico' | 'restrito';
  const criar = useMutation({
    mutationFn: () => {
      const body: DossieCreateInput = {
        tipo: f.tipo,
        assunto: f.assunto.trim(),
        ...(f.numero.trim() ? { numero: f.numero.trim() } : {}),
        ...(f.interessado.trim() ? { interessado: f.interessado.trim() } : {}),
        ...(f.classificacaoId ? { classificacaoId: f.classificacaoId } : {}),
        ...(usuario ? { nivelAcesso: nivel } : {}),
        ...(f.dataAbertura ? { dataAbertura: f.dataAbertura } : {}),
        ...(f.observacoes.trim() ? { observacoes: f.observacoes.trim() } : {}),
      };
      return api<DossieView>(`/t/${slug}/dossies`, { method: 'POST', body });
    },
    onSuccess: (d) => {
      toast.success(`${TIPO_DOSSIE_LABEL[d.tipo]} ${d.numero} aberto.`);
      qc.invalidateQueries({ queryKey: ['dossies'] });
      onCriado(d.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para abrir dossiês.' : e.message) : 'Falha'),
  });
  const utilizaveis = (classes ?? []).filter((c) => c.ativo && classeTemTemporalidade(c));

  return (
    <Modal
      open
      size="lg"
      onClose={() => !criar.isPending && onClose()}
      title="Abrir dossiê ou processo"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} loading={criar.isPending} disabled={f.assunto.trim().length < 3}>
            Abrir
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="ds-tipo" required>
          <SelectMenu id="ds-tipo" className={inputCls} value={f.tipo} onChange={(e) => set('tipo', e.target.value as TipoDossie)}>
            <option value="processo">Processo (ex.: licitação, requerimento)</option>
            <option value="dossie">Dossiê (ex.: pasta funcional, obra)</option>
          </SelectMenu>
        </Field>
        <Field label="Número" htmlFor="ds-num" hint="Em branco: sequencial automático (001/2026)">
          <Input id="ds-num" value={f.numero} onChange={(e) => set('numero', e.target.value)} placeholder="Nº do protocolo, se houver" />
        </Field>
        <Field label="Assunto" htmlFor="ds-assunto" required className="sm:col-span-2">
          <Input id="ds-assunto" value={f.assunto} onChange={(e) => set('assunto', e.target.value)} placeholder="Ex.: Pregão 12/2024 — merenda escolar" />
        </Field>
        <Field label="Interessado" htmlFor="ds-int">
          <Input id="ds-int" value={f.interessado} onChange={(e) => set('interessado', e.target.value)} placeholder="Pessoa, empresa ou setor" />
        </Field>
        <Field label="Data de abertura" htmlFor="ds-data" hint="Em branco: hoje">
          <Input id="ds-data" type="date" value={f.dataAbertura} onChange={(e) => set('dataAbertura', e.target.value)} />
        </Field>
        <Field label="Classe (Plano de Classificação)" htmlFor="ds-classe" className="sm:col-span-2" hint="Define o prazo de guarda do conjunto">
          <SelectMenu id="ds-classe" className={inputCls} value={f.classificacaoId} onChange={(e) => set('classificacaoId', e.target.value)}>
            <option value="">Sem classe por enquanto</option>
            {utilizaveis.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Nível de acesso" htmlFor="ds-nivel" hint={usuario && !usuario.podeVerRestrito ? 'Você não tem acesso a restritos: o conjunto será público' : undefined}>
          <SelectMenu id="ds-nivel" className={inputCls} value={nivel} onChange={(e) => set('nivelAcesso', e.target.value)} disabled={usuario ? !usuario.podeVerRestrito : false}>
            <option value="restrito">Restrito</option>
            <option value="publico">Público</option>
          </SelectMenu>
        </Field>
        <Field label="Observações" htmlFor="ds-obs" className="sm:col-span-2">
          <Textarea id="ds-obs" rows={2} value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
