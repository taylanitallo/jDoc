'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, CalendarDays } from 'lucide-react';
import { SelectMenu } from '@/components/ui/select-menu';
import { Switch } from '@/components/ui/switch';
import { useAylaVisibility } from './assistente-widget';

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

/** Seletor de exercicio compacto para o header. */
export function ExercicioSelect() {
  const { exercicio, setExercicio } = useExercicio();
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 8 }, (_, i) => anoAtual - i);
  return (
    <SelectMenu
      aria-label="Exercício"
      value={exercicio}
      onChange={(e) => setExercicio(Number(e.target.value))}
      leading={<CalendarDays className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />}
      menuClassName="min-w-[168px]"
      className="h-10 cursor-pointer rounded-[10px] border border-ink-200 bg-surface pl-3 text-sm font-bold text-ink-800 shadow-xs outline-none transition hover:border-ink-300 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/20"
    >
      {anos.map((ano) => (
        <option key={ano} value={ano}>
          {ano}
        </option>
      ))}
    </SelectMenu>
  );
}

/** Preferencias rapidas do usuario (hoje: ocultar a assistente Ayla). */
export function ContaMenu() {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { oculta, setOculta } = useAylaVisibility();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label="Assistente Ayla"
        aria-expanded={aberto}
        aria-haspopup="menu"
        title="Assistente Ayla"
        className="flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
      >
        <Bot className="h-[18px] w-[18px]" aria-hidden />
      </button>
      {aberto && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 top-full z-40 mt-2 w-64 rounded-[12px] border border-ink-200 bg-surface p-3 shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-ink-800">Ocultar Ayla</p>
              <p className="text-xs text-ink-500">Esconde a assistente de IA do canto da tela.</p>
            </div>
            <Switch checked={oculta} onChange={setOculta} label="Ocultar Ayla" />
          </div>
        </div>
      )}
    </div>
  );
}
