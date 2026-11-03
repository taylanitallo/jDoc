'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Activity,
  BadgeCheck,
  BookMarked,
  Building2,
  Clock3,
  DatabaseBackup,
  FileStack,
  Gauge,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  ScrollText,
  Settings,
  ShieldHalf,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PAPEL_ADMIN_LABEL, type AdminAtual, type PapelAdmin } from '@jdoc/shared';
import { api, setAccessToken } from '@/lib/api';
import { TelaSessao, useSessao } from '@/components/shell/sessao';
import { AppShell, type NavGroup } from '@/components/shell/app-shell';
import { ReauthDialog } from '@/components/platform/reauth-dialog';
import { useTemaUsuario } from '@/components/theme/use-tema-usuario';
import { AdminProvider } from '@/components/platform/admin-context';

type Item = { href: string; label: string; icon: LucideIcon; papeis?: PapelAdmin[]; descricao: string };

const TODOS: PapelAdmin[] = ['owner', 'support', 'implantacao'];
const OPERACAO: PapelAdmin[] = ['owner', 'support'];

/** Menu do painel: cada item so aparece para quem pode usa-lo (a API barra de qualquer jeito). */
const MENU: Array<{ title: string; items: Item[] }> = [
  {
    title: 'Visão geral',
    items: [{ href: '/superadmin', label: 'Painel', icon: LayoutDashboard, papeis: TODOS, descricao: 'Situação da plataforma e dos órgãos' }],
  },
  {
    title: 'Órgãos',
    items: [
      { href: '/superadmin/orgaos', label: 'Órgãos', icon: Building2, papeis: TODOS, descricao: 'Cadastro, módulos, perfis, usuários e integrações' },
      { href: '/superadmin/usuarios', label: 'Usuários', icon: Users, papeis: TODOS, descricao: 'Busca de usuários em todos os órgãos' },
      { href: '/superadmin/perfis-padrao', label: 'Perfis padrão', icon: ShieldHalf, papeis: ['owner', 'implantacao'], descricao: 'Modelos de perfis aplicados aos órgãos' },
    ],
  },
  {
    title: 'Operação',
    items: [
      { href: '/superadmin/backups', label: 'Backups', icon: DatabaseBackup, papeis: OPERACAO, descricao: 'Cópias de segurança e restauração' },
      { href: '/superadmin/jobs', label: 'Jobs', icon: Clock3, papeis: OPERACAO, descricao: 'Execuções de rotinas automáticas' },
      { href: '/superadmin/performance', label: 'Performance', icon: Gauge, papeis: OPERACAO, descricao: 'Tempo de resposta, erros, saúde e correções' },
      { href: '/superadmin/leis', label: 'Leis de referência', icon: BookMarked, papeis: TODOS, descricao: 'Biblioteca de leis por órgão e sincronização diária' },
      { href: '/superadmin/logs', label: 'Logs', icon: ScrollText, papeis: OPERACAO, descricao: 'Auditoria da plataforma e dos órgãos' },
    ],
  },
  {
    title: 'Atendimento',
    items: [
      { href: '/superadmin/chamados', label: 'Chamados', icon: LifeBuoy, papeis: OPERACAO, descricao: 'Fila de atendimento dos órgãos' },
      { href: '/superadmin/sla', label: 'SLA', icon: BadgeCheck, papeis: OPERACAO, descricao: 'Cumprimento dos prazos de atendimento' },
      { href: '/superadmin/releases', label: 'Releases', icon: Megaphone, papeis: OPERACAO, descricao: 'Notas de versão publicadas aos órgãos' },
    ],
  },
  {
    title: 'Administração',
    items: [
      { href: '/superadmin/equipe', label: 'Equipe', icon: UserCog, descricao: 'Pessoas com acesso a este painel' },
      { href: '/superadmin/configuracoes', label: 'Configurações', icon: Settings, descricao: 'Chaves globais, e-mail e integrações' },
    ],
  },
];

const EXTRAS: Record<string, { title: string; description: string }> = {
  conta: { title: 'Minha conta', description: 'Dados, senha, verificação em 2 etapas, sessões e tema' },
};

function tituloDa(pathname: string): { title: string; description?: string } {
  const seg = pathname.split('/')[2] ?? '';
  if (EXTRAS[seg]) return EXTRAS[seg]!;
  for (const g of MENU) {
    for (const i of g.items) {
      if (i.href === `/superadmin${seg ? `/${seg}` : ''}`) return { title: i.label, description: i.descricao };
    }
  }
  return { title: 'Painel' };
}

export default function SuperadminShell({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const pathname = usePathname();
  const login = `/superadmin/login?next=${encodeURIComponent(pathname)}`;
  // Bootstrap de sessao: refresh via cookie httpOnly (com timeout e "Tentar novamente").
  const { estado, tentarDeNovo } = useSessao(null, login);

  if (estado !== 'pronta') return <TelaSessao estado={estado} onTentar={tentarDeNovo} />;

  return (
    <QueryClientProvider client={queryClient}>
      <Casca>{children}</Casca>
    </QueryClientProvider>
  );
}

function Casca({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me } = useQuery({ queryKey: ['superadmin', 'me'], queryFn: () => api<AdminAtual>('/superadmin/me') });

  useTemaUsuario('superadmin', me?.uiTheme, null, !!me);

  // Sem 2FA ou com senha provisoria: so Minha conta ate resolver.
  const pendente = !!me && (!me.mfaEnabled || me.mustChangePassword);
  const naConta = pathname.startsWith('/superadmin/conta');
  useEffect(() => {
    if (pendente && !naConta) router.replace('/superadmin/conta');
  }, [pendente, naConta, router]);

  const sair = async () => {
    try {
      await api('/superadmin/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      router.replace('/superadmin/login');
    }
  };

  const groups: NavGroup[] = me
    ? MENU.map((g) => ({
        title: g.title,
        items: g.items
          .filter((i) => (i.papeis ?? ['owner']).includes(me.role))
          .map(({ href, label, icon }) => ({ href, label, icon })),
      })).filter((g) => g.items.length > 0)
    : [];

  return (
    <AdminProvider admin={me ?? null}>
      <AppShell
        appName="jDoc"
        subtitle="Superadmin"
        icon={FileStack}
        groups={pendente ? [] : groups}
        user={me ? { nome: me.nome, papel: PAPEL_ADMIN_LABEL[me.role] } : null}
        onLogout={sair}
        contaHref="/superadmin/conta"
        titulo={tituloDa(pathname)}
        banner={
          pendente ? (
            <div className="flex items-center gap-2 border-b border-warning-200 bg-warning-50 px-4 py-2.5 text-sm font-medium text-warning-600 sm:px-6 lg:px-8">
              <Activity className="h-4 w-4 shrink-0" aria-hidden />
              {me?.mustChangePassword ? 'Troque a senha provisória' : 'Ative a verificação em 2 etapas'} para liberar o painel.
            </div>
          ) : undefined
        }
      >
        {children}
      </AppShell>
      <ReauthDialog />
    </AdminProvider>
  );
}
