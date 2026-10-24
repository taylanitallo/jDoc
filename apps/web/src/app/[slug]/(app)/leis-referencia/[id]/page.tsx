'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Lock } from 'lucide-react';
import { ESFERA_LEI_LABEL, type LeiDetalhe } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Card } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';

function dataBr(iso: string | null): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export default function LeiReferenciaPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const { data, isLoading, error } = useQuery<LeiDetalhe>({
    queryKey: ['lei-ref', slug, id],
    queryFn: () => api(`/t/${slug}/leis-referencia/${id}`),
  });

  return (
    <div className="space-y-5">
      <Link href={`/${slug}/leis-referencia`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Todas as leis
      </Link>
      {error ? (
        <EmptyState icon={Lock} title="Lei não encontrada" description={error instanceof ApiError ? error.message : 'Falha ao carregar'} />
      ) : isLoading || !data ? (
        <div className="h-40 animate-pulse rounded-[12px] bg-ink-100" />
      ) : (
        <Card>
          <div className="space-y-2 border-b border-ink-100 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-extrabold text-ink-900 sm:text-xl">{data.titulo}</h1>
              <Badge tone="neutral">{ESFERA_LEI_LABEL[data.esfera]}</Badge>
              {data.revogada && <Badge tone="danger">Revogada</Badge>}
            </div>
            {data.ementa && <p className="text-sm text-ink-600">{data.ementa}</p>}
            <p className="text-xs text-ink-500">{[data.tipoRotulo, dataBr(data.data), data.situacao].filter(Boolean).join(' · ')}</p>
            <div className="flex flex-wrap gap-4 pt-1 text-sm">
              <a href={data.repositorio} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                Ver na origem <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              {data.fonte && /^https?:\/\//.test(data.fonte) && (
                <a href={data.fonte} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                  Fonte oficial <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </div>
          </div>
          <div className="p-5">
            {data.texto ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink-800">{data.texto}</pre>
            ) : (
              <EmptyState icon={Lock} title="Texto indisponível agora" description="A origem está fora do ar. Tente de novo mais tarde ou use “Ver na origem”." />
            )}
            <p className="mt-6 border-t border-ink-100 pt-3 text-xs text-ink-500">Cópia de referência. Confira sempre o Diário Oficial antes de citar.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
