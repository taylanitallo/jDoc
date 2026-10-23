'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import { TIPO_RELEASE_LABEL, type ReleaseView } from '@jdoc/shared';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Card, PageHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { TOM_RELEASE } from '@/components/chamados/conversa';
import { marcarNovidadesVistas } from '@/components/chamados/novidades';

/** Notas de versao publicadas pela equipe JEOS. */
export default function NovidadesPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data } = useQuery({ queryKey: ['novidades', slug], queryFn: () => api<ReleaseView[]>(`/t/${slug}/novidades`) });
  useEffect(() => {
    if (data?.[0]) marcarNovidadesVistas(slug, data[0].publicadoEm);
  }, [data, slug]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Novidades" description="O que mudou no jDoc." />
      {!data ? (
        <Skeleton rows={5} />
      ) : data.length === 0 ? (
        <EmptyState icon={Megaphone} title="Nenhuma novidade por enquanto" />
      ) : (
        <ol className="space-y-4">
          {data.map((r) => (
            <li key={r.id}>
              <Card className="p-5">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-ink-900">v{r.versao}</span>
                  <Badge tone={TOM_RELEASE[r.tipo]}>{TIPO_RELEASE_LABEL[r.tipo]}</Badge>
                  <span className="text-xs text-ink-500">{fmtDate(r.publicadoEm)}</span>
                </p>
                <h2 className="mt-1 text-base font-bold text-ink-900">{r.titulo}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">{r.corpo}</p>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
