'use client';

import { useQuery } from '@tanstack/react-query';
import { Landmark, CheckCircle2, XCircle, HardDrive, FileText, Upload } from 'lucide-react';
import type { MasterDashboard } from '@jdoc/shared';
import { api } from '@/lib/api';
import { cardCls, formatBytes } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';

export default function SuperadminDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['sa-dashboard'],
    queryFn: () => api<MasterDashboard>('/superadmin/dashboard'),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-bold text-app">Dashboard Master</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl bg-app-skeleton"
              aria-hidden
            />
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    { label: 'TOTAL DE ÓRGÃOS', value: data.totalOrgaos, icon: Landmark, accent: 'card-accent-blue' },
    { label: 'ATIVOS', value: data.orgaosAtivos, icon: CheckCircle2, accent: 'card-accent-green' },
    { label: 'INATIVOS', value: data.orgaosInativos, icon: XCircle, accent: 'card-accent-orange' },
    {
      label: 'ARMAZENAMENTO TOTAL',
      value: formatBytes(data.armazenamentoTotalBytes),
      icon: HardDrive,
      accent: 'card-accent-purple',
    },
    { label: 'DOCUMENTOS INDEXADOS', value: data.documentosIndexados, icon: FileText, accent: 'card-accent-blue' },
    { label: 'UPLOADS NO MÊS', value: data.uploadsNoMes, icon: Upload, accent: 'card-accent-green' },
  ] as const;

  const maxGrowth = Math.max(1, ...data.crescimento.map((g) => g.total));

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-app">Dashboard Master</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className={`${cardCls} p-4 ${accent}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase text-app-muted">{label}</p>
              <Icon className="h-5 w-5 text-app-muted" aria-hidden />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-app">{value}</p>
          </div>
        ))}
      </div>

      <div className={`${cardCls} p-5 card-accent-purple`}>
        <p className="mb-4 text-xs font-bold uppercase text-app-muted">
          Crescimento — órgãos cadastrados (12 meses)
        </p>
        {data.crescimento.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Sem dados no período"
            description="Não há registros de crescimento dos órgãos nos últimos 12 meses."
          />
        ) : (
          <div className="flex h-32 items-end gap-2">
            {data.crescimento.map((g) => (
              <div key={g.mes} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-app">{g.total}</span>
                <div
                  className="w-full rounded-t bg-gradient-primary"
                  style={{ height: `${(g.total / maxGrowth) * 100}%`, minHeight: 4 }}
                />
                <span className="text-[9px] text-app-muted">{g.mes}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}