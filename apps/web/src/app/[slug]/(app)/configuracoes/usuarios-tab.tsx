'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { UnidadeOrcamentaria, UsuarioTenant } from '@jdoc/shared';
import { MODULES, MODULE_ACTIONS, MODULOS_RBAC_POR_SISTEMA } from '@jdoc/shared';
import { useBranding } from '@/components/branding';
import { useToast } from '@/components/toast';
import { Pencil, Key, Plus, Trash2, Users as UsersIcon } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Avatar, Badge, Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls, type Tone, SelectMenu } from '@/components/ui';

const PERFIL_TOM: Record<string, Tone> = { admin: 'violet', operador: 'info', consulta: 'neutral' };
const PERFIL_ROTULO: Record<string, string> = { admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' };

const MODULE_LABELS: Record<string, string> = {
  receitas: 'Receitas',
  despesas: 'Despesas',
  balancete: 'Balancete',
  extrato: 'Extrato',
  outros: 'Outros',
  configuracoes: 'Configurações',
  prestacao_contas: 'Prestação de contas',
  acervo: 'Acervo',
  acervo_restrito: 'Acervo — docs restritos (só Ler)',
  classificacao: 'Plano de Classificação',
  temporalidade: 'Temporalidade',
  arquivo_fisico: 'Arquivo físico',
  integridade: 'Integridade (preservação digital)',
  atendimento: 'Atendimento e consultas',
  sigilo: 'Sigilo (LAI)',
  dossies: 'Dossiês e processos',
  descricao: 'Descrição arquivística (NOBRADE)',
  legislacao: 'Legislação (texto compilado)',
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

  const toast = useToast();
  const excluir = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/configuracoes/usuarios/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracoes', 'usuarios'] });
      toast.success('Usuário excluído.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para excluir usuários.' : e.message) : 'Falha ao excluir'),
  });

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
        <h2 className="text-base font-bold text-ink-900">Usuários e permissões</h2>
        <button type="button" onClick={() => setEditing('new')} className={btnPrimary}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Novo usuário
          </span>
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-500">Carregando...</p>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Nenhum usuário cadastrado"
          description="Adicione usuários para que possam acessar o sistema."
        />
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="min-w-full divide-y divide-ink-200 text-sm">
            <thead className="bg-ink-50/60">
              <tr>
                <th className="px-4 py-3 text-left label-caps">
                  Nome
                </th>
                <th className="px-4 py-3 text-left label-caps">
                  E-mail
                </th>
                <th className="px-4 py-3 text-left label-caps">
                  Perfil
                </th>
                <th className="px-4 py-3 text-left label-caps">
                  Status
                </th>
                <th className="px-4 py-3 text-right label-caps">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {data?.items.map((u) => (
                <tr key={u.id} className="transition-colors hover:bg-brand-50/40">
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="flex items-center gap-3">
                      <Avatar nome={u.nome} size="sm" />
                      <span className="font-semibold text-ink-900">{u.nome}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">{u.email}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={PERFIL_TOM[u.role] ?? 'neutral'}>{PERFIL_ROTULO[u.role] ?? u.role}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={u.ativo ? 'success' : 'danger'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Editar usuário ${u.nome}`}
                        title="Editar"
                        onClick={() => setEditing(u)}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Resetar senha de ${u.nome}`}
                        title="Resetar senha"
                        onClick={() => setResetting(u)}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-warning-50 hover:text-warning-600"
                      >
                        <Key className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Excluir usuário ${u.nome}`}
                        title="Excluir"
                        disabled={excluir.isPending}
                        onClick={() => {
                          if (window.confirm(`Excluir o usuário ${u.nome} (${u.email})? Esta ação não pode ser desfeita.`)) excluir.mutate(u.id!);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
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
  const { modulos } = useBranding();
  // Modulos RBAC de sistema nao contratado nao aparecem (nao faz sentido conceder).
  const doOutroSistema = new Set(
    (['financeiro', 'arquivo'] as const).filter((s) => !modulos.includes(s)).flatMap((s) => MODULOS_RBAC_POR_SISTEMA[s]),
  );
  const modulosVisiveis = MODULES.filter((m) => !doOutroSistema.has(m));
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="usuario-nome">Nome<span className="ml-0.5 text-danger-600">*</span></label>
            <input
              id="usuario-nome"
              className={inputCls}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="usuario-email">E-mail<span className="ml-0.5 text-danger-600">*</span></label>
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
            <label className={labelCls} htmlFor="usuario-role">Perfil<span className="ml-0.5 text-danger-600">*</span></label>
            <SelectMenu
              id="usuario-role"
              className={inputCls}
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'operador' | 'consulta')}
            >
              <option value="admin">Administrador</option>
              <option value="operador">Operador</option>
              <option value="consulta">Consulta</option>
            </SelectMenu>
          </div>
          {!usuario && (
            <div>
              <label className={labelCls} htmlFor="usuario-senha">Senha provisória<span className="ml-0.5 text-danger-600">*</span></label>
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
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo
          </label>
        )}

        {role === 'admin' ? (
          <p className="rounded-[10px] bg-surface px-3 py-2 text-xs text-ink-500">
            Administradores têm acesso total ao tenant — não é preciso marcar permissões.
          </p>
        ) : (
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
                  {modulosVisiveis.map((m) => (
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

        {unidades.length > 0 && (
          <div>
            <p className={labelCls}>Unidades orçamentárias com acesso</p>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-[10px] border border-ink-200 p-2">
              {unidades.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm text-ink-800">
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
          <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>
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
          <p className="text-sm text-ink-800">Senha redefinida. O usuário precisará trocá-la no próximo acesso.</p>
        ) : (
          <>
            <div>
              <label className={labelCls} htmlFor="nova-senha">Nova senha provisória<span className="ml-0.5 text-danger-600">*</span></label>
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
              <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>
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
