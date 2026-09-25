'use client';

import { useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Landmark,
  Users,
  ScrollText,
  ShieldCheck,
  KeyRound,
  DatabaseBackup,
} from 'lucide-react';
import { api, setAccessToken } from '@/lib/api';
import { TelaSessao, useSessao } from '@/components/shell/sessao';
import { AppShell } from '@/components/shell/app-shell';

const items = [
  { href: '/superadmin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/superadmin/orgaos', label: 'Órgãos', icon: Landmark },
  { href: '/superadmin/usuarios', label: 'Usuários', icon: Users },
  { href: '/superadmin/backups', label: 'Backups', icon: DatabaseBackup },
  { href: '/superadmin/logs', label: 'Logs', icon: ScrollText },
  { href: '/superadmin/2fa-setup', label: '2FA', icon: KeyRound },
];

const TITULOS: Record<string, { title: string; description: string }> = {
  dashboard: { title: 'Dashboard', description: 'Visão geral de todos os órgãos' },
  orgaos: { title: 'Órgãos', description: 'Cadastro, módulos contratados, quota e status' },
  usuarios: { title: 'Usuários', description: 'Usuários de qualquer órgão e superadmins' },
  backups: { title: 'Backups', description: 'Cópias de segurança por órgão' },
  logs: { title: 'Logs', description: 'Auditoria global e eventos de segurança' },
  '2fa-setup': { title: 'Autenticação em dois fatores', description: 'Configure o 2FA do seu acesso' },
};

export default function SuperadminShell({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const pathname = usePathname();
  const router = useRouter();

  // Bootstrap de sessao: refresh via cookie httpOnly (com timeout e "Tentar novamente").
  const { estado, tentarDeNovo } = useSessao(null, '/superadmin/login');

  const logout = async () => {
    try {
      await api('/superadmin/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      router.replace('/superadmin/login');
    }
  };

  if (estado !== 'pronta') return <TelaSessao estado={estado} onTentar={tentarDeNovo} />;

  const titulo = TITULOS[pathname.split('/')[2] ?? ''] ?? { title: 'Painel master' };

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell
        appName="jDoc Master"
        subtitle="JEOS Sistemas"
        icon={ShieldCheck}
        groups={[{ title: 'Administração', items: [...items] }]}
        user={{ nome: 'Superadmin JEOS', papel: 'Painel master' }}
        onLogout={logout}
        titulo={titulo}
      >
        {children}
      </AppShell>
    </QueryClientProvider>
  );
}
