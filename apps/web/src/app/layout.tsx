import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/toast';
import { SCRIPT_TEMA_MARCA } from '@/lib/brand-theme';

/** Fonte do Design System (variavel --font-inter, usada por --font-sans). */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'jDoc — Sistema de Gestão Eletrônica de Documentos',
  description: 'Gestão eletrônica de documentos para órgãos públicos — JEOS Sistemas',
};

/** Script anti-flash: aplica a classe `dark` antes do React hidratar.
 *  - Fonte: padrao recomendado em https://github.com/pacocoursey/next-themes#avoid-hydration-mismatch
 */
const noFlashScript = `
(function() {
  try {
    var t = localStorage.getItem('jdoc-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || ((!t || t === 'system') && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (_) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* dangerouslySetInnerHTML necessario para script inline minimo anti-flash */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
        {/* Tema de cor do usuario (cache local), tambem antes da pintura. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_MARCA }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
