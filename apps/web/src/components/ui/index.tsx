'use client';

/**
 * Kit de componentes do Design System do jDoc (sem biblioteca externa).
 * Tokens em src/app/globals.css (@theme). Telas novas usam os componentes;
 * os helpers em string (inputCls, btnPrimary, cardCls...) seguem exportados
 * para as telas antigas e ja renderizam no padrao novo.
 */
import { cn } from '@/lib/cn';
import { buttonClasses } from './button';
import { cardClasses } from './card';
import { inputClasses, labelClasses } from './input';

export { Button, buttonClasses, type ButtonProps, type ButtonVariant, type ButtonSize } from './button';
export { Card, CardHeader, CardBody, cardClasses } from './card';
export { Badge, TONE_SOFT, TONE_VIVID, type Tone } from './badge';
export { StatCard } from './stat-card';
export { Input, Select, Textarea, Field, inputClasses, labelClasses } from './input';
export { SelectMenu, type SelectMenuProps } from './select-menu';
export { Modal } from './modal';
export { Avatar, iniciais } from './avatar';
export { PageHeader } from './page-header';
export { Tabs, TabButton } from './tabs';
export { Pagination } from './pagination';
export { DropdownMenu, type DropdownItem } from './dropdown-menu';
export { Switch } from './switch';
export { ConfirmDialog } from './confirm-dialog';

// ---- Helpers de transicao (telas antigas) ----
export const inputCls = inputClasses;
export const labelCls = labelClasses;
export const btnPrimary = buttonClasses('primary', 'md');
export const btnGhost = buttonClasses('outline', 'md');
export const cardCls = cardClasses;


export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1024 ** 3).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

/** Barra de uso de quota com alertas 80/90/100%. */
export function UsageBar({ percent }: { percent: number }) {
  const p = Math.min(percent, 100);
  const cor = p >= 100 ? 'bg-danger-500' : p >= 90 ? 'bg-orange-500' : p >= 80 ? 'bg-warning-500' : 'bg-brand-600';
  const texto = p >= 100 ? 'text-danger-600' : p >= 90 ? 'text-orange-600' : p >= 80 ? 'text-warning-600' : 'text-ink-500';
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div className={cn('h-full rounded-full transition-all', cor)} style={{ width: `${p}%` }} />
      </div>
      <p className={cn('mt-1 text-[11px] font-semibold tabular-nums', texto)}>
        {percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%{p >= 100 ? ' — quota esgotada' : p >= 90 ? ' — crítico' : p >= 80 ? ' — atenção' : ''}
      </p>
    </div>
  );
}
