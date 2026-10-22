'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogIn, LogOut, MoreHorizontal, Pencil, Search, Trash2, Unlock, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import type { PerfilView, SenhaProvisoriaResposta, UsuarioOrgaoView } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtCpf, fmtRelative } from '@/lib/format';
import { Avatar, Badge, Button, Card, ConfirmDialog, DropdownMenu, Field, Input, Modal, Pagination, Select } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { SenhaProvisoriaModal, useOrgao } from '@/components/platform/orgao-ui';
import { usePode } from '@/components/platform/admin-context';

const POR_PAGINA = 20;
type Acao = 'senha' | 'desbloquear' | 'sessoes' | 'desativar' | 'reativar' | 'excluir';

export default function OrgaoUsuariosPage() {
  const { id } = useParams<{ id: string }>();
  const { data: t } = useOrgao(id);
  const qc = useQueryClient();
  const toast = useToast();
  const podeExcluir = usePode('owner', 'implantacao');
  const podeEntrar = usePode('owner', 'support');
  const chave = ['sa-users', id];
  const { data: usuarios, isLoading } = useQuery({ queryKey: chave, queryFn: () => api<UsuarioOrgaoView[]>(`/superadmin/tenants/${id}/users`) });
  const { data: perfis } = useQuery({ queryKey: ['sa-perfis', id], queryFn: () => api<PerfilView[]>(`/superadmin/tenants/${id}/roles`) });
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState('');
  const [pagina, setPagina] = useState(1);
  const [form, setForm] = useState<UsuarioOrgaoView | 'novo' | null>(null);
  const [acao, setAcao] = useState<{ tipo: Acao; alvo: UsuarioOrgaoView } | null>(null);
  const [entrarComo, setEntrarComo] = useState<UsuarioOrgaoView | null>(null);
  const [senha, setSenha] = useState<{ email: string; senha: string } | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const d = q.replace(/\D/g, '');
    return (usuarios ?? []).filter(
      (u) =>
        (!situacao || (situacao === 'ativos' ? u.ativo : situacao === 'inativos' ? !u.ativo : u.bloqueadoPor > 0)) &&
        (!q || u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (!!d && (u.cpf ?? '').includes(d))),
    );
  }, [usuarios, busca, situacao]);
  const visiveis = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const recarregar = () => qc.invalidateQueries({ queryKey: chave });

  const executar = useMutation({
    mutationFn: async ({ tipo, alvo }: { tipo: Acao; alvo: UsuarioOrgaoView }) => {
      const base = `/superadmin/tenants/${id}/users/${alvo.id}`;
      if (tipo === 'senha') return api<SenhaProvisoriaResposta>(`${base}/reset-password`, { method: 'POST' });
      if (tipo === 'desbloquear') return api(`${base}/unlock`, { method: 'POST' });
      if (tipo === 'sessoes') return api(`${base}/revoke-sessions`, { method: 'POST' });
      if (tipo === 'excluir') return api(base, { method: 'DELETE' });
      return api(base, { method: 'PATCH', body: { ativo: tipo === 'reativar' } });
    },
    onSuccess: async (r, { tipo, alvo }) => {
      setAcao(null);
      const msg: Record<Acao, string> = {
        senha: 'Senha redefinida.',
        desbloquear: 'Usuário desbloqueado.',
        sessoes: 'Sessões encerradas.',
        desativar: 'Usuário desativado.',
        reativar: 'Usuário reativado.',
        excluir: 'Usuário excluído.',
      };
      toast.success(msg[tipo]);
      const resp = r as SenhaProvisoriaResposta | undefined;
      if (tipo === 'senha' && resp?.senhaProvisoria) setSenha({ email: alvo.email, senha: resp.senhaProvisoria });
      else if (tipo === 'senha' && resp?.emailEnviado) toast.info(`A nova senha foi enviada para ${alvo.email}.`);
      await recarregar();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível concluir.'),
  });

  const CONFIRMA: Record<Acao, { titulo: string; texto: string; botao: string }> = {
    senha: { titulo: 'Redefinir a senha?', texto: 'Uma senha provisória é enviada por e-mail e as sessões atuais são encerradas.', botao: 'Redefinir' },
    desbloquear: { titulo: 'Desbloquear?', texto: 'Libera o login bloqueado por tentativas erradas.', botao: 'Desbloquear' },
    sessoes: { titulo: 'Encerrar sessões?', texto: 'Desconecta o usuário de todos os navegadores e do jDoc Desktop.', botao: 'Encerrar' },
    desativar: { titulo: 'Desativar o usuário?', texto: 'Ele não consegue mais entrar até ser reativado.', botao: 'Desativar' },
    reativar: { titulo: 'Reativar o usuário?', texto: 'Ele volta a poder entrar.', botao: 'Reativar' },
    excluir: { titulo: 'Excluir o usuário?', texto: 'Só é possível para quem nunca registrou documentos; nos demais casos, desative.', botao: 'Excluir' },
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
            placeholder="Buscar por nome, e-mail ou CPF"
            className="pl-9"
            aria-label="Buscar"
          />
        </div>
        <Select
          value={situacao}
          onChange={(e) => {
            setSituacao(e.target.value);
            setPagina(1);
          }}
          className="sm:w-48"
          aria-label="Situação"
        >
          <option value="">Todos</option>
          <option value="ativos">Ativos</option>
          <option value="inativos">Desativados</option>
          <option value="bloqueados">Bloqueados</option>
        </Select>
        <Button leftIcon={<UserPlus aria-hidden />} onClick={() => setForm('novo')}>
          Novo usuário
        </Button>
      </div>

      {isLoading ? (
        <SkeletonTable rows={5} columns={5} label="Carregando usuários" />
      ) : filtrados.length === 0 ? (
        <EmptyState icon={Users} title={usuarios?.length ? 'Ninguém com esses filtros' : 'Nenhum usuário'} description="Crie o primeiro usuário do órgão." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Usuário</th>
                  <th className="px-4 py-3 label-caps">Perfil</th>
                  <th className="px-4 py-3 label-caps">Situação</th>
                  <th className="px-4 py-3 label-caps">Último acesso</th>
                  <th className="px-4 py-3" aria-label="Ações" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visiveis.map((u) => (
                  <tr key={u.id} className="hover:bg-ink-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar nome={u.nome} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-900">{u.nome}</p>
                          <p className="truncate text-xs text-ink-500">
                            {u.email}
                            {u.cpf && ` · ${fmtCpf(u.cpf)}`}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-700">{u.perfilNome ?? <span className="text-ink-500">Personalizado</span>}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={u.ativo ? 'success' : 'neutral'}>{u.ativo ? 'Ativo' : 'Desativado'}</Badge>
                        {u.bloqueadoPor > 0 && <Badge tone="danger">Bloqueado</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{u.ultimoAcesso ? fmtRelative(u.ultimoAcesso) : 'Nunca'}</td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu
                        items={[
                          { label: 'Editar', icon: Pencil, onSelect: () => setForm(u) },
                          ...(podeEntrar && u.ativo && t?.status === 'ativo'
                            ? [{ label: 'Entrar como', icon: LogIn, hint: 'Abre o sistema como este usuário', onSelect: () => setEntrarComo(u) }]
                            : []),
                          { label: 'Redefinir senha', icon: KeyRound, onSelect: () => setAcao({ tipo: 'senha', alvo: u }) },
                          ...(u.bloqueadoPor > 0 ? [{ label: 'Desbloquear', icon: Unlock, onSelect: () => setAcao({ tipo: 'desbloquear', alvo: u }) }] : []),
                          { label: 'Encerrar sessões', icon: LogOut, onSelect: () => setAcao({ tipo: 'sessoes', alvo: u }) },
                          u.ativo
                            ? { label: 'Desativar', icon: UserX, onSelect: () => setAcao({ tipo: 'desativar', alvo: u }) }
                            : { label: 'Reativar', icon: UserCheck, onSelect: () => setAcao({ tipo: 'reativar', alvo: u }) },
                          ...(podeExcluir ? [{ label: 'Excluir', icon: Trash2, danger: true, onSelect: () => setAcao({ tipo: 'excluir', alvo: u }) }] : []),
                        ]}
                        trigger={({ alternar, aberto }) => (
                          <Button variant="ghost" size="icon" aria-label={`Ações de ${u.nome}`} aria-haspopup="menu" aria-expanded={aberto} onClick={alternar}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={filtrados.length} onPageChange={setPagina} />
          </div>
        </Card>
      )}

      {form && (
        <UsuarioForm
          tenantId={id}
          perfis={perfis ?? []}
          usuario={form === 'novo' ? null : form}
          onFechar={() => setForm(null)}
          onSalvo={async (r) => {
            setForm(null);
            await recarregar();
            if (r?.senhaProvisoria && r.email) setSenha({ email: r.email, senha: r.senhaProvisoria });
          }}
        />
      )}

      {acao && (
        <ConfirmDialog
          open
          onClose={() => setAcao(null)}
          title={CONFIRMA[acao.tipo].titulo}
          description={
            <>
              <strong className="text-ink-900">{acao.alvo.nome}</strong> — {CONFIRMA[acao.tipo].texto}
            </>
          }
          confirmLabel={CONFIRMA[acao.tipo].botao}
          tone={['reativar', 'desbloquear'].includes(acao.tipo) ? 'primary' : 'danger'}
          loading={executar.isPending}
          onConfirm={() => executar.mutate(acao)}
        />
      )}

      {entrarComo && t && <EntrarComoModal tenantId={id} usuario={entrarComo} onFechar={() => setEntrarComo(null)} />}
      <SenhaProvisoriaModal dados={senha} onFechar={() => setSenha(null)} />
    </div>
  );
}

function UsuarioForm({
  tenantId,
  perfis,
  usuario,
  onFechar,
  onSalvo,
}: {
  tenantId: string;
  perfis: PerfilView[];
  usuario: UsuarioOrgaoView | null;
  onFechar: () => void;
  onSalvo: (r?: SenhaProvisoriaResposta & { email?: string }) => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [cpf, setCpf] = useState(fmtCpf(usuario?.cpf));
  const [perfilId, setPerfilId] = useState(usuario?.perfilId ?? perfis.find((p) => p.chave === 'operador')?.id ?? perfis[0]?.id ?? '');
  const salvar = useMutation({
    mutationFn: async () => {
      const cpfLimpo = cpf.replace(/\D/g, '') || null;
      if (!usuario) {
        return api<SenhaProvisoriaResposta>(`/superadmin/tenants/${tenantId}/users`, {
          method: 'POST',
          body: { nome: nome.trim(), email: email.trim(), cpf: cpfLimpo, perfilId },
        });
      }
      await api(`/superadmin/tenants/${tenantId}/users/${usuario.id}`, {
        method: 'PATCH',
        body: {
          nome: nome.trim(),
          email: email.trim(),
          cpf: cpfLimpo,
          ...(perfilId && perfilId !== usuario.perfilId ? { perfilId } : {}),
        },
      });
      return undefined;
    },
    onSuccess: (r) => {
      toast.success(usuario ? 'Usuário atualizado.' : r?.emailEnviado ? 'Usuário criado. O convite foi enviado por e-mail.' : 'Usuário criado.');
      onSalvo(r ? { ...r, email: email.trim() } : undefined);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  return (
    <Modal
      open
      onClose={onFechar}
      title={usuario ? `Editar ${usuario.nome}` : 'Novo usuário'}
      subtitle={usuario ? undefined : 'O usuário recebe uma senha provisória por e-mail e troca no primeiro acesso.'}
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={salvar.isPending} disabled={nome.trim().length < 3 || !email.includes('@') || !perfilId} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" htmlFor="uf-nome" required className="sm:col-span-2">
          <Input id="uf-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="E-mail" htmlFor="uf-email" required>
          <Input id="uf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="CPF" htmlFor="uf-cpf">
          <Input id="uf-cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(fmtCpf(e.target.value))} placeholder="000.000.000-00" />
        </Field>
        <Field
          label="Perfil"
          htmlFor="uf-perfil"
          required
          className="sm:col-span-2"
          hint={usuario && !usuario.perfilId ? 'Hoje com permissões personalizadas; escolher um perfil substitui as permissões.' : undefined}
        >
          <Select id="uf-perfil" value={perfilId} onChange={(e) => setPerfilId(e.target.value)}>
            {usuario && !usuario.perfilId && <option value="">Personalizado (manter)</option>}
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/**
 * "Entrar como": pede o motivo (vai para a auditoria), a API exige a
 * reautenticacao, e o sistema do orgao abre em outra aba com a faixa de aviso.
 */
function EntrarComoModal({ tenantId, usuario, onFechar }: { tenantId: string; usuario: UsuarioOrgaoView; onFechar: () => void }) {
  const toast = useToast();
  const entrar = useMutation({
    mutationFn: ({ motivo }: { motivo: string; aba: Window | null }) =>
      api<{ accessToken: string; slug: string; expiraEm: string }>(`/superadmin/tenants/${tenantId}/impersonate`, {
        method: 'POST',
        body: { userId: usuario.id, motivo },
      }),
    onSuccess: (r, { aba }) => {
      // Token no fragmento (#): nao vai para o servidor nem fica em log de acesso.
      const url = `/${r.slug}/entrar-como#token=${encodeURIComponent(r.accessToken)}`;
      if (aba) aba.location.href = url;
      else window.open(url, '_blank');
      toast.success('Sessão aberta em outra aba (vale por 30 minutos).');
      onFechar();
    },
    onError: (e, { aba }) => {
      aba?.close();
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    },
  });
  return (
    <ConfirmDialog
      open
      onClose={onFechar}
      title={`Entrar como ${usuario.nome}?`}
      description="Você verá o sistema exatamente como este usuário, por até 30 minutos. Tudo o que fizer fica registrado com o seu nome e o motivo."
      confirmLabel="Entrar"
      tone="primary"
      loading={entrar.isPending}
      motivo={{ label: 'Motivo', placeholder: 'Ex.: chamado nº 123, conferir permissões do usuário', minimo: 10 }}
      onConfirm={(m) => {
        // A aba nasce no clique (senao o bloqueador de pop-up barra) e recebe o endereco depois.
        const aba = window.open('about:blank', '_blank');
        if (aba) aba.opener = null;
        entrar.mutate({ motivo: m, aba });
      }}
    />
  );
}
