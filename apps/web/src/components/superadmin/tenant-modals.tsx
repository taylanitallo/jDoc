'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  updateTenantSchema,
  UFS,
  type UpdateTenantInput,
  type TenantOverview,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
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
