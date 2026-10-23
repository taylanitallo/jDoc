'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessagesSquare, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import {
  CANAL_CHAMADO_LABEL,
  CATEGORIA_CHAMADO_LABEL,
  CRITICIDADES,
  CRITICIDADE_LABEL,
  STATUS_CHAMADO,
  STATUS_CHAMADO_LABEL,
  type AdminEquipe,
  type ChamadoDetalhe,
  type ChamadoUpdateInput,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, CardHeader, Field, PageHeader, Select, Textarea } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { Anexos, BadgesChamado, Conversa, Responder } from '@/components/chamados/conversa';
import { useAdmin, usePode } from '@/components/platform/admin-context';

export default function ChamadoPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const eu = useAdmin();
  const owner = usePode('owner');
  const chave = ['sa-chamado', id];
  const { data: c } = useQuery({ queryKey: chave, queryFn: () => api<ChamadoDetalhe>(`/superadmin/tickets/${id}`), refetchInterval: 30_000 });
  // So o owner lista a equipe; os outros escolhem entre "eu" e ninguem.
  const { data: equipe } = useQuery({ queryKey: ['superadmin', 'equipe'], queryFn: () => api<AdminEquipe[]>('/superadmin/admins'), enabled: owner });
  const [f, setF] = useState({ status: '', criticidade: '', responsavelId: '', justificativa: '', contingencia: '' });
  useEffect(() => {
    if (c)
      setF({
        status: c.status,
        criticidade: c.criticidade,
        responsavelId: c.responsavelId ?? '',
        justificativa: c.justificativa ?? '',
        contingencia: c.contingencia ?? '',
      });
  }, [c]);

  const salvar = useMutation({
    mutationFn: () => {
      const body: ChamadoUpdateInput = {
        status: f.status as ChamadoUpdateInput['status'],
        criticidade: f.criticidade as ChamadoUpdateInput['criticidade'],
        responsavelId: f.responsavelId || null,
        justificativa: f.justificativa.trim() || null,
        contingencia: f.contingencia.trim() || null,
      };
      return api<ChamadoDetalhe>(`/superadmin/tickets/${id}`, { method: 'PATCH', body });
    },
    onSuccess: (d) => {
      qc.setQueryData(chave, d);
      void qc.invalidateQueries({ queryKey: ['sa-chamados'] });
      toast.success('Chamado atualizado.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });

  if (!c) return <Skeleton rows={10} />;
  const atrasado = c.respostaAtrasada || c.solucaoAtrasada;
  const responsaveis = owner ? (equipe ?? []).filter((a) => a.ativo) : eu ? [{ id: eu.id, nome: eu.nome }] : [];
  const urlAnexo = (key: string) => `/superadmin/tickets/${id}/anexos/${key}`;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/superadmin/chamados', label: 'Chamados' }}
        title={`Nº ${c.numero} — ${c.titulo}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <BadgesChamado c={c} />
            <span>
              {c.orgao} · {c.abertoPor} · {CANAL_CHAMADO_LABEL[c.canal as keyof typeof CANAL_CHAMADO_LABEL] ?? c.canal} ·{' '}
              {CATEGORIA_CHAMADO_LABEL[c.categoria as keyof typeof CATEGORIA_CHAMADO_LABEL] ?? c.categoria}
            </span>
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader icon={MessagesSquare} title="Descrição" description={`Aberto em ${fmtDateTime(c.criadoEm)}`} />
            <div className="p-5">
              <p className="whitespace-pre-wrap text-sm text-ink-800">{c.descricao}</p>
              <Anexos anexos={c.anexos} urlDe={urlAnexo} />
            </div>
          </Card>
          <Card>
            <CardHeader icon={MessagesSquare} title="Conversa" description="Mensagens internas ficam só com a equipe." />
            <div className="space-y-5 p-5">
              <Conversa mensagens={c.mensagens} urlAnexo={urlAnexo} perspectiva="equipe" />
              <Responder
                rotaAnexo={`/superadmin/tickets/${id}/anexos`}
                podeInterna
                desabilitado={c.status === 'fechado' || c.status === 'cancelado'}
                onEnviar={async (m) => {
                  try {
                    const d = await api<ChamadoDetalhe>(`/superadmin/tickets/${id}/messages`, { method: 'POST', body: m });
                    qc.setQueryData(chave, d);
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : 'Não foi possível enviar.');
                    throw e;
                  }
                }}
              />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={SlidersHorizontal} title="Andamento" />
            <div className="space-y-4 p-5">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="label-caps">Responder até</dt>
                  <dd className={c.respostaAtrasada ? 'font-semibold text-danger-600' : 'text-ink-800'}>{fmtDateTime(c.prazoResposta)}</dd>
                  {c.respondidoEm && <dd className="text-xs text-ink-500">respondido {fmtDateTime(c.respondidoEm)}</dd>}
                </div>
                <div>
                  <dt className="label-caps">Resolver até</dt>
                  <dd className={c.solucaoAtrasada ? 'font-semibold text-danger-600' : 'text-ink-800'}>{fmtDateTime(c.prazoSolucao)}</dd>
                  {c.resolvidoEm && <dd className="text-xs text-ink-500">resolvido {fmtDateTime(c.resolvidoEm)}</dd>}
                </div>
              </dl>
              <Field label="Situação" htmlFor="ch-status">
                <Select id="ch-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                  {STATUS_CHAMADO.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_CHAMADO_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Criticidade" htmlFor="ch-crit" hint="Mudar recalcula os prazos a partir da abertura.">
                <Select id="ch-crit" value={f.criticidade} onChange={(e) => setF({ ...f, criticidade: e.target.value })}>
                  {CRITICIDADES.map((x) => (
                    <option key={x} value={x}>
                      {CRITICIDADE_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Responsável" htmlFor="ch-resp">
                <Select id="ch-resp" value={f.responsavelId} onChange={(e) => setF({ ...f, responsavelId: e.target.value })}>
                  <option value="">Ninguém</option>
                  {c.responsavelId && !responsaveis.some((r) => r.id === c.responsavelId) && <option value={c.responsavelId}>{c.responsavel}</option>}
                  {responsaveis.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
                </Select>
              </Field>
              {atrasado && (
                <Field
                  label="Justificativa do atraso"
                  htmlFor="ch-just"
                  required={['resolvido', 'fechado'].includes(f.status)}
                  hint="Obrigatória para encerrar um chamado fora do prazo."
                >
                  <Textarea id="ch-just" value={f.justificativa} onChange={(e) => setF({ ...f, justificativa: e.target.value })} />
                </Field>
              )}
              <Button className="w-full" onClick={() => salvar.mutate()} loading={salvar.isPending}>
                Salvar andamento
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader icon={ShieldAlert} title="Plano de contingência" description="O que o órgão pode fazer enquanto não há solução." />
            <div className="space-y-3 p-5">
              <Textarea value={f.contingencia} onChange={(e) => setF({ ...f, contingencia: e.target.value })} className="min-h-28" aria-label="Plano de contingência" />
              <Button variant="outline" className="w-full" onClick={() => salvar.mutate()} loading={salvar.isPending}>
                Salvar plano
              </Button>
            </div>
          </Card>
          {atrasado && !c.justificativa && (
            <p className="flex items-start gap-2 rounded-[12px] bg-danger-50 p-3 text-sm text-danger-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Prazo estourado. Registre a justificativa antes de encerrar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
