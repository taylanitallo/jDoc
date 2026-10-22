'use client';

/** Backups e agendamento de um orgao (aba Backup do detalhe do orgao). */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, RefreshCw } from 'lucide-react';
import type {
  BackupsListResponse,
  BackupView,
  TenantBackupSettings,
  TenantOverview,
  UpdateBackupSettingsInput,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, btnGhost, btnPrimary, cardCls, formatBytes, inputCls, labelCls, SelectMenu } from '@/components/ui';
import { useToast } from '@/components/toast';
import { fmtDateTime } from '@/lib/format';

export function BackupTab({ tenant }: { tenant: TenantOverview }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sa-backups', tenant.id],
    queryFn: () => api<BackupsListResponse>(`/superadmin/backups?tenantId=${tenant.id}`),
    refetchInterval: 5000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sa-backups', tenant.id] });

  const gerar = useMutation({
    mutationFn: () => api('/superadmin/backups', { method: 'POST', body: { tenantId: tenant.id } }),
    onSuccess: () => {
      invalidate();
      toast.success('Backup solicitado.');
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Erro ao gerar backup';
      setError(msg);
      toast.error(msg);
    },
  });

  const baixar = useMutation({
    mutationFn: async (id: string) => {
      const r = await api<{ url: string }>(`/superadmin/backups/${id}/download`, { method: 'POST' });
      return r.url;
    },
    onSuccess: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Erro ao baixar backup'),
  });

  const remover = useMutation({
    mutationFn: (id: string) => api(`/superadmin/backups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Backup excluído.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Erro ao excluir backup'),
  });

  const limparHistorico = useMutation({
    mutationFn: () => api<{ count: number }>(`/superadmin/backups/history?tenantId=${tenant.id}`, { method: 'DELETE' }),
    onSuccess: (r) => {
      invalidate();
      toast.success(`Histórico limpo (${r.count} registro(s)).`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Erro ao limpar histórico'),
  });

  const items = data?.items ?? [];
  const concluidos = items.filter((b) => b.status === 'concluido').length;
  const falhas = items.filter((b) => b.status === 'erro').length;
  const storageTotal = items.reduce((acc, b) => acc + (b.sizeBytes ?? 0), 0);
  const ultimo = items.find((b) => b.status === 'concluido');

  const statusColor = (s: string) =>
    s === 'concluido' ? 'green' : s === 'processando' ? 'blue' : s === 'pendente' ? 'orange' : 'red';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`${cardCls} p-3 text-center`}>
          <p className="text-xl font-extrabold text-ink-800">{concluidos}</p>
          <p className="label-caps">Concluídos</p>
        </div>
        <div className={`${cardCls} p-3 text-center`}>
          <p className={`text-xl font-extrabold ${falhas > 0 ? 'text-danger-600' : 'text-ink-800'}`}>{falhas}</p>
          <p className="label-caps">Falhas</p>
        </div>
        <div className={`${cardCls} p-3 text-center`}>
          <p className="text-xl font-extrabold text-ink-800">{formatBytes(storageTotal)}</p>
          <p className="label-caps">Storage</p>
        </div>
        <div className={`${cardCls} p-3 text-center`}>
          <p className="text-sm font-bold text-ink-800">
            {ultimo ? fmtDateTime(ultimo.concluidoEm ?? ultimo.criadoEm) : '—'}
          </p>
          <p className="label-caps">Último backup</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="label-caps">{items.length} registro(s)</p>
        <div className="flex gap-2">
          <button
            type="button"
            className={btnGhost}
            disabled={limparHistorico.isPending || items.length === 0}
            onClick={() => {
              if (confirm('Apagar TODO o histórico de backups deste órgão? Os arquivos também serão removidos.')) {
                limparHistorico.mutate();
              }
            }}
          >
            <Trash2 className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
            Limpar Histórico
          </button>
          <button type="button" className={btnPrimary} disabled={gerar.isPending} onClick={() => gerar.mutate()}>
            <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${gerar.isPending ? 'animate-spin' : ''}`} aria-hidden />
            Fazer Backup
          </button>
        </div>
      </div>

      {error && <p className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}

      <div className={`${cardCls} max-h-72 overflow-y-auto`}>
        {isLoading && <p className="p-4 text-sm text-ink-500">Carregando…</p>}
        {!isLoading && items.length === 0 && (
          <p className="p-6 text-center text-sm text-ink-500">Nenhum backup ainda.</p>
        )}
        {items.map((b: BackupView) => (
          <div key={b.id} className="flex items-center justify-between gap-2 border-b border-ink-200 px-3 py-2 last:border-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge color={statusColor(b.status)}>{b.status.toUpperCase()}</Badge>
                {b.isSafetyBackup && <Badge color="gray">SEGURANÇA</Badge>}
                <span className="text-xs text-ink-500">
                  {b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {fmtDateTime(b.criadoEm)}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                title="Baixar"
                disabled={b.status !== 'concluido'}
                onClick={() => baixar.mutate(b.id)}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-success-50 hover:text-success-600 disabled:opacity-30"
              >
                <Download className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                title="Excluir"
                onClick={() => confirm('Excluir este backup?') && remover.mutate(b.id)}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-500"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgendamentoTab({ tenant }: { tenant: TenantOverview }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['sa-backup-settings', tenant.id],
    queryFn: () => api<TenantBackupSettings>(`/superadmin/backups/settings/${tenant.id}`),
  });

  const [form, setForm] = useState<UpdateBackupSettingsInput | null>(null);
  useEffect(() => {
    if (data && !form) {
      setForm({ enabled: data.enabled, frequencia: data.frequencia, hora: data.hora, retencao: data.retencao });
    }
  }, [data, form]);

  const save = useMutation({
    mutationFn: (input: UpdateBackupSettingsInput) =>
      api<TenantBackupSettings>(`/superadmin/backups/settings/${tenant.id}`, { method: 'PATCH', body: input }),
    onSuccess: () => toast.success('Agendamento salvo.'),
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar agendamento';
      setError(msg);
      toast.error(msg);
    },
  });

  const gerarAgora = useMutation({
    mutationFn: () => api('/superadmin/backups', { method: 'POST', body: { tenantId: tenant.id } }),
    onSuccess: () => toast.success('Backup solicitado.'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Erro ao gerar backup'),
  });

  if (isLoading || !form) {
    return <p className="p-4 text-sm text-ink-500">Carregando…</p>;
  }

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex items-center justify-between p-4`}>
        <div className="space-y-1 text-xs text-ink-500">
          <p>
            <span className="font-bold text-ink-800">Próximo backup: </span>
            {data?.proximoBackup ? fmtDateTime(data.proximoBackup) : '—'}
          </p>
        </div>
        <button type="button" className={btnGhost} disabled={gerarAgora.isPending} onClick={() => gerarAgora.mutate()}>
          <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${gerarAgora.isPending ? 'animate-spin' : ''}`} aria-hidden />
          Executar Agora
        </button>
      </div>

      <label className={`${cardCls} flex items-center justify-between p-4`}>
        <div>
          <p className="text-sm font-bold text-ink-800">Ativar backup automático</p>
          <p className="text-xs text-ink-500">Executa sozinho no horário configurado</p>
        </div>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="h-5 w-5"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Frequência</label>
          <SelectMenu
            className={inputCls}
            value={form.frequencia}
            onChange={(e) => setForm({ ...form, frequencia: e.target.value as UpdateBackupSettingsInput['frequencia'] })}
          >
            <option value="diario">Diário</option>
            <option value="semanal">Semanal (domingo)</option>
          </SelectMenu>
        </div>
        <div>
          <label className={labelCls}>Horário de execução</label>
          <SelectMenu
            className={inputCls}
            value={form.hora}
            onChange={(e) => setForm({ ...form, hora: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </SelectMenu>
        </div>
      </div>

      <div>
        <label className={labelCls}>Quantidade de backups retidos</label>
        <input
          type="number"
          min={1}
          max={90}
          className={inputCls}
          value={form.retencao}
          onChange={(e) => setForm({ ...form, retencao: Number(e.target.value) })}
        />
        <p className="mt-1 text-[11px] text-ink-500">Backups mais antigos que este limite são removidos automaticamente.</p>
      </div>

      {error && <p className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}

      <button type="button" className={`${btnPrimary} w-full`} disabled={save.isPending} onClick={() => save.mutate(form)}>
        {save.isPending ? 'Salvando…' : 'Salvar configurações'}
      </button>
    </div>
  );
}
