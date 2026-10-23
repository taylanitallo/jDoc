'use client';

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SelectMenu } from './select-menu';

/**
 * Campo: raio 10, borda ink-200, fundo surface. 16px no celular (evita o zoom
 * do iOS ao focar) e 14px a partir de sm. Foco brand-500 + anel brand/20.
 */
export const inputClasses =
  'w-full rounded-[10px] border border-ink-200 bg-surface px-3 py-2 text-base text-ink-800 shadow-xs outline-none transition ' +
  'placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 ' +
  'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-55 sm:text-sm';

const erroClasses = 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20';

/** Rotulo: 13px semibold ink-700. */
export const labelClasses = 'mb-1.5 block text-[13px] font-semibold text-ink-700';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, type, ...rest }, ref) {
    const [visivel, setVisivel] = useState(false);
    const campo = (
      <input
        ref={ref}
        type={type === 'password' && visivel ? 'text' : type}
        aria-invalid={invalid || undefined}
        className={cn(inputClasses, 'h-10 py-0', type === 'password' && 'pr-11', invalid && erroClasses, className)}
        {...rest}
      />
    );
    if (type !== 'password') return campo;
    // Todo campo de senha tem o olho (Padrao JEOS), implementado so aqui.
    return (
      <div className="relative">
        {campo}
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          disabled={rest.disabled}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[10px] text-ink-400 transition hover:text-ink-700"
        >
          {visivel ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    );
  },
);

/** Select do kit: lista propria no padrao visual (ver SelectMenu). */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, ...rest }, ref) {
    return <SelectMenu ref={ref} invalid={invalid} className={cn(inputClasses, 'h-10 py-0', className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(inputClasses, 'min-h-20', invalid && erroClasses, className)} {...rest} />;
  },
);

/** Rotulo + campo + dica/erro. Obrigatorio ganha asterisco em danger. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={labelClasses}>
        {label}
        {required && <span className="ml-0.5 text-danger-600">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger-600" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>
      )}
    </div>
  );
}
