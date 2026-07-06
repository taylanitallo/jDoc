'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Landmark,
  Users,
  ScrollText,
  ShieldCheck,
  KeyRound,
  DatabaseBackup,
  LogOut,
} from 'lucide-react';
import { api, setAccessToken } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';

const items = [
  { href: '/superadmin/dashboard', label: 'DASHBOARD', icon: LayoutDashboard },
  { href: '/superadmin/orgaos', label: 'ÓRGÃOS', icon: Landmark },
  { href: '/superadmin/usuarios', label: 'USUÁRIOS', icon: Users },
  { href: '/superadmin/backups', label: 'BACKUPS', icon: DatabaseBackup },
  { href: '/superadmin/logs', label: 'LOGS', icon: ScrollText },
  { href: '/superadmin/2fa-setup', label: '2FA', icon: KeyRound },
] as const;

export default function SuperadminShell({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Bootstrap de sessao: tenta refresh via cookie httpOnly.
  useEffect(() => {
    let active = true;
    api<{ accessToken: string }>('/superadmin/auth/refresh', { method: 'POST' })
      .then((r) => {
        if (!active) return;
        setAccessToken(r.accessToken);
        setReady(true);
      })
      .catch(() => {
        if (active) router.replace('/superadmin/login');
      });
    return () => {
      active = false;
    };
  }, [router]);

  const logout = async () => {
    try {
      await api('/superadmin/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      router.replace('/superadmin/login');
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg">
        <p className="text-sm text-app-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen bg-app-bg">
        <aside className="flex w-64 shrink-0 flex-col bg-sidebar-bg">
          <div className="flex items-center gap-3 bg-gradient-primary px-4 py-3">
            <ShieldCheck className="h-8 w-8 text-white" aria-hidden />
            <div>
              <p className="text-sm font-bold uppercase text-white">Painel Master</p>
              <p className="text-[10px] text-white/80">JEOS Sistemas</p>
            </div>
          </div>
          <nav className="flex-1 py-3">
            {items.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 px-4 py-2.5 text-xs font-semibold tracking-wide transition ${
                    active
                      ? 'border-l-4 border-accent bg-sidebar-hover text-white'
                      : 'border-l-4 border-transparent text-app-muted hover:bg-sidebar-hover hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-3 px-4 py-3 text-xs font-semibold text-app-muted transition hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            SAIR
          </button>
        </aside>
        <main className="min-w-0 flex-1 p-6">
          <div className="mb-4 flex justify-end">
            <ThemeToggle />
          </div>
          {children}
        </main>
      </div>
    </QueryClientProvider>
  );
}