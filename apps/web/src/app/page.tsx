'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Download, Landmark, Search } from 'lucide-react';
import { AuthLayout } from '@/components/shell/auth-layout';
import { Card, Input, buttonClasses } from '@/components/ui';
import { api } from '@/lib/api';
import { isDesktopApp } from '@/lib/desktop-bridge';

const DESKTOP_DOWNLOAD_URL =
  'https://buknzokboidzhenafwpi.supabase.co/storage/v1/object/public/downloads/jDoc-Desktop-1.0.4-x64.exe';

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
    <AuthLayout>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Acessar o sistema</h1>
        <p className="mt-0.5 text-sm text-ink-500">Selecione seu órgão para entrar</p>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            type="search"
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Pesquisar órgão…"
            aria-label="Pesquisar órgão"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {filtered.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/${t.slug}/login`}
                className="group flex items-center gap-3 rounded-[10px] p-2.5 transition-colors hover:bg-ink-50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-600/15">
                  {t.brasaoUrl ? (
                    <img src={t.brasaoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Landmark className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-900">{t.nome}</span>
                  <span className="block truncate text-xs text-ink-500">/{t.slug}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />
              </Link>
            </li>
          ))}

          {tenants.length > 0 && filtered.length === 0 && (
            <li className="py-8 text-center text-sm text-ink-500">Nenhum órgão encontrado.</li>
          )}
          {tenants.length === 0 &&
            [0, 1, 2].map((k) => (
              <li key={k} className="flex items-center gap-3 p-2.5" aria-hidden>
                <span className="h-10 w-10 animate-pulse rounded-[10px] bg-ink-100" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-3.5 w-2/3 animate-pulse rounded-[6px] bg-ink-100" />
                  <span className="block h-3 w-1/4 animate-pulse rounded-[6px] bg-ink-100" />
                </span>
              </li>
            ))}
        </ul>
      </Card>

      {!desktop && (
        <a href={DESKTOP_DOWNLOAD_URL} className={buttonClasses('outline', 'md', 'mt-4 w-full')}>
          <Download aria-hidden />
          Baixar o jDoc Desktop (Windows)
        </a>
      )}
    </AuthLayout>
  );
}
