'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Plus, Power, Trash2 } from 'lucide-react';
import {
  createTenantUserSchema,
  MODULES,
  MODULE_ACTIONS,
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
  SelectMenu,
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

const MODULE_LABELS: Record<string, string> = {
  receitas: 'Receitas',
  despesas: 'Despesas',
  balancete: 'Balancete',
  extrato: 'Extrato',
  outros: 'Outros',
  configuracoes: 'Configurações',
  prestacao_contas: 'Prestação de Contas',
};

const ACTION_LABELS: Record<string, string> = {
  read: 'Ler',
  create: 'Criar',
  update: 'Editar',
  delete: 'Excluir',
  export: 'Exportar',
};

export default function UsuariosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [tenantId, setTenantId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [resetting, setResetting] = useState<TenantUserView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: tenants } = useQuery({
    queryKey: ['sa-tenants'],
    queryFn: () => api<TenantOverview[]>('/superadmin/tenants'),
  });

  // Preseleciona o orgao quando chega via link (ex: card do dashboard).
  useEffect(() => {
    const fromQuery = searchParams.get('tenantId');
    if (fromQuery) setTenantId(fromQuery);
  }, [searchParams]);

  const { data: users, isLoading } = useQuery({
    queryKey: ['sa-users', tenantId],
    queryFn: () => api<TenantUserView[]>(`/superadmin/tenants/${tenantId}/users`),
    enabled: !!tenantId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sa-users', tenantId] });

  const excluir = useMutation({
    mutationFn: (u: TenantUserView) => api(`/superadmin/tenants/${tenantId}/users/${u.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      toast.success('Usuário excluído.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao excluir'),
  });

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
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Usuários por Órgão</h1>
        <div className="flex items-center gap-3">
          <SelectMenu
            aria-label="Selecionar órgão"
            className={`${inputCls} w-64`}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          >
            <option value="">Selecione o órgão…</option>
            {tenants?.map((t) => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </SelectMenu>
          <button
            type="button"
            className={btnPrimary}
            disabled={!tenantId}
            onClick={() => setCreateOpen(true)}
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden /> Novo usuário
            </span>
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
          {error}
        </p>
      )}

      {!tenantId ? (
        <div className={`${cardCls} p-10 text-center text-sm text-ink-500`}>
          Selecione um órgão para gerenciar seus usuários.
        </div>
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/60">
              <tr className="border-b border-ink-200 label-caps">
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
                    <div className="h-6 animate-pulse rounded bg-ink-100" />
                  </td>
                </tr>
              )}
              {users?.map((u) => (
                <tr key={u.id} className="border-b border-ink-200 hover:bg-ink-50">
                  <td className="px-4 py-3 font-semibold text-ink-800">{u.nome}</td>
                  <td className="px-4 py-3 text-ink-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge color={u.role === 'admin' ? 'blue' : u.role === 'operador' ? 'orange' : 'gray'}>
                      {u.role.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={u.ativo ? 'green' : 'red'}>{u.ativo ? 'ATIVO' : 'INATIVO'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-500">
                    {u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="Resetar senha"
                        aria-label={`Resetar senha de ${u.nome}`}
                        onClick={() => setResetting(u)}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                      >
                        <KeyRound className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title={u.ativo ? 'Desativar' : 'Ativar'}
                        aria-label={u.ativo ? `Desativar ${u.nome}` : `Ativar ${u.nome}`}
                        onClick={() => toggleActive.mutate(u)}
                        className={`rounded p-1.5 text-ink-500 ${
                          u.ativo
                            ? 'hover:bg-danger-50 hover:text-danger-500'
                            : 'hover:bg-success-50 hover:text-success-600'
                        }`}
                      >
                        <Power className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        aria-label={`Excluir ${u.nome}`}
                        disabled={excluir.isPending}
                        onClick={() => {
                          if (window.confirm(`Excluir o usuário ${u.nome} (${u.email})? Esta ação não pode ser desfeita.`)) excluir.mutate(u);
                        }}
                        className="rounded p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-500">
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
  const [permissions, setPermissions] = useState<string[]>([]);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateTenantUserInput>({ resolver: zodResolver(createTenantUserSchema) });

  const role = watch('role');

  const togglePermission = (key: string) => {
    setPermissions((cur) => (cur.includes(key) ? cur.filter((p) => p !== key) : [...cur, key]));
  };

  const onSubmit = async (data: CreateTenantUserInput) => {
    setError(null);
    try {
      await api(`/superadmin/tenants/${tenantId}/users`, {
        method: 'POST',
        body: { ...data, permissions: data.role === 'admin' ? undefined : permissions },
      });
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
    <Modal title="Novo usuário" subtitle="Senha provisória deve ser trocada no primeiro acesso" open onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="u-nome">Nome completo<span className="ml-0.5 text-danger-600">*</span></label>
          <input id="u-nome" className={inputCls} {...register('nome')} />
          {errors.nome && <p className="mt-1 text-xs text-danger-600">{errors.nome.message}</p>}
        </div>
        <div>
          <label className={labelCls} htmlFor="u-email">E-mail<span className="ml-0.5 text-danger-600">*</span></label>
          <input id="u-email" type="email" className={inputCls} {...register('email')} />
          {errors.email && <p className="mt-1 text-xs text-danger-600">{errors.email.message}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="u-senha">Senha inicial<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="u-senha" type="password" className={inputCls} {...register('senha')} />
            {errors.senha && <p className="mt-1 text-xs text-danger-600">{errors.senha.message}</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="u-role">Papel<span className="ml-0.5 text-danger-600">*</span></label>
            <SelectMenu id="u-role" className={inputCls} {...register('role')}>
              <option value="">Selecione…</option>
              {TENANT_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </SelectMenu>
            {errors.role && <p className="mt-1 text-xs text-danger-600">Papel obrigatório</p>}
          </div>
        </div>

        {role && role !== 'admin' && (
          <div>
            <p className={labelCls}>Permissões por módulo</p>
            <div className={`${cardCls} overflow-x-auto`}>
              <table className="w-full text-left text-xs">
                <thead className="bg-ink-50/60">
                  <tr className="border-b border-ink-200 text-ink-500">
                    <th className="px-3 py-2">Módulo</th>
                    {MODULE_ACTIONS.map((a) => (
                      <th key={a} className="px-2 py-2 text-center">{ACTION_LABELS[a] ?? a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m} className="border-b border-ink-200 last:border-0">
                      <td className="px-3 py-1.5 text-ink-800">{MODULE_LABELS[m] ?? m}</td>
                      {MODULE_ACTIONS.map((a) => {
                        const key = `${m}:${a}`;
                        return (
                          <td key={a} className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={permissions.includes(key)}
                              onChange={() => togglePermission(key)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
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
          <p className="rounded-[10px] bg-success-50 px-3 py-2 text-sm text-success-600">
            Senha redefinida. Todas as sessões do usuário foram revogadas; troca forçada no próximo login.
          </p>
          <div className="flex justify-end">
            <button type="button" className={btnPrimary} onClick={onClose}>Fechar</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="r-senha">Nova senha (mín. 6 caracteres)</label>
            <input
              id="r-senha"
              type="password"
              className={inputCls}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
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
