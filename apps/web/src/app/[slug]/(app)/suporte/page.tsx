'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, LifeBuoy, Paperclip, Plus, Star, X } from 'lucide-react';
import {
  CATEGORIAS_CHAMADO,
  CATEGORIA_CHAMADO_LABEL,
  CRITICIDADES,
  CRITICIDADE_DESCRICAO,
  CRITICIDADE_LABEL,
  PRAZOS_SLA,
  type AnexoChamado,
  type ChamadoCreateInput,
  type ChamadoDetalhe,
  type ChamadoResumo,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { enviarArquivo } from '@/lib/upload';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { Anexos, BadgesChamado, Conversa, Responder } from '@/components/chamados/conversa';

/** Suporte: o orgao abre e acompanha os chamados com a equipe JEOS. */
function Suporte() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const sel = useSearchParams().get('chamado');
  const [novo, setNovo] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['suporte', slug],
    queryFn: () => api<{ items: ChamadoResumo[]; total: number }>(`/t/${slug}/suporte/chamados?page=1&pageSize=100`),
  });
  const abrir = (id: string | null) => router.replace(id ? `/${slug}/suporte?chamado=${id}` : `/${slug}/suporte`);

  return (
    <div>
      <PageHeader
        title="Suporte"
        description="Fale com a equipe JEOS. Acompanhe aqui as respostas e o prazo de cada chamado."
        actions={
          <Button leftIcon={<Plus aria-hidden />} onClick={() => setNovo(true)}>
            Abrir chamado
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className={cn(sel && 'hidden lg:block')}>
          {isLoading ? (
            <Skeleton rows={5} />
          ) : !data?.items.length ? (
            <EmptyState icon={LifeBuoy} title="Nenhum chamado" description="Precisa de ajuda? Abra um chamado." />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-ink-100">
                {data.items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => abrir(c.id)}
                      aria-current={sel === c.id}
                      className={cn('w-full space-y-1 px-4 py-3 text-left transition', sel === c.id ? 'bg-brand-50' : 'hover:bg-ink-50')}
                    >
                      <span className="block text-xs text-ink-500">
                        Nº {c.numero} · {fmtRelative(c.atualizadoEm)}
                      </span>
                      <span className="block text-sm font-semibold text-ink-900">{c.titulo}</span>
                      <BadgesChamado c={c} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        {sel ? (
          <DetalheChamado slug={slug} id={sel} onVoltar={() => abrir(null)} />
        ) : (
          <div className="hidden lg:block">
            <EmptyState icon={LifeBuoy} title="Escolha um chamado" description="Ou abra um novo." />
          </div>
        )}
      </div>
      {novo && (
        <NovoChamado
          slug={slug}
          onFechar={() => setNovo(false)}
          onCriado={(id) => {
            setNovo(false);
            abrir(id);
          }}
        />
      )}
    </div>
  );
}

function DetalheChamado({ slug, id, onVoltar }: { slug: string; id: string; onVoltar: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['suporte', slug, id];
  const { data: c } = useQuery({ queryKey: chave, queryFn: () => api<ChamadoDetalhe>(`/t/${slug}/suporte/chamados/${id}`), refetchInterval: 30_000 });
  const [nota, setNota] = useState(0);
  const avaliar = useMutation({
    mutationFn: () => api<ChamadoDetalhe>(`/t/${slug}/suporte/chamados/${id}/avaliacao`, { method: 'POST', body: { nota } }),
    onSuccess: async (d) => {
      qc.setQueryData(chave, d);
      await qc.invalidateQueries({ queryKey: ['suporte', slug] });
      toast.success('Obrigado pela avaliação!');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível avaliar.'),
  });
  if (!c) return <Skeleton rows={6} />;
  const urlAnexo = (key: string) => `/t/${slug}/suporte/chamados/${id}/anexos/${key}`;
  const encerrado = c.status === 'fechado' || c.status === 'cancelado';

  return (
    <Card>
      <CardHeader
        title={`Nº ${c.numero} — ${c.titulo}`}
        description={`Aberto por ${c.abertoPor} em ${fmtDateTime(c.criadoEm)}${c.responsavel ? ` · com ${c.responsavel}` : ''}`}
        action={
          <Button size="sm" variant="ghost" className="lg:hidden" leftIcon={<ChevronLeft aria-hidden />} onClick={onVoltar}>
            Voltar
          </Button>
        }
      />
      <div className="space-y-5 p-5">
        <BadgesChamado c={c} />
        {!c.resolvidoEm && (
          <p className="text-xs text-ink-500">
            Resposta prevista até {fmtDateTime(c.prazoResposta)} · solução prevista até {fmtDateTime(c.prazoSolucao)} (horário comercial).
          </p>
        )}
        <div className="rounded-[12px] bg-ink-50 p-4">
          <p className="whitespace-pre-wrap text-sm text-ink-800">{c.descricao}</p>
          <Anexos anexos={c.anexos} urlDe={urlAnexo} />
        </div>
        {c.contingencia && (
          <div className="rounded-[12px] border border-info-500/30 bg-info-50 p-4 text-sm">
            <p className="label-caps mb-1">Enquanto isso, você pode</p>
            <p className="whitespace-pre-wrap text-ink-800">{c.contingencia}</p>
          </div>
        )}
        <Conversa mensagens={c.mensagens} urlAnexo={urlAnexo} perspectiva="orgao" />
        {c.status === 'resolvido' && !c.satisfacao && (
          <div className="rounded-[12px] border border-success-500/30 bg-success-50 p-4">
            <p className="text-sm font-semibold text-ink-900">A equipe marcou como resolvido. Como foi o atendimento?</p>
            <div className="mt-2 flex items-center gap-1" role="radiogroup" aria-label="Nota de 1 a 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={nota === n} aria-label={`${n} de 5`} onClick={() => setNota(n)}>
                  <Star className={cn('h-6 w-6', n <= nota ? 'fill-warning-500 text-warning-500' : 'text-ink-300')} aria-hidden />
                </button>
              ))}
              <Button size="sm" className="ml-3" disabled={!nota} loading={avaliar.isPending} onClick={() => avaliar.mutate()}>
                Avaliar e encerrar
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-500">Não resolveu? Responda abaixo que o chamado volta para a equipe.</p>
          </div>
        )}
        {!encerrado && (
          <Responder
            rotaAnexo={`/t/${slug}/suporte/anexos`}
            onEnviar={async (m) => {
              try {
                const d = await api<ChamadoDetalhe>(`/t/${slug}/suporte/chamados/${id}/mensagens`, { method: 'POST', body: { corpo: m.corpo, anexos: m.anexos } });
                qc.setQueryData(chave, d);
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : 'Não foi possível enviar.');
                throw e;
              }
            }}
          />
        )}
      </div>
    </Card>
  );
}

function NovoChamado({ slug, onFechar, onCriado }: { slug: string; onFechar: () => void; onCriado: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<ChamadoCreateInput>({ titulo: '', descricao: '', categoria: 'duvida', criticidade: 'media', anexos: [] });
  const [subindo, setSubindo] = useState(false);
  const criar = useMutation({
    mutationFn: () => api<ChamadoDetalhe>(`/t/${slug}/suporte/chamados`, { method: 'POST', body: f }),
    onSuccess: async (c) => {
      toast.success(`Chamado nº ${c.numero} aberto. A equipe JEOS foi avisada.`);
      await qc.invalidateQueries({ queryKey: ['suporte', slug] });
      onCriado(c.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível abrir o chamado.'),
  });
  const anexar = async (file: File) => {
    setSubindo(true);
    try {
      const a = await enviarArquivo<AnexoChamado>(`/t/${slug}/suporte/anexos`, file);
      setF((s) => ({ ...s, anexos: [...s.anexos, a] }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubindo(false);
    }
  };
  const prazo = PRAZOS_SLA[f.criticidade];
  return (
    <Modal
      open
      onClose={onFechar}
      title="Abrir chamado"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={criar.isPending} disabled={f.titulo.trim().length < 5 || f.descricao.trim().length < 10} onClick={() => criar.mutate()}>
            Abrir chamado
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assunto" htmlFor="sp-tit" required className="sm:col-span-2">
          <Input id="sp-tit" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Não consigo enviar o balancete de agosto" />
        </Field>
        <Field label="Tipo" htmlFor="sp-cat">
          <Select id="sp-cat" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value as ChamadoCreateInput['categoria'] })}>
            {CATEGORIAS_CHAMADO.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_CHAMADO_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Urgência" htmlFor="sp-crit" hint={`${CRITICIDADE_DESCRICAO[f.criticidade]}. Resposta em até ${prazo.resposta} h úteis.`}>
          <Select id="sp-crit" value={f.criticidade} onChange={(e) => setF({ ...f, criticidade: e.target.value as ChamadoCreateInput['criticidade'] })}>
            {CRITICIDADES.map((c) => (
              <option key={c} value={c}>
                {CRITICIDADE_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Descreva o que aconteceu" htmlFor="sp-desc" required className="sm:col-span-2" hint="Quanto mais detalhe (tela, passos, mensagem de erro), mais rápido resolvemos.">
          <Textarea id="sp-desc" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} className="min-h-32" />
        </Field>
        <div className="sm:col-span-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-brand-600">
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              disabled={subindo || f.anexos.length >= 5}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void anexar(file);
              }}
            />
            <Paperclip className="h-4 w-4" aria-hidden />
            {subindo ? 'Enviando…' : 'Anexar print ou PDF'}
          </label>
          {f.anexos.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {f.anexos.map((a) => (
                <li key={a.key} className="inline-flex items-center gap-1 rounded-[8px] bg-ink-100 px-2 py-1 text-xs text-ink-700">
                  {a.nome}
                  <button type="button" aria-label={`Remover ${a.nome}`} onClick={() => setF({ ...f, anexos: f.anexos.filter((x) => x.key !== a.key) })}>
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function SuportePage() {
  return (
    <Suspense>
      <Suporte />
    </Suspense>
  );
}
