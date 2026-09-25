'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-semibold transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-55 [&_svg]:shrink-0';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800',
  secondary: 'bg-ink-100 text-ink-800 hover:bg-ink-200',
  outline: 'border border-ink-200 bg-surface text-ink-700 shadow-xs hover:bg-ink-50 hover:text-ink-900',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  danger: 'bg-danger-600 text-white shadow-xs hover:bg-danger-500',
  success: 'bg-success-600 text-white shadow-xs hover:bg-success-500',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-[8px] px-3 text-[13px] [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-10 gap-2 rounded-[10px] px-4 text-sm [&_svg]:h-4 [&_svg]:w-4',
  lg: 'h-12 gap-2 rounded-[12px] px-5 text-[15px] [&_svg]:h-5 [&_svg]:w-5',
  icon: 'h-10 w-10 rounded-[10px] [&_svg]:h-[18px] [&_svg]:w-[18px]',
};

/** Classes do botao, para elementos que precisam parecer botao (ex.: <Link>). */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Mostra o Loader2 girando e desabilita o botao. */
  loading?: boolean;
  leftIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, leftIcon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : leftIcon}
      {children}
    </button>
  );
});
