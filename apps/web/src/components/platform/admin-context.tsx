'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AdminAtual, PapelAdmin } from '@jdoc/shared';

const AdminContext = createContext<AdminAtual | null>(null);

export function AdminProvider({ admin, children }: { admin: AdminAtual | null; children: ReactNode }) {
  return <AdminContext.Provider value={admin}>{children}</AdminContext.Provider>;
}

/** Admin logado (null enquanto carrega). */
export function useAdmin(): AdminAtual | null {
  return useContext(AdminContext);
}

/** O papel do admin logado esta entre estes? Esconde botoes; quem barra e a API. */
export function usePode(...papeis: PapelAdmin[]): boolean {
  const admin = useContext(AdminContext);
  return !!admin && papeis.includes(admin.role);
}
