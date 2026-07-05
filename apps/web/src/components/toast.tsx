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
    wrapper: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100',
    icon: 'text-emerald-500',
    Icon: CheckCircle2,
  },
  error: {
    wrapper: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100',
    icon: 'text-red-500',
    Icon: AlertTriangle,
  },
  info: {
    wrapper: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-100',
    icon: 'text-blue-500',
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
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2"
      >
        {items.map(item => {
          const style = KIND_STYLES[item.kind];
          const Icon = style.Icon;
          return (
            <div
              key={item.id}
              role={item.kind === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg ${style.wrapper}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} aria-hidden />
              <p className="flex-1 text-xs font-medium">{item.message}</p>
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label="Fechar notificação"
                className="rounded p-0.5 opacity-60 hover:opacity-100"
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
