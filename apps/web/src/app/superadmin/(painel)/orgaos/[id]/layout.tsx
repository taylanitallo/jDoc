'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { DatabaseBackup, ExternalLink, FileSignature, History, KeyRound, LayoutGrid, LifeBuoy, Settings2, ShieldHalf, Users } from 'lucide-react';
import { AMBIENTE_LABEL, TENANT_STATUS_LABEL, type TenantStatus } from '@jdoc/shared';
import { cn } from '@/lib/cn';
import { Badge, PageHeader, buttonClasses } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { STATUS_TOM, useOrgao } from '@/components/platform/orgao-ui';

const ABAS = [
  { id: 'geral', label: 'Geral', icon: Settings2 },
  { id: 'modulos', label: 'Módulos e menus', icon: LayoutGrid },
  { id: 'perfis', label: 'Perfis', icon: ShieldHalf },
  { id: 'usuarios', label: 'Usuários', icon: Users },
  { id: 'integracoes', label: 'Chaves de API', icon: KeyRound },
  { id: 'acessos', label: 'Acessos', icon: History },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'continuidade', label: 'Continuidade', icon: LifeBuoy },
  { id: 'contrato', label: 'Contrato e medição', icon: FileSignature },
];

export default function OrgaoLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { data: t, isLoading, isError } = useOrgao(id);
  const base = `/superadmin/orgaos/${id}`;

  if (isError) return <EmptyState title="Órgão não encontrado" description="Ele pode ter sido excluído." />;

  return (
    <div>
      <PageHeader
        back={{ href: '/superadmin/orgaos', label: 'Órgãos' }}
        title={isLoading || !t ? <Skeleton className="h-7 w-64" /> : t.nome}
        description={
          t ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TOM[t.status as TenantStatus] ?? 'neutral'}>{TENANT_STATUS_LABEL[t.status as TenantStatus] ?? t.status}</Badge>
              <span>
                /{t.slug} · {t.cidade ?? '—'}
                {t.uf ? `/${t.uf}` : ''} · {AMBIENTE_LABEL[t.ambiente]}
              </span>
            </span>
          ) : undefined
        }
        actions={
          t && (
            <a href={`/${t.slug}/login`} target="_blank" rel="noopener noreferrer" className={buttonClasses('outline', 'md')}>
              <ExternalLink aria-hidden />
              Acessar sistema
            </a>
          )
        }
      />
      <nav aria-label="Seções do órgão" className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-ink-200">
        {ABAS.map(({ id: aba, label, icon: Icon }) => {
          const href = `${base}/${aba}`;
          const ativa = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={aba}
              href={href}
              aria-current={ativa ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-semibold transition',
                ativa ? 'border-brand-600 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-900',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
