'use client';

import { useState } from 'react';
import { FileCheck, FilePlus2, History } from 'lucide-react';
import { ReportForm } from '@/components/reports/report-form';
import { ReportHistory } from '@/components/reports/report-history';
import { useParams } from 'next/navigation';
import { accentGradientStyle, cardCls } from '@/components/ui';
import { useBranding } from '@/components/branding';

export default function PrestacaoContasPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [reload, setReload] = useState(0);
  const { corDestaque } = useBranding();

  return (
    <div className="space-y-6 p-6">
      <div
        className="overflow-hidden rounded-2xl bg-gradient-primary p-6 text-white shadow-lg"
        style={accentGradientStyle(corDestaque)}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <FileCheck className="h-7 w-7" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Prestação de Contas</h1>
            <p className="mt-0.5 text-sm text-white/80">
              Gere relatórios de prestação de contas com filtros personalizados.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${cardCls} card-accent-purple lg:col-span-1 p-6`}>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-app">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300">
              <FilePlus2 className="h-5 w-5" aria-hidden />
            </span>
            Novo Relatório
          </h2>
          <ReportForm
            slug={slug}
            tipo="prestacao_contas"
            onSubmit={() => setReload(r => r + 1)}
          />
        </div>

        <div className={`${cardCls} card-accent-blue lg:col-span-2 p-6`}>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-app">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
              <History className="h-5 w-5" aria-hidden />
            </span>
            Histórico
          </h2>
          <ReportHistory slug={slug} tipo="prestacao_contas" reload={reload} />
        </div>
      </div>
    </div>
  );
}