import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Cabecalho de pagina: titulo extrabold, descricao, "Voltar" opcional e acoes a direita. */
export function PageHeader({
  title,
  description,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label?: string };
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6', className)}>
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-500 transition hover:text-ink-900"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {back.label ?? 'Voltar'}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2" data-print-hide>{actions}</div>}
      </div>
    </div>
  );
}
