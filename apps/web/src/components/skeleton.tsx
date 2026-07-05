'use client';

import type { CSSProperties } from 'react';

/** Skeleton padrao JEOS.
 *  - Pulso lento em background var(--app-skeleton) -> respeita dark mode sem flicker.
 *  - lineHeight via style porque h- sobe para cima do skeleton e distorce tabelas.
 */
export function Skeleton({
  className = '',
  style,
  rows = 1,
}: {
  className?: string;
  style?: CSSProperties;
  rows?: number;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className={`h-3 w-full animate-pulse rounded bg-app-skeleton ${className}`}
          style={style}
        />
      ))}
    </div>
  );
}

/** Skeleton linha de tabela: cinco colunas com larguras realistas. */
export function SkeletonRow({ columns = 5 }: { columns?: number }) {
  const widths = ['w-32', 'w-24', 'w-20', 'w-28', 'w-16', 'w-24'];
  return (
    <tr aria-hidden>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="p-2">
          <span className={`block h-3 animate-pulse rounded bg-app-skeleton ${widths[i] ?? 'w-20'}`} />
        </td>
      ))}
    </tr>
  );
}

/** Skeleton com varios SkeletonRow. */
export function SkeletonTable({
  rows = 3,
  columns = 5,
  label,
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      {label && <span className="sr-only">{label}</span>}
      <div className="overflow-hidden rounded-xl border border-app-border bg-app-card">
        <table className="w-full text-sm">
          <thead className="bg-app-table-head">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="p-2 text-left text-xs font-bold uppercase text-app-muted">
                  &nbsp;
                </th>
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
