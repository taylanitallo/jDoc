import { cn } from '@/lib/cn';

/** "Maria da Silva Souza" -> "MS" (primeira + ultima palavra relevante). */
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p));
  if (partes.length === 0) return '?';
  const a = partes[0]![0] ?? '';
  const b = partes.length > 1 ? partes[partes.length - 1]![0] ?? '' : '';
  return (a + b).toUpperCase();
}

const TAMANHO = { sm: 'h-8 w-8 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-11 w-11 text-sm' } as const;
const TOM = {
  brand: 'bg-brand-50 text-brand-600 ring-brand-600/20',
  neutral: 'bg-ink-100 text-ink-600 ring-ink-600/10',
  dark: 'bg-white/10 text-white ring-white/15',
} as const;

export function Avatar({
  nome,
  size = 'md',
  tone = 'brand',
  className,
}: {
  nome: string | null | undefined;
  size?: keyof typeof TAMANHO;
  tone?: keyof typeof TOM;
  className?: string;
}) {
  return (
    <span
      title={nome ?? undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold ring-1 ring-inset',
        TAMANHO[size],
        TOM[tone],
        className,
      )}
    >
      {iniciais(nome)}
    </span>
  );
}
