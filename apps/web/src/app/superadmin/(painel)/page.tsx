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
import { cardCls, formatBytes, Badge, StatCard, UsageBar, btnGhost } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { EditModal, QuotaModal } from '@/components/superadmin/tenant-modals';
import { TenantManageModal } from '@/components/superadmin/tenant-manage-modal';
import { fmtDate } from '@/lib/format';

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
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Visão geral</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-[16px] bg-ink-100" aria-hidden />
          ))}
        </div>
      </div>
    );
  }

  const cards = [
    { label: 'Total de órgãos', value: data.totalOrgaos, icon: Landmark, tone: 'brand' },
    { label: 'Ativos', value: data.orgaosAtivos, icon: CheckCircle2, tone: 'success' },
    { label: 'Inativos', value: data.orgaosInativos, icon: XCircle, tone: 'orange' },
    {
      label: 'Armazenamento total',
      value: formatBytes(data.armazenamentoTotalBytes),
      icon: HardDrive,
      tone: 'info',
    },
    { label: 'Documentos indexados', value: data.documentosIndexados, icon: FileText, tone: 'brand' },
    { label: 'Uploads no mês', value: data.uploadsNoMes, icon: Upload, tone: 'success' },
  ] as const;

  const maxGrowth = Math.max(1, ...data.crescimento.map((g) => g.total));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Visão geral</h1>
        <Link href="/superadmin/orgaos" className="flex items-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-700">
          <Plus className="h-4 w-4" aria-hidden />
          Novo órgão
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ label, value, icon, tone }) => (
          <StatCard key={label} label={label} value={value} icon={icon} tone={tone} />
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="label-caps">
            Órgãos cadastrados{tenants ? ` (${tenants.length})` : ''}
          </p>
          <Link href="/superadmin/orgaos" className="text-xs font-semibold text-accent hover:underline">
            Ver todos →
          </Link>
        </div>

        {loadingTenants ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-[16px] bg-ink-100" aria-hidden />
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
              <div key={t.id} className={`${cardCls} border-t-4 ${t.status === 'ativo' ? 'border-t-success-500' : 'border-t-danger-500'} p-4`}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600">
                      {t.brasaoUrl ? (
                        <img src={t.brasaoUrl} alt={t.nome} className="h-full w-full object-cover" />
                      ) : (
                        <Landmark className="h-4 w-4 text-white" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink-800">{t.nome}</p>
                      <p className="truncate text-[11px] text-ink-500">/{t.slug}</p>
                    </div>
                  </div>
                  <Badge color={t.status === 'ativo' ? 'green' : 'red'}>{t.status.toUpperCase()}</Badge>
                </div>

                <p className="mb-2 text-[11px] text-ink-500">
                  Criado em {fmtDate(t.criadoEm)}
                </p>

                <UsageBar percent={t.usoPercent} />
                <p className="mb-3 mt-1 text-[11px] text-ink-500">
                  {formatBytes(t.usoBytes)} de {(t.quotaDiscoMb / 1024).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB
                </p>

                <div className="space-y-1.5">
                  <a
                    href={`/${t.slug}/login`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-brand-600 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-700"
                  >
                    <LogIn className="h-3.5 w-3.5" aria-hidden />
                    Acessar Sistema
                  </a>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
                    className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-ink-200 py-2 text-[13px] font-semibold text-accent transition hover:bg-ink-50"
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

      <div className={`${cardCls} p-5`}>
        <p className="mb-4 label-caps">
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
                <span className="text-[10px] font-bold text-ink-800">{g.total}</span>
                <div
                  className="w-full rounded-t bg-brand-600"
                  style={{ height: `${(g.total / maxGrowth) * 100}%`, minHeight: 4 }}
                />
                <span className="text-[9px] text-ink-500">{g.mes}</span>
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
