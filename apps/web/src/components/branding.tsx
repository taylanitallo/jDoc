'use client';

import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TenantBranding } from '@jdoc/shared';

const EMPTY_BRANDING: TenantBranding = { nomeExibido: null, corDestaque: null, brasaoUrl: null };

const BrandingContext = createContext<TenantBranding>(EMPTY_BRANDING);

/** Identidade visual do tenant (nome exibido, cor de destaque, brasao) — usada no sidebar e nos relatorios. */
export function useBranding(): TenantBranding {
  return useContext(BrandingContext);
}

/** Busca a identidade do tenant via React Query (mesma queryKey usada pela tela de
 *  Configuracoes) — assim, ao salvar o layout ou trocar o brasao, o invalidateQueries
 *  de la atualiza o sidebar/banners aqui tambem, sem precisar recarregar a pagina.
 *  Aplica --accent-color em um wrapper `display:contents` (sem afetar o layout) para
 *  reaproveitar o utilitario `accent` do Tailwind. */
export function BrandingProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const { data } = useQuery<TenantBranding>({
    queryKey: ['configuracoes', 'branding'],
    queryFn: () => api(`/t/${slug}/configuracoes/branding`),
    retry: false,
  });
  const branding = data ?? EMPTY_BRANDING;

  const style = branding.corDestaque
    ? ({ '--accent-color': branding.corDestaque } as CSSProperties)
    : undefined;

  return (
    <BrandingContext.Provider value={branding}>
      <div className="contents" style={style}>
        {children}
      </div>
    </BrandingContext.Provider>
  );
}
