'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Eraser, Play } from 'lucide-react';
import { JOBS, JOBS_MANUAIS, STATUS_JOB_LABEL, type JobRunView } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtDuracao } from '@/lib/format';
import { Badge, Button, Card, CardHeader, ConfirmDialog, PageHeader, Pagination, Select, type Tone } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { usePode } from '@/components/platform/admin-context';

const POR_PAGINA = 25;
const TOM: Record<JobRunView['status'], Tone> = { running: 'info', success: 'success', failed: 'danger' };

export default function JobsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = usePode('owner');
  const [job, setJob] = useState('');
  const [status, setStatus] = useState('');
  const [pagina, setPagina] = useState(1);
  const [limpar, setLimpar] = useState(false);
  const qs = new URLSearchParams({ page: String(pagina), pageSize: String(POR_PAGINA), ...(job ? { job } : {}), ...(status ? { status } : {}) });
  const { data, isLoading } = useQuery({
    queryKey: ['sa-jobs', job, status, pagina],
    queryFn: () => api<{ items: JobRunView[]; total: number }>(`/superadmin/jobs?${qs}`),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === 'running') ? 3000 : 30_000),
  });

  const executar = useMutation({
    mutationFn: (j: string) => api<{ iniciado: boolean }>('/superadmin/jobs/run', { method: 'POST', body: { job: j } }),
    onSuccess: async (r) => {
      if (r.iniciado) toast.success('Execução iniciada.');
      else toast.info('Este job já está rodando.');
      await qc.invalidateQueries({ queryKey: ['sa-jobs'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível executar.'),
  });
  const limparHist = useMutation({
    mutationFn: () => api<{ apagados: number }>('/superadmin/jobs', { method: 'DELETE' }),
    onSuccess: async (r) => {
      setLimpar(false);
      toast.success(`${r.apagados} execução(ões) apagada(s).`);
      await qc.invalidateQueries({ queryKey: ['sa-jobs'] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="Rotinas automáticas da plataforma, com trava para nunca rodarem em dobro."
        actions={
          owner && (
            <Button variant="outline" leftIcon={<Eraser aria-hidden />} onClick={() => setLimpar(true)}>
              Limpar histórico
            </Button>
          )
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {JOBS_MANUAIS.map((j) => (
          <Card key={j}>
            <CardHeader
              icon={Clock3}
              title={JOBS[j].nome}
              description={JOBS[j].descricao}
              action={
                <Button size="sm" leftIcon={<Play aria-hidden />} loading={executar.isPending && executar.variables === j} onClick={() => executar.mutate(j)}>
                  Executar agora
                </Button>
              }
            />
            <p className="px-5 py-3 text-xs text-ink-500">{JOBS[j].agenda}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Select value={job} onChange={(e) => { setJob(e.target.value); setPagina(1); }} className="sm:w-64" aria-label="Job">
          <option value="">Todos os jobs</option>
          {Object.entries(JOBS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.nome}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }} className="sm:w-48" aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_JOB_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} columns={6} label="Carregando execuções" />
      ) : !data?.items.length ? (
        <EmptyState icon={Clock3} title="Nenhuma execução" description="As execuções aparecem aqui conforme os jobs rodam." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Job</th>
                  <th className="px-4 py-3 label-caps">Situação</th>
                  <th className="px-4 py-3 label-caps">Início</th>
                  <th className="px-4 py-3 label-caps">Duração</th>
                  <th className="px-4 py-3 label-caps">Origem</th>
                  <th className="px-4 py-3 label-caps">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-900">{r.nome}</p>
                      {r.orgao && <p className="text-xs text-ink-500">{r.orgao}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={TOM[r.status]}>{STATUS_JOB_LABEL[r.status]}</Badge>
                      {r.tentativa > 1 && <span className="mt-1 block text-xs text-ink-500">{r.tentativa}ª tentativa</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-600">{fmtDateTime(r.inicio)}</td>
                    <td className="px-4 py-3 tabular-nums text-ink-600">{fmtDuracao(r.duracaoMs)}</td>
                    <td className="px-4 py-3 text-ink-600">{r.origem === 'manual' ? `Manual${r.disparadoPor ? ` · ${r.disparadoPor}` : ''}` : 'Agendado'}</td>
                    <td className="max-w-md px-4 py-3">
                      {r.erro ? <p className="break-words text-xs text-danger-600">{r.erro}</p> : <p className="text-xs text-ink-600">{r.resumo ?? '—'}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={data.total} onPageChange={setPagina} />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={limpar}
        onClose={() => setLimpar(false)}
        title="Limpar o histórico de jobs?"
        description="Apaga as execuções já terminadas. As que estão rodando continuam."
        confirmLabel="Limpar"
        loading={limparHist.isPending}
        onConfirm={() => limparHist.mutate()}
      />
    </div>
  );
}
