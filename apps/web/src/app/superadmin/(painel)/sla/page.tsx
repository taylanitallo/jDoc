'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, CalendarOff, Clock, FileDown, Printer, Smile, Trash2 } from 'lucide-react';
import { CRITICIDADE_LABEL, PRAZOS_SLA, feriadosNacionais, type FeriadoInput, type RelatorioSla, type TenantOverview } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate, todayFortaleza } from '@/lib/format';
import { Button, Card, CardHeader, Field, Input, PageHeader, Select, StatCard } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';

const limite = (d: string, fim: boolean) => new Date(`${d}T${fim ? '23:59:59' : '00:00:00'}-03:00`).toISOString();
const pctTxt = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);
const hTxt = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')} h úteis`);

/** Relatorio de SLA por periodo e orgao; exporta CSV e PDF (impressao). */
export default function SlaPage() {
  const hoje = todayFortaleza();
  const [de, setDe] = useState(`${hoje.slice(0, 8)}01`);
  const [ate, setAte] = useState(hoje);
  const [tenantId, setTenantId] = useState('');
  const { data: orgaos } = useQuery({ queryKey: ['sa-tenants'], queryFn: () => api<TenantOverview[]>('/superadmin/tenants') });
  const qs = new URLSearchParams({ de: limite(de, false), ate: limite(ate, true), ...(tenantId ? { tenantId } : {}) });
  const { data: r, isLoading } = useQuery({ queryKey: ['sa-sla', qs.toString()], queryFn: () => api<RelatorioSla>(`/superadmin/sla-report?${qs}`) });

  const exportarCsv = () => {
    if (!r) return;
    const linhas = [
      ['Órgão', 'Chamados', 'Resposta no prazo (%)', 'Solução no prazo (%)', 'Satisfação média'],
      ...r.porOrgao.map((o) => [o.orgao, String(o.total), o.respostaNoPrazoPct ?? '', o.solucaoNoPrazoPct ?? '', o.satisfacaoMedia ?? '']),
      [],
      ['Criticidade', 'Chamados', 'Resposta no prazo (%)', 'Solução no prazo (%)'],
      ...r.porCriticidade.map((c) => [CRITICIDADE_LABEL[c.criticidade], String(c.total), c.respostaNoPrazoPct ?? '', c.solucaoNoPrazoPct ?? '']),
    ];
    // Excel em pt-BR: ponto-e-virgula como separador e virgula decimal nos numeros.
    const celula = (v: string | number) => `"${(typeof v === 'number' ? v.toLocaleString('pt-BR') : v).replace(/"/g, '""')}"`;
    const csv = linhas.map((l) => l.map(celula).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sla-${de}-a-${ate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="SLA"
        description={`Cumprimento dos prazos de ${fmtDate(de)} a ${fmtDate(ate)}, em horas úteis.`}
        actions={
          <>
            <Button variant="outline" leftIcon={<FileDown aria-hidden />} onClick={exportarCsv} disabled={!r}>
              Exportar CSV
            </Button>
            <Button variant="outline" leftIcon={<Printer aria-hidden />} onClick={() => window.print()} disabled={!r}>
              Exportar PDF
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3" data-print-hide>
        <Field label="De" htmlFor="sla-de">
          <Input id="sla-de" type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="sla-ate">
          <Input id="sla-ate" type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </Field>
        <Field label="Órgão" htmlFor="sla-org">
          <Select id="sla-org" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">Todos</option>
            {(orgaos ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isLoading || !r ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Chamados" value={r.total.toLocaleString('pt-BR')} icon={BadgeCheck} tone="brand" />
            <StatCard label="Resposta no prazo" value={pctTxt(r.respostaNoPrazoPct)} icon={Clock} tone={(r.respostaNoPrazoPct ?? 100) >= 90 ? 'success' : 'warning'} hint={`média ${hTxt(r.mediaRespostaH)}`} />
            <StatCard label="Solução no prazo" value={pctTxt(r.solucaoNoPrazoPct)} icon={BadgeCheck} tone={(r.solucaoNoPrazoPct ?? 100) >= 90 ? 'success' : 'warning'} hint={`média ${hTxt(r.mediaSolucaoH)}`} />
            <StatCard label="Atrasados em aberto" value={String(r.atrasadosAbertos)} icon={AlertTriangle} tone={r.atrasadosAbertos ? 'danger' : 'success'} />
            <StatCard label="Satisfação média" value={r.satisfacaoMedia === null ? '—' : `${r.satisfacaoMedia.toLocaleString('pt-BR')} de 5`} icon={Smile} tone="teal" />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader icon={Clock} title="Por criticidade" description="Prazos: resposta / solução em horas úteis." />
              <table className="w-full text-sm">
                <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                  <tr>
                    <th className="px-4 py-2.5 label-caps">Criticidade</th>
                    <th className="px-4 py-2.5 label-caps">Prazos</th>
                    <th className="px-4 py-2.5 text-right label-caps">Qtd.</th>
                    <th className="px-4 py-2.5 text-right label-caps">Resposta</th>
                    <th className="px-4 py-2.5 text-right label-caps">Solução</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {r.porCriticidade.map((c) => (
                    <tr key={c.criticidade}>
                      <td className="px-4 py-2.5 font-semibold text-ink-800">{CRITICIDADE_LABEL[c.criticidade]}</td>
                      <td className="px-4 py-2.5 text-ink-600">
                        {PRAZOS_SLA[c.criticidade].resposta} h / {PRAZOS_SLA[c.criticidade].solucao} h
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{c.total}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{pctTxt(c.respostaNoPrazoPct)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{pctTxt(c.solucaoNoPrazoPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader icon={BadgeCheck} title="Por órgão" />
              {r.porOrgao.length === 0 ? (
                <p className="p-5 text-sm text-ink-500">Nenhum chamado no período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                    <tr>
                      <th className="px-4 py-2.5 label-caps">Órgão</th>
                      <th className="px-4 py-2.5 text-right label-caps">Qtd.</th>
                      <th className="px-4 py-2.5 text-right label-caps">Resposta</th>
                      <th className="px-4 py-2.5 text-right label-caps">Solução</th>
                      <th className="px-4 py-2.5 text-right label-caps">Satisfação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {r.porOrgao.map((o) => (
                      <tr key={o.tenantId}>
                        <td className="px-4 py-2.5 text-ink-800">{o.orgao}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{o.total}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{pctTxt(o.respostaNoPrazoPct)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{pctTxt(o.solucaoNoPrazoPct)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{o.satisfacaoMedia ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
      <Feriados />
    </div>
  );
}

/** Feriados extras (municipais/estaduais) que o calculo de prazo tambem pula. */
function Feriados() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['sa-feriados'], queryFn: () => api<FeriadoInput[]>('/superadmin/feriados') });
  const [data_, setData] = useState('');
  const [nome, setNome] = useState('');
  const ano = new Date().getFullYear();
  const nacionais = [...feriadosNacionais(ano).entries()].sort();
  const salvar = useMutation({
    mutationFn: () => api('/superadmin/feriados', { method: 'POST', body: { data: data_, nome: nome.trim() } }),
    onSuccess: async () => {
      setData('');
      setNome('');
      toast.success('Feriado cadastrado.');
      await qc.invalidateQueries({ queryKey: ['sa-feriados'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  const excluir = useMutation({
    mutationFn: (d: string) => api(`/superadmin/feriados/${d}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa-feriados'] }),
  });
  return (
    <Card data-print-hide>
      <CardHeader icon={CalendarOff} title="Feriados" description={`Os nacionais entram sozinhos (${nacionais.length} em ${ano}). Cadastre aqui os estaduais e municipais.`} />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Data" htmlFor="fer-data">
              <Input id="fer-data" type="date" value={data_} onChange={(e) => setData(e.target.value)} />
            </Field>
            <Field label="Nome" htmlFor="fer-nome" className="min-w-48 flex-1">
              <Input id="fer-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Data Magna do Ceará" />
            </Field>
            <Button onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={!data_ || nome.trim().length < 2}>
              Adicionar
            </Button>
          </div>
          <ul className="divide-y divide-ink-100 rounded-[12px] border border-ink-200">
            {(data ?? []).length === 0 && <li className="px-3 py-2 text-sm text-ink-500">Nenhum feriado extra.</li>}
            {(data ?? []).map((f) => (
              <li key={f.data} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  <strong className="tabular-nums">{fmtDate(f.data)}</strong> · {f.nome}
                </span>
                <Button size="icon" variant="ghost" aria-label={`Remover ${f.nome}`} onClick={() => excluir.mutate(f.data)}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label-caps mb-2">Nacionais em {ano}</p>
          <ul className="grid gap-1 text-sm text-ink-600 sm:grid-cols-2">
            {nacionais.map(([d, n]) => (
              <li key={d}>
                <span className="tabular-nums">{fmtDate(d)}</span> · {n}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
