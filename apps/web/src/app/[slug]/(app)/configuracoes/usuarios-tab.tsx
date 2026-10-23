'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Orgao, PerfilOrgaoResumo, SegurancaOrgao, UsuarioTenant } from '@jdoc/shared';
import { fmtCpf } from '@/lib/format';
import { PermissionMatrix } from '@/components/platform/permission-matrix';
import { useBranding } from '@/components/branding';
import { useToast } from '@/components/toast';
import { Pencil, Key, Plus, ShieldCheck, ShieldOff, Trash2, Users as UsersIcon } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Avatar, Badge, Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls, type Tone, SelectMenu, Input } from '@/components/ui';

const PERFIL_TOM: Record<string, Tone> = { admin: 'violet', operador: 'info', consulta: 'neutral' };
const PERFIL_ROTULO: Record<string, string> = { admin: 'Administrador', operador: 'Operador', consulta: 'Consulta' };

/** Secretaria do cadastro de orgaos, uma por codigo (o cadastro se repete a cada exercicio). */
interface Secretaria {
  codigo: string;
  nome: string;
}

function secretariasDistintas(orgaos: Orgao[]): Secretaria[] {
  const porCodigo = new Map<string, Orgao>();
  for (const o of orgaos) {
    const atual = porCodigo.get(o.codigo);
    if (!atual || o.exercicio > atual.exercicio) porCodigo.set(o.codigo, o);
  }
  return [...porCodigo.values()]
    .map((o) => ({ codigo: o.codigo, nome: o.descricao }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
}

/** Exigir verificacao em 2 etapas dos administradores (TR: autenticacao multifator para administradores). */
function SegurancaCard({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({
    queryKey: ['configuracoes', 'seguranca'],
    queryFn: () => api<SegurancaOrgao>(`/t/${slug}/configuracoes/seguranca`),
  });
  const salvar = useMutation({
    mutationFn: (mfaObrigatorioAdmin: boolean) =>
      api<SegurancaOrgao>(`/t/${slug}/configuracoes/seguranca`, { method: 'PUT', body: { mfaObrigatorioAdmin } }),
    onSuccess: async (s) => {
      qc.setQueryData(['configuracoes', 'seguranca'], s);
      await qc.invalidateQueries({ queryKey: ['auth', 'me', slug] });
      toast.success(s.mfaObrigatorioAdmin ? 'Administradores agora precisam da verificação em 2 etapas.' : 'Verificação em 2 etapas deixou de ser obrigatória.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  if (!data) return null;
  return (
    <div className={`${cardCls} flex flex-col gap-3 p-4 sm:flex-row sm:items-center`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
        <ShieldCheck className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink-900">Verificação em 2 etapas para administradores</p>
        <p className="text-xs text-ink-500">
          {data.administradoresSemMfa === 0
            ? `Todos os ${data.administradores} administrador(es) já usam o aplicativo autenticador.`
            : `${data.administradoresSemMfa} de ${data.administradores} administrador(es) ainda sem verificação em 2 etapas.`}
          {data.mfaObrigatorioAdmin ? ' Quem não tiver configurado é levado a configurar no próximo acesso.' : ''}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
        <input
          type="checkbox"
          checked={data.mfaObrigatorioAdmin}
          disabled={salvar.isPending}
          onChange={(e) => salvar.mutate(e.target.checked)}
        />
        Exigir
      </label>
    </div>
  );
}

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

  const { data: orgaosData } = useQuery<{ items: Orgao[]; total: number }>({
    queryKey: ['configuracoes', 'orgaos', 'todos-para-lotacao'],
    queryFn: () => api(`/t/${slug}/configuracoes/orgaos?pageSize=1000`),
  });
  const secretarias = secretariasDistintas(orgaosData?.items ?? []);
  const nomeSecretaria = (codigo: string) => secretarias.find((s) => s.codigo === codigo)?.nome ?? codigo;

  const resetMfa = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/configuracoes/usuarios/${id}/reset-mfa`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['configuracoes', 'usuarios'] });
      qc.invalidateQueries({ queryKey: ['configuracoes', 'seguranca'] });
      toast.success('Verificação em 2 etapas desligada. O usuário configura de novo no próximo acesso.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível desligar.'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['configuracoes', 'usuarios'] });

  return (
    <div className="space-y-4">
      <SegurancaCard slug={String(slug)} />
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
                  Lotação
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
                  <td className="max-w-56 px-4 py-3 text-xs text-ink-600">
                    {u.role === 'admin' || !u.orgaosCodigos?.length ? (
                      <span className="text-ink-400">Todas as secretarias</span>
                    ) : (
                      <span title={u.orgaosCodigos.map(nomeSecretaria).join(', ')} className="line-clamp-2">
                        {u.orgaosCodigos.map(nomeSecretaria).join(', ')}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={u.ativo ? 'success' : 'danger'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge>
                      {u.mfaEnabled && <Badge tone="brand">2 etapas</Badge>}
                    </span>
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
                      {u.mfaEnabled && (
                        <button
                          type="button"
                          aria-label={`Desligar verificação em 2 etapas de ${u.nome}`}
                          title="Desligar 2 etapas (celular perdido)"
                          disabled={resetMfa.isPending}
                          onClick={() => {
                            if (window.confirm(`Desligar a verificação em 2 etapas de ${u.nome}? Use quando a pessoa perdeu o celular; as sessões dela serão encerradas.`)) {
                              resetMfa.mutate(u.id!);
                            }
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-warning-50 hover:text-warning-600"
                        >
                          <ShieldOff className="h-4 w-4" aria-hidden />
                        </button>
                      )}
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
          secretarias={secretarias}
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
  secretarias,
  onClose,
  onDone,
}: {
  slug: string;
  usuario: UsuarioTenant | null;
  secretarias: Secretaria[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { modulos } = useBranding();
  // Perfis definidos pela equipe JEOS; "Personalizado" = permissoes marcadas uma a uma.
  const { data: perfis } = useQuery({
    queryKey: ['configuracoes', 'perfis'],
    queryFn: () => api<PerfilOrgaoResumo[]>(`/t/${slug}/configuracoes/perfis`),
  });
  const [perfilId, setPerfilId] = useState<string | null>(usuario ? (usuario.perfilId ?? '') : null);
  const perfilEscolhido = perfilId === null ? (perfis?.find((p) => p.papel === 'operador') ?? perfis?.[0]) : perfis?.find((p) => p.id === perfilId);
  const personalizado = perfilId === '';
  const [cpf, setCpf] = useState(fmtCpf(usuario?.cpf));
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [role, setRole] = useState<'admin' | 'operador' | 'consulta'>(usuario?.role ?? 'operador');
  const [senha, setSenha] = useState('');
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true);
  const [permissions, setPermissions] = useState<string[]>(usuario?.permissions ?? []);
  const [orgaosCodigos, setOrgaosCodigos] = useState<string[]>(usuario?.orgaosCodigos ?? []);
  const [error, setError] = useState<string | null>(null);

  const toggleSecretaria = (codigo: string) => {
    setOrgaosCodigos((cur) => (cur.includes(codigo) ? cur.filter((c) => c !== codigo) : [...cur, codigo]));
  };

  const save = useMutation({
    mutationFn: () => {
      const vinculo = {
        cpf: cpf.replace(/\D/g, '') || null,
        perfilId: personalizado ? null : (perfilEscolhido?.id ?? null),
        role: personalizado ? role : (perfilEscolhido?.papel ?? role),
      };
      if (usuario) {
        return api(`/t/${slug}/configuracoes/usuarios/${usuario.id}`, {
          method: 'PATCH',
          body: { nome, ativo, permissions, orgaosCodigos, ...vinculo },
        });
      }
      return api(`/t/${slug}/configuracoes/usuarios`, {
        method: 'POST',
        body: { email, nome, senha, permissions, orgaosCodigos, ...vinculo },
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
            <label className={labelCls} htmlFor="usuario-cpf">CPF</label>
            <Input id="usuario-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(fmtCpf(e.target.value))} placeholder="000.000.000-00" />
          </div>
          <div>
            <label className={labelCls} htmlFor="usuario-perfil">Perfil<span className="ml-0.5 text-danger-600">*</span></label>
            <SelectMenu
              id="usuario-perfil"
              className={inputCls}
              value={personalizado ? '' : (perfilEscolhido?.id ?? '')}
              onChange={(e) => setPerfilId(e.target.value)}
            >
              {(perfis ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
              <option value="">Personalizado</option>
            </SelectMenu>
          </div>
          {personalizado && (
            <div>
              <label className={labelCls} htmlFor="usuario-role">Papel<span className="ml-0.5 text-danger-600">*</span></label>
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
          )}
          {!usuario && (
            <div>
              <label className={labelCls} htmlFor="usuario-senha">Senha provisória<span className="ml-0.5 text-danger-600">*</span></label>
              <Input
                id="usuario-senha"
                type="password"
                
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

        {!personalizado && perfilEscolhido ? (
          <div>
            <p className={labelCls}>Permissões do perfil {perfilEscolhido.nome}</p>
            {perfilEscolhido.papel === 'admin' ? (
              <p className="rounded-[10px] bg-ink-50 px-3 py-2 text-xs text-ink-500">Administradores têm acesso total ao órgão.</p>
            ) : (
              <PermissionMatrix value={perfilEscolhido.permissoes} sistemas={modulos} readOnly />
            )}
          </div>
        ) : role === 'admin' ? (
          <p className="rounded-[10px] bg-surface px-3 py-2 text-xs text-ink-500">
            Administradores têm acesso total ao órgão — não é preciso marcar permissões.
          </p>
        ) : (
          <div>
            <p className={labelCls}>Permissões por módulo</p>
            <PermissionMatrix value={permissions} onChange={setPermissions} sistemas={modulos} />
          </div>
        )}

        {secretarias.length > 0 && (
          <div>
            <p className={labelCls}>Lotação: secretarias que o usuário enxerga</p>
            {(personalizado ? role : perfilEscolhido?.papel) === 'admin' ? (
              <p className="rounded-[10px] bg-ink-50 px-3 py-2 text-xs text-ink-500">Administradores enxergam todas as secretarias.</p>
            ) : (
              <>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-[10px] border border-ink-200 p-2">
                  {secretarias.map((s) => (
                    <label key={s.codigo} className="flex items-center gap-2 text-sm text-ink-800">
                      <input type="checkbox" checked={orgaosCodigos.includes(s.codigo)} onChange={() => toggleSecretaria(s.codigo)} />
                      {s.codigo} — {s.nome}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  {orgaosCodigos.length === 0
                    ? 'Nenhuma marcada: enxerga todas as secretarias.'
                    : 'Enxerga só os documentos destas secretarias e os documentos sem secretaria.'}
                </p>
              </>
            )}
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
            disabled={save.isPending || !nome || (!usuario && (!email || senha.length < 6))}
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
              <Input
                id="nova-senha"
                type="password"
                
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
              disabled={reset.isPending || novaSenha.length < 6}
            >
              {reset.isPending ? 'Salvando…' : 'Resetar'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
