'use client';

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { ExercicioProvider, Topbar } from '@/components/topbar';
import { BrandingProvider } from '@/components/branding';
import { DesktopUpdateBanner } from '@/components/desktop-update-banner';
import { api, setAccessToken, setLastTenantSlug } from '@/lib/api';

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  // Cache o slug do tenant no cliente HTTP (necessario para refresh single-flight).
  useEffect(() => {
    if (slug) setLastTenantSlug(slug);
  }, [slug]);

  // Bootstrap de sessao: tenta refresh via cookie httpOnly.
  useEffect(() => {
    if (!slug) return;
    let active = true;
    api<{ accessToken: string }>(`/t/${slug}/auth/refresh`, { method: 'POST' })
      .then((r) => {
        if (!active) return;
        setAccessToken(r.accessToken);
        setReady(true);
      })
      .catch(() => {
        if (active) router.replace(`/${slug}/login`);
      });
    return () => {
      active = false;
    };
  }, [slug, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg">
        <p className="text-sm text-app-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider slug={slug}>
        <ExercicioProvider>
          <div className="flex min-h-screen bg-app-bg">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <DesktopUpdateBanner />
              <main className="flex-1 p-6">{children}</main>
            </div>
          </div>
        </ExercicioProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}
