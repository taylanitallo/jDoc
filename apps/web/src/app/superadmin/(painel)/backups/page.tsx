'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download, Eraser, HardDriveDownload, History, MoreHorizontal, Trash2 } from 'lucide-react';
import {
  STATUS_BACKUP_LABEL,
  TIPOS_BACKUP,
  TIPO_BACKUP_LABEL,
  type BackupView,
  type BackupsListResponse,
  type TenantOverview,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, DropdownMenu, Field, Input, Modal, PageHeader, Pagination, Select, formatBytes, type Tone } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { ProgressoRestauracao } from '@/components/platform/restauracao';
import { usePode } from '@/components/platform/admin-context';

const POR_PAGINA = 25;
const TOM_STATUS: Record<BackupView['status'], Tone> = { pendente: 'neutral', processando: 'info', concluido: 'success', erro: 'danger' };
const TOM_TIPO: Record<BackupView['kind'], Tone> = { manual: 'brand', agendado: 'teal', seguranca: 'warning' };

export default function BackupsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = usePode('owner');
  const [tenantId, setTenantId] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [pagina, setPagina] = useState(1);
  const [excluir, setExcluir] = useState<BackupView | null>(null);
  const [restaurar, setRestaurar] = useState<BackupView | null>(null);
  const [restauracao, setRestauracao] = useState<string | null>(null);
  const [completo, setCompleto] = useState(false);
  const [limpar, setLimpar] = useState(false);
  const [dias, setDias] = useState('90');

  const { data: orgaos } = useQuery({ queryKey: ['sa-tenants'], queryFn: () => api<TenantOverview[]>('/superadmin/tenants') });
  const qs = new URLSearchParams({
    ...(tenantId === 'completo' ? { completo: 'true' } : tenantId ? { tenantId } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['sa-backups-geral', qs.toString()],
    queryFn: () => api<BackupsListResponse>(`/superadmin/backups?${qs}`),
    refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === 'pendente' || b.status === 'processando') ? 3000 : 30_000),
  });
  const itens = data?.items ?? [];
  const recarregar = () => qc.invalidateQueries({ queryKey: ['sa-backups-geral'] });
  const erro = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível concluir.');

  const baixar = useMutation({
    mutationFn: (id: string) => api<{ url: string }>(`/superadmin/backups/${id}/download`, { method: 'POST' }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: erro,
  });
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/superadmin/backups/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setExcluir(null);
      toast.success('Backup excluído.');
      await recarregar();
    },
    onError: erro,
  });
  const fazerCompleto = useMutation({
    mutationFn: () => api('/superadmin/backups/completo', { method: 'POST' }),
    onSuccess: async () => {
      setCompleto(false);
      toast.success('Backup completo iniciado. Acompanhe na lista.');
      await recarregar();
    },
    onError: erro,
  });
  const limparAntigos = useMutation({
    mutationFn: () => api<{ count: number }>(`/superadmin/backups/antigos?diasMaisQue=${Number(dias)}`, { method: 'DELETE' }),
    onSuccess: async (r) => {
      setLimpar(false);
      toast.success(`${r.count} backup(s) apagado(s).`);
      await recarregar();
    },
    onError: erro,
  });
  const iniciarRestauracao = useMutation({
    mutationFn: (b: BackupView) =>
      api<{ id: string }>('/superadmin/backups/restore/de-backup', { method: 'POST', body: { tenantId: b.tenantId, backupId: b.id } }),
    onSuccess: (r) => {
      setRestaurar(null);
      setRestauracao(r.id);
    },
    onError: erro,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Backups"
        description="Cópias dos bancos dos órgãos (manuais, agendadas e de segurança) e o backup completo da plataforma."
        actions={
          owner && (
            <>
              <Button variant="outline" leftIcon={<Eraser aria-hidden />} onClick={() => setLimpar(true)}>
                Limpar antigos
              </Button>
              <Button leftIcon={<DatabaseBackup aria-hidden />} onClick={() => setCompleto(true)}>
                Backup completo
              </Button>
            </>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPagina(1); }} aria-label="Órgão">
          <option value="">Todos os órgãos</option>
          <option value="completo">Somente backups completos</option>
          {(orgaos ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </Select>
        <Select value={kind} onChange={(e) => { setKind(e.target.value); setPagina(1); }} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {TIPOS_BACKUP.map((k) => (
            <option key={k} value={k}>
              {TIPO_BACKUP_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }} aria-label="Situação">
          <option value="">Todas as situações</option>
          {Object.entries(STATUS_BACKUP_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} columns={6} label="Carregando backups" />
      ) : itens.length === 0 ? (
        <EmptyState icon={DatabaseBackup} title="Nenhum backup" description="Faça o primeiro pela aba Backup do órgão ou pelo backup completo." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Órgão</th>
                  <th className="px-4 py-3 label-caps">Tipo</th>
                  <th className="px-4 py-3 label-caps">Situação</th>
                  <th className="px-4 py-3 text-right label-caps">Tamanho</th>
                  <th className="px-4 py-3 label-caps">Por</th>
                  <th className="px-4 py-3 label-caps">Data</th>
                  <th className="px-4 py-3" aria-label="Ações" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {itens.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-semibold text-ink-900">{b.tenantNome ?? 'Plataforma inteira'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={TOM_TIPO[b.kind]}>{b.tenantId ? TIPO_BACKUP_LABEL[b.kind] : 'Completo'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={TOM_STATUS[b.status]}>{STATUS_BACKUP_LABEL[b.status]}</Badge>
                      {b.erroMensagem && <p className="mt-1 max-w-64 truncate text-xs text-danger-600" title={b.erroMensagem}>{b.erroMensagem}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink-600">{b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}</td>
                    <td className="px-4 py-3 text-ink-600">{b.criadoPor ?? (b.kind === 'agendado' ? 'Agendamento' : '—')}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-600">{fmtDateTime(b.criadoEm)}</td>
                    <td className="px-4 py-3 text-right">
                      {owner && b.status !== 'processando' && b.status !== 'pendente' && (
                        <DropdownMenu
                          items={[
                            ...(b.status === 'concluido'
                              ? [{ label: 'Baixar', icon: Download, hint: 'Fica registrado na auditoria', onSelect: () => baixar.mutate(b.id) }]
                              : []),
                            ...(b.status === 'concluido' && b.tenantId
                              ? [{ label: 'Restaurar este backup', icon: History, onSelect: () => setRestaurar(b) }]
                              : []),
                            { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => setExcluir(b) },
                          ]}
                          trigger={({ alternar, aberto }) => (
                            <Button variant="ghost" size="icon" aria-label="Ações do backup" aria-haspopup="menu" aria-expanded={aberto} onClick={alternar}>
                              <MoreHorizontal aria-hidden />
                            </Button>
                          )}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={itens.length} onPageChange={setPagina} />
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!excluir}
        onClose={() => setExcluir(null)}
        title="Excluir o backup?"
        description="O arquivo é apagado e não pode ser recuperado."
        confirmLabel="Excluir"
        loading={apagar.isPending}
        onConfirm={() => {
          if (excluir) apagar.mutate(excluir.id);
        }}
      />
      <ConfirmDialog
        open={completo}
        onClose={() => setCompleto(false)}
        title="Fazer o backup completo?"
        description="Copia o banco inteiro (catálogo e todos os órgãos). Pode levar alguns minutos."
        confirmLabel="Iniciar"
        tone="primary"
        loading={fazerCompleto.isPending}
        onConfirm={() => fazerCompleto.mutate()}
      />
      {restaurar && (
        <ConfirmDialog
          open
          onClose={() => setRestaurar(null)}
          title={`Restaurar ${restaurar.tenantNome}?`}
          description={`Os dados atuais do órgão serão substituídos pelos do backup de ${fmtDateTime(restaurar.criadoEm)}. Antes é feito um backup de segurança e o órgão fica em manutenção durante a troca. Se algo falhar, os dados atuais permanecem.`}
          confirmLabel="Restaurar"
          digitar={restaurar.tenantSlug ?? undefined}
          loading={iniciarRestauracao.isPending}
          onConfirm={() => iniciarRestauracao.mutate(restaurar)}
        />
      )}
      <Modal open={!!restauracao} onClose={() => setRestauracao(null)} title="Restauração" subtitle="Pode fechar: ela continua no servidor." size="sm">
        {restauracao && <ProgressoRestauracao id={restauracao} onFim={() => void recarregar()} />}
      </Modal>
      <Modal
        open={limpar}
        onClose={() => setLimpar(false)}
        title="Limpar backups antigos"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setLimpar(false)}>
              Cancelar
            </Button>
            <Button variant="danger" leftIcon={<HardDriveDownload aria-hidden />} loading={limparAntigos.isPending} disabled={!(Number(dias) >= 1)} onClick={() => limparAntigos.mutate()}>
              Apagar
            </Button>
          </>
        }
      >
        <Field label="Apagar backups com mais de (dias)" htmlFor="limpar-dias" hint="Vale para todos os órgãos e para os backups completos.">
          <Input id="limpar-dias" type="number" min={1} value={dias} onChange={(e) => setDias(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
