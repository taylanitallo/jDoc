import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes condicionais e resolve conflitos do Tailwind (a ultima vence). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
