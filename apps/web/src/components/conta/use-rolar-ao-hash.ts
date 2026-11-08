'use client';

import { useEffect } from 'react';

/**
 * Leva a tela ate a secao do hash (#senha, #aparencia...) depois que os dados
 * chegam: enquanto a tela mostra o skeleton a secao ainda nao existe, e o
 * navegador nao tem para onde rolar.
 */
export function useRolarAoHash(pronto: boolean) {
  useEffect(() => {
    if (!pronto) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [pronto]);
}
