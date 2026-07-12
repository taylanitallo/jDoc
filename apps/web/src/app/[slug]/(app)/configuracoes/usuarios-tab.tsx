'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { UnidadeOrcamentaria, UsuarioTenant } from '@jdoc/shared';
import { MODULES, MODULE_ACTIONS } from '@jdoc/shared';
import { Pencil, Key, Plus, Users as UsersIcon } from 'lucide-react';
import { Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';

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

export function UsuariosTab() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [page] = useState(1);
  const [editing, setEditing] = useState<UsuarioTenant | 'new' | null>(null);
  const [resetting, setResetting] = useState<UsuarioTenant | null>(null);

  const { data, isLoading } = useQuery<{ items: UsuarioTenant[]; total: number }>({
    queryKey: ['configuracoes', 'usuarios', page],
    queryFn: () => api(`/t/${slug}/configuracoes/usuarios?page=${page}&pageSize=20`),
  });

  const { data: unidadesData } = useQuery<{ items: UnidadeOrcamentaria[]; total: number }>({
    queryKey: ['configuracoes', 'unidades', 'all-para-usuario'],
    queryFn: () => api(`/t/${slug}/configuracoes/unidades?pageSize=200`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['configuracoes', 'usuarios'] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-app">Usuários e Permissões</h2>
        <button type="button" onClick={() => setEditing('new')} className={btnPrimary}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Novo Usuário
          </span>
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-app-muted">Carregando...</p>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Nenhum usuário cadastrado"
          description="Adicione usuários para que possam acessar o sistema."
        />
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="min-w-full divide-y divide-app-border text-sm">
            <thead>
              <tr className="bg-app-table-head">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-app-muted">
                  Nome
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-app-muted">
                  E-mail
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-app-muted">
                  Perfil
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-app-muted">
                  Status
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-app-muted">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {data?.items.map((u) => (
                <tr key={u.id} className="hover:bg-app-hover">
                  <td className="whitespace-nowrap px-4 py-2 font-medium text-app">{u.nome}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-app-muted">{u.email}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-app-muted">
                    <span className="rounded-full bg-app-badge-gray-bg px-2 py-0.5 text-[10px] font-medium capitalize text-app-badge-gray-text">
                      {u.role}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        u.ativo
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
                      }`}
                    >
                      {u.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Editar usuário ${u.nome}`}
                      title="Editar"
                      onClick={() => setEditing(u)}
                      className="mx-1 text-app-muted hover:text-accent"
                    >
                      <Pencil className="inline h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Resetar senha de ${u.nome}`}
                      title="Resetar senha"
                      onClick={() => setResetting(u)}
                      className="mx-1 text-app-muted hover:text-yellow-600 dark:hover:text-yellow-300"
                    >
                      <Key className="inline h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UsuarioModal
          slug={String(slug)}
          usuario={editing === 'new' ? null : editing}
          unidades={unidadesData?.items ?? []}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}

      {resetting && (
        <ResetSenhaModal
          slug={String(slug)}
          usuario={resetting}
          onClose={() => setResetting(null)}
        />
      )}
    </div>
  );
}

function UsuarioModal({
  slug,
  usuario,
  unidades,
  onClose,
  onDone,
}: {
  slug: string;
  usuario: UsuarioTenant | null;
  unidades: UnidadeOrcamentaria[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [role, setRole] = useState<'admin' | 'operador' | 'consulta'>(usuario?.role ?? 'operador');
  const [senha, setSenha] = useState('');
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true);
  const [permissions, setPermissions] = useState<string[]>(usuario?.permissions ?? []);
  const [unidadesIds, setUnidadesIds] = useState<string[]>(usuario?.unidadesIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const togglePermission = (key: string) => {
    setPermissions((cur) => (cur.includes(key) ? cur.filter((p) => p !== key) : [...cur, key]));
  };

  const toggleUnidade = (id: string) => {
    setUnidadesIds((cur) => (cur.includes(id) ? cur.filter((u) => u !== id) : [...cur, id]));
  };

  const save = useMutation({
    mutationFn: () => {
      if (usuario) {
        return api(`/t/${slug}/configuracoes/usuarios/${usuario.id}`, {
          method: 'PATCH',
          body: { nome, role, ativo, permissions, unidadesIds },
        });
      }
      return api(`/t/${slug}/configuracoes/usuarios`, {
        method: 'POST',
        body: { email, nome, role, senha, permissions, unidadesIds },
      });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar usuário'),
  });

  return (
    <Modal title={usuario ? 'Usuário — Edição' : 'Usuário — Inclusão'} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="usuario-nome">Nome *</label>
            <input
              id="usuario-nome"
              className={inputCls}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="usuario-email">E-mail *</label>
            <input
              id="usuario-email"
              type="email"
              className={inputCls}
              value={email}
              disabled={!!usuario}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@orgao.gov.br"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="usuario-role">Perfil *</label>
            <select
              id="usuario-role"
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'operador' | 'consulta')}
            >
              <option value="admin">Administrador</option>
              <option value="operador">Operador</option>
              <option value="consulta">Consulta</option>
            </select>
          </div>
          {!usuario && (
            <div>
              <label className={labelCls} htmlFor="usuario-senha">Senha provisória *</label>
              <input
                id="usuario-senha"
                type="password"
                className={inputCls}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="mínimo 6 caracteres"
              />
            </div>
          )}
        </div>

        {usuario && (
          <label className="flex items-center gap-2 text-sm text-app">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo
          </label>
        )}

        {role === 'admin' ? (
          <p className="rounded-lg bg-app-input-bg px-3 py-2 text-xs text-app-muted">
            Administradores têm acesso total ao tenant — não é preciso marcar permissões.
          </p>
        ) : (
          <div>
            <p className={labelCls}>Permissões por módulo</p>
            <div className={`${cardCls} overflow-x-auto`}>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-app-border text-app-muted">
                    <th className="px-3 py-2">Módulo</th>
                    {MODULE_ACTIONS.map((a) => (
                      <th key={a} className="px-2 py-2 text-center">{ACTION_LABELS[a] ?? a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m} className="border-b border-app-border last:border-0">
                      <td className="px-3 py-1.5 text-app">{MODULE_LABELS[m] ?? m}</td>
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

        {unidades.length > 0 && (
          <div>
            <p className={labelCls}>Unidades orçamentárias com acesso</p>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-app-border p-2">
              {unidades.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm text-app">
                  <input
                    type="checkbox"
                    checked={unidadesIds.includes(u.id!)}
                    onChange={() => toggleUnidade(u.id!)}
                  />
                  {u.codigo ? `${u.codigo} — ` : ''}{u.nome}
                </label>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => save.mutate()}
            disabled={save.isPending || !nome || (!usuario && (!email || senha.length < 8))}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ResetSenhaModal({
  slug,
  usuario,
  onClose,
}: {
  slug: string;
  usuario: UsuarioTenant;
  onClose: () => void;
}) {
  const [novaSenha, setNovaSenha] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useMutation({
    mutationFn: () =>
      api(`/t/${slug}/configuracoes/usuarios/${usuario.id}/reset-senha`, {
        method: 'POST',
        body: { novaSenha },
      }),
    onSuccess: () => setDone(true),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao resetar senha'),
  });

  return (
    <Modal title="Resetar senha" subtitle={usuario.nome} open onClose={onClose}>
      <div className="space-y-4">
        {done ? (
          <p className="text-sm text-app">Senha redefinida. O usuário precisará trocá-la no próximo acesso.</p>
        ) : (
          <>
            <div>
              <label className={labelCls} htmlFor="nova-senha">Nova senha provisória *</label>
              <input
                id="nova-senha"
                type="password"
                className={inputCls}
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                placeholder="mínimo 6 caracteres"
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>{done ? 'Fechar' : 'Cancelar'}</button>
          {!done && (
            <button
              type="button"
              className={btnPrimary}
              onClick={() => reset.mutate()}
              disabled={reset.isPending || novaSenha.length < 8}
            >
              {reset.isPending ? 'Salvando…' : 'Resetar'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
