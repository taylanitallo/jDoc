'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CalendarDays, CircleUserRound, LogOut, Menu } from 'lucide-react';
import { api, setAccessToken } from '@/lib/api';
import { ThemeToggle } from './theme-toggle';
import { useSidebarMobile } from './sidebar';

/** Seletor global de EXERCICIO (ano) — filtra todo o sistema. */
const ExercicioContext = createContext<{
  exercicio: number;
  setExercicio: (ano: number) => void;
} | null>(null);

export function useExercicio() {
  const ctx = useContext(ExercicioContext);
  if (!ctx) throw new Error('useExercicio fora do ExercicioProvider');
  return ctx;
}

export function ExercicioProvider({ children }: { children: ReactNode }) {
  const [exercicio, setExercicio] = useState(new Date().getFullYear());
  const value = useMemo(() => ({ exercicio, setExercicio }), [exercicio]);
  return <ExercicioContext.Provider value={value}>{children}</ExercicioContext.Provider>;
}

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return 'BOM DIA';
  if (h < 18) return 'BOA TARDE';
  return 'BOA NOITE';
}

export function Topbar({ userName = 'USUÁRIO' }: { userName?: string }) {
  const { exercicio, setExercicio } = useExercicio();
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 6 }, (_, i) => anoAtual - i);

  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { setMobileOpen } = useSidebarMobile();

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  async function logout() {
    try {
      await api(`/t/${slug}/auth/logout`, { method: 'POST' });
    } finally {
      setAccessToken(null);
      router.replace(`/${slug}/login`);
    }
  }

  return (
    <header className="flex h-16 items-center justify-between gap-2 border-b border-app-border bg-app-card px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-app-muted transition hover:bg-app-hover hover:text-app md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <p className="truncate text-sm font-bold text-app">
          {saudacao()}, <span className="text-neon-violet">{userName.toUpperCase()}</span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-app-muted">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">EXERCÍCIO</span>
          <select
            value={exercicio}
            onChange={(e) => setExercicio(Number(e.target.value))}
            className="rounded-lg border border-app-input-border bg-app-input-bg px-2 py-1.5 text-sm font-bold text-app outline-none focus:border-neon-purple"
          >
            {anos.map((ano) => (
              <option key={ano} value={ano}>
                {ano}
              </option>
            ))}
          </select>
        </label>
        <ThemeToggle />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Perfil do usuário"
            aria-expanded={menuOpen}
            className="flex items-center rounded-full text-app-muted transition hover:text-app"
          >
            <CircleUserRound className="h-8 w-8" aria-hidden />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-10 mt-2 w-40 overflow-hidden rounded-lg border border-app-border bg-app-card shadow-lg">
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-app-muted transition hover:bg-app-hover hover:text-app"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                SAIR
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}