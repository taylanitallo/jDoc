'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, ShieldHalf, Trash2 } from 'lucide-react';
import { TENANT_ROLES, chaveDoNome, type PerfilView, type TenantRole } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, Modal, Select } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { PermissionMatrix } from '@/components/platform/permission-matrix';
import { PAPEL_ORGAO, useOrgao } from '@/components/platform/orgao-ui';
import { usePode } from '@/components/platform/admin-context';

export default function OrgaoPerfisPage() {
  const { id } = useParams<{ id: string }>();
  const { data: t } = useOrgao(id);
  const pode = usePode('owner', 'implantacao');
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['sa-perfis', id];
  const { data: perfis, isLoading } = useQuery({ queryKey: chave, queryFn: () => api<PerfilView[]>(`/superadmin/tenants/${id}/roles`) });
  const [selId, setSelId] = useState<string | null>(null);
  const [criar, setCriar] = useState(false);
  const [confirmar, setConfirmar] = useState<'restaurar' | 'excluir' | null>(null);

  const sel = perfis?.find((p) => p.id === selId) ?? perfis?.[0] ?? null;
  const [rascunho, setRascunho] = useState<{ nome: string; descricao: string; papel: TenantRole; permissoes: string[] } | null>(null);
  useEffect(() => {
    if (sel) setRascunho({ nome: sel.nome, descricao: sel.descricao ?? '', papel: sel.papel, permissoes: sel.permissoes });
  }, [sel]);

  const recarregar = () => qc.invalidateQueries({ queryKey: chave });
  const erro = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível concluir.');

  const salvar = useMutation({
    mutationFn: () => api(`/superadmin/tenants/${id}/roles/${sel!.id}`, { method: 'PATCH', body: { ...rascunho!, descricao: rascunho!.descricao || null } }),
    onSuccess: async () => {
      toast.success('Perfil salvo. Os usuários dele recebem as permissões no próximo acesso.');
      await recarregar();
    },
    onError: erro,
  });
  const restaurar = useMutation({
    mutationFn: () => api(`/superadmin/tenants/${id}/roles/${sel!.id}/restore`, { method: 'POST' }),
    onSuccess: async () => {
      setConfirmar(null);
      toast.success('Perfil voltou ao padrão.');
      await recarregar();
    },
    onError: erro,
  });
  const excluir = useMutation({
    mutationFn: () => api(`/superadmin/tenants/${id}/roles/${sel!.id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setConfirmar(null);
      setSelId(null);
      toast.success('Perfil excluído.');
      await recarregar();
    },
    onError: erro,
  });

  if (isLoading || !t) return <Skeleton rows={8} />;
  if (!perfis?.length) return <EmptyState icon={ShieldHalf} title="Nenhum perfil" />;

  const alterado =
    !!sel &&
    !!rascunho &&
    (rascunho.nome !== sel.nome ||
      rascunho.papel !== sel.papel ||
      (rascunho.descricao || null) !== sel.descricao ||
      JSON.stringify([...rascunho.permissoes].sort()) !== JSON.stringify([...sel.permissoes].sort()));

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <p className="text-sm font-bold text-ink-900">Perfis do órgão</p>
          {pode && (
            <Button size="sm" variant="ghost" leftIcon={<Plus aria-hidden />} onClick={() => setCriar(true)}>
              Novo
            </Button>
          )}
        </div>
        <ul className="divide-y divide-ink-100">
          {perfis.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelId(p.id)}
                aria-current={sel?.id === p.id}
                className={cn('w-full px-4 py-3 text-left transition', sel?.id === p.id ? 'bg-brand-50' : 'hover:bg-ink-50')}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  {p.nome}
                  {p.sistema && <Badge tone="neutral">Padrão</Badge>}
                  {p.alteradoDoPadrao && <Badge tone="warning">Alterado</Badge>}
                </span>
                <span className="text-xs text-ink-500">
                  {PAPEL_ORGAO[p.papel]} · {p.usuarios} usuário(s) · {p.permissoes.length} permissões
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {sel && rascunho && (
        <Card>
          <CardHeader
            icon={ShieldHalf}
            title={sel.nome}
            description={sel.sistema ? 'Perfil padrão do sistema: o modelo global pode ser reaplicado a qualquer momento.' : 'Perfil criado para este órgão.'}
            action={
              pode && (
                <>
                  {sel.sistema && sel.alteradoDoPadrao && (
                    <Button size="sm" variant="ghost" leftIcon={<RotateCcw aria-hidden />} onClick={() => setConfirmar('restaurar')}>
                      Restaurar padrão
                    </Button>
                  )}
                  {!sel.sistema && (
                    <Button size="sm" variant="ghost" leftIcon={<Trash2 aria-hidden />} onClick={() => setConfirmar('excluir')}>
                      Excluir
                    </Button>
                  )}
                </>
              )
            }
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <Field label="Nome" htmlFor="pf-nome" required>
                <Input id="pf-nome" value={rascunho.nome} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} disabled={!pode} />
              </Field>
              <Field label="Papel" htmlFor="pf-papel" hint="Administrador tem acesso total.">
                <Select id="pf-papel" value={rascunho.papel} onChange={(e) => setRascunho({ ...rascunho, papel: e.target.value as TenantRole })} disabled={!pode}>
                  {TENANT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {PAPEL_ORGAO[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Descrição" htmlFor="pf-desc" className="sm:col-span-2">
                <Input id="pf-desc" value={rascunho.descricao} onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })} disabled={!pode} />
              </Field>
            </div>
            <PermissionMatrix
              value={rascunho.permissoes}
              onChange={(v) => setRascunho({ ...rascunho, permissoes: v })}
              sistemas={t.modulos}
              readOnly={!pode}
            />
            {pode && (
              <div className="flex justify-end">
                <Button onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={!alterado || rascunho.nome.trim().length < 2}>
                  Salvar perfil
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      <NovoPerfilModal
        aberto={criar}
        perfis={perfis}
        tenantId={id}
        onFechar={() => setCriar(false)}
        onCriado={async (p) => {
          setCriar(false);
          await recarregar();
          setSelId(p.id);
        }}
      />

      <ConfirmDialog
        open={confirmar === 'restaurar'}
        onClose={() => setConfirmar(null)}
        title="Restaurar o padrão?"
        description={`O perfil ${sel?.nome} volta ao modelo global e os ${sel?.usuarios ?? 0} usuário(s) dele recebem as permissões padrão.`}
        confirmLabel="Restaurar"
        tone="primary"
        loading={restaurar.isPending}
        onConfirm={() => restaurar.mutate()}
      />
      <ConfirmDialog
        open={confirmar === 'excluir'}
        onClose={() => setConfirmar(null)}
        title="Excluir o perfil?"
        description={`O perfil ${sel?.nome} será removido. Só é possível quando nenhum usuário o usa.`}
        confirmLabel="Excluir"
        loading={excluir.isPending}
        onConfirm={() => excluir.mutate()}
      />
    </div>
  );
}

function NovoPerfilModal({
  aberto,
  perfis,
  tenantId,
  onFechar,
  onCriado,
}: {
  aberto: boolean;
  perfis: PerfilView[];
  tenantId: string;
  onFechar: () => void;
  onCriado: (p: PerfilView) => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [base, setBase] = useState('');
  const [papel, setPapel] = useState<TenantRole>('operador');
  const criar = useMutation({
    mutationFn: () =>
      api<PerfilView>(`/superadmin/tenants/${tenantId}/roles`, {
        method: 'POST',
        body: { nome: nome.trim(), papel, permissoes: [], ...(base ? { copiarDe: base } : {}) },
      }),
    onSuccess: (p) => {
      toast.success('Perfil criado.');
      setNome('');
      setBase('');
      onCriado(p);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível criar.'),
  });
  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      title="Novo perfil"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={criar.isPending} disabled={nome.trim().length < 2} onClick={() => criar.mutate()}>
            Criar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome" htmlFor="np-nome" required hint={nome.trim() ? `Chave: ${chaveDoNome(nome)}` : undefined}>
          <Input id="np-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Secretário de Finanças" />
        </Field>
        <Field label="Começar a partir de" htmlFor="np-base" hint="Copia as permissões de outro perfil.">
          <Select id="np-base" value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="">Nenhuma permissão</option>
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Papel" htmlFor="np-papel">
          <Select id="np-papel" value={papel} onChange={(e) => setPapel(e.target.value as TenantRole)}>
            {TENANT_ROLES.map((r) => (
              <option key={r} value={r}>
                {PAPEL_ORGAO[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
