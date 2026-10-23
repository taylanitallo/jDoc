'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { BoletimMedicao } from '@/components/medicao/boletim';

/** Fiscal do contrato: confere o boletim de medicao de cada mes. */
export default function MedicaoPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Medição do contrato"
        description="Valores do mês por item (secretaria): mensalidade do GED e páginas digitalizadas com o seu aceite."
      />
      <BoletimMedicao base={`/t/${slug}/medicoes`} />
    </div>
  );
}
