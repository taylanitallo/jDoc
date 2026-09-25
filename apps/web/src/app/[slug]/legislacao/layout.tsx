'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Landmark, Scale } from 'lucide-react';
import type { TenantBranding } from '@jdoc/shared';
import { api } from '@/lib/api';

/** Portal publico da legislacao: sem login, cabecalho com o brasao e o nome do orgao. */
export default function LegislacaoPublicaLayout({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={qc}>
      <Portal>{children}</Portal>
    </QueryClientProvider>
  );
}

function Portal({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const { data: b } = useQuery<TenantBranding>({
    queryKey: ['public-branding', slug],
    queryFn: () => api(`/t/${slug}/configuracoes/public-branding`),
  });
  const nome = b?.nomeExibido || b?.nomeOrgao || String(slug);
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-ink-200 bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink-200 bg-ink-50">
            {b?.brasaoUrl ? (
              <img src={b.brasaoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <Landmark className="h-6 w-6 text-ink-400" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold uppercase tracking-tight text-ink-900 sm:text-base">{nome}</p>
            <Link href={`/${slug}/legislacao`} className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
              <Scale className="h-4 w-4" aria-hidden /> Legislação municipal
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-center text-xs text-ink-400 sm:px-6">
        Texto compilado para consulta, sem valor oficial: prevalece o texto publicado no diário/meio oficial. Publicado com jDoc — JEOS Sistemas.
      </footer>
    </div>
  );
}
