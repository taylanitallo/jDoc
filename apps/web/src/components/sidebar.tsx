'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Home,
  TrendingUp,
  TrendingDown,
  Scale,
  Landmark,
  FolderOpen,
  FolderSync,
  FileCheck,
  Film,
  Settings,
} from 'lucide-react';
import { useBranding } from './branding';
import { isDesktopApp } from '@/lib/desktop-bridge';

const items = [
  { href: 'dashboard', label: 'HOME', icon: Home },
  { href: 'receitas', label: 'RECEITAS', icon: TrendingUp },
  { href: 'despesas', label: 'DESPESAS', icon: TrendingDown },
  { href: 'balancete', label: 'BALANCETE', icon: Scale },
  { href: 'extrato', label: 'EXTRATO DE CONTAS', icon: Landmark },
  { href: 'outros', label: 'OUTROS ARQUIVOS', icon: FolderOpen },
  { href: 'prestacao-contas', label: 'PRESTAÇÃO DE CONTAS', icon: FileCheck },
  { href: 'midia-legislativa', label: 'MÍDIA LEGISLATIVA', icon: Film },
  { href: 'configuracoes', label: 'CONFIGURAÇÕES', icon: Settings },
] as const;

/** So existe dentro do jDoc Desktop — item extra checado no cliente apos montar
 *  (evita mismatch de hidratacao, ja que o servidor nunca sabe se e o executavel). */
const pastaMonitoradaItem = { href: 'pasta-monitorada', label: 'PASTA MONITORADA', icon: FolderSync } as const;

/** "Prefeitura de Iraucuba" -> ["Prefeitura", "de Iraucuba"] — quebra so na primeira palavra,
 *  preservando o texto por completo (nada e descartado, so cabe em duas linhas no sidebar). */
function splitPrefeituraLabel(name: string): [string, string] | null {
  const idx = name.indexOf(' ');
  if (idx === -1) return null;
  return [name.slice(0, idx), name.slice(idx + 1)];
}

export function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { nomeExibido, brasaoUrl } = useBranding();
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

  const label = nomeExibido || String(slug).replace(/_/g, ' ');
  const splitLabel = nomeExibido ? splitPrefeituraLabel(nomeExibido) : null;
  const navItems = desktop ? [...items, pastaMonitoradaItem] : items;

  return (
    <aside
      className={`relative flex shrink-0 flex-col bg-sidebar-dark transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-light text-white shadow hover:opacity-90"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronLeft className="h-3.5 w-3.5" aria-hidden />}
      </button>

      {/* Brasao em faixa verde-bandeira — mesma altura minima da topbar, pra alinhar na mesma linha */}
      <div className="flex min-h-16 items-center gap-3 bg-flag-green px-4 py-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20">
          {brasaoUrl ? (
            <img src={brasaoUrl} alt="Brasão" className="h-full w-full object-cover" />
          ) : (
            <Landmark className="h-5 w-5 text-white" aria-hidden />
          )}
        </div>
        {!collapsed && (
          <div className="min-w-0">
            {splitLabel ? (
              <>
                <p className="truncate text-sm font-bold uppercase leading-tight text-white">{splitLabel[0]}</p>
                <p className="truncate text-sm font-bold uppercase leading-tight text-white">{splitLabel[1]}</p>
              </>
            ) : (
              <p className="truncate text-sm font-bold uppercase leading-tight text-white">{label}</p>
            )}
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const full = `/${slug}/${href}`;
          const active = pathname.startsWith(full);
          return (
            <Link
              key={href}
              href={full}
              title={collapsed ? label : undefined}
              onClick={() => setCollapsed(true)}
              className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold tracking-wide transition ${
                active
                  ? 'border-l-4 border-accent bg-sidebar-light text-white'
                  : 'border-l-4 border-transparent text-app-muted hover:bg-sidebar-light hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <p className="px-4 py-3 text-center text-[10px] text-app-muted">
          © 2026 JEOS SISTEMAS • V1.0.0
        </p>
      )}
    </aside>
  );
}
