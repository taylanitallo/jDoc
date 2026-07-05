'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, CircleUserRound } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';

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

  return (
    <header className="flex h-16 items-center justify-between border-b border-app-border bg-app-card px-6">
      <p className="text-sm font-bold text-app">
        {saudacao()}, <span className="text-neon-violet">{userName.toUpperCase()}</span>
      </p>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-app-muted">
          <CalendarDays className="h-4 w-4" aria-hidden />
          EXERCÍCIO
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
        <CircleUserRound className="h-8 w-8 text-app-muted" aria-label="Perfil do usuário" />
      </div>
    </header>
  );
}