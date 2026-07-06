'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DatabaseBackup,
  CalendarClock,
  ScrollText,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import type {
  BackupsListResponse,
  BackupView,
  TenantBackupSettings,
  TenantOverview,
  UpdateBackupSettingsInput,
  RestoreJobView,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { restoreTenantBackup } from '@/lib/upload';
import { Badge, Modal, btnGhost, btnPrimary, cardCls, formatBytes, inputCls, labelCls } from '@/components/ui';
import { useToast } from '@/components/toast';

const TABS = [
  { key: 'backup', label: 'Backup', icon: DatabaseBackup },
  { key: 'agendamento', label: 'Agendamento', icon: CalendarClock },
  { key: 'logs', label: 'Logs', icon: ScrollText },
  { key: 'restaurar', label: 'Restaurar', icon: Upload },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function TenantManageModal({
  tenant,
  onClose,
}: {
  tenant: TenantOverview;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>('backup');

  return (
    <Modal title={tenant.nome} subtitle={`/${tenant.slug}`} open onClose={onClose}>
      <div className="mb-4 flex gap-1 rounded-lg bg-app-input-bg p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-bold uppercase transition ${
              tab === key ? 'bg-app-card text-app shadow' : 'text-app-muted hover:text-app'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {tab === 'backup' && <BackupTab tenant={tenant} />}
      {tab === 'agendamento' && <AgendamentoTab tenant={tenant} />}
      {tab === 'logs' && <LogsTab tenant={tenant} />}
      {tab === 'restaurar' && <RestaurarTab tenant={tenant} />}
    </Modal>
  );
}

function BackupTab({ tenant }: { tenant: TenantOverview }) {
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`${cardCls} p-3 text-center`}>
          <p className="text-xl font-extrabold text-app">{concluidos}</p>
          <p className="text-[10px] uppercase text-app-muted">Concluídos</p>
        </div>
        <div className={`${cardCls} p-3 text-center`}>
          <p className={`text-xl font-extrabold ${falhas > 0 ? 'text-app-error-text' : 'text-app'}`}>{falhas}</p>
          <p className="text-[10px] uppercase text-app-muted">Falhas</p>
        </div>
        <div className={`${cardCls} p-3 text-center`}>
          <p className="text-xl font-extrabold text-app">{formatBytes(storageTotal)}</p>
          <p className="text-[10px] uppercase text-app-muted">Storage</p>
        </div>
        <div className={`${cardCls} p-3 text-center`}>
          <p className="text-sm font-bold text-app">
            {ultimo ? new Date(ultimo.concluidoEm ?? ultimo.criadoEm).toLocaleString('pt-BR') : '—'}
          </p>
          <p className="text-[10px] uppercase text-app-muted">Último backup</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase text-app-muted">{items.length} registro(s)</p>
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

      {error && <p className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>}

      <div className={`${cardCls} max-h-72 overflow-y-auto`}>
        {isLoading && <p className="p-4 text-sm text-app-muted">Carregando…</p>}
        {!isLoading && items.length === 0 && (
          <p className="p-6 text-center text-sm text-app-muted">Nenhum backup ainda.</p>
        )}
        {items.map((b: BackupView) => (
          <div key={b.id} className="flex items-center justify-between gap-2 border-b border-app-border px-3 py-2 last:border-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge color={statusColor(b.status)}>{b.status.toUpperCase()}</Badge>
                {b.isSafetyBackup && <Badge color="gray">SEGURANÇA</Badge>}
                <span className="text-xs text-app-muted">
                  {b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-app-muted">
                {new Date(b.criadoEm).toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                title="Baixar"
                disabled={b.status !== 'concluido'}
                onClick={() => baixar.mutate(b.id)}
                className="rounded p-1.5 text-app-muted hover:bg-green-50 hover:text-green-600 disabled:opacity-30 dark:hover:bg-green-900/30"
              >
                <Download className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                title="Excluir"
                onClick={() => confirm('Excluir este backup?') && remover.mutate(b.id)}
                className="rounded p-1.5 text-app-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
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

function AgendamentoTab({ tenant }: { tenant: TenantOverview }) {
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
    return <p className="p-4 text-sm text-app-muted">Carregando…</p>;
  }

  return (
    <div className="space-y-4">
      <div className={`${cardCls} flex items-center justify-between p-4`}>
        <div className="space-y-1 text-xs text-app-muted">
          <p>
            <span className="font-bold text-app">Próximo backup: </span>
            {data?.proximoBackup ? new Date(data.proximoBackup).toLocaleString('pt-BR') : '—'}
          </p>
        </div>
        <button type="button" className={btnGhost} disabled={gerarAgora.isPending} onClick={() => gerarAgora.mutate()}>
          <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${gerarAgora.isPending ? 'animate-spin' : ''}`} aria-hidden />
          Executar Agora
        </button>
      </div>

      <label className={`${cardCls} flex items-center justify-between p-4`}>
        <div>
          <p className="text-sm font-bold text-app">Ativar backup automático</p>
          <p className="text-xs text-app-muted">Executa sozinho no horário configurado</p>
        </div>
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="h-5 w-5"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Frequência</label>
          <select
            className={inputCls}
            value={form.frequencia}
            onChange={(e) => setForm({ ...form, frequencia: e.target.value as UpdateBackupSettingsInput['frequencia'] })}
          >
            <option value="diario">Diário</option>
            <option value="semanal">Semanal (domingo)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Horário de execução</label>
          <select
            className={inputCls}
            value={form.hora}
            onChange={(e) => setForm({ ...form, hora: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
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
        <p className="mt-1 text-[11px] text-app-muted">Backups mais antigos que este limite são removidos automaticamente.</p>
      </div>

      {error && <p className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>}

      <button type="button" className={`${btnPrimary} w-full`} disabled={save.isPending} onClick={() => save.mutate(form)}>
        {save.isPending ? 'Salvando…' : 'Salvar Configurações'}
      </button>
    </div>
  );
}

interface TenantLogEntry {
  id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  criado_em: string;
}

function LogsTab({ tenant }: { tenant: TenantOverview }) {
  const { data, isLoading } = useQuery({
    queryKey: ['sa-tenant-logs', tenant.id],
    queryFn: () =>
      api<{ items: TenantLogEntry[]; total: number }>(`/superadmin/tenants/${tenant.id}/logs?page=1&pageSize=50`),
  });

  return (
    <div className={`${cardCls} max-h-96 overflow-y-auto`}>
      {isLoading && <p className="p-4 text-sm text-app-muted">Carregando…</p>}
      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <p className="p-6 text-center text-sm text-app-muted">Nenhum registro de log.</p>
      )}
      {data?.items.map((l) => (
        <div key={l.id} className="border-b border-app-border px-3 py-2 last:border-0">
          <div className="flex items-center gap-2">
            <Badge color="blue">{l.action.toUpperCase()}</Badge>
            <span className="text-[11px] text-app-muted">
              {new Date(l.criado_em).toLocaleString('pt-BR')}
            </span>
          </div>
          {l.metadata && (
            <p className="mt-1 truncate text-[11px] text-app-muted">{JSON.stringify(l.metadata)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function RestaurarTab({ tenant }: { tenant: TenantOverview }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RestoreJobView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pollRestore(id: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const r = await api<RestoreJobView>(`/superadmin/backups/restore/${id}`);
      setStatus(r);
      if (r.status === 'concluido' || r.status === 'erro') return;
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    setStatus(null);
    try {
      const result = await restoreTenantBackup(tenant.id, file, () => undefined);
      if (!result.ok) {
        setError(result.message);
        toast.error(result.message);
        return;
      }
      const { id } = result.body as { id: string };
      toast.success('Restauração iniciada. Acompanhe o status abaixo.');
      await pollRestore(id);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
        <AlertTriangle className="h-8 w-8 shrink-0" aria-hidden />
        <p>
          <strong>Restaurar — use com cautela.</strong> Substitui TODOS os dados atuais de{' '}
          <strong>{tenant.nome}</strong>. Um backup de segurança é criado automaticamente antes.
          Somente arquivos <code>.dump.gz</code> gerados por este sistema são compatíveis.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".gz"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className={`${cardCls} flex w-full flex-col items-center gap-2 border-2 border-dashed p-8 text-center hover:border-neon-purple`}
      >
        <Upload className="h-8 w-8 text-app-muted" aria-hidden />
        <p className="text-sm font-semibold text-app">Clique para selecionar o arquivo de backup</p>
        <p className="text-xs text-app-muted">Apenas arquivos .dump.gz gerados por este sistema</p>
      </button>

      {error && <p className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>}

      {status && (
        <div className={`${cardCls} p-4`}>
          <div className="flex items-center gap-2">
            <Badge
              color={status.status === 'concluido' ? 'green' : status.status === 'erro' ? 'red' : 'blue'}
            >
              {status.status.toUpperCase()}
            </Badge>
            <span className="text-xs text-app-muted">
              {status.status === 'concluido' && 'Restauração concluída.'}
              {status.status === 'processando' && 'Restaurando… isso pode levar alguns instantes.'}
              {status.status === 'pendente' && 'Na fila…'}
              {status.status === 'erro' && (status.erroMensagem ?? 'Falha na restauração.')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
