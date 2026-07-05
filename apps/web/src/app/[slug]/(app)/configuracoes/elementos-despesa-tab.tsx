'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import type { ElementoDespesa } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { useExercicio } from '@/components/topbar';
import { Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';

export function ElementosDespesaTab() {
  const { slug } = useParams<{ slug: string }>();
  const { exercicio } = useExercicio();
  const qc = useQueryClient();

  const [descricao, setDescricao] = useState('');
  const [editing, setEditing] = useState<ElementoDespesa | 'new' | null>(null);

  const { data, isLoading } = useQuery<{ items: ElementoDespesa[]; total: number }>({
    queryKey: ['configuracoes', 'elementos', exercicio, descricao],
    queryFn: () =>
      api(
        `/t/${slug}/configuracoes/elementos?exercicio=${exercicio}&pageSize=200${
          descricao ? `&descricao=${encodeURIComponent(descricao)}` : ''
        }`,
      ),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['configuracoes', 'elementos'] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-app">Elemento de Despesa</h2>
        <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Novo Elemento
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
        <EmptyState icon={Search} title="Nenhum elemento encontrado" description="Cadastre elementos de despesa para este exercício." />
      ) : (
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-app-border text-[11px] font-bold uppercase text-app-muted">
                <th className="px-4 py-3">Elemento</th>
                <th className="px-4 py-3">Descrição do elemento de despesa</th>
                <th className="px-4 py-3">Exercício</th>
                <th className="px-4 py-3">Ativo</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((el) => (
                <tr key={el.id} className="border-b border-app-border hover:bg-app-hover">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-app">{el.codigo}</td>
                  <td className="px-4 py-3 text-app">{el.nome}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-app-muted">{el.exercicio}</td>
                  <td className="px-4 py-3 text-app-muted">{el.ativo ? 'SIM' : 'NÃO'}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      aria-label={`Editar elemento ${el.nome}`}
                      onClick={() => setEditing(el)}
                      className="rounded p-1.5 text-app-muted hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ElementoModal
          slug={String(slug)}
          exercicio={exercicio}
          elemento={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function ElementoModal({
  slug,
  exercicio,
  elemento,
  onClose,
  onDone,
}: {
  slug: string;
  exercicio: number;
  elemento: ElementoDespesa | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [codigo, setCodigo] = useState(elemento?.codigo ?? '');
  const [nome, setNome] = useState(elemento?.nome ?? '');
  const [exercicioValue, setExercicioValue] = useState(elemento?.exercicio ?? exercicio);
  const [ativo, setAtivo] = useState(elemento?.ativo ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { codigo, nome, descricao: null, exercicio: exercicioValue, ativo };
      return elemento
        ? api(`/t/${slug}/configuracoes/elementos/${elemento.id}`, { method: 'PATCH', body })
        : api(`/t/${slug}/configuracoes/elementos`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar elemento'),
  });

  return (
    <Modal title="Elemento de despesa — Edição/Inclusão" open onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="elemento-codigo">Elemento *</label>
          <input
            id="elemento-codigo"
            className={inputCls}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="ex.: 31900100"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="elemento-descricao">Descrição *</label>
          <input
            id="elemento-descricao"
            className={inputCls}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: APOSENTAD., RESERVA REMUN. E REFORMAS"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="elemento-exercicio">Exercício *</label>
          <input
            id="elemento-exercicio"
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
            disabled={save.isPending || !codigo || !nome}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
