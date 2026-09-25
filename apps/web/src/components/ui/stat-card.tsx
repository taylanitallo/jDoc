import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { cardClasses } from './card';
import { TONE_VIVID, type Tone } from './badge';

/** Indicador: chip 40x40 (fundo -50 + icone -600), rotulo .label-caps e valor grande. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  hint,
  href,
  loading,
  className,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  hint?: ReactNode;
  href?: string;
  loading?: boolean;
  className?: string;
}) {
  const cor = TONE_VIVID[tone];
  const conteudo = (
    <>
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', cor.barra)} />
      <div className="flex items-start justify-between gap-3">
        <p className="label-caps">{label}</p>
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-white shadow-md', cor.chip)}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
      {loading ? (
        <div className="mt-1 h-8 w-16 animate-pulse rounded-[8px] bg-ink-100" />
      ) : (
        <p className="mt-1 text-[28px] font-extrabold leading-9 tracking-tight text-ink-900 tabular-nums">{value}</p>
      )}
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </>
  );
  const cls = cn(
    cardClasses,
    'relative block overflow-hidden bg-linear-to-br to-surface to-60% p-5',
    cor.fundo,
    href && 'transition hover:-translate-y-0.5 hover:shadow-md',
    className,
  );
  return href ? (
    <Link href={href} className={cls} data-testid="kpi">
      {conteudo}
    </Link>
  ) : (
    <div className={cls} data-testid="kpi">
      {conteudo}
    </div>
  );
}
