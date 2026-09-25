'use client';

import { useState } from 'react';
import { FilePlus2, History } from 'lucide-react';
import { ReportForm } from '@/components/reports/report-form';
import { ReportHistory } from '@/components/reports/report-history';
import { useParams } from 'next/navigation';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';

export default function PrestacaoContasPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [reload, setReload] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prestação de contas"
        description="Gere relatórios de prestação de contas com filtros personalizados."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Novo relatório" description="Escolha os filtros e gere o pacote" icon={FilePlus2} />
          <CardBody>
            <ReportForm slug={slug} tipo="prestacao_contas" onSubmit={() => setReload((r) => r + 1)} />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Histórico" description="Relatórios gerados anteriormente" icon={History} />
          <CardBody>
            <ReportHistory slug={slug} tipo="prestacao_contas" reload={reload} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}