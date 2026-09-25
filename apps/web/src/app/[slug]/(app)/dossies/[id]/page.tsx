'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Layers,
  FileText,
  FolderKanban,
  History,
  Link2,
  Lock,
  LockOpen,
  Plus,
  Printer,
  Search,
  Unlink,
  X,
} from 'lucide-react';
import {
  EVENTO_DOSSIE_LABEL,
  FASE_LABEL,
  TIPO_DOSSIE_LABEL,
  type DocumentPage,
  type DossiesPage,
  type DossieView,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, SelectMenu, StatCard, TONE_VIVID, Textarea, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

const br = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—');
const brHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type Acao = 'juntar' | 'encerrar' | 'reabrir' | 'apensar' | 'desapensar' | { desentranhar: { id: string; identificacao: string } } | null;

export default function DossiePage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const toast = useToast();
  const [acao, setAcao] = useState<Acao>(null);
  const [imprimindo, setImprimindo] = useState(false);
  const { data: d, isLoading, error } = useQuery<DossieView>({
    queryKey: ['dossie', slug, id],
    queryFn: () => api(`/t/${slug}/dossies/${id}`),
  });

  const capa = async () => {
    setImprimindo(true);
    const aba = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(`/t/${slug}/dossies/${id}/capa`);
      if (aba) aba.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      aba?.close();
      toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar a capa');
    } finally {
      setImprimindo(false);
    }
  };

  const voltar = (
    <Link href={`/${slug}/dossies`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-600">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Dossiês e processos
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
  if (isLoading || !d) {
    return (
      <div className="space-y-4">
        {voltar}
        <div className="h-32 animate-pulse rounded-[14px] bg-ink-100" />
        <div className="h-64 animate-pulse rounded-[14px] bg-ink-100" />
      </div>
    );
  }

  const aberto = d.status === 'aberto';
  const linha = (rotulo: string, valor: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-500">{rotulo}</dt>
      <dd className="text-right font-medium text-ink-800">{valor ?? '—'}</dd>
    </div>
  );

  const tom = d.tipo === 'processo' ? TONE_VIVID.brand : TONE_VIVID.teal;
  const guarda = d.previsaoDestinacao ? br(d.previsaoDestinacao) : '—';
  const destino = d.destinacao === 'guarda_permanente' ? 'guarda permanente' : d.destinacao ? 'eliminação' : null;
  const guardaDica = !d.classeCodigo ? 'defina a classe' : aberto ? `${destino} · conta do encerramento` : (destino ?? '');

  return (
    <div className="space-y-6">
      {voltar}
      <Card className="overflow-hidden">
        <span aria-hidden className={cn('block h-1', tom.barra)} />
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] text-white shadow-md', tom.chip)}>
              <FolderKanban className="h-7 w-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="label-caps">{TIPO_DOSSIE_LABEL[d.tipo]}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="font-mono text-2xl font-extrabold tracking-tight text-ink-900">{d.numero}</h1>
                <Badge tone={aberto ? 'info' : 'neutral'}>{aberto ? 'Aberto' : `Encerrado em ${br(d.dataEncerramento)}`}</Badge>
                {d.nivelAcesso === 'restrito' && <Badge tone="danger">Restrito</Badge>}
              </div>
              <p className="mt-0.5 truncate text-sm font-medium text-ink-700">{d.assunto}</p>
              {d.apensadoA && (
                <p className="mt-1 flex items-center gap-1 text-xs text-ink-500">
                  <Link2 className="h-3.5 w-3.5" aria-hidden /> Apensado ao{' '}
                  <Link className="font-semibold text-brand-600 hover:underline" href={`/${slug}/dossies/${d.apensadoA.id}`}>
                    {d.apensadoA.numero}
                  </Link>{' '}
                  — segue a guarda do principal
                </p>
              )}
            </div>
          </div>
          {aberto && (
            <Button className="shrink-0" onClick={() => setAcao('juntar')} leftIcon={<Plus aria-hidden />}>
              Juntar documentos
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t border-ink-100 bg-ink-50/50 px-3 py-2">
          <Button size="sm" variant="ghost" onClick={capa} loading={imprimindo} leftIcon={<Printer aria-hidden />}>
            Capa e termos (PDF)
          </Button>
          {aberto && !d.apensadoA && (
            <Button size="sm" variant="ghost" onClick={() => setAcao('encerrar')} leftIcon={<Lock aria-hidden />}>
              Encerrar
            </Button>
          )}
          {!aberto && (
            <Button size="sm" variant="ghost" onClick={() => setAcao('reabrir')} leftIcon={<LockOpen aria-hidden />}>
              Reabrir
            </Button>
          )}
          {d.apensadoA ? (
            <Button size="sm" variant="ghost" onClick={() => setAcao('desapensar')} leftIcon={<Unlink aria-hidden />}>
              Desapensar
            </Button>
          ) : (
            d.apensos.length === 0 && (
              <Button size="sm" variant="ghost" onClick={() => setAcao('apensar')} leftIcon={<Link2 aria-hidden />}>
                Apensar a outro
              </Button>
            )
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Documentos" value={d.totalDocumentos} icon={FileText} tone="brand" hint={d.totalApensos ? `+ ${d.totalApensos} apenso(s)` : 'na ordem da juntada'} />
        <StatCard label="Páginas" value={d.totalPaginas} icon={Layers} tone="violet" hint="soma dos documentos" />
        <StatCard label={aberto ? 'Aberto em' : 'Encerrado em'} value={br(aberto ? d.dataAbertura : d.dataEncerramento)} icon={CalendarDays} tone="teal" hint={aberto ? 'prazo de guarda ainda não corre' : `aberto em ${br(d.dataAbertura)}`} />
        <StatCard
          label="Destinação prevista"
          value={guarda}
          icon={Archive}
          tone={d.destinacao === 'guarda_permanente' ? 'success' : 'orange'}
          hint={guardaDica}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Documentos juntados" icon={FileText} description={`${d.totalDocumentos} documento(s) · ${d.totalPaginas} página(s), na ordem da juntada`} />
          {d.documentos.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={FileText} title="Nenhum documento juntado" description={aberto ? 'Use "Juntar documentos" para incluir documentos do acervo.' : 'Conjunto sem documentos.'} />
            </div>
          ) : (
            <ol className="divide-y divide-ink-100">
              {d.documentos.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-600">{doc.ordem}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">
                      {doc.restrito && <Lock className="mr-1 inline h-3.5 w-3.5 text-danger-600" aria-label="Restrito" />}
                      {doc.identificacao}
                    </p>
                    <p className="text-xs text-ink-400">
                      {doc.dataDocumento ? `Data ${br(doc.dataDocumento)} · ` : ''}
                      {doc.paginas ? `${doc.paginas} pág. · ` : ''}
                      juntado em {brHora(doc.juntadoEm)}
                      {doc.juntadoPor ? ` por ${doc.juntadoPor}` : ''}
                    </p>
                  </div>
                  {aberto && (
                    <Button size="sm" variant="ghost" onClick={() => setAcao({ desentranhar: { id: doc.id, identificacao: doc.identificacao } })}>
                      Desentranhar
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Dados e guarda" description="Os prazos contam do encerramento" />
            <dl className="divide-y divide-ink-100 px-5 py-2">
              {linha('Interessado', d.interessado)}
              {linha('Classe', d.classeCodigo ? `${d.classeCodigo} — ${d.classeDescricao}` : 'Sem classe')}
              {linha('Abertura', br(d.dataAbertura))}
              {linha('Fase', d.fase ? (FASE_LABEL[d.fase as keyof typeof FASE_LABEL] ?? d.fase) : null)}
              {linha('Transferência prevista', br(d.previsaoTransferencia))}
              {linha('Destinação prevista', d.previsaoDestinacao ? `${br(d.previsaoDestinacao)} · ${d.destinacao === 'guarda_permanente' ? 'guarda permanente' : 'eliminação'}` : null)}
              {linha('Local físico', d.localFisico)}
              {linha('Aberto por', d.criadoPor)}
            </dl>
            {d.observacoes && <p className="border-t border-ink-100 px-5 py-3 text-sm text-ink-600">{d.observacoes}</p>}
          </Card>

          {d.apensos.length > 0 && (
            <Card>
              <CardHeader title="Apensos" icon={Link2} description="Tramitam e são guardados junto" />
              <ul className="divide-y divide-ink-100">
                {d.apensos.map((a) => (
                  <li key={a.id}>
                    <Link href={`/${slug}/dossies/${a.id}`} className="block px-5 py-3 text-sm hover:bg-brand-50/40">
                      <span className="font-mono font-semibold text-ink-900">{a.numero}</span>
                      <span className="ml-2 text-ink-600">{a.assunto}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Histórico" icon={History} />
            <ol className="space-y-3 px-5 py-4">
              {d.eventos.map((e, i) => (
                <li key={i} className="relative border-l-2 border-brand-100 pl-4">
                  <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand-600" />
                  <p className="text-sm font-semibold text-ink-800">{EVENTO_DOSSIE_LABEL[e.tipo]}</p>
                  <p className="text-xs text-ink-600">{e.descricao}</p>
                  <p className="text-[11px] text-ink-400">
                    {brHora(e.data)}
                    {e.usuario ? ` · ${e.usuario}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {acao && <AcaoModal slug={String(slug)} dossie={d} acao={acao} onClose={() => setAcao(null)} />}
    </div>
  );
}

function AcaoModal({ slug, dossie, acao, onClose }: { slug: string; dossie: DossieView; acao: NonNullable<Acao>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [data, setData] = useState('');
  const [principalId, setPrincipalId] = useState('');
  const [docs, setDocs] = useState<Array<{ id: string; titulo: string }>>([]);
  const [termo, setTermo] = useState('');
  const [termoDeb, setTermoDeb] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTermoDeb(termo.trim()), 350);
    return () => clearTimeout(t);
  }, [termo]);

  const tipo = typeof acao === 'string' ? acao : 'desentranhar';
  const { data: achados, isFetching } = useQuery<DocumentPage>({
    queryKey: ['dossie', 'busca-doc', slug, termoDeb],
    queryFn: () => api(`/t/${slug}/documents?module=acervo&pageSize=8&q=${encodeURIComponent(termoDeb)}`),
    enabled: tipo === 'juntar' && termoDeb.length >= 2,
  });
  const { data: candidatos } = useQuery<DossiesPage>({
    queryKey: ['dossies', 'principais', slug, dossie.tipo],
    queryFn: () => api(`/t/${slug}/dossies?situacao=abertos&tipo=${dossie.tipo}&pageSize=100`),
    enabled: tipo === 'apensar',
  });
  const principais = (candidatos?.items ?? []).filter((c) => c.id !== dossie.id && !c.apensadoA);

  const executar = useMutation({
    mutationFn: () => {
      const base = `/t/${slug}/dossies/${dossie.id}`;
      switch (tipo) {
        case 'juntar':
          return api<DossieView>(`${base}/juntar`, { method: 'POST', body: { documentIds: docs.map((x) => x.id) } });
        case 'encerrar':
          return api<DossieView>(`${base}/encerrar`, { method: 'POST', body: data ? { dataEncerramento: data } : {} });
        case 'reabrir':
          return api<DossieView>(`${base}/reabrir`, { method: 'POST', body: { motivo: motivo.trim() } });
        case 'apensar':
          return api<DossieView>(`${base}/apensar`, { method: 'POST', body: { principalId } });
        case 'desapensar':
          return api<DossieView>(`${base}/desapensar`, { method: 'POST', body: { motivo: motivo.trim() } });
        default:
          return api<DossieView>(`${base}/desentranhar`, {
            method: 'POST',
            body: { documentId: typeof acao === 'object' ? acao.desentranhar.id : '', motivo: motivo.trim() },
          });
      }
    },
    onSuccess: (v) => {
      qc.setQueryData(['dossie', slug, dossie.id], v);
      qc.invalidateQueries({ queryKey: ['dossie'] });
      qc.invalidateQueries({ queryKey: ['dossies'] });
      toast.success(SUCESSO[tipo]);
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para esta ação.' : e.message) : 'Falha'),
  });

  const precisaMotivo = tipo === 'reabrir' || tipo === 'desapensar' || tipo === 'desentranhar';
  const pronto =
    tipo === 'juntar' ? docs.length > 0 : tipo === 'apensar' ? principalId !== '' : precisaMotivo ? motivo.trim().length >= 10 : true;

  return (
    <Modal
      open
      size={tipo === 'juntar' ? 'lg' : 'md'}
      onClose={() => !executar.isPending && onClose()}
      title={TITULO[tipo]}
      subtitle={`${TIPO_DOSSIE_LABEL[dossie.tipo]} ${dossie.numero}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={executar.isPending}>
            Cancelar
          </Button>
          <Button variant={tipo === 'desentranhar' ? 'danger' : 'primary'} onClick={() => executar.mutate()} loading={executar.isPending} disabled={!pronto}>
            {BOTAO[tipo]}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {tipo === 'juntar' && (
          <>
            <p className="text-sm text-ink-600">
              Os documentos passam a seguir a classe e os prazos do conjunto. Só entram documentos na fase corrente que não estejam em outro dossiê.
            </p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input aria-label="Buscar documento" autoFocus placeholder="Buscar no acervo por título, número, ementa…" className="pl-9" value={termo} onChange={(e) => setTermo(e.target.value)} />
            </div>
            {termoDeb.length >= 2 && (
              <ul className="max-h-56 overflow-y-auto rounded-[10px] border border-ink-200/70">
                {isFetching && <li className="px-3 py-2 text-xs text-ink-500">Buscando…</li>}
                {achados?.items.length === 0 && <li className="px-3 py-2 text-xs text-ink-500">Nenhum documento encontrado.</li>}
                {achados?.items.map((doc) => {
                  const ja = docs.some((x) => x.id === doc.id) || dossie.documentos.some((x) => x.id === doc.id);
                  const titulo = doc.descricao || doc.originalName;
                  return (
                    <li key={doc.id} className="flex items-center gap-2 border-b border-ink-100 px-3 py-2 last:border-0">
                      <FileText className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{titulo}</span>
                      {doc.fase !== 'corrente' && <Badge tone="neutral">{FASE_LABEL[doc.fase]}</Badge>}
                      <Button size="sm" variant={ja ? 'secondary' : 'outline'} disabled={ja} onClick={() => setDocs((xs) => [...xs, { id: doc.id, titulo }])}>
                        {ja ? 'Incluído' : 'Incluir'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            {docs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {docs.map((x) => (
                  <span key={x.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-xs font-medium text-brand-600 ring-1 ring-inset ring-brand-600/15">
                    <span className="truncate">{x.titulo}</span>
                    <button type="button" aria-label={`Remover ${x.titulo}`} onClick={() => setDocs((xs) => xs.filter((y) => y.id !== x.id))} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/60">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {tipo === 'encerrar' && (
          <>
            <p className="text-sm text-ink-600">
              Com o encerramento não se juntam mais documentos e começa a contagem do prazo de guarda do conjunto. O termo de encerramento sai na capa.
            </p>
            <Field label="Data do encerramento" htmlFor="enc-data" hint="Em branco: hoje">
              <Input id="enc-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Field>
          </>
        )}

        {tipo === 'apensar' && (
          <>
            <p className="text-sm text-ink-600">O apenso tramita junto e segue a guarda do principal. Só um nível: o principal não pode estar apensado.</p>
            <Field label="Principal" htmlFor="ap-principal" required>
              <SelectMenu id="ap-principal" className={inputCls} value={principalId} onChange={(e) => setPrincipalId(e.target.value)}>
                <option value="">Selecione…</option>
                {principais.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.numero} — {p.assunto}
                  </option>
                ))}
              </SelectMenu>
            </Field>
          </>
        )}

        {tipo === 'desentranhar' && typeof acao === 'object' && (
          <p className="text-sm text-ink-600">
            Retirar <strong className="text-ink-800">{acao.desentranhar.identificacao}</strong> do conjunto. O documento continua no acervo e o ato fica registrado no histórico.
          </p>
        )}
        {tipo === 'reabrir' && <p className="text-sm text-ink-600">Só é possível reabrir enquanto todos os documentos estão na fase corrente.</p>}

        {precisaMotivo && (
          <Field label="Motivo" htmlFor="ac-motivo" required hint="Mínimo 10 caracteres; fica no histórico">
            <Textarea id="ac-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

type TipoAcao = 'juntar' | 'encerrar' | 'reabrir' | 'apensar' | 'desapensar' | 'desentranhar';
const TITULO: Record<TipoAcao, string> = {
  juntar: 'Juntar documentos',
  encerrar: 'Encerrar',
  reabrir: 'Reabrir',
  apensar: 'Apensar a outro',
  desapensar: 'Desapensar',
  desentranhar: 'Desentranhar documento',
};
const BOTAO: Record<TipoAcao, string> = {
  juntar: 'Juntar',
  encerrar: 'Encerrar',
  reabrir: 'Reabrir',
  apensar: 'Apensar',
  desapensar: 'Desapensar',
  desentranhar: 'Desentranhar',
};
const SUCESSO: Record<TipoAcao, string> = {
  juntar: 'Documentos juntados.',
  encerrar: 'Encerrado. A contagem do prazo de guarda começou.',
  reabrir: 'Reaberto.',
  apensar: 'Apensado.',
  desapensar: 'Desapensado.',
  desentranhar: 'Documento desentranhado.',
};
