'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

/** Botao Sol/Lua para alternar entre light e dark mode.
 *  - Evita hydration mismatch: so renderiza o icone correto apos `mounted`.
 *  - aria-label explicito em ambos os estados.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro'}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
      className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-ink-200 bg-surface text-ink-500 shadow-xs transition hover:bg-ink-50 hover:text-ink-800"
    >
      {!mounted ? (
        // Render neutro enquanto hidrata para evitar flicker
        <Sun className="h-4 w-4" aria-hidden />
      ) : isDark ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}
