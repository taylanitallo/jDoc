'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import type { UiTheme } from '@jdoc/shared';
import { aplicarTemaMarca } from '@/lib/brand-theme';

/**
 * Reaplica o tema salvo no servidor assim que o usuario e carregado (o cache
 * local ja pintou antes; aqui ele e corrigido se outro aparelho mudou o tema).
 * O modo (claro/escuro/sistema) so e imposto quando o usuario escolheu um.
 */
export function useTemaUsuario(escopo: string, tema: UiTheme | null | undefined, corOrgao?: string | null, pronto = true): void {
  const { setTheme } = useTheme();
  const cor = tema?.color ?? null;
  const modo = tema?.mode;
  useEffect(() => {
    if (!pronto) return;
    aplicarTemaMarca(escopo, cor, corOrgao);
  }, [escopo, cor, corOrgao, pronto]);
  useEffect(() => {
    if (pronto && modo) setTheme(modo);
  }, [modo, pronto, setTheme]);
}
