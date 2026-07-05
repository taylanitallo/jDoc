'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Orgao, UnidadeOrcamentaria } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { useExercicio } from '@/components/topbar';
import { Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';

export function OrgaosTab() {
  const { slug } = useParams<{ slug: string }>();
  const { exercicio } = useExercicio();
  const qc = useQueryClient();

  const [descricao, setDescricao] = useState('');
  const [editing, setEditing] = useState<Orgao | 'new' | null>(null);
  const [linkingOrgao, setLinkingOrgao] = useState<Orgao | null>(null);

  const { data, isLoading } = useQuery<{ items: Orgao[]; total: number }>({
    queryKey: ['configuracoes', 'orgaos', exercicio, descricao],
    queryFn: () =>
      api(
        `/t/${slug}/configuracoes/orgaos?exercicio=${exercicio}&pageSize=100${
          descricao ? `&descricao=${encodeURIComponent(descricao)}` : ''
        }`,
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['configuracoes', 'orgaos'] });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/configuracoes/orgaos/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-app">Órgãos</h2>
        <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Novo Órgão
          </span>
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-app-muted" aria-hidden />
        <input
          aria-label="Pesquisar por descrição"
          className={inputCls + ' pl-9'}
          placeholder="Pesquisar pela descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-app-muted">Carregando...</p>
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={Search} title="Nenhum órgão encontrado" description="Cadastre órgãos para este exercício." />
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-app-border text-[11px] font-bold uppercase text-app-muted">
                <th className="px-4 py-3">Órgão</th>
                <th className="px-4 py-3">Sigla</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Exercício</th>
                <th className="px-4 py-3">Importa?</th>
                <th className="px-4 py-3">Ativo</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((o) => (
                <tr key={o.id} className="border-b border-app-border hover:bg-app-hover">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-app">{o.codigo}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-app-muted">{o.sigla ?? '—'}</td>
                  <td className="px-4 py-3 text-app">{o.descricao}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-app-muted">{o.exercicio}</td>
                  <td className="px-4 py-3 text-app-muted">{o.importa ? 'SIM' : 'NÃO'}</td>
                  <td className="px-4 py-3 text-app-muted">{o.ativo ? 'SIM' : 'NÃO'}</td>
                  <td className="px-4 py-3">
                    <div className="flex w-fit gap-0.5">
                      <button
                        type="button"
                        title="Vincular Unidade Orçamentária"
                        aria-label={`Vincular unidade ao órgão ${o.descricao}`}
                        onClick={() => setLinkingOrgao(o)}
                        className="rounded p-1 text-app-muted hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                      >
                        <Building2 className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Editar órgão"
                        aria-label={`Editar órgão ${o.descricao}`}
                        onClick={() => setEditing(o)}
                        className="rounded p-1 text-app-muted hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Excluir órgão"
                        aria-label={`Excluir órgão ${o.descricao}`}
                        onClick={() => remove.mutate(o.id!)}
                        className="rounded p-1 text-app-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
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
        <OrgaoModal
          slug={String(slug)}
          exercicio={exercicio}
          orgao={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}

      {linkingOrgao && (
        <UnidadesDoOrgaoModal
          slug={String(slug)}
          orgao={linkingOrgao}
          onClose={() => setLinkingOrgao(null)}
        />
      )}
    </div>
  );
}

function OrgaoModal({
  slug,
  exercicio,
  orgao,
  onClose,
  onDone,
}: {
  slug: string;
  exercicio: number;
  orgao: Orgao | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [codigo, setCodigo] = useState(orgao?.codigo ?? '');
  const [sigla, setSigla] = useState(orgao?.sigla ?? '');
  const [descricao, setDescricao] = useState(orgao?.descricao ?? '');
  const [exercicioValue, setExercicioValue] = useState(orgao?.exercicio ?? exercicio);
  const [importa, setImporta] = useState(orgao?.importa ?? true);
  const [ativo, setAtivo] = useState(orgao?.ativo ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { codigo, sigla: sigla.trim() || null, descricao, exercicio: exercicioValue, importa, ativo };
      return orgao
        ? api(`/t/${slug}/configuracoes/orgaos/${orgao.id}`, { method: 'PATCH', body })
        : api(`/t/${slug}/configuracoes/orgaos`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar órgão'),
  });

  return (
    <Modal title={orgao ? 'Órgão — Edição' : 'Órgão — Inclusão'} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls} htmlFor="orgao-codigo">Código *</label>
            <input
              id="orgao-codigo"
              className={inputCls}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="ex.: 05"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="orgao-sigla">Sigla</label>
            <input
              id="orgao-sigla"
              className={inputCls}
              value={sigla}
              onChange={(e) => setSigla(e.target.value)}
              placeholder="ex.: FME"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="orgao-exercicio">Exercício *</label>
            <input
              id="orgao-exercicio"
              type="number"
              className={inputCls}
              value={exercicioValue}
              onChange={(e) => setExercicioValue(Number(e.target.value))}
            />
          </div>
          <div className="col-span-3">
            <label className={labelCls} htmlFor="orgao-descricao">Descrição *</label>
            <input
              id="orgao-descricao"
              className={inputCls}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="ex.: SECRETARIA DE SAÚDE"
            />
          </div>
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-app">
            <input type="checkbox" checked={importa} onChange={(e) => setImporta(e.target.checked)} />
            Importa dados
          </label>
          <label className="flex items-center gap-2 text-sm text-app">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className={btnPrimary}
            onClick={() => save.mutate()}
            disabled={save.isPending || !codigo || !descricao}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function UnidadesDoOrgaoModal({
  slug,
  orgao,
  onClose,
}: {
  slug: string;
  orgao: Orgao;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<{ mode: 'create' } | { mode: 'edit'; unidade: UnidadeOrcamentaria } | null>(null);

  const { data, isLoading } = useQuery<UnidadeOrcamentaria[]>({
    queryKey: ['configuracoes', 'unidades-do-orgao', orgao.id],
    queryFn: () => api(`/t/${slug}/configuracoes/orgaos/${orgao.id}/unidades`),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['configuracoes', 'unidades-do-orgao', orgao.id] });
    qc.invalidateQueries({ queryKey: ['configuracoes', 'unidades'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/configuracoes/unidades/${id}`, { method: 'DELETE' }),
    onSuccess: invalidateAll,
  });

  return (
    <Modal
      title="Unidades Orçamentárias"
      subtitle={`Órgão ${orgao.codigo} — ${orgao.descricao}`}
      open
      onClose={onClose}
    >
      <div className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-app-muted">Carregando...</p>
        ) : data && data.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Nenhuma unidade vinculada"
            description="Este órgão ainda não tem unidades orçamentárias."
          />
        ) : (
          <ul className="space-y-1">
            {data?.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between rounded-lg border border-app-border px-3 py-2 text-sm text-app"
              >
                <span>
                  {u.codigo ? `${u.codigo} — ` : ''}{u.nome}
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] ${
                      u.ativo
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                        : 'bg-app-badge-gray-bg text-app-badge-gray-text'
                    }`}
                  >
                    {u.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    title="Editar unidade"
                    aria-label={`Editar unidade ${u.nome}`}
                    onClick={() => setForm({ mode: 'edit', unidade: u })}
                    className="rounded p-1.5 text-app-muted hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    title="Excluir unidade"
                    aria-label={`Excluir unidade ${u.nome}`}
                    onClick={() => remove.mutate(u.id!)}
                    className="rounded p-1.5 text-app-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {form ? (
          <UnidadeInlineForm
            slug={slug}
            orgao={orgao}
            unidade={form.mode === 'edit' ? form.unidade : null}
            onCancel={() => setForm(null)}
            onDone={() => {
              invalidateAll();
              setForm(null);
            }}
          />
        ) : (
          <button type="button" className={btnPrimary} onClick={() => setForm({ mode: 'create' })}>
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden /> Nova Unidade neste Órgão
            </span>
          </button>
        )}
      </div>
    </Modal>
  );
}

function UnidadeInlineForm({
  slug,
  orgao,
  unidade,
  onCancel,
  onDone,
}: {
  slug: string;
  orgao: Orgao;
  unidade: UnidadeOrcamentaria | null;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [codigo, setCodigo] = useState(unidade?.codigo ?? '');
  const [nome, setNome] = useState(unidade?.nome ?? '');
  const [ativo, setAtivo] = useState(unidade?.ativo ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { orgaoId: orgao.id, codigo: codigo || null, nome, ativo };
      return unidade
        ? api(`/t/${slug}/configuracoes/unidades/${unidade.id}`, { method: 'PATCH', body })
        : api(`/t/${slug}/configuracoes/unidades`, { method: 'POST', body });
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar unidade'),
  });

  return (
    <div className="space-y-3 rounded-lg border border-app-border p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="unidade-orgao-codigo">Código da unidade</label>
          <input
            id="unidade-orgao-codigo"
            className={inputCls}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="ex.: 06"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="unidade-orgao-nome">Descrição *</label>
          <input
            id="unidade-orgao-nome"
            className={inputCls}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: FUNDO MUNICIPAL DE SAÚDE"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-app">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Ativo
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onCancel}>Cancelar</button>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => save.mutate()}
          disabled={save.isPending || !nome}
        >
          {save.isPending ? 'Salvando…' : unidade ? 'Salvar' : 'Vincular'}
        </button>
      </div>
    </div>
  );
}
