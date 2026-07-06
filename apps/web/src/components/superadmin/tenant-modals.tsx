'use client';

import { useState, type DragEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileUp, Trash2 } from 'lucide-react';
import {
  updateTenantSchema,
  UFS,
  type UpdateTenantInput,
  type TenantOverview,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { uploadTenantBrasao } from '@/lib/upload';
import {
  Modal,
  UsageBar,
  btnGhost,
  btnPrimary,
  formatBytes,
  inputCls,
  labelCls,
} from '@/components/ui';
import { useToast } from '@/components/toast';

/**
 * Modais de Editar/Quota do orgao — compartilhados entre a pagina de Orgaos
 * e os cards do Dashboard. Precisam viver FORA de um arquivo page.tsx: o
 * Next.js so aceita um conjunto fixo de exports nomeados num page.tsx
 * (default/metadata/config/...) e rejeita qualquer outro no build.
 */

export function EditModal({
  tenant,
  onClose,
  onDone,
}: {
  tenant: TenantOverview;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateTenantInput>({
    resolver: zodResolver(updateTenantSchema),
    defaultValues: {
      nome: tenant.nome,
      cidade: tenant.cidade ?? undefined,
      uf: (tenant.uf as UpdateTenantInput['uf']) ?? undefined,
      responsavel: tenant.responsavel ?? undefined,
      email: tenant.email ?? undefined,
    },
  });

  const onSubmit = async (data: UpdateTenantInput) => {
    setError(null);
    try {
      await api(`/superadmin/tenants/${tenant.id}`, { method: 'PATCH', body: data });
      onDone();
      onClose();
      toast.success('Órgão atualizado.');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar';
      setError(msg);
      toast.error(msg);
    }
  };

  const [brasaoUrl, setBrasaoUrl] = useState(tenant.brasaoUrl);
  const [dragOver, setDragOver] = useState(false);
  const [uploadingBrasao, setUploadingBrasao] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [removingBrasao, setRemovingBrasao] = useState(false);

  async function handleBrasaoFile(file: File) {
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      toast.error('Envie uma imagem PNG ou JPEG.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2MB.');
      return;
    }
    setUploadingBrasao(true);
    setProgress(0);
    const result = await uploadTenantBrasao(tenant.id, file, setProgress);
    setUploadingBrasao(false);
    setProgress(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const { brasaoUrl: url } = result.body as { brasaoUrl: string };
    setBrasaoUrl(url);
    onDone();
    toast.success('Brasão atualizado.');
  }

  async function handleRemoveBrasao() {
    setRemovingBrasao(true);
    try {
      await api(`/superadmin/tenants/${tenant.id}/brasao`, { method: 'DELETE' });
      setBrasaoUrl(null);
      onDone();
      toast.success('Brasão removido.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erro ao remover brasão');
    } finally {
      setRemovingBrasao(false);
    }
  }

  function onDropBrasao(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleBrasaoFile(f);
  }

  return (
    <Modal title="Editar Órgão" subtitle={`/${tenant.slug}`} open onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelCls} htmlFor="e-nome">Nome</label>
            <input id="e-nome" className={inputCls} {...register('nome')} />
            {errors.nome && (
              <p className="mt-1 text-xs text-app-error-text">{errors.nome.message}</p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="e-cidade">Cidade</label>
            <input id="e-cidade" className={inputCls} {...register('cidade')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="e-uf">UF</label>
            <select id="e-uf" className={inputCls} {...register('uf')}>
              <option value="">—</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="e-resp">Responsável</label>
            <input id="e-resp" className={inputCls} {...register('responsavel')} />
          </div>
          <div>
            <label className={labelCls} htmlFor="e-email">E-mail</label>
            <input
              id="e-email"
              type="email"
              className={inputCls}
              {...register('email')}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-app-error-text">{errors.email.message}</p>
            )}
          </div>
        </div>

        <div>
          <label className={labelCls}>Brasão do Município</label>
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-app-border bg-app-table-head">
              {brasaoUrl ? (
                <img src={brasaoUrl} alt="Brasão atual" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[9px] text-app-muted">Sem brasão</span>
              )}
            </div>

            <div
              role="button"
              tabIndex={0}
              aria-label="Área de upload do brasão"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDropBrasao}
              onClick={() => document.getElementById('sa-brasao-file-input')?.click()}
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('sa-brasao-file-input')?.click()}
              className={`flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed p-3 text-center transition ${
                dragOver ? 'border-accent bg-purple-50 dark:bg-purple-900/10' : 'border-app-border hover:border-app-muted'
              }`}
            >
              <FileUp className="h-4 w-4 text-app-muted" aria-hidden />
              <p className="text-[11px] text-app-muted">
                PNG/JPEG até 2MB —{' '}
                <span className="font-semibold text-accent">clique para selecionar</span>
              </p>
              <input
                id="sa-brasao-file-input"
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleBrasaoFile(f);
                }}
              />
            </div>

            {brasaoUrl && (
              <button
                type="button"
                onClick={handleRemoveBrasao}
                disabled={removingBrasao}
                className={`${btnGhost} shrink-0`}
                title="Remover brasão"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {uploadingBrasao && progress !== null && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-app-skeleton">
              <div className="h-full bg-gradient-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={btnPrimary} disabled={isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function QuotaModal({
  tenant,
  onClose,
  onDone,
}: {
  tenant: TenantOverview;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  // Estado em GB (o que o superadmin ve e edita) — a API continua em MB.
  const [quotaGb, setQuotaGb] = useState(tenant.quotaDiscoMb / 1024);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await api(`/superadmin/tenants/${tenant.id}/quota`, {
        method: 'PATCH',
        body: { quotaDiscoMb: Math.round(quotaGb * 1024) },
      });
      onDone();
      onClose();
      toast.success('Quota atualizada.');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar quota';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Quota de Disco" subtitle={tenant.nome} open onClose={onClose}>
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase text-app-muted">Uso atual</p>
          <UsageBar percent={tenant.usoPercent} />
          <p className="mt-1 text-xs text-app-muted">
            {formatBytes(tenant.usoBytes)} de {(tenant.quotaDiscoMb / 1024).toFixed(2)} GB
          </p>
        </div>
        <div>
          <label className={labelCls} htmlFor="q-gb">Nova quota (GB)</label>
          <input
            id="q-gb"
            type="number"
            min={0.1}
            step={0.1}
            className={inputCls}
            value={quotaGb}
            onChange={(e) => setQuotaGb(Number(e.target.value))}
          />
          <p className="mt-1 text-[11px] text-app-muted">
            Limite interno do jDoc (bloqueia novos envios ao atingir). Não reserva espaço
            no Supabase — o espaço real disponível depende do plano contratado lá.
          </p>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={btnPrimary} onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar quota'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
