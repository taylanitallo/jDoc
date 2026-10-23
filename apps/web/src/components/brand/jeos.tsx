import { cn } from '@/lib/cn';

export const JEOS_URL = 'https://www.jeossistemas.com';
export const JEOS_NOME = 'JEOS SISTEMAS E ASSESSORIAS LTDA';

/** Rodape padrao: "© {ano} JEOS SISTEMAS E ASSESSORIAS LTDA", clicavel para o site. */
export function JeosFooter({ className, extra }: { className?: string; extra?: string }) {
  return (
    <p className={cn('text-center text-xs text-ink-500', className)}>
      © {new Date().getFullYear()}{' '}
      <a href={JEOS_URL} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-ink-800 hover:underline">
        {JEOS_NOME}
      </a>
      {extra ? ` · ${extra}` : null}
    </p>
  );
}
