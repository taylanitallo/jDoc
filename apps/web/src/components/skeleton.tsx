'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/** Bloco de carregamento com brilho deslizante (shimmer). */
export function Skeleton({ className, style, rows = 1 }: { className?: string; style?: CSSProperties; rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={style} className={cn('relative h-3 w-full overflow-hidden rounded-[6px] bg-ink-100', className)}>
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-linear-to-r from-transparent via-surface/60 to-transparent" />
        </div>
      ))}
    </div>
  );
}

/** Linha de tabela em carregamento. */
export function SkeletonRow({ columns = 5 }: { columns?: number }) {
  const larguras = ['w-32', 'w-24', 'w-20', 'w-28', 'w-16', 'w-24'];
  return (
    <tr aria-hidden>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className={larguras[i] ?? 'w-20'} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 3, columns = 5, label }: { rows?: number; columns?: number; label?: string }) {
  return (
    <div>
      {label && <span className="sr-only">{label}</span>}
      <div className="overflow-hidden rounded-[16px] border border-ink-200/70 bg-surface shadow-xs">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-200 bg-ink-50/60">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-3">&nbsp;</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <SkeletonRow key={i} columns={columns} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
