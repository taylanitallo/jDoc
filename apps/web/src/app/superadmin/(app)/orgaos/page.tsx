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
  SelectMenu,
} from '@/components/ui';
import { useToast } from '@/components/toast';
import { EditModal, QuotaModal } from '@/components/superadmin/tenant-modals';
import { ModulosBadges, ModulosContratados } from '@/components/superadmin/modulos-contratados';

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
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Órgãos</h1>
        <button type="button" className={btnPrimary} onClick={() => setCreateOpen(true)}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Cadastrar Órgão
          </span>
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600"
        >
          {error}
        </p>
      )}

      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-50/60">
            <tr className="border-b border-ink-200 label-caps">
              <th className="px-4 py-3">Órgão</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Cidade/UF</th>
              <th className="px-4 py-3">Módulos</th>
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
                    <div className="h-6 animate-pulse rounded bg-ink-100" />
                  </td>
                </tr>
              ))}
            {tenants?.map((t) => (
              <tr
                key={t.id}
                className="border-b border-ink-200 hover:bg-ink-50"
              >
                <td className="px-4 py-3 font-semibold text-ink-800">{t.nome}</td>
                <td className="px-4 py-3 text-ink-500">/{t.slug}</td>
                <td className="px-4 py-3 text-ink-500">
                  {t.cidade ?? '—'}
                  {t.uf ? `/${t.uf}` : ''}
                </td>
                <td className="px-4 py-3">
                  <ModulosBadges modulos={t.modulos ?? ['financeiro']} />
                </td>
                <td className="px-4 py-3">
                  <Badge color={t.status === 'ativo' ? 'green' : 'red'}>
                    {t.status.toUpperCase()}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <UsageBar percent={t.usoPercent} />
                  <p className="text-[10px] text-ink-500">
                    {formatBytes(t.usoBytes)} de {(t.quotaDiscoMb / 1024).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      title="Editar"
                      aria-label={`Editar ${t.nome}`}
                      onClick={() => setEditing(t)}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title="Quota de disco"
                      aria-label={`Alterar quota de ${t.nome}`}
                      onClick={() => setQuotaEditing(t)}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
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
                          ? 'text-ink-500 hover:bg-danger-50 hover:text-danger-500'
                          : 'text-ink-500 hover:bg-success-50 hover:text-success-600'
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
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateTenantInput>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { quotaDiscoMb: 1024, modulos: ['financeiro'] },
  });
  const modulos = watch('modulos') ?? [];

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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="nome">Nome do órgão<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="nome" className={inputCls} placeholder="Prefeitura Municipal de..." {...register('nome')} />
            {errors.nome && <p className="mt-1 text-xs text-danger-600">{errors.nome.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="slug">Slug (URL)<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="slug" className={inputCls} placeholder="iraucuba" {...register('slug')} />
            {errors.slug && <p className="mt-1 text-xs text-danger-600">{errors.slug.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="quota">Quota (GB)<span className="ml-0.5 text-danger-600">*</span></label>
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
              <p className="mt-1 text-xs text-danger-600">
                {errors.quotaDiscoMb.message}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="cidade">Cidade<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="cidade" className={inputCls} placeholder="Irauçuba" {...register('cidade')} />
            {errors.cidade && <p className="mt-1 text-xs text-danger-600">{errors.cidade.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="uf">UF<span className="ml-0.5 text-danger-600">*</span></label>
            <SelectMenu id="uf" className={inputCls} {...register('uf')}>
              <option value="">Selecione…</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </SelectMenu>
            {errors.uf && <p className="mt-1 text-xs text-danger-600">UF obrigatória</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="responsavel">Responsável<span className="ml-0.5 text-danger-600">*</span></label>
            <input
              id="responsavel"
              className={inputCls}
              placeholder="Nome completo"
              {...register('responsavel')}
            />
            {errors.responsavel && (
              <p className="mt-1 text-xs text-danger-600">{errors.responsavel.message}</p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="email">E-mail<span className="ml-0.5 text-danger-600">*</span></label>
            <input
              id="email"
              type="email"
              className={inputCls}
              placeholder="contato@orgao.gov.br"
              {...register('email')}
            />
            {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
          </div>
          <ModulosContratados
            value={modulos}
            onChange={(v) => setValue('modulos', v, { shouldValidate: true })}
            erro={errors.modulos?.message}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600"
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
