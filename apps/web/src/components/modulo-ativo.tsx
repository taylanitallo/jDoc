'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Landmark, Library, type LucideIcon } from 'lucide-react';
import type { Sistema } from '@jdoc/shared';
import { useBranding } from '@/components/branding';

const CHAVE = 'jdoc-modulo-ativo';

/** Rotas (segmento apos /<slug>/) que pertencem a cada modulo. As demais sao comuns. */
export const ROTAS_DO_MODULO: Record<Sistema, readonly string[]> = {
  financeiro: ['receitas', 'despesas', 'balancete', 'extrato', 'outros', 'prestacao-contas', 'midia-legislativa', 'pasta-monitorada'],
  arquivo: ['acervo', 'dossies', 'descricao', 'arquivo-fisico', 'temporalidade', 'integridade', 'relatorios', 'atendimento', 'sigilo'],
};

export function moduloDaRota(segmento: string): Sistema | null {
  if (ROTAS_DO_MODULO.financeiro.includes(segmento)) return 'financeiro';
  if (ROTAS_DO_MODULO.arquivo.includes(segmento)) return 'arquivo';
  return null;
}

/** Identidade visual de cada modulo: Financeiro em azul (brand), Arquivo em laranja. */
export const MODULO_VISUAL: Record<Sistema, { nome: string; curto: string; icon: LucideIcon; solido: string; suave: string; texto: string; anel: string }> = {
  financeiro: {
    nome: 'Financeiro/Contábil',
    curto: 'Financeiro',
    icon: Landmark,
    solido: 'bg-brand-600',
    suave: 'bg-brand-50',
    texto: 'text-brand-600',
    anel: 'hover:border-brand-500 focus-visible:border-brand-500',
  },
  arquivo: {
    nome: 'Arquivo Municipal',
    curto: 'Arquivo',
    icon: Library,
    solido: 'bg-orange-600',
    suave: 'bg-orange-50',
    texto: 'text-orange-600',
    anel: 'hover:border-orange-500 focus-visible:border-orange-500',
  },
};

interface ModuloAtivoCtx {
  /** Modulo em uso na tela (null enquanto os modulos contratados carregam). */
  ativo: Sistema | null;
  /** O orgao contratou os dois? So entao existe o seletor. */
  ambos: boolean;
  trocar: (s: Sistema) => void;
}

const Ctx = createContext<ModuloAtivoCtx>({ ativo: null, ambos: false, trocar: () => undefined });

export function useModuloAtivo(): ModuloAtivoCtx {
  return useContext(Ctx);
}

/**
 * Separa a experiencia em dois modulos: Financeiro/Contabil e Arquivo Municipal.
 * A rota manda (abrir /acervo ativa o Arquivo); nas telas comuns vale a ultima
 * escolha do usuario, guardada no navegador.
 */
export function ModuloAtivoProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const { modulos } = useBranding();
  const pathname = usePathname();
  const [escolhido, setEscolhido] = useState<Sistema | null>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(CHAVE);
      if (v === 'financeiro' || v === 'arquivo') setEscolhido(v);
    } catch {
      // localStorage indisponivel: usa o padrao
    }
  }, []);

  const trocar = useCallback((s: Sistema) => {
    setEscolhido(s);
    try {
      localStorage.setItem(CHAVE, s);
    } catch {
      // ignora
    }
  }, []);

  const segmento = pathname.slice(`/${slug}/`.length).split('/')[0] ?? '';
  const daRota = moduloDaRota(segmento);

  // A rota de um modulo vira a escolha salva (voltar ao Inicio mantem o modulo).
  useEffect(() => {
    if (daRota && daRota !== escolhido) trocar(daRota);
  }, [daRota, escolhido, trocar]);

  let ativo: Sistema | null = null;
  if (modulos.length > 0) {
    const candidato = daRota ?? escolhido;
    ativo = candidato && modulos.includes(candidato) ? candidato : modulos.includes('financeiro') ? 'financeiro' : 'arquivo';
  }

  return <Ctx.Provider value={{ ativo, ambos: modulos.length > 1, trocar }}>{children}</Ctx.Provider>;
}
