'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

const LARGURA = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' } as const;

/**
 * Modal do Design System. Overlay ink-900/45 com blur; no celular abre como
 * bottom sheet (raio 20 no topo), no desktop centralizado (raio 16, sombra xl).
 * Esc e clique fora fecham; rolagem da pagina travada enquanto aberto.
 */
export function Modal({
  title,
  subtitle,
  open,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof LARGURA;
}) {
  const tituloId = useId();
  const painel = useRef<HTMLDivElement>(null);
  // onClose costuma ser funcao inline: em ref, o efeito so roda ao abrir/fechar
  // (senao re-focaria o painel a cada render e roubaria o foco dos campos).
  const fechar = useRef(onClose);
  fechar.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && fechar.current();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    painel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <div className="animate-fade-in absolute inset-0 bg-ink-900/45 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={cn(
          'animate-slide-up relative flex max-h-[92vh] w-full flex-col overflow-hidden bg-surface outline-none',
          'rounded-t-[20px] sm:rounded-[16px] sm:shadow-xl',
          LARGURA[size],
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-ink-200 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div className="min-w-0">
            <h2 id={tituloId} className="text-[15px] font-bold text-ink-900">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="pb-safe flex justify-end gap-2 border-t border-ink-100 bg-ink-50/60 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
