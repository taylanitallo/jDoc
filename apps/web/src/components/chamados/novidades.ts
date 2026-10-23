'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReleaseView } from '@jdoc/shared';
import { api } from '@/lib/api';

const CHAVE = (slug: string) => `jdoc-novidades-vistas:${slug}`;
const EVENTO = 'jdoc-novidades-vistas';

/** Guarda (neste navegador) a data da ultima novidade vista. */
export function marcarNovidadesVistas(slug: string, ate: string): void {
  try {
    localStorage.setItem(CHAVE(slug), ate);
    window.dispatchEvent(new Event(EVENTO));
  } catch {
    // sem localStorage: o selo so some quando a lista for vista de novo
  }
}

/** Quantas notas de versao o usuario ainda nao viu (selo no menu "Novidades"). */
export function useNovidadesNaoLidas(slug: string): number {
  const { data } = useQuery({ queryKey: ['novidades', slug], queryFn: () => api<ReleaseView[]>(`/t/${slug}/novidades`), staleTime: 10 * 60_000 });
  const [vistas, setVistas] = useState<string | null>(null);
  useEffect(() => {
    const ler = () => {
      try {
        setVistas(localStorage.getItem(CHAVE(slug)));
      } catch {
        setVistas(null);
      }
    };
    ler();
    window.addEventListener(EVENTO, ler);
    return () => window.removeEventListener(EVENTO, ler);
  }, [slug]);
  if (!data) return 0;
  return data.filter((r) => !vistas || r.publicadoEm > vistas).length;
}
