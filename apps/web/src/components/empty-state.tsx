'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

/** Estado vazio: chip de icone, titulo, descricao e acao opcional. */
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
      className="flex flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed border-ink-200 bg-surface px-6 py-12 text-center"
    >
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-[12px] bg-ink-100 text-ink-500">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-sm font-bold text-ink-900">{title}</h3>
      {description && <p className="max-w-sm text-[13px] text-ink-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
