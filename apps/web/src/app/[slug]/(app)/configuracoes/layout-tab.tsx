'use client';

import { useState, useEffect, type DragEvent } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { uploadBrasao } from '@/lib/upload';
import { useToast } from '@/components/toast';
import { cardCls, inputCls, labelCls, btnGhost, btnPrimary } from '@/components/ui';
import type { TenantSettings, TenantBranding } from '@jdoc/shared';

export function LayoutTab() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: settings, isLoading } = useQuery<TenantSettings>({
    queryKey: ['configuracoes', 'settings'],
    queryFn: () => api(`/t/${slug}/configuracoes/settings`),
  });

  const { data: branding } = useQuery<TenantBranding>({
    queryKey: ['configuracoes', 'branding'],
    queryFn: () => api(`/t/${slug}/configuracoes/branding`),
  });

  // brasaoKey e gerenciado pelos endpoints dedicados de upload/remover — nao faz parte deste form.
  const [form, setForm] = useState<Omit<Partial<TenantSettings>, 'brasaoKey'>>({});

  useEffect(() => {
    if (settings) {
      setForm({
        nomeExibido: settings.nomeExibido,
        corDestaque: settings.corDestaque,
        textoRodape: settings.textoRodape,
      });
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: Partial<TenantSettings>) =>
      api(`/t/${slug}/configuracoes/settings`, {
        method: 'PATCH',
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuracoes', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['configuracoes', 'branding'] });
      toast.success('Layout atualizado.');
    },
    onError: e => {
      const msg = e instanceof ApiError ? e.message : 'Erro ao salvar layout.';
      toast.error(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(form);
  };

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  async function handleBrasaoFile(file: File) {
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      toast.error('Envie uma imagem PNG ou JPEG.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2MB.');
      return;
    }
    setUploading(true);
    setProgress(0);
    const result = await uploadBrasao(slug, file, setProgress);
    setUploading(false);
    setProgress(null);
    if (result.ok) {
      queryClient.invalidateQueries({ queryKey: ['configuracoes', 'branding'] });
      toast.success('Brasão atualizado.');
    } else {
      toast.error(result.message);
    }
  }

  async function handleRemoveBrasao() {
    setRemoving(true);
    try {
      await api(`/t/${slug}/configuracoes/brasao`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['configuracoes', 'branding'] });
      toast.success('Brasão removido.');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro ao remover brasão.';
      toast.error(msg);
    } finally {
      setRemoving(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleBrasaoFile(f);
  };

  if (isLoading) return <p className="text-sm text-app-muted">Carregando...</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-app">Layout / Customização</h2>

      <form onSubmit={handleSubmit} className={`${cardCls} space-y-4 p-6`}>
        {/* Nome Exibido */}
        <div>
          <label className={labelCls}>Nome Exibido</label>
          <input
            type="text"
            value={form.nomeExibido ?? ''}
            onChange={(e) => setForm({ ...form, nomeExibido: e.target.value })}
            placeholder="Prefeitura Municipal de..."
            className={inputCls}
          />
        </div>

        {/* Cor Destaque */}
        <div>
          <label className={labelCls}>Cor de Destaque</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.corDestaque ?? '#3B82F6'}
              onChange={(e) => setForm({ ...form, corDestaque: e.target.value })}
              className="h-8 w-12 cursor-pointer rounded border border-app-input-border"
            />
            <span className="text-sm text-app-muted">{form.corDestaque}</span>
          </div>
          <p className="mt-1 text-[10px] text-app-muted">
            Usada no cabeçalho de Mídia Legislativa / Prestação de Contas e nos relatórios gerados.
          </p>
        </div>

        {/* Texto Rodape */}
        <div>
          <label className={labelCls}>Texto do Rodapé</label>
          <textarea
            value={form.textoRodape ?? ''}
            onChange={(e) => setForm({ ...form, textoRodape: e.target.value })}
            placeholder="Desenvolvido por..."
            rows={2}
            className={inputCls}
          />
        </div>

        <button type="submit" disabled={mutation.isPending} className={btnPrimary}>
          {mutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </form>

      {/* Brasao — upload dedicado (imagem real, nao mais um file_key colado a mao) */}
      <div className={`${cardCls} space-y-3 p-6`}>
        <label className={labelCls}>Brasão do Município</label>

        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-app-border bg-app-table-head">
            {branding?.brasaoUrl ? (
              <img src={branding.brasaoUrl} alt="Brasão atual" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[10px] text-app-muted">Sem brasão</span>
            )}
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="Área de upload do brasão"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('brasao-file-input')?.click()}
            onKeyDown={(e) => e.key === 'Enter' && document.getElementById('brasao-file-input')?.click()}
            className={`flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-4 text-center transition ${
              dragOver ? 'border-accent bg-purple-50 dark:bg-purple-900/10' : 'border-app-border hover:border-app-muted'
            }`}
          >
            <FileUp className="h-5 w-5 text-app-muted" aria-hidden />
            <p className="text-xs text-app-muted">
              Arraste uma imagem (PNG/JPEG, até 2MB) ou{' '}
              <span className="font-semibold text-accent">clique para selecionar</span>
            </p>
            <input
              id="brasao-file-input"
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleBrasaoFile(f);
              }}
            />
          </div>

          {branding?.brasaoUrl && (
            <button
              type="button"
              onClick={handleRemoveBrasao}
              disabled={removing}
              className={`${btnGhost} shrink-0`}
              title="Remover brasão"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Remover
            </button>
          )}
        </div>

        {uploading && progress !== null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-skeleton">
            <div className="h-full bg-gradient-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
