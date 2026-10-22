'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DropdownItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Acao destrutiva: texto/icone em danger. */
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

/**
 * Menu suspenso: o gatilho e renderizado pelo chamador (recebe `aberto` e `alternar`).
 * Fecha com Esc, clique fora ou ao escolher um item.
 */
export function DropdownMenu({
  trigger,
  items,
  align = 'end',
  side = 'bottom',
  className,
}: {
  trigger: (p: { aberto: boolean; alternar: () => void }) => ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'end';
  /** 'top' abre para cima (ex.: menu do avatar no rodape da sidebar). */
  side?: 'bottom' | 'top';
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({ aberto, alternar: () => setAberto((v) => !v) })}
      {aberto && (
        <div
          role="menu"
          className={cn(
            'absolute z-40 w-64 animate-fade-in overflow-hidden rounded-[12px] border border-ink-200/70 bg-surface p-1.5 shadow-xl',
            side === 'top' ? 'bottom-full mb-2' : 'mt-2',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map(({ label, icon: Icon, onSelect, danger, disabled, hint }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setAberto(false);
                onSelect();
              }}
              className={cn(
                'flex w-full items-start gap-3 rounded-[8px] px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55',
                danger ? 'text-danger-600 hover:bg-danger-50' : 'text-ink-700 hover:bg-ink-50 hover:text-ink-900',
              )}
            >
              {Icon && <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', danger ? 'text-danger-600' : 'text-ink-500')} aria-hidden />}
              <span className="min-w-0">
                <span className="block">{label}</span>
                {hint && <span className="block text-xs font-normal text-ink-500">{hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
