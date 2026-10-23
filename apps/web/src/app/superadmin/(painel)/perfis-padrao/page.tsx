'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Send, ShieldHalf } from 'lucide-react';
import type { ModeloPerfilView, PreviaAplicarModelo } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, Modal, PageHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { PermissionMatrix } from '@/components/platform/permission-matrix';
import { PAPEL_ORGAO } from '@/components/platform/orgao-ui';
import { usePode } from '@/components/platform/admin-context';

/**
 * Modelos globais dos perfis do sistema. Mudar aqui vale para orgaos novos;
 * "Aplicar a todos os orgaos" reescreve o perfil de mesma chave em cada um.
 */
export default function PerfisPadraoPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const owner = usePode('owner');
  const { data: modelos } = useQuery({ queryKey: ['sa-modelos'], queryFn: () => api<ModeloPerfilView[]>('/superadmin/role-templates') });
  const [chave, setChave] = useState<string | null>(null);
  const sel = modelos?.find((m) => m.chave === chave) ?? modelos?.[0] ?? null;
  const [rascunho, setRascunho] = useState<{ nome: string; descricao: string; permissoes: string[] } | null>(null);
  const [confirmarFabrica, setConfirmarFabrica] = useState(false);
  const [previa, setPrevia] = useState<PreviaAplicarModelo | null>(null);

  useEffect(() => {
    if (sel) setRascunho({ nome: sel.nome, descricao: sel.descricao ?? '', permissoes: sel.permissoes });
  }, [sel]);

  const erro = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
  const salvar = useMutation({
    mutationFn: () =>
      api<ModeloPerfilView[]>(`/superadmin/role-templates/${sel!.chave}`, {
        method: 'PUT',
        body: { nome: rascunho!.nome.trim(), descricao: rascunho!.descricao.trim() || null, permissoes: rascunho!.permissoes },
      }),
    onSuccess: (lista) => {
      qc.setQueryData(['sa-modelos'], lista);
      toast.success('Modelo salvo. Vale para órgãos novos; use "Aplicar a todos" para os existentes.');
    },
    onError: erro,
  });
  const fabrica = useMutation({
    mutationFn: () => api<ModeloPerfilView[]>(`/superadmin/role-templates/${sel!.chave}`, { method: 'DELETE' }),
    onSuccess: (lista) => {
      qc.setQueryData(['sa-modelos'], lista);
      setConfirmarFabrica(false);
      toast.success('Modelo voltou ao padrão de fábrica.');
    },
    onError: erro,
  });
  const verPrevia = useMutation({
    mutationFn: () => api<PreviaAplicarModelo>(`/superadmin/role-templates/${sel!.chave}/preview`),
    onSuccess: setPrevia,
    onError: erro,
  });
  const aplicar = useMutation({
    mutationFn: () => api<{ alterados: number }>(`/superadmin/role-templates/${sel!.chave}/apply`, { method: 'POST' }),
    onSuccess: (r) => {
      setPrevia(null);
      toast.success(`Perfil atualizado em ${r.alterados} órgão(s).`);
    },
    onError: erro,
  });

  if (!modelos || !sel || !rascunho) return <Skeleton rows={8} />;
  const alterado =
    rascunho.nome !== sel.nome ||
    (rascunho.descricao || null) !== (sel.descricao || null) ||
    JSON.stringify([...rascunho.permissoes].sort()) !== JSON.stringify([...sel.permissoes].sort());

  return (
    <div>
      <PageHeader title="Perfis padrão" description="Modelos dos perfis criados em todo órgão. Edite na matriz e, se quiser, aplique a todos." />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {modelos.map((m) => (
              <li key={m.chave}>
                <button
                  type="button"
                  onClick={() => setChave(m.chave)}
                  aria-current={sel.chave === m.chave}
                  className={cn('w-full px-4 py-3 text-left transition', sel.chave === m.chave ? 'bg-brand-50' : 'hover:bg-ink-50')}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                    {m.nome}
                    {m.personalizado && <Badge tone="warning">Alterado</Badge>}
                  </span>
                  <span className="text-xs text-ink-500">
                    {PAPEL_ORGAO[m.papel]} · {m.permissoes.length} permissões
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            icon={ShieldHalf}
            title={sel.nome}
            description={sel.personalizado && sel.atualizadoEm ? `Alterado em ${fmtDateTime(sel.atualizadoEm)}` : 'Padrão de fábrica'}
            action={
              <>
                {sel.personalizado && (
                  <Button size="sm" variant="ghost" leftIcon={<RotateCcw aria-hidden />} onClick={() => setConfirmarFabrica(true)}>
                    Padrão de fábrica
                  </Button>
                )}
                {owner && (
                  <Button size="sm" variant="outline" leftIcon={<Send aria-hidden />} loading={verPrevia.isPending} onClick={() => verPrevia.mutate()} disabled={alterado}>
                    Aplicar a todos os órgãos
                  </Button>
                )}
              </>
            }
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="mp-nome" required>
                <Input id="mp-nome" value={rascunho.nome} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} />
              </Field>
              <Field label="Descrição" htmlFor="mp-desc">
                <Input id="mp-desc" value={rascunho.descricao} onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })} />
              </Field>
            </div>
            <PermissionMatrix value={rascunho.permissoes} onChange={(v) => setRascunho({ ...rascunho, permissoes: v })} />
            <div className="flex justify-end">
              <Button onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={!alterado || rascunho.nome.trim().length < 2}>
                Salvar modelo
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmarFabrica}
        onClose={() => setConfirmarFabrica(false)}
        title="Voltar ao padrão de fábrica?"
        description={`O modelo ${sel.nome} perde as alterações. Os órgãos não mudam até você aplicar.`}
        confirmLabel="Voltar ao padrão"
        tone="primary"
        loading={fabrica.isPending}
        onConfirm={() => fabrica.mutate()}
      />

      <Modal
        open={!!previa}
        onClose={() => setPrevia(null)}
        title={`Aplicar "${sel.nome}" a todos os órgãos?`}
        subtitle={
          previa
            ? previa.perfisQueMudam === 0
              ? 'Todos os órgãos já estão iguais ao modelo.'
              : `${previa.perfisQueMudam} de ${previa.orgaos} órgão(s) terão o perfil reescrito; os usuários dele recebem as novas permissões.`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setPrevia(null)}>
              Cancelar
            </Button>
            <Button loading={aplicar.isPending} disabled={!previa?.perfisQueMudam} onClick={() => aplicar.mutate()}>
              Aplicar
            </Button>
          </>
        }
      >
        {previa && previa.perfisQueMudam > 0 && (
          <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-[10px] border border-ink-200">
            {previa.detalhes
              .filter((d) => d.mudaria)
              .map((d) => (
                <li key={d.tenantId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-ink-800">{d.orgao}</span>
                  <span className="text-xs text-ink-500">{d.usuarios} usuário(s)</span>
                </li>
              ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
