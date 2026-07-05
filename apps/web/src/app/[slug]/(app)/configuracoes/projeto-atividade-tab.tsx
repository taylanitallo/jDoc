'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { ProjetoAtividade } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { useExercicio } from '@/components/topbar';
import { Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';

export function ProjetoAtividadeTab() {
  const { slug } = useParams<{ slug: string }>();
  const { exercicio } = useExercicio();
  const qc = useQueryClient();

  const [descricao, setDescricao] = useState('');
  const [editing, setEditing] = useState<ProjetoAtividade | 'new' | null>(null);

  const { data, isLoading } = useQuery<{ items: ProjetoAtividade[]; total: number }>({
    queryKey: ['configuracoes', 'projetos', exercicio, descricao],
    queryFn: () =>
      api(
        `/t/${slug}/configuracoes/projetos?exercicio=${exercicio}&pageSize=500${
          descricao ? `&descricao=${encodeURIComponent(descricao)}` : ''
        }`,
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['configuracoes', 'projetos'] });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/configuracoes/projetos/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-app">Projeto Atividade</h2>
        <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Novo Projeto/Atividade
          </span>
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-app-muted" aria-hidden />
        <input
          aria-label="Pesquisar pela descrição"
          className={inputCls + ' pl-9'}
          placeholder="Pesquisar pela descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-app-muted">Carregando...</p>
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={Search} title="Nenhum projeto/atividade encontrado" description="Cadastre projetos/atividades para este exercício." />
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-app-border text-[11px] font-bold uppercase text-app-muted">
                <th className="px-4 py-3">Projeto</th>
                <th className="px-4 py-3">Descrição do projeto atividade</th>
                <th className="px-4 py-3">Exercício</th>
                <th className="px-4 py-3">Ativo</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((p) => (
                <tr key={p.id} className="border-b border-app-border hover:bg-app-hover">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-app">{p.codigo}</td>
                  <td className="px-4 py-3 text-app">{p.descricao}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-app-muted">{p.exercicio}</td>
                  <td className="px-4 py-3 text-app-muted">{p.ativo ? 'SIM' : 'NÃO'}</td>
                  <td className="px-4 py-3">
                    <div className="flex w-fit gap-0.5">
                      <button
                        type="button"
                        title="Editar"
                        aria-label={`Editar projeto/atividade ${p.descricao}`}
                        onClick={() => setEditing(p)}
                        className="rounded p-1 text-app-muted hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        aria-label={`Excluir projeto/atividade ${p.descricao}`}
                        onClick={() => remove.mutate(p.id!)}
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
        <ProjetoModal
          slug={String(slug)}
          exercicio={exercicio}
          projeto={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function ProjetoModal({
  slug,
  exercicio,
  projeto,
  onClose,
  onDone,
}: {
  slug: string;
  exercicio: number;
  projeto: ProjetoAtividade | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [codigo, setCodigo] = useState(projeto?.codigo ?? '');
  const [descricao, setDescricao] = useState(projeto?.descricao ?? '');
  const [exercicioValue, setExercicioValue] = useState(projeto?.exercicio ?? exercicio);
  const [ativo, setAtivo] = useState(projeto?.ativo ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { codigo, descricao, exercicio: exercicioValue, ativo };
      return projeto
        ? api(`/t/${slug}/configuracoes/projetos/${projeto.id}`, { method: 'PATCH', body })
        : api(`/t/${slug}/configuracoes/projetos`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar projeto/atividade'),
  });

  return (
    <Modal title="Projeto Atividade — Edição/Inclusão" open onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="projeto-codigo">Projeto *</label>
          <input
            id="projeto-codigo"
            className={inputCls}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="ex.: 1001"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="projeto-descricao">Descrição *</label>
          <input
            id="projeto-descricao"
            className={inputCls}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="ex.: AMPLIAÇÃO E REFORMA DE ACADEMIAS EM SAÚDE"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="projeto-exercicio">Exercício *</label>
          <input
            id="projeto-exercicio"
            type="number"
            className={inputCls}
            value={exercicioValue}
            onChange={(e) => setExercicioValue(Number(e.target.value))}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-app">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Ativo
        </label>

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
