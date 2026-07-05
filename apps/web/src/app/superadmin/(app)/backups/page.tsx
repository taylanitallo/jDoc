'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Badge, btnPrimary, cardCls, formatBytes, inputCls, labelCls } from '@/components/ui';
import { RefreshCw, Download } from 'lucide-react';
import type { BackupView, BackupsListResponse, TenantOverview } from '@jdoc/shared';
import { useToast } from '@/components/toast';

export default function BackupsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [filterTenantId, setFilterTenantId] = useState<string>('');

  // Lista de órgãos (para o seletor e o filtro).
  const { data: tenants, isLoading: isLoadingTenants } = useQuery({
    queryKey: ['sa-tenants'],
    queryFn: () => api<TenantOverview[]>('/superadmin/tenants'),
  });

  const { data: backups, isLoading } = useQuery({
    queryKey: ['sa-backups'],
    queryFn: () => api<BackupsListResponse>('/superadmin/backups'),
  });

  const gerarBackup = useMutation({
    mutationFn: async (tenantId: string) => {
      if (!tenantId) throw new Error('Selecione um orgao para gerar o backup');
      return api<{ id: string; status: string }>('/superadmin/backups', {
        method: 'POST',
        body: { tenantId },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sa-backups'] });
      toast.success('Backup solicitado. Acompanhe na tabela abaixo.');
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Erro ao gerar backup';
      setError(msg);
      toast.error(msg);
    },
  });

  const baixarBackup = useMutation({
    mutationFn: async (backupId: string) => {
      const result = await api<{ url: string; expiresInSeconds: number }>(
        `/superadmin/backups/${backupId}/download`,
        { method: 'POST' },
      );
      return result.url;
    },
    onSuccess: (url) => {
      // _blank + noopener,noreferrer: abre nova aba sem acesso a window.opener.
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('Link de download gerado. Abrindo em nova aba...');
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Erro ao baixar backup';
      setError(msg);
      toast.error(msg);
    },
  });

  // Aplica filtro por tenant sobre a lista retornada pelo backend.
  const backupsFiltrados = useMemo(() => {
    if (!backups?.items) return [];
    if (!filterTenantId) return backups.items;
    return backups.items.filter((b: BackupView) => b.tenantId === filterTenantId);
  }, [backups, filterTenantId]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'concluido':
        return 'green';
      case 'processando':
        return 'blue';
      case 'pendente':
        return 'orange';
      case 'erro':
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-app">Painel de Backups</h1>
      </div>

      <div className={`${cardCls} flex flex-wrap items-end gap-3 p-4 card-accent-blue`}>
        <div className="min-w-[240px] flex-1">
          <label className={labelCls} htmlFor="backup-tenant">
            Selecione o orgão
          </label>
          <select
            id="backup-tenant"
            className={inputCls}
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            disabled={isLoadingTenants}
          >
            <option value="">— selecione —</option>
            {tenants?.map((t: TenantOverview) => (
              <option key={t.id} value={t.id}>
                {t.nome} ({t.slug})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={btnPrimary}
          onClick={() => gerarBackup.mutate(selectedTenantId)}
          disabled={gerarBackup.isPending || !selectedTenantId}
        >
          <span className="flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${gerarBackup.isPending ? 'animate-spin' : ''}`} aria-hidden />
            Gerar backup
          </span>
        </button>

        <div className="min-w-[240px] flex-1">
          <label className={labelCls} htmlFor="backup-filter">
            Filtrar por orgão
          </label>
          <select
            id="backup-filter"
            className={inputCls}
            value={filterTenantId}
            onChange={(e) => setFilterTenantId(e.target.value)}
          >
            <option value="">— todos —</option>
            {tenants?.map((t: TenantOverview) => (
              <option key={t.id} value={t.id}>
                {t.nome} ({t.slug})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
          {error}
        </p>
      )}

      <div className={`${cardCls} overflow-x-auto card-accent-blue`}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-table-head text-[11px] font-bold uppercase text-app-muted">
              <th className="px-4 py-3">Órgão</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Tamanho</th>
              <th className="px-4 py-3">Criado em</th>
              <th className="px-4 py-3">Concluído em</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} aria-hidden>
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-6 animate-pulse rounded bg-app-skeleton" />
                  </td>
                </tr>
              ))}
            {backupsFiltrados.map((b: BackupView) => (
              <tr key={b.id} className="border-b border-app-border hover:bg-app-hover">
                <td className="px-4 py-3 font-semibold text-app">{b.tenantSlug}</td>
                <td className="px-4 py-3">
                  <Badge color={statusColor(b.status)}>{b.status.toUpperCase()}</Badge>
                </td>
                <td className="px-4 py-3 text-app-muted">
                  {b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}
                </td>
                <td className="px-4 py-3 text-app-muted">
                  {new Date(b.criadoEm).toLocaleString('pt-BR')}
                </td>
                <td className="px-4 py-3 text-app-muted">
                  {b.concluidoEm ? new Date(b.concluidoEm).toLocaleString('pt-BR') : '—'}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    title="Baixar backup"
                    aria-label={`Baixar backup do orgão ${b.tenantSlug}`}
                    disabled={b.status !== 'concluido'}
                    onClick={() => baixarBackup.mutate(b.id)}
                    className={`rounded p-1.5 ${
                      b.status === 'concluido'
                        ? 'text-app-muted hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30'
                        : 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                    }`}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && backupsFiltrados.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-app-muted">
                  Nenhum backup encontrado para o filtro selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}