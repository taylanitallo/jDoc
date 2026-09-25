'use client';

import { cn } from '@/lib/cn';

/** Interruptor liga/desliga (role=switch). Trilho 36x20, bolinha 16px presa ao trilho. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Nome acessivel (o texto visivel fica a cargo de quem usa). */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-55',
        checked ? 'bg-brand-600' : 'bg-ink-300',
        className,
      )}
    >
      {/* bolinha sempre branca (contraste nos dois temas); desliza dentro do trilho */}
      <span
        aria-hidden
        className={cn(
          'block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}
