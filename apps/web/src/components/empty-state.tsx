'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

/** Empty state padrao JEOS.
 *  - Icone Lucide centrado + titulo + subtitulo + CTA opcional.
 *  - Cor da borda reage ao dark mode.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-app-border bg-app-card px-6 py-12 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-app-table-head text-app-muted">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-sm font-bold text-app">{title}</h3>
      {description && <p className="max-w-sm text-xs text-app-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
