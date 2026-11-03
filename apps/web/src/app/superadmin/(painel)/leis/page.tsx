'use client';

import { useQuery } from '@tanstack/react-query';
import { ESFERA_LEI_LABEL, type SincronizacaoLeisView } from '@jdoc/shared';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';

export default function LeisPlataformaPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['sa-leis-status'],
    queryFn: () => api<SincronizacaoLeisView>('/superadmin/leis-referencia/status'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leis de referência"
        description="Biblioteca sincronizada todo dia às 05h30 com o repositório ctresb/leis. Cada órgão vê federal, o próprio estado e o próprio município."
      />
      {isLoading || !data ? (
        <SkeletonTable />
      ) : (
        <>
          <Card>
            <CardHeader title="Acervo carregado" description={`Última sincronização: ${data.ultimaExecucao ? fmtDateTime(data.ultimaExecucao) : 'nunca'}`} />
            <ul className="divide-y divide-ink-100">
              {data.totais.map((t) => (
                <li key={`${t.esfera}-${t.uf}-${t.municipio}`} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="text-ink-800">
                    {ESFERA_LEI_LABEL[t.esfera]}
                    {t.uf ? ` · ${t.uf}` : ''}
                    {t.municipio ? ` · ${t.municipio}` : ''}
                  </span>
                  <span className="font-semibold tabular-nums text-ink-900">{t.total.toLocaleString('pt-BR')}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Órgãos e o que cada um enxerga" description="Órgão sem município coberto vê só federal e estadual." />
            <ul className="divide-y divide-ink-100">
              {data.escopo.map((o) => (
                <li key={o.tenant} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span className="min-w-0 font-medium text-ink-900">{o.tenant}</span>
                  <span className="flex items-center gap-2 text-ink-600">
                    {o.uf ?? 'sem estado'}
                    {o.municipio ? ` · ${o.municipio}` : ''}
                    <Badge tone={!o.uf ? 'warning' : o.municipioCoberto ? 'success' : 'neutral'}>
                      {!o.uf ? 'Só federal' : o.municipioCoberto ? 'Município coberto' : 'Município sem leis na origem'}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
