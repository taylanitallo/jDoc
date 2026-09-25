import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Superficie base: raio 16, borda ink-200/70, sombra xs. */
export const cardClasses = 'rounded-[16px] border border-ink-200/70 bg-surface shadow-xs';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardClasses, className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  icon: Icon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-600">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...rest} />;
}
