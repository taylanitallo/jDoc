'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, Download, Lock } from 'lucide-react';
import type { MedicaoView } from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Boletim de medicao do mes: o orgao (fiscal) so confere; a equipe JEOS
 * tambem fecha (`podeFechar`). `base` = /t/<slug>/medicoes ou
 * /superadmin/tenants/<id>/medicoes.
 */
export function BoletimMedicao({ base, podeFechar = false }: { base: string; podeFechar?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [obs, setObs] = useState('');
  const [baixando, setBaixando] = useState(false);
  const { data: m, error } = useQuery({
    queryKey: ['medicao', base, mes],
    queryFn: () => api<MedicaoView>(`${base}/${mes}`),
    enabled: /^\d{4}-\d{2}$/.test(mes),
    retry: false,
  });
  const fechar = useMutation({
    mutationFn: () => api<MedicaoView>(`${base}/${mes}/fechar`, { method: 'POST', body: obs.trim() ? { observacao: obs.trim() } : {} }),
    onSuccess: (r) => {
      qc.setQueryData(['medicao', base, mes], r);
      toast.success('Medição fechada.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível fechar.'),
  });
  const pdf = async () => {
    setBaixando(true);
    const aba = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(`${base}/${mes}/boletim.pdf`);
      if (aba) aba.location.href = url;
    } catch {
      aba?.close();
      toast.error('Não foi possível gerar o boletim.');
    } finally {
      setBaixando(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={Calculator}
        title="Boletim de medição"
        description="Mensalidade do GED por item + páginas digitalizadas com aceite do fiscal no mês, limitadas ao saldo contratado."
        action={
          m && (
            <Badge tone={m.fechada ? 'success' : 'warning'}>
              {m.fechada ? (
                <>
                  <Lock className="mr-1 inline h-3 w-3" aria-hidden /> Fechada
                </>
              ) : (
                'Prévia'
              )}
            </Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Mês" htmlFor="md-mes">
            <Input id="md-mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </Field>
          <Button variant="outline" leftIcon={<Download aria-hidden />} loading={baixando} disabled={!m} onClick={() => void pdf()}>
            Boletim em PDF
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-danger-600">{error instanceof ApiError ? error.message : 'Não foi possível carregar.'}</p>
        ) : !m ? (
          <Skeleton rows={4} />
        ) : !m.linhas.length ? (
          <p className="text-sm text-ink-500">Nenhum item de contrato cadastrado para este órgão.</p>
        ) : (
          <>
            <p className="text-sm text-ink-600">
              Contrato {m.contrato.numero ?? '—'} · fiscal {m.contrato.fiscal ?? '—'} · disponibilidade no mês{' '}
              <strong className={m.disponibilidade !== null && m.disponibilidade < m.metaDisponibilidade ? 'text-danger-600' : 'text-ink-900'}>
                {m.disponibilidade === null ? 'sem medição' : `${m.disponibilidade.toFixed(2)}%`}
              </strong>{' '}
              (meta {m.metaDisponibilidade}%)
            </p>
            <div className="overflow-x-auto rounded-[12px] border border-ink-200/70">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                  <tr>
                    <th className="px-3 py-2 label-caps">Item</th>
                    <th className="px-3 py-2 text-right label-caps">GED</th>
                    <th className="px-3 py-2 text-right label-caps">Págs. no mês</th>
                    <th className="px-3 py-2 text-right label-caps">Medidas</th>
                    <th className="px-3 py-2 text-right label-caps">Saldo após</th>
                    <th className="px-3 py-2 text-right label-caps">Serviço</th>
                    <th className="px-3 py-2 text-right label-caps">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {m.linhas.map((l) => (
                    <tr key={l.numero}>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-ink-900">
                          {l.numero}. {l.orgaoNome ?? l.orgaoCodigo ?? 'Geral'}
                        </span>
                        <span className="block text-xs text-ink-500">{l.descricao}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(l.valorMensalGed)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.paginasMes.toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.paginasMedidas.toLocaleString('pt-BR')}
                        {l.paginasExcedentes > 0 && <span className="block text-xs text-warning-600">+{l.paginasExcedentes} acima do saldo</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.max(0, l.paginasContratadas - l.paginasAnteriores - l.paginasMedidas).toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(l.valorServico)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{brl(l.valorTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-ink-200 bg-ink-50/60">
                  <tr>
                    <td className="px-3 py-2 font-bold text-ink-900">Total</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{brl(m.totais.ged)}</td>
                    <td />
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{m.totais.paginasMedidas.toLocaleString('pt-BR')}</td>
                    <td />
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{brl(m.totais.servico)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{brl(m.totais.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {m.paginasSemItem > 0 && (
              <p className="flex items-start gap-2 rounded-[10px] bg-warning-50 px-3 py-2 text-sm text-warning-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {m.paginasSemItem} página(s) aceita(s) de secretaria sem item no contrato não entram na medição.
              </p>
            )}
            {m.fechada ? (
              <p className="text-xs text-ink-500">
                Fechada por {m.fechadaPor} em {fmtDateTime(m.fechadaEm)}
                {m.observacao ? ` — ${m.observacao}` : ''}
              </p>
            ) : (
              podeFechar && (
                <div className="space-y-2 border-t border-ink-100 pt-4">
                  <Field label="Observação do fechamento" htmlFor="md-obs">
                    <Textarea id="md-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: conferido com o fiscal em reunião de 05/11" />
                  </Field>
                  <Button leftIcon={<Lock aria-hidden />} loading={fechar.isPending} onClick={() => fechar.mutate()}>
                    Fechar medição do mês
                  </Button>
                  <p className="text-xs text-ink-500">Fechada, a medição não muda mais e as páginas dela contam no saldo dos meses seguintes.</p>
                </div>
              )
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
