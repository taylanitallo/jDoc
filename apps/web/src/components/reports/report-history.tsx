'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Download, Loader2, FileText, Trash2, TriangleAlert, CheckCircle2, XCircle, Clock, HardDrive, ListChecks } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { Badge, Modal, btnGhost, cardCls, formatBytes } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';

interface ReportJobView {
  id: string;
  tipo: string;
  status: string;
  totalRegistros: number;
  criadoEm: string;
  erroMensagem: string | null;
  fileSize: number | null;
}

interface ReportHistoryProps {
  slug: string;
  tipo: 'prestacao_contas' | 'midia_legislativa';
  reload: number;
}

const STATUS_COLOR: Record<string, 'green' | 'red' | 'orange' | 'gray'> = {
  concluido: 'green',
  erro: 'red',
  pendente: 'orange',
  processando: 'orange',
};

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  processando: 'Processando',
  concluido: 'Concluído',
  erro: 'Erro',
};

const ROW_ACCENT: Record<string, string> = {
  concluido: 'border-l-4 border-l-success-500',
  erro: 'border-l-4 border-l-danger-500',
  pendente: 'border-l-4 border-l-orange-500/30',
  processando: 'border-l-4 border-l-orange-500',
};

const STAT_TILE_STYLE: Record<string, string> = {
  purple: 'bg-brand-50 text-brand-600',
  green: 'bg-success-50 text-success-600',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-danger-50 text-danger-600',
  blue: 'bg-brand-50 text-brand-600',
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'concluido') return <CheckCircle2 className="h-3 w-3" aria-hidden />;
  if (status === 'erro') return <XCircle className="h-3 w-3" aria-hidden />;
  if (status === 'processando') return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
  return <Clock className="h-3 w-3" aria-hidden />;
}

function StatTile({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color: keyof typeof STAT_TILE_STYLE;
}) {
  return (
    <div className={`${cardCls} flex items-center gap-3 p-3`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${STAT_TILE_STYLE[color]}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-tight text-ink-800">{value}</p>
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      </div>
    </div>
  );
}

export function ReportHistory({ slug, tipo, reload }: ReportHistoryProps) {
  const toast = useToast();
  const [jobs, setJobs] = useState<ReportJobView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Carrega lista inicial (historico separado por tipo de relatorio)
  useEffect(() => {
    let active = true;
    setLoadError(null);
    api<{ items: ReportJobView[]; total: number }>(`/t/${slug}/reports?tipo=${tipo}&page=1&pageSize=20`)
      .then(data => {
        if (!active) return;
        setJobs(data.items);
      })
      .catch(err => {
        if (!active) return;
        const msg = err instanceof ApiError ? err.message : 'Erro ao carregar histórico';
        setLoadError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, tipo, reload, toast]);

  // Polling de cada job não-terminal a cada 2s
  useEffect(() => {
    const pendingIds = jobs
      .filter(j => j.status !== 'concluido' && j.status !== 'erro')
      .map(j => j.id);
    if (pendingIds.length === 0) return;

    const interval = setInterval(() => {
      Promise.all(
        pendingIds.map(id =>
          api<ReportJobView>(`/t/${slug}/reports/${id}`).catch(() => null),
        ),
      ).then(updates => {
        const valid = updates.filter((u): u is ReportJobView => u !== null);
        setJobs(prev =>
          prev.map(job => {
            const updated = valid.find((u: ReportJobView) => u.id === job.id);
            return updated ?? job;
          }),
        );
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [slug, jobs]);

  const stats = useMemo(() => {
    const concluidos = jobs.filter(j => j.status === 'concluido').length;
    const emAndamento = jobs.filter(j => j.status === 'pendente' || j.status === 'processando').length;
    const erros = jobs.filter(j => j.status === 'erro').length;
    const espacoTotal = jobs.reduce((acc, j) => acc + (j.fileSize ?? 0), 0);
    return { concluidos, emAndamento, erros, espacoTotal };
  }, [jobs]);

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleClearHistory() {
    setClearError(null);
    setClearing(true);
    try {
      await api(`/t/${slug}/reports?tipo=${tipo}`, { method: 'DELETE' });
      setJobs([]);
      setConfirmClear(false);
      toast.success('Histórico limpo.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao limpar histórico';
      setClearError(msg);
      toast.error(msg);
    } finally {
      setClearing(false);
    }
  }

  async function handleDeleteOne() {
    if (!confirmDeleteId) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await api(`/t/${slug}/reports/${confirmDeleteId}`, { method: 'DELETE' });
      setJobs(prev => prev.filter(j => j.id !== confirmDeleteId));
      setConfirmDeleteId(null);
      toast.success('Relatório excluído.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao excluir relatório';
      setDeleteError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload(jobId: string) {
    setDownloadError(null);
    try {
      const data = await api<{ signedUrl: string }>(
        `/t/${slug}/reports/${jobId}/download`,
      );
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      toast.success('Download iniciado em nova aba.');
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Erro ao gerar link de download';
      setDownloadError(msg);
      toast.error(msg);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center p-8" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-hidden />
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="p-4">
        {loadError ? (
          <p className="text-sm text-danger-600" role="alert">
            {loadError}
          </p>
        ) : (
          <EmptyState
            icon={FileText}
            title="Nenhum relatório gerado ainda"
            description="Os relatórios solicitados aparecerão aqui."
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {loadError && (
        <p className="p-2 text-sm text-danger-600" role="alert">
          {loadError}
        </p>
      )}
      {downloadError && (
        <p className="p-2 text-sm text-danger-600" role="alert">
          {downloadError}
        </p>
      )}
      <div className="flex items-center justify-between">
        {stats.erros > 0 ? (
          <p className="inline-flex items-center gap-1 text-xs font-semibold text-danger-600">
            <XCircle className="h-3.5 w-3.5" aria-hidden /> {stats.erros}{' '}
            {stats.erros === 1 ? 'relatório com erro' : 'relatórios com erro'}
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="flex items-center gap-2 rounded-[10px] border border-danger-500/30 bg-surface px-4 py-2 text-[13px] font-semibold text-danger-500 transition hover:bg-danger-50"
          onClick={() => setConfirmClear(true)}
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Limpar histórico
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={ListChecks} label="Total" value={jobs.length} color="purple" />
        <StatTile icon={CheckCircle2} label="Concluídos" value={stats.concluidos} color="green" />
        <StatTile icon={Loader2} label="Em andamento" value={stats.emAndamento} color="orange" />
        <StatTile icon={HardDrive} label="Espaço usado" value={formatBytes(stats.espacoTotal)} color="blue" />
      </div>

      {/* Tabela (telas médias e maiores) */}
      <div className={`${cardCls} hidden overflow-x-auto md:block`}>
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60">
            <tr>
              <th className="p-3 text-left label-caps">
                Status
              </th>
              <th className="p-3 text-left label-caps">
                Total
              </th>
              <th className="p-3 text-left label-caps">
                Tamanho
              </th>
              <th className="p-3 text-left label-caps">
                Criado em
              </th>
              <th className="p-3 text-right label-caps">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => {
              const created = new Date(job.criadoEm);
              return (
                <tr
                  key={job.id}
                  className={`border-t border-ink-200 transition hover:bg-ink-50 ${ROW_ACCENT[job.status] ?? 'border-l-4 border-l-transparent'}`}
                >
                  <td className="p-3">
                    <Badge color={STATUS_COLOR[job.status] ?? 'gray'}>
                      <span className="inline-flex items-center gap-1">
                        <StatusIcon status={job.status} />
                        {STATUS_LABEL[job.status] ?? job.status}
                      </span>
                    </Badge>
                  </td>
                  <td className="p-3 tabular-nums text-ink-800">{job.totalRegistros}</td>
                  <td className="p-3 tabular-nums text-ink-500">
                    {job.fileSize != null ? formatBytes(job.fileSize) : '—'}
                  </td>
                  <td className="p-3 text-ink-500" title={created.toLocaleString('pt-BR')}>
                    <div className="text-ink-800">{created.toLocaleDateString('pt-BR')}</div>
                    <div className="text-xs">{created.toLocaleTimeString('pt-BR')}</div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">
                      {job.status === 'concluido' ? (
                        <button
                          type="button"
                          aria-label="Baixar relatório"
                          onClick={() => handleDownload(job.id)}
                          className="rounded-[10px] border border-success-500/30 bg-surface px-4 py-2 text-[13px] font-semibold text-success-600 transition hover:bg-success-50"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Download className="h-4 w-4" aria-hidden /> Download
                          </span>
                        </button>
                      ) : job.status === 'erro' ? (
                        <span className="text-xs text-danger-600" title={job.erroMensagem ?? undefined}>
                          {job.erroMensagem}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-ink-500">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          <span className="sr-only">Processando</span>
                        </span>
                      )}
                      <button
                        type="button"
                        aria-label="Excluir relatório"
                        title="Excluir do histórico"
                        onClick={() => setConfirmDeleteId(job.id)}
                        className="rounded-[10px] p-2 text-ink-500 transition hover:bg-danger-50 hover:text-danger-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cards (telas pequenas) */}
      <div className="space-y-2 md:hidden">
        {jobs.map(job => {
          const created = new Date(job.criadoEm);
          return (
            <div
              key={job.id}
              className={`${cardCls} p-3 ${ROW_ACCENT[job.status] ?? 'border-l-4 border-l-transparent'}`}
            >
              <div className="flex items-center justify-between">
                <Badge color={STATUS_COLOR[job.status] ?? 'gray'}>
                  <span className="inline-flex items-center gap-1">
                    <StatusIcon status={job.status} />
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                </Badge>
                <div className="flex items-center gap-1">
                  {job.status === 'concluido' ? (
                    <button
                      type="button"
                      aria-label="Baixar relatório"
                      onClick={() => handleDownload(job.id)}
                      className="rounded-[10px] border border-success-500/30 bg-surface px-3 py-1.5 text-[13px] font-semibold text-success-600 transition hover:bg-success-50"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Download className="h-4 w-4" aria-hidden /> Download
                      </span>
                    </button>
                  ) : job.status === 'processando' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-ink-500" aria-hidden />
                  ) : null}
                  <button
                    type="button"
                    aria-label="Excluir relatório"
                    onClick={() => setConfirmDeleteId(job.id)}
                    className="rounded-[10px] p-2 text-ink-500 transition hover:bg-danger-50 hover:text-danger-600"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-y-1 text-xs">
                <dt className="text-ink-500">Total</dt>
                <dd className="text-right text-ink-800">{job.totalRegistros}</dd>
                <dt className="text-ink-500">Tamanho</dt>
                <dd className="text-right text-ink-800">
                  {job.fileSize != null ? formatBytes(job.fileSize) : '—'}
                </dd>
                <dt className="text-ink-500">Criado em</dt>
                <dd className="text-right text-ink-800">{created.toLocaleString('pt-BR')}</dd>
              </dl>
              {job.status === 'erro' && job.erroMensagem && (
                <p className="mt-2 text-xs text-danger-600">{job.erroMensagem}</p>
              )}
            </div>
          );
        })}
      </div>
      {confirmClear && (
        <Modal
          title="Limpar histórico"
          subtitle="Relatórios gerados"
          open
          onClose={() => setConfirmClear(false)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-[10px] bg-danger-50 px-3 py-3 text-sm text-danger-600">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Isso vai excluir <strong>permanentemente</strong> todo o histórico de relatórios gerados,
                incluindo os arquivos já produzidos. Essa ação não pode ser desfeita. Deseja continuar?
              </p>
            </div>
            {clearError && (
              <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {clearError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setConfirmClear(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-60"
                onClick={handleClearHistory}
                disabled={clearing}
              >
                {clearing ? 'Limpando…' : 'Limpar histórico'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDeleteId && (
        <Modal
          title="Excluir relatório"
          subtitle="Item do histórico"
          open
          onClose={() => setConfirmDeleteId(null)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-[10px] bg-danger-50 px-3 py-3 text-sm text-danger-600">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Isso vai excluir <strong>permanentemente</strong> este relatório e o arquivo gerado
                (se houver). Essa ação não pode ser desfeita. Deseja continuar?
              </p>
            </div>
            {deleteError && (
              <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setConfirmDeleteId(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-60"
                onClick={handleDeleteOne}
                disabled={deleting}
              >
                {deleting ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}