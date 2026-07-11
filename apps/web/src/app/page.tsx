'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Landmark, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { isDesktopApp } from '@/lib/desktop-bridge';

const DESKTOP_DOWNLOAD_URL =
  'https://buknzokboidzhenafwpi.supabase.co/storage/v1/object/public/downloads/jDoc-Desktop-1.0.3-x64.exe';

interface PublicTenantListItem {
  slug: string;
  nome: string;
  brasaoUrl: string | null;
}

/**
 * Landing da raiz do site — sem tenant na URL ainda. Alem de servir o
 * navegador comum sem link direto do orgao, e a TELA INICIAL do jDoc
 * Desktop (a janela do executavel carrega esta origem sem slug nenhum).
 * Lista os orgaos ativos pra escolher clicando (em vez de digitar o slug
 * de cor), igual ao padrao das outras plataformas JEOS.
 */
export default function Home() {
  const [tenants, setTenants] = useState<PublicTenantListItem[]>([]);
  const [query, setQuery] = useState('');
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

  useEffect(() => {
    api<PublicTenantListItem[]>('/tenants')
      .then(setTenants)
      .catch(() => undefined);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) => t.nome.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [tenants, query]);

  return (
    <main
      className="relative flex min-h-screen items-center justify-center bg-black bg-cover px-4"
      style={{ backgroundImage: "url('/background.png')", backgroundPosition: 'right 15%' }}
    >
      <div className="flex w-full max-w-5xl flex-col items-center gap-12 lg:flex-row lg:justify-end">
        <section className="w-full max-w-md rounded-2xl border-2 border-neon-purple/60 bg-black/70 p-6 shadow-[0_0_35px_rgba(168,85,247,0.35)] backdrop-blur">
          <p className="mb-4 text-center text-sm text-app-muted">
            Selecione seu órgão para acessar o sistema
          </p>

          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-app-muted" aria-hidden />
            <input
              type="text"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Pesquisar órgão..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder-app-muted outline-none focus:border-neon-purple"
            />
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto">
            {filtered.map((t) => (
              <div
                key={t.slug}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-primary">
                    {t.brasaoUrl ? (
                      <img src={t.brasaoUrl} alt={t.nome} className="h-full w-full object-cover" />
                    ) : (
                      <Landmark className="h-4 w-4 text-white" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{t.nome}</p>
                    <p className="truncate text-xs text-neon-purple">/{t.slug}</p>
                  </div>
                </div>
                <Link
                  href={`/${t.slug}/login`}
                  className="shrink-0 rounded-lg bg-gradient-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:opacity-90"
                >
                  Acessar
                </Link>
              </div>
            ))}

            {tenants.length > 0 && filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-app-muted">Nenhum órgão encontrado.</p>
            )}
            {tenants.length === 0 && (
              <p className="py-6 text-center text-xs text-app-muted">Carregando órgãos…</p>
            )}
          </div>

          {!desktop && (
            <a
              href={DESKTOP_DOWNLOAD_URL}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-bold uppercase tracking-wide text-app-muted transition hover:border-neon-purple hover:text-white"
            >
              <Download className="h-4 w-4" aria-hidden />
              Baixar o jDoc Desktop (Windows)
            </a>
          )}
        </section>
      </div>

      <footer className="absolute bottom-4 w-full text-center text-xs text-app-muted">
        © 2026{' '}
        <a
          href="https://jeossistemas.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white hover:underline"
        >
          JEOS SISTEMAS E ASSESSORIAS LTDA
        </a>{' '}
        • V1.0.0
      </footer>
    </main>
  );
}
