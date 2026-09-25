'use client';

import { useState } from 'react';
import { FilePlus2, History } from 'lucide-react';
import { ReportForm } from '@/components/reports/report-form';
import { ReportHistory } from '@/components/reports/report-history';
import { useParams } from 'next/navigation';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';

export default function MidiaLegislativaPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [reload, setReload] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mídia legislativa"
        description="Gere pacotes de mídia legislativa organizados por exercício, mês e tipo."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Novo relatório" description="Escolha os filtros e gere o pacote" icon={FilePlus2} />
          <CardBody>
            <ReportForm slug={slug} tipo="midia_legislativa" onSubmit={() => setReload((r) => r + 1)} />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Histórico" description="Relatórios gerados anteriormente" icon={History} />
          <CardBody>
            <ReportHistory slug={slug} tipo="midia_legislativa" reload={reload} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}