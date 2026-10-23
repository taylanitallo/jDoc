'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IntegracaoView, TesteIntegracao } from '@jdoc/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { IntegracaoCard } from '@/components/platform/integracao-card';
import { LgpdCard } from '@/components/platform/lgpd-card';
import { usePode } from '@/components/platform/admin-context';

/**
 * Chaves globais padrao (SMTP, IA, mapas, WhatsApp): valem para todo orgao que
 * nao tiver a propria. Segredos cifrados; salvar pede confirmacao de identidade.
 */
export default function ConfiguracoesPage() {
  const qc = useQueryClient();
  const owner = usePode('owner');
  const { data } = useQuery({ queryKey: ['sa-settings'], queryFn: () => api<IntegracaoView[]>('/superadmin/settings') });
  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Padrões da plataforma, usados por todo órgão que não tiver configuração própria. O servidor de e-mail envia convites e a recuperação de senha."
      />
      {!data ? (
        <Skeleton rows={8} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {data.map((v) => (
            <IntegracaoCard
              key={v.key}
              view={v}
              modo="plataforma"
              onSalvar={async (body) => {
                await api(`/superadmin/settings/${v.key}`, { method: 'PUT', body });
                await qc.invalidateQueries({ queryKey: ['sa-settings'] });
              }}
              onTestar={() => api<TesteIntegracao>(`/superadmin/settings/${v.key}/test`, { method: 'POST' })}
            />
          ))}
        </div>
      )}
      <div className="mt-6">
        <LgpdCard podeEditar={owner} />
      </div>
    </div>
  );
}
