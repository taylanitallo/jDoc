'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Abas em "pill" sobre fundo ink-100 (segmented control). */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: ReadonlyArray<{ id: T; label: ReactNode; count?: number; icon?: LucideIcon }>;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-[12px] bg-ink-100 p-1', className)}>
      {items.map((it) => (
        <TabButton key={it.id} active={value === it.id} onClick={() => onChange(it.id)} count={it.count}>
          {it.icon && <it.icon className="h-4 w-4 shrink-0" aria-hidden />}
          {it.label}
        </TabButton>
      ))}
    </div>
  );
}

export function TabButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] px-3.5 text-[13px] font-semibold transition',
        active ? 'bg-surface text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-900',
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', active ? 'bg-brand-50 text-brand-600' : 'bg-ink-200 text-ink-600')}>
          {count}
        </span>
      )}
    </button>
  );
}
