'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Plus, Power } from 'lucide-react';
import {
  createTenantUserSchema,
  TENANT_ROLES,
  type CreateTenantUserInput,
  type TenantOverview,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Modal,
  btnGhost,
  btnPrimary,
  cardCls,
  inputCls,
  labelCls,
} from '@/components/ui';
import { useToast } from '@/components/toast';

interface TenantUserView {
  id: string;
  email: string;
  nome: string;
  role: string;
  ativo: boolean;
  ultimoAcesso: string | null;
}

export default function UsuariosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tenantId, setTenantId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [resetting, setResetting] = useState<TenantUserView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: tenants } = useQuery({
    queryKey: ['sa-tenants'],
    queryFn: () => api<TenantOverview[]>('/superadmin/tenants'),
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ['sa-users', tenantId],
    queryFn: () => api<TenantUserView[]>(`/superadmin/tenants/${tenantId}/users`),
    enabled: !!tenantId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sa-users', tenantId] });

  const toggleActive = useMutation({
    mutationFn: (u: TenantUserView) =>
      api(`/superadmin/tenants/${tenantId}/users/${u.id}/ativo`, {
        method: 'PATCH',
        body: { ativo: !u.ativo },
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Status do usuário atualizado.');
    },
    onError: (e) => {
      const msg = e instanceof ApiError ? e.message : 'Erro ao alterar usuário';
      setError(msg);
      toast.error(msg);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-app">Usuários por Órgão</h1>
        <div className="flex items-center gap-3">
          <select
            aria-label="Selecionar órgão"
            className={`${inputCls} w-64`}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          >
            <option value="">Selecione o órgão…</option>
            {tenants?.map((t) => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </select>
          <button
            type="button"
            className={btnPrimary}
            disabled={!tenantId}
            onClick={() => setCreateOpen(true)}
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden /> Novo Usuário
            </span>
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
          {error}
        </p>
      )}

      {!tenantId ? (
        <div className={`${cardCls} p-10 text-center text-sm text-app-muted card-accent-blue`}>
          Selecione um órgão para gerenciar seus usuários.
        </div>
      ) : (
        <div className={`${cardCls} overflow-x-auto card-accent-green`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-app-border text-[11px] font-bold uppercase text-app-muted">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Papel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Último acesso</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-6 animate-pulse rounded bg-app-skeleton" />
                  </td>
                </tr>
              )}
              {users?.map((u) => (
                <tr key={u.id} className="border-b border-app-border hover:bg-app-hover">
                  <td className="px-4 py-3 font-semibold text-app">{u.nome}</td>
                  <td className="px-4 py-3 text-app-muted">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge color={u.role === 'admin' ? 'blue' : u.role === 'operador' ? 'orange' : 'gray'}>
                      {u.role.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={u.ativo ? 'green' : 'red'}>{u.ativo ? 'ATIVO' : 'INATIVO'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-app-muted">
                    {u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="Resetar senha"
                        aria-label={`Resetar senha de ${u.nome}`}
                        onClick={() => setResetting(u)}
                        className="rounded p-1.5 text-app-muted hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/30 dark:hover:text-purple-300"
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title={u.ativo ? 'Desativar' : 'Ativar'}
                        aria-label={u.ativo ? `Desativar ${u.nome}` : `Ativar ${u.nome}`}
                        onClick={() => toggleActive.mutate(u)}
                        className={`rounded p-1.5 text-app-muted ${
                          u.ativo
                            ? 'hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30'
                            : 'hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30'
                        }`}
                      >
                        <Power className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-app-muted">
                    Nenhum usuário neste órgão.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && tenantId && (
        <CreateUserModal tenantId={tenantId} onClose={() => setCreateOpen(false)} onDone={invalidate} />
      )}
      {resetting && tenantId && (
        <ResetPasswordModal
          tenantId={tenantId}
          user={resetting}
          onClose={() => setResetting(null)}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  tenantId,
  onClose,
  onDone,
}: {
  tenantId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateTenantUserInput>({ resolver: zodResolver(createTenantUserSchema) });

  const onSubmit = async (data: CreateTenantUserInput) => {
    setError(null);
    try {
      await api(`/superadmin/tenants/${tenantId}/users`, { method: 'POST', body: data });
      onDone();
      onClose();
      toast.success('Usuário criado.');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao criar usuário';
      setError(msg);
      toast.error(msg);
    }
  };

  return (
    <Modal title="Novo Usuário" subtitle="Senha provisória deve ser trocada no primeiro acesso" open onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="u-nome">Nome completo *</label>
          <input id="u-nome" className={inputCls} {...register('nome')} />
          {errors.nome && <p className="mt-1 text-xs text-app-error-text">{errors.nome.message}</p>}
        </div>
        <div>
          <label className={labelCls} htmlFor="u-email">E-mail *</label>
          <input id="u-email" type="email" className={inputCls} {...register('email')} />
          {errors.email && <p className="mt-1 text-xs text-app-error-text">{errors.email.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="u-senha">Senha inicial *</label>
            <input id="u-senha" type="password" className={inputCls} {...register('senha')} />
            {errors.senha && <p className="mt-1 text-xs text-app-error-text">{errors.senha.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="u-role">Papel *</label>
            <select id="u-role" className={inputCls} {...register('role')}>
              <option value="">Selecione…</option>
              {TENANT_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {errors.role && <p className="mt-1 text-xs text-app-error-text">Papel obrigatório</p>}
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="submit" className={btnPrimary} disabled={isSubmitting}>
            {isSubmitting ? 'Criando…' : 'Criar usuário'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  tenantId,
  user,
  onClose,
}: {
  tenantId: string;
  user: { id: string; nome: string };
  onClose: () => void;
}) {
  const toast = useToast();
  const [senha, setSenha] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await api(`/superadmin/tenants/${tenantId}/users/${user.id}/password`, {
        method: 'PATCH',
        body: { novaSenha: senha },
      });
      setDone(true);
      toast.success('Senha redefinida. Sessões revogadas.');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erro ao resetar senha';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Resetar Senha" subtitle={user.nome} open onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-200">
            Senha redefinida. Todas as sessões do usuário foram revogadas; troca forçada no próximo login.
          </p>
          <div className="flex justify-end">
            <button type="button" className={btnPrimary} onClick={onClose}>Fechar</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="r-senha">Nova senha (mín. 10 caracteres)</label>
            <input
              id="r-senha"
              type="password"
              className={inputCls}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className={btnPrimary}
              onClick={save}
              disabled={saving || senha.length < 10}
            >
              {saving ? 'Salvando…' : 'Resetar senha'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}