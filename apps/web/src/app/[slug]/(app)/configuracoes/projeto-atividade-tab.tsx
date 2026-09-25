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
        <h2 className="text-base font-bold text-ink-900">Projeto/atividade</h2>
        <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Novo projeto/atividade
          </span>
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-500" aria-hidden />
        <input
          aria-label="Pesquisar pela descrição"
          className={inputCls + ' pl-9'}
          placeholder="Pesquisar pela descrição"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-ink-500">Carregando...</p>
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={Search} title="Nenhum projeto/atividade encontrado" description="Cadastre projetos/atividades para este exercício." />
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/60">
              <tr className="border-b border-ink-200 label-caps">
                <th className="px-4 py-3">Projeto</th>
                <th className="px-4 py-3">Descrição do projeto atividade</th>
                <th className="px-4 py-3">Exercício</th>
                <th className="px-4 py-3">Ativo</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((p) => (
                <tr key={p.id} className="border-b border-ink-200 hover:bg-ink-50">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink-800">{p.codigo}</td>
                  <td className="px-4 py-3 text-ink-800">{p.descricao}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">{p.exercicio}</td>
                  <td className="px-4 py-3 text-ink-500">{p.ativo ? 'SIM' : 'NÃO'}</td>
                  <td className="px-4 py-3">
                    <div className="flex w-fit gap-0.5">
                      <button
                        type="button"
                        title="Editar"
                        aria-label={`Editar projeto/atividade ${p.descricao}`}
                        onClick={() => setEditing(p)}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        aria-label={`Excluir projeto/atividade ${p.descricao}`}
                        onClick={() => remove.mutate(p.id!)}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-500"
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
    <Modal title="Projeto/atividade" open onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="projeto-codigo">Projeto<span className="ml-0.5 text-danger-600">*</span></label>
          <input
            id="projeto-codigo"
            className={inputCls}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="ex.: 1001"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="projeto-descricao">Descrição<span className="ml-0.5 text-danger-600">*</span></label>
          <input
            id="projeto-descricao"
            className={inputCls}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="ex.: AMPLIAÇÃO E REFORMA DE ACADEMIAS EM SAÚDE"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="projeto-exercicio">Exercício<span className="ml-0.5 text-danger-600">*</span></label>
          <input
            id="projeto-exercicio"
            type="number"
            className={inputCls}
            value={exercicioValue}
            onChange={(e) => setExercicioValue(Number(e.target.value))}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Ativo
        </label>

        {error && (
          <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>
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
