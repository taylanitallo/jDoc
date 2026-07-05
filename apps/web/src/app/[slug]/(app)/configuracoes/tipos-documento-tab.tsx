'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { TipoDocumento } from '@jdoc/shared';
import { Pencil, Plus } from 'lucide-react';
import { Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';

const CORES = ['blue', 'green', 'orange', 'red', 'purple', 'gray'] as const;

export function TiposDocumentoTab() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [page] = useState(1);
  const [editing, setEditing] = useState<TipoDocumento | 'new' | null>(null);

  const { data, isLoading } = useQuery<{ items: TipoDocumento[]; total: number }>({
    queryKey: ['configuracoes', 'tipos-documento', page],
    queryFn: () => api(`/t/${slug}/configuracoes/tipos-documento?page=${page}&pageSize=50`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['configuracoes', 'tipos-documento'] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-app">Tipos de Documento</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className={btnPrimary}
        >
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" aria-hidden /> Novo Tipo
          </span>
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-app-muted">Carregando...</p>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={Pencil}
          title="Nenhum tipo cadastrado"
          description="Cadastre tipos de documento para usar nos módulos do sistema."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.items.map((td) => (
            <div key={td.id} className={`${cardCls} p-4`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium text-app">{td.nome}</p>
                  {td.descricao && <p className="text-xs text-app-muted">{td.descricao}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Editar tipo ${td.nome}`}
                    onClick={() => setEditing(td)}
                    className="text-app-muted hover:text-accent"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              {td.cor && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: td.cor }} />
                  <span className="text-[10px] text-app-muted">{td.cor}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TipoDocumentoModal
          slug={String(slug)}
          tipo={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function TipoDocumentoModal({
  slug,
  tipo,
  onClose,
  onDone,
}: {
  slug: string;
  tipo: TipoDocumento | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [nome, setNome] = useState(tipo?.nome ?? '');
  const [descricao, setDescricao] = useState(tipo?.descricao ?? '');
  const [cor, setCor] = useState(tipo?.cor ?? 'blue');
  const [ativo, setAtivo] = useState(tipo?.ativo ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { nome, descricao: descricao || null, cor, ativo };
      return tipo
        ? api(`/t/${slug}/configuracoes/tipos-documento/${tipo.id}`, { method: 'PATCH', body })
        : api(`/t/${slug}/configuracoes/tipos-documento`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao salvar tipo de documento'),
  });

  return (
    <Modal title={tipo ? 'Tipo de Documento — Edição' : 'Tipo de Documento — Inclusão'} open onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="tipo-nome">Nome *</label>
          <input
            id="tipo-nome"
            className={inputCls}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex.: Contrato"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="tipo-descricao">Descrição</label>
          <input
            id="tipo-descricao"
            className={inputCls}
            value={descricao ?? ''}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição opcional"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="tipo-cor">Cor</label>
          <select id="tipo-cor" className={inputCls} value={cor} onChange={(e) => setCor(e.target.value)}>
            {CORES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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
            disabled={save.isPending || !nome}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
