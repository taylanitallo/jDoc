'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/** Provider unificado do jDoc.
 * - attribute="class": alterna a classe `dark` em <html>
 * - storageKey="jdoc-theme": o tema persiste por orgao/usuario no navegador
 * - defaultTheme="light": inicio limpo; respeita prefers-color-scheme na primeira carga
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      storageKey="jdoc-theme"
      defaultTheme="light"
      enableSystem
    >
      {children}
    </NextThemesProvider>
  );
}
