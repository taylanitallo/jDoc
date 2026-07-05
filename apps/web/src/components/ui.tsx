'use client';

import { X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

/** Modal padrão JEOS: header gradiente azul→roxo com título/subtítulo. */
export function Modal({
  title,
  subtitle,
  open,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-app-card shadow-2xl">
        <div className="flex items-start justify-between bg-gradient-modal px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-white/80">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

export function Badge({
  color,
  children,
}: {
  color: 'green' | 'red' | 'orange' | 'blue' | 'gray';
  children: ReactNode;
}) {
  const map = {
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
    gray: 'bg-app-badge-gray-bg text-app-badge-gray-text',
  } as const;
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${map[color]}`}>
      {children}
    </span>
  );
}

/** Barra de uso de quota com alertas 80/90/100%. */
export function UsageBar({ percent }: { percent: number }) {
  const p = Math.min(percent, 100);
  const color =
    p >= 100 ? 'bg-red-500' : p >= 90 ? 'bg-orange-500' : p >= 80 ? 'bg-yellow-500' : 'bg-gradient-primary';
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-app-skeleton">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${p}%` }} />
      </div>
      <p
        className={`mt-1 text-[10px] font-semibold ${
          p >= 100
            ? 'text-app-error-text dark:text-red-300'
            : p >= 90
            ? 'text-orange-600 dark:text-orange-300'
            : p >= 80
            ? 'text-yellow-600 dark:text-yellow-300'
            : 'text-app-muted'
        }`}
      >
        {percent.toFixed(1)}%{p >= 100 ? ' — QUOTA ESGOTADA' : p >= 90 ? ' — crítico' : p >= 80 ? ' — atenção' : ''}
      </p>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function shadeHex(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const r = clamp(((num >> 16) & 0xff) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Gradiente de banner a partir da cor de destaque do tenant — `undefined` mantem o
 *  gradiente padrao (classe `bg-gradient-primary`) quando o tenant nao customizou. */
export function accentGradientStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  return { background: `linear-gradient(120deg, ${shadeHex(color, -25)}, ${color} 55%, ${shadeHex(color, 20)})` };
}

// Classes que ja sao dark-aware atraves das variaveis CSS em globals.css.
export const inputCls =
  'w-full rounded-lg border border-app-input-border bg-app-input-bg px-3 py-2 text-sm text-app outline-none focus:border-neon-purple';
export const labelCls = 'mb-1 block text-xs font-bold uppercase text-app-muted';
export const btnPrimary =
  'rounded-lg bg-gradient-primary px-4 py-2 text-xs font-bold uppercase text-white transition hover:opacity-90 disabled:opacity-50';
export const btnGhost =
  'rounded-lg border border-app-input-border bg-app-input-bg px-4 py-2 text-xs font-bold uppercase text-app-muted transition hover:bg-app-hover hover:text-app';
export const cardCls = 'rounded-xl border border-app-border bg-app-card shadow-sm';
