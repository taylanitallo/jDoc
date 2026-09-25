'use client';

import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Hook para chamar toasts a partir de qualquer componente client. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa de <ToastProvider>');
  return ctx;
}

const KIND_STYLES: Record<ToastKind, { wrapper: string; icon: string; Icon: typeof CheckCircle2 }> = {
  success: {
    wrapper: 'border-ink-200/70 bg-surface text-ink-800',
    icon: 'text-success-600',
    Icon: CheckCircle2,
  },
  error: {
    wrapper: 'border-danger-500/30 bg-surface text-ink-800',
    icon: 'text-danger-600',
    Icon: AlertTriangle,
  },
  info: {
    wrapper: 'border-ink-200/70 bg-surface text-ink-800',
    icon: 'text-brand-600',
    Icon: Info,
  },
};

const DEFAULT_TTL_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      counter.current += 1;
      const id = `t-${Date.now()}-${counter.current}`;
      setItems(prev => [...prev, { id, kind, message }]);
      // Auto-dismiss
      window.setTimeout(() => remove(id), DEFAULT_TTL_MS);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: msg => push('success', msg),
      error: msg => push('error', msg),
      info: msg => push('info', msg),
    }),
    [push],
  );

  // Cleanup timers ao desmontar (previne memory leak em HMR)
  useEffect(() => () => setItems([]), []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
      >
        {items.map(item => {
          const style = KIND_STYLES[item.kind];
          const Icon = style.Icon;
          return (
            <div
              key={item.id}
              role={item.kind === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-[12px] border px-4 py-3 shadow-lg ${style.wrapper}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} aria-hidden />
              <p className="flex-1 text-sm font-medium">{item.message}</p>
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label="Fechar notificação"
                className="rounded-[6px] p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
