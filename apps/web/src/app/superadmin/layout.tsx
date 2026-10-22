import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Area escondida: nenhum link no sistema, sem indexacao, titulo neutro. */
export const metadata: Metadata = {
  title: 'Acesso restrito',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function SuperadminRootLayout({ children }: { children: ReactNode }) {
  return children;
}
