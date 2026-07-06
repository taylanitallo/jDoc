'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark,
  CheckCircle2,
  XCircle,
  HardDrive,
  FileText,
  Upload,
  Plus,
  LogIn,
  Sliders,
  Users,
  Pencil,
  Power,
  Settings2,
} from 'lucide-react';
import type { MasterDashboard, TenantOverview } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { cardCls, formatBytes, Badge, UsageBar, btnGhost } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { EditModal, QuotaModal } from '@/components/superadmin/tenant-modals';
import { TenantManageModal } from '@/components/superadmin/tenant-manage-modal';

export default function SuperadminDashboardPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['sa-dashboard'],
    queryFn: () => api<MasterDashboard>('/superadmin/dashboard'),
  });
  const { data: tenants, isLoading: loadingTenants } = useQuery({
    queryKey: ['sa-tenants'],
    queryFn: () => api<TenantOverview[]>('/superadmin/tenants'),
  });

  const [editing, setEditing] = useState<TenantOverview | null>(null);
  const [quotaEditing, setQuotaEditing] = useState<TenantOverview | null>(null);
  const [managing, setManaging] = useState<TenantOverview | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sa-tenants'] });

  const toggleStatus = useMutation({
    mutationFn: (t: TenantOverview) =>
      api(`/superadmin/tenants/${t.id}/status`, {
        method: 'PATCH',
        body: { status: t.status === 'ativo' ? 'inativo' : 'ativo' },
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Status do órgão atualizado.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Erro ao alterar status'),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-bold text-app">Dashboard Master</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-app-skeleton" aria-hidden />
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    { label: 'TOTAL DE ÓRGÃOS', value: data.totalOrgaos, icon: Landmark, accent: 'card-accent-blue' },
    { label: 'ATIVOS', value: data.orgaosAtivos, icon: CheckCircle2, accent: 'card-accent-green' },
    { label: 'INATIVOS', value: data.orgaosInativos, icon: XCircle, accent: 'card-accent-orange' },
    {
      label: 'ARMAZENAMENTO TOTAL',
      value: formatBytes(data.armazenamentoTotalBytes),
      icon: HardDrive,
      accent: 'card-accent-purple',
    },
    { label: 'DOCUMENTOS INDEXADOS', value: data.documentosIndexados, icon: FileText, accent: 'card-accent-blue' },
    { label: 'UPLOADS NO MÊS', value: data.uploadsNoMes, icon: Upload, accent: 'card-accent-green' },
  ] as const;

  const maxGrowth = Math.max(1, ...data.crescimento.map((g) => g.total));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-app">Dashboard Master</h1>
        <Link href="/superadmin/orgaos" className="flex items-center gap-2 rounded-lg bg-gradient-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:opacity-90">
          <Plus className="h-4 w-4" aria-hidden />
          Novo Órgão
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className={`${cardCls} p-4 ${accent}`}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase text-app-muted">{label}</p>
              <Icon className="h-5 w-5 text-app-muted" aria-hidden />
            </div>
            <p className="mt-2 text-2xl font-extrabold text-app">{value}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase text-app-muted">
            Órgãos cadastrados{tenants ? ` (${tenants.length})` : ''}
          </p>
          <Link href="/superadmin/orgaos" className="text-xs font-semibold text-accent hover:underline">
            Ver todos →
          </Link>
        </div>

        {loadingTenants ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-app-skeleton" aria-hidden />
            ))}
          </div>
        ) : !tenants || tenants.length === 0 ? (
          <div className={`${cardCls} p-5`}>
            <EmptyState
              icon={Landmark}
              title="Nenhum órgão cadastrado"
              description="Cadastre o primeiro órgão para começar a usar o jDoc."
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tenants.map((t) => (
              <div key={t.id} className={`${cardCls} border-t-4 ${t.status === 'ativo' ? 'border-t-green-500' : 'border-t-red-500'} p-4`}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-primary">
                      {t.brasaoUrl ? (
                        <img src={t.brasaoUrl} alt={t.nome} className="h-full w-full object-cover" />
                      ) : (
                        <Landmark className="h-4 w-4 text-white" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-app">{t.nome}</p>
                      <p className="truncate text-[11px] text-app-muted">/{t.slug}</p>
                    </div>
                  </div>
                  <Badge color={t.status === 'ativo' ? 'green' : 'red'}>{t.status.toUpperCase()}</Badge>
                </div>

                <p className="mb-2 text-[11px] text-app-muted">
                  Criado em {new Date(t.criadoEm).toLocaleDateString('pt-BR')}
                </p>

                <UsageBar percent={t.usoPercent} />
                <p className="mb-3 mt-1 text-[11px] text-app-muted">
                  {formatBytes(t.usoBytes)} de {(t.quotaDiscoMb / 1024).toFixed(2)} GB
                </p>

                <div className="space-y-1.5">
                  <a
                    href={`/${t.slug}/login`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-primary py-2 text-xs font-bold uppercase text-white transition hover:opacity-90"
                  >
                    <LogIn className="h-3.5 w-3.5" aria-hidden />
                    Acessar Sistema
                  </a>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => setQuotaEditing(t)} className={`${btnGhost} text-[11px]`}>
                      <Sliders className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      Configurar
                    </button>
                    <Link
                      href={`/superadmin/usuarios?tenantId=${t.id}`}
                      className={`${btnGhost} text-center text-[11px]`}
                    >
                      <Users className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      Usuários
                    </Link>
                    <button type="button" onClick={() => setEditing(t)} className={`${btnGhost} text-[11px]`}>
                      <Pencil className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleStatus.mutate(t)}
                      className={`${btnGhost} text-[11px]`}
                    >
                      <Power className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      {t.status === 'ativo' ? 'Desativar' : 'Ativar'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setManaging(t)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-app-border py-2 text-[11px] font-bold uppercase text-accent transition hover:bg-app-hover"
                  >
                    <Settings2 className="h-3.5 w-3.5" aria-hidden />
                    Gerenciar (Backup &amp; Logs)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${cardCls} p-5 card-accent-purple`}>
        <p className="mb-4 text-xs font-bold uppercase text-app-muted">
          Crescimento — órgãos cadastrados (12 meses)
        </p>
        {data.crescimento.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Sem dados no período"
            description="Não há registros de crescimento dos órgãos nos últimos 12 meses."
          />
        ) : (
          <div className="flex h-32 items-end gap-2">
            {data.crescimento.map((g) => (
              <div key={g.mes} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] font-bold text-app">{g.total}</span>
                <div
                  className="w-full rounded-t bg-gradient-primary"
                  style={{ height: `${(g.total / maxGrowth) * 100}%`, minHeight: 4 }}
                />
                <span className="text-[9px] text-app-muted">{g.mes}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <EditModal tenant={editing} onClose={() => setEditing(null)} onDone={invalidate} />}
      {quotaEditing && (
        <QuotaModal tenant={quotaEditing} onClose={() => setQuotaEditing(null)} onDone={invalidate} />
      )}
      {managing && <TenantManageModal tenant={managing} onClose={() => setManaging(null)} />}
    </div>
  );
}
