'use client';

import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IntegracaoView, TesteIntegracao } from '@jdoc/shared';
import { api } from '@/lib/api';
import { Skeleton } from '@/components/skeleton';
import { IntegracaoCard } from '@/components/platform/integracao-card';
import { usePode } from '@/components/platform/admin-context';

/** Chaves de API do orgao: propria (cifrada) ou a padrao da plataforma. */
export default function OrgaoIntegracoesPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const pode = usePode('owner', 'implantacao');
  const chave = ['sa-integracoes', id];
  const { data } = useQuery({ queryKey: chave, queryFn: () => api<IntegracaoView[]>(`/superadmin/tenants/${id}/integrations`) });
  if (!data) return <Skeleton rows={6} />;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {data.map((v) => (
        <IntegracaoCard
          key={v.key}
          view={v}
          modo="orgao"
          podeEditar={pode}
          onSalvar={async (body) => {
            await api(`/superadmin/tenants/${id}/integrations/${v.key}`, { method: 'PUT', body });
            await qc.invalidateQueries({ queryKey: chave });
          }}
          onTestar={() => api<TesteIntegracao>(`/superadmin/tenants/${id}/integrations/${v.key}/test`, { method: 'POST' })}
        />
      ))}
    </div>
  );
}
