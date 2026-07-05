import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { ToastProvider } from '@/components/toast';

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
    if (t === 'dark' || (!t && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (_) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* dangerouslySetInnerHTML necessario para script inline minimo anti-flash */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
