import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'orange' | 'violet' | 'teal' | 'pink' | 'neutral';

/** Par "fundo -50 + texto/icone -600" de cada tom (o -50 escurece no tema escuro). */
export const TONE_SOFT: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-600 ring-brand-600/15',
  success: 'bg-success-50 text-success-600 ring-success-600/15',
  warning: 'bg-warning-50 text-warning-600 ring-warning-600/20',
  danger: 'bg-danger-50 text-danger-600 ring-danger-600/15',
  info: 'bg-info-50 text-info-500 ring-info-500/15',
  orange: 'bg-orange-50 text-orange-600 ring-orange-600/15',
  violet: 'bg-violet-50 text-violet-600 ring-violet-600/15',
  teal: 'bg-teal-50 text-teal-600 ring-teal-600/15',
  pink: 'bg-pink-50 text-pink-600 ring-pink-600/15',
  neutral: 'bg-ink-100 text-ink-600 ring-ink-600/10',
};

/** Cor cheia de cada tom: chip solido (fundo -600, icone branco), barra de destaque e degrade leve do card. */
export const TONE_VIVID: Record<Tone, { chip: string; barra: string; fundo: string; valor: string }> = {
  brand: { chip: 'bg-brand-600 shadow-brand-600/30', barra: 'bg-brand-600', fundo: 'from-brand-50', valor: 'text-brand-600' },
  success: { chip: 'bg-success-600 shadow-success-600/30', barra: 'bg-success-500', fundo: 'from-success-50', valor: 'text-success-600' },
  warning: { chip: 'bg-warning-500 shadow-warning-500/30', barra: 'bg-warning-500', fundo: 'from-warning-50', valor: 'text-warning-600' },
  danger: { chip: 'bg-danger-600 shadow-danger-600/30', barra: 'bg-danger-500', fundo: 'from-danger-50', valor: 'text-danger-600' },
  info: { chip: 'bg-info-600 shadow-info-600/30', barra: 'bg-info-500', fundo: 'from-info-50', valor: 'text-info-600' },
  orange: { chip: 'bg-orange-600 shadow-orange-600/30', barra: 'bg-orange-500', fundo: 'from-orange-50', valor: 'text-orange-600' },
  violet: { chip: 'bg-violet-600 shadow-violet-600/30', barra: 'bg-violet-500', fundo: 'from-violet-50', valor: 'text-violet-600' },
  teal: { chip: 'bg-teal-600 shadow-teal-600/30', barra: 'bg-teal-500', fundo: 'from-teal-50', valor: 'text-teal-600' },
  pink: { chip: 'bg-pink-600 shadow-pink-600/30', barra: 'bg-pink-500', fundo: 'from-pink-50', valor: 'text-pink-600' },
  neutral: { chip: 'bg-ink-600 shadow-ink-600/20', barra: 'bg-ink-400', fundo: 'from-ink-100', valor: 'text-ink-900' },
};

/** Cores do Badge legado (green/red/orange/blue/gray) -> tons do Design System. */
const LEGADO: Record<string, Tone> = { green: 'success', red: 'danger', orange: 'orange', blue: 'brand', gray: 'neutral' };

export function Badge({
  tone,
  color,
  children,
  className,
}: {
  tone?: Tone;
  /** @deprecated use `tone` */
  color?: 'green' | 'red' | 'orange' | 'blue' | 'gray';
  children: ReactNode;
  className?: string;
}) {
  const t: Tone = tone ?? (color ? LEGADO[color] ?? 'neutral' : 'neutral');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset',
        TONE_SOFT[t],
        className,
      )}
    >
      {children}
    </span>
  );
}
