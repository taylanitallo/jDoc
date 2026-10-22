'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, LogOut, MoreHorizontal, Search, ShieldOff, UserCog, UserPlus, UserX, UserCheck, Pencil } from 'lucide-react';
import {
  PAPEIS_ADMIN,
  PAPEL_ADMIN_DESCRICAO,
  PAPEL_ADMIN_LABEL,
  type AdminEquipe,
  type PapelAdmin,
  type SenhaProvisoriaResposta,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
} from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { useAdmin } from '@/components/platform/admin-context';

const POR_PAGINA = 20;
type Acao = 'senha' | 'mfa' | 'sessoes' | 'desativar' | 'reativar';

export default function EquipePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const eu = useAdmin();
  const { data, isLoading } = useQuery({ queryKey: ['superadmin', 'equipe'], queryFn: () => api<AdminEquipe[]>('/superadmin/admins') });
  const [busca, setBusca] = useState('');
  const [papel, setPapel] = useState<'' | PapelAdmin>('');
  const [pagina, setPagina] = useState(1);
  const [convidar, setConvidar] = useState(false);
  const [editar, setEditar] = useState<AdminEquipe | null>(null);
  const [acao, setAcao] = useState<{ tipo: Acao; alvo: AdminEquipe } | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ nome: string; senha: string } | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (data ?? []).filter(
      (a) => (!papel || a.role === papel) && (!q || a.nome.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)),
    );
  }, [data, busca, papel]);
  const pagina_ = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const atualizar = () => qc.invalidateQueries({ queryKey: ['superadmin', 'equipe'] });
  const erro = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível concluir.');

  const executar = useMutation({
    mutationFn: async ({ tipo, alvo }: { tipo: Acao; alvo: AdminEquipe }) => {
      if (tipo === 'senha') return api<SenhaProvisoriaResposta>(`/superadmin/admins/${alvo.id}/password`, { method: 'POST' });
      if (tipo === 'mfa') return api(`/superadmin/admins/${alvo.id}/reset-mfa`, { method: 'POST' });
      if (tipo === 'sessoes') return api(`/superadmin/admins/${alvo.id}/revoke-sessions`, { method: 'POST' });
      return api(`/superadmin/admins/${alvo.id}`, { method: 'PATCH', body: { ativo: tipo === 'reativar' } });
    },
    onSuccess: async (r, { tipo, alvo }) => {
      setAcao(null);
      const msg: Record<Acao, string> = {
        senha: 'Senha redefinida.',
        mfa: 'Verificação em 2 etapas resetada. No próximo acesso a pessoa configura de novo.',
        sessoes: 'Sessões encerradas.',
        desativar: 'Acesso desativado.',
        reativar: 'Acesso reativado.',
      };
      toast.success(msg[tipo]);
      const resp = r as SenhaProvisoriaResposta | undefined;
      if (tipo === 'senha' && resp?.senhaProvisoria) setSenhaGerada({ nome: alvo.nome, senha: resp.senhaProvisoria });
      else if (tipo === 'senha' && resp?.emailEnviado) toast.info(`A nova senha foi enviada para ${alvo.email}.`);
      await atualizar();
    },
    onError: erro,
  });

  const CONFIRMA: Record<Acao, { titulo: string; texto: string; botao: string }> = {
    senha: { titulo: 'Redefinir senha?', texto: 'Uma senha provisória será gerada e as sessões da pessoa serão encerradas.', botao: 'Redefinir' },
    mfa: { titulo: 'Resetar verificação em 2 etapas?', texto: 'O autenticador atual deixa de valer e as sessões são encerradas.', botao: 'Resetar' },
    sessoes: { titulo: 'Encerrar sessões?', texto: 'Todos os navegadores conectados com esta conta serão desconectados.', botao: 'Encerrar' },
    desativar: { titulo: 'Desativar acesso?', texto: 'A pessoa não consegue mais entrar no painel até ser reativada.', botao: 'Desativar' },
    reativar: { titulo: 'Reativar acesso?', texto: 'A pessoa volta a poder entrar no painel.', botao: 'Reativar' },
  };

  return (
    <div>
      <PageHeader
        title="Equipe"
        description="Pessoas com acesso a este painel e o que cada uma pode fazer."
        actions={
          <Button leftIcon={<UserPlus aria-hidden />} onClick={() => setConvidar(true)}>
            Convidar
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
            placeholder="Buscar por nome ou e-mail"
            className="pl-9"
            aria-label="Buscar"
          />
        </div>
        <Select
          value={papel}
          onChange={(e) => {
            setPapel(e.target.value as '' | PapelAdmin);
            setPagina(1);
          }}
          className="sm:w-56"
          aria-label="Papel"
        >
          <option value="">Todos os papéis</option>
          {PAPEIS_ADMIN.map((p) => (
            <option key={p} value={p}>
              {PAPEL_ADMIN_LABEL[p]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={4} columns={5} label="Carregando equipe" />
      ) : filtrados.length === 0 ? (
        <EmptyState icon={UserCog} title="Ninguém encontrado" description="Ajuste a busca ou convide alguém para a equipe." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Pessoa</th>
                  <th className="px-4 py-3 label-caps">Papel</th>
                  <th className="px-4 py-3 label-caps">Situação</th>
                  <th className="px-4 py-3 label-caps">2 etapas</th>
                  <th className="px-4 py-3 label-caps">Último acesso</th>
                  <th className="px-4 py-3" aria-label="Ações" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {pagina_.map((a) => (
                  <tr key={a.id} className="hover:bg-ink-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar nome={a.nome} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-900">
                            {a.nome}
                            {a.id === eu?.id && <span className="ml-1.5 text-xs font-medium text-ink-500">(você)</span>}
                          </p>
                          <p className="truncate text-xs text-ink-500">{a.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={a.role === 'owner' ? 'brand' : a.role === 'support' ? 'info' : 'teal'}>{PAPEL_ADMIN_LABEL[a.role]}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={a.ativo ? 'success' : 'neutral'}>{a.ativo ? 'Ativo' : 'Desativado'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={a.mfaEnabled ? 'success' : 'warning'}>{a.mfaEnabled ? 'Sim' : 'Não'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {a.ultimoAcesso ? fmtRelative(a.ultimoAcesso) : 'Nunca'}
                      {a.sessoesAtivas > 0 && <span className="block text-xs text-ink-500">{a.sessoesAtivas} sessão(ões) ativa(s)</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu
                        items={[
                          { label: 'Editar nome e papel', icon: Pencil, onSelect: () => setEditar(a) },
                          { label: 'Redefinir senha', icon: KeyRound, onSelect: () => setAcao({ tipo: 'senha', alvo: a }) },
                          { label: 'Resetar 2 etapas', icon: ShieldOff, onSelect: () => setAcao({ tipo: 'mfa', alvo: a }), disabled: !a.mfaEnabled },
                          { label: 'Encerrar sessões', icon: LogOut, onSelect: () => setAcao({ tipo: 'sessoes', alvo: a }), disabled: a.sessoesAtivas === 0 },
                          a.ativo
                            ? { label: 'Desativar acesso', icon: UserX, danger: true, onSelect: () => setAcao({ tipo: 'desativar', alvo: a }), disabled: a.id === eu?.id }
                            : { label: 'Reativar acesso', icon: UserCheck, onSelect: () => setAcao({ tipo: 'reativar', alvo: a }) },
                        ]}
                        trigger={({ alternar, aberto }) => (
                          <Button variant="ghost" size="icon" aria-label={`Ações de ${a.nome}`} aria-haspopup="menu" aria-expanded={aberto} onClick={alternar}>
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

      <ConvidarModal
        aberto={convidar}
        onFechar={() => setConvidar(false)}
        onConvidado={async (nome, r) => {
          setConvidar(false);
          await atualizar();
          if (r.senhaProvisoria) setSenhaGerada({ nome, senha: r.senhaProvisoria });
          else toast.success('Convite enviado por e-mail.');
        }}
      />
      {editar && <EditarModal alvo={editar} onFechar={() => setEditar(null)} onSalvo={atualizar} />}

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
          tone={acao.tipo === 'reativar' ? 'primary' : 'danger'}
          loading={executar.isPending}
          onConfirm={() => executar.mutate(acao)}
        />
      )}

      <Modal
        open={!!senhaGerada}
        onClose={() => setSenhaGerada(null)}
        title="Senha provisória"
        subtitle="O e-mail não pôde ser enviado (servidor de e-mail não configurado). Repasse a senha por um canal seguro; ela só aparece agora."
        size="sm"
        footer={<Button onClick={() => setSenhaGerada(null)}>Pronto</Button>}
      >
        {senhaGerada && (
          <div className="space-y-2">
            <p className="text-sm text-ink-600">{senhaGerada.nome}</p>
            <div className="flex gap-2">
              <Input readOnly value={senhaGerada.senha} className="font-mono" aria-label="Senha provisória" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copiar senha"
                onClick={async () => {
                  await navigator.clipboard.writeText(senhaGerada.senha);
                  toast.success('Senha copiada.');
                }}
              >
                <Copy aria-hidden />
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SeletorPapel({ valor, onChange }: { valor: PapelAdmin; onChange: (p: PapelAdmin) => void }) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label="Papel">
      {PAPEIS_ADMIN.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={valor === p}
          onClick={() => onChange(p)}
          className={`rounded-[10px] border p-3 text-left transition ${valor === p ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-ink-200 hover:border-ink-300'}`}
        >
          <span className="block text-sm font-semibold text-ink-900">{PAPEL_ADMIN_LABEL[p]}</span>
          <span className="block text-xs text-ink-500">{PAPEL_ADMIN_DESCRICAO[p]}</span>
        </button>
      ))}
    </div>
  );
}

function ConvidarModal({
  aberto,
  onFechar,
  onConvidado,
}: {
  aberto: boolean;
  onFechar: () => void;
  onConvidado: (nome: string, r: SenhaProvisoriaResposta) => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PapelAdmin>('support');
  const convidar = useMutation({
    mutationFn: () => api<SenhaProvisoriaResposta>('/superadmin/admins', { method: 'POST', body: { nome: nome.trim(), email: email.trim(), role } }),
    onSuccess: (r) => {
      onConvidado(nome.trim(), r);
      setNome('');
      setEmail('');
      setRole('support');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível convidar.'),
  });
  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      title="Convidar para a equipe"
      subtitle="A pessoa recebe uma senha provisória por e-mail e, no primeiro acesso, troca a senha e configura a verificação em 2 etapas."
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={convidar.isPending} disabled={nome.trim().length < 2 || !email.includes('@')} onClick={() => convidar.mutate()}>
            Convidar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome" htmlFor="conv-nome" required>
          <Input id="conv-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="E-mail" htmlFor="conv-email" required>
          <Input id="conv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Papel" required>
          <SeletorPapel valor={role} onChange={setRole} />
        </Field>
      </div>
    </Modal>
  );
}

function EditarModal({ alvo, onFechar, onSalvo }: { alvo: AdminEquipe; onFechar: () => void; onSalvo: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState(alvo.nome);
  const [role, setRole] = useState<PapelAdmin>(alvo.role);
  const salvar = useMutation({
    mutationFn: () =>
      api(`/superadmin/admins/${alvo.id}`, {
        method: 'PATCH',
        body: { ...(nome.trim() !== alvo.nome ? { nome: nome.trim() } : {}), ...(role !== alvo.role ? { role } : {}) },
      }),
    onSuccess: () => {
      toast.success('Alterações salvas.');
      onSalvo();
      onFechar();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  const mudou = nome.trim() !== alvo.nome || role !== alvo.role;
  return (
    <Modal
      open
      onClose={onFechar}
      title={`Editar ${alvo.nome}`}
      subtitle="Alterar o papel pede a confirmação da sua identidade."
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={salvar.isPending} disabled={!mudou || nome.trim().length < 2} onClick={() => salvar.mutate()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome" htmlFor="ed-nome" required>
          <Input id="ed-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </Field>
        <Field label="Papel" required>
          <SeletorPapel valor={role} onChange={setRole} />
        </Field>
      </div>
    </Modal>
  );
}
