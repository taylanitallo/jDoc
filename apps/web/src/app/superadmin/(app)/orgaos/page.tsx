'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Power, HardDrive } from 'lucide-react';
import {
  createTenantSchema,
  UFS,
  type CreateTenantInput,
  type TenantOverview,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Modal,
  UsageBar,
  btnGhost,
  btnPrimary,
  cardCls,
  formatBytes,
  inputCls,
  labelCls,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { EditModal, QuotaModal } from '@/components/superadmin/tenant-modals';

export default function OrgaosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: tenants, isLoading } = useQuery({
    queryKey: ['sa-tenants'],
    queryFn: () => api<TenantOverview[]>('/superadmin/tenants'),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TenantOverview | null>(null);
  const [quotaEditing, setQuotaEditing] = useState<TenantOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Erro ao alterar status';
      setError(msg);
      toast.error(msg);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-app">Órgãos</h1>
        <button type="button" className={btnPrimary} onClick={() => setCreateOpen(true)}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Cadastrar Órgão
          </span>
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text"
        >
          {error}
        </p>
      )}

      <div className={`${cardCls} overflow-x-auto card-accent-blue`}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-app-border text-[11px] font-bold uppercase text-app-muted">
              <th className="px-4 py-3">Órgão</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Cidade/UF</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 w-52">Uso do disco</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-6 animate-pulse rounded bg-app-skeleton" />
                  </td>
                </tr>
              ))}
            {tenants?.map((t) => (
              <tr
                key={t.id}
                className="border-b border-app-border hover:bg-app-hover"
              >
                <td className="px-4 py-3 font-semibold text-app">{t.nome}</td>
                <td className="px-4 py-3 text-app-muted">/{t.slug}</td>
                <td className="px-4 py-3 text-app-muted">
                  {t.cidade ?? '—'}
                  {t.uf ? `/${t.uf}` : ''}
                </td>
                <td className="px-4 py-3">
                  <Badge color={t.status === 'ativo' ? 'green' : 'red'}>
                    {t.status.toUpperCase()}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <UsageBar percent={t.usoPercent} />
                  <p className="text-[10px] text-app-muted">
                    {formatBytes(t.usoBytes)} de {(t.quotaDiscoMb / 1024).toFixed(2)} GB
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      title="Editar"
                      aria-label={`Editar ${t.nome}`}
                      onClick={() => setEditing(t)}
                      className="rounded p-1.5 text-app-muted hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Quota de disco"
                      aria-label={`Alterar quota de ${t.nome}`}
                      onClick={() => setQuotaEditing(t)}
                      className="rounded p-1.5 text-app-muted hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/30 dark:hover:text-purple-300"
                    >
                      <HardDrive className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title={t.status === 'ativo' ? 'Desativar' : 'Ativar'}
                      aria-label={
                        t.status === 'ativo'
                          ? `Desativar ${t.nome}`
                          : `Ativar ${t.nome}`
                      }
                      onClick={() => toggleStatus.mutate(t)}
                      className={`rounded p-1.5 ${
                        t.status === 'ativo'
                          ? 'text-app-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30'
                          : 'text-app-muted hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30'
                      }`}
                    >
                      <Power className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {tenants?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-app-muted">
                  Nenhum órgão cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={invalidate} />
      {editing && (
        <EditModal tenant={editing} onClose={() => setEditing(null)} onDone={invalidate} />
      )}
      {quotaEditing && (
        <QuotaModal
          tenant={quotaEditing}
          onClose={() => setQuotaEditing(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function CreateModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [quotaGb, setQuotaGb] = useState(1);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateTenantInput>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { quotaDiscoMb: 1024 },
  });

  const onSubmit = async (data: CreateTenantInput) => {
    setError(null);
    try {
      await api('/superadmin/tenants', { method: 'POST', body: data });
      reset();
      setQuotaGb(1);
      onDone();
      onClose();
      toast.success('Órgão cadastrado e provisionado.');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao cadastrar órgão';
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <Modal
      title="Cadastrar Órgão"
      subtitle="Provisiona schema isolado automaticamente"
      open={open}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelCls} htmlFor="nome">Nome do órgão *</label>
            <input id="nome" className={inputCls} placeholder="Prefeitura Municipal de..." {...register('nome')} />
            {errors.nome && <p className="mt-1 text-xs text-app-error-text">{errors.nome.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="slug">Slug (URL) *</label>
            <input id="slug" className={inputCls} placeholder="iraucuba" {...register('slug')} />
            {errors.slug && <p className="mt-1 text-xs text-app-error-text">{errors.slug.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="quota">Quota (GB) *</label>
            <input
              id="quota"
              type="number"
              min={0.1}
              step={0.1}
              className={inputCls}
              value={quotaGb}
              onChange={(e) => {
                const gb = Number(e.target.value);
                setQuotaGb(gb);
                setValue('quotaDiscoMb', Math.round(gb * 1024), { shouldValidate: true });
              }}
            />
            {errors.quotaDiscoMb && (
              <p className="mt-1 text-xs text-app-error-text">
                {errors.quotaDiscoMb.message}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="cidade">Cidade *</label>
            <input id="cidade" className={inputCls} placeholder="Irauçuba" {...register('cidade')} />
            {errors.cidade && <p className="mt-1 text-xs text-app-error-text">{errors.cidade.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="uf">UF *</label>
            <select id="uf" className={inputCls} {...register('uf')}>
              <option value="">Selecione…</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
            {errors.uf && <p className="mt-1 text-xs text-app-error-text">UF obrigatória</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="responsavel">Responsável *</label>
            <input
              id="responsavel"
              className={inputCls}
              placeholder="Nome completo"
              {...register('responsavel')}
            />
            {errors.responsavel && (
              <p className="mt-1 text-xs text-app-error-text">{errors.responsavel.message}</p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="email">E-mail *</label>
            <input
              id="email"
              type="email"
              className={inputCls}
              placeholder="contato@orgao.gov.br"
              {...register('email')}
            />
            {errors.email && <p className="mt-1 text-xs text-app-error-text">{errors.email.message}</p>}
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
            {isSubmitting ? 'Provisionando…' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
