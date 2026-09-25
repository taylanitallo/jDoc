'use client';

import { useState, useEffect, type DragEvent } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, FileUp, ImageIcon, Landmark, Palette, Save, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { uploadBrasao } from '@/lib/upload';
import { useToast } from '@/components/toast';
import { Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui';
import type { TenantSettings, TenantBranding } from '@jdoc/shared';

const CORES_SUGERIDAS = ['#073f88', '#2547eb', '#0d9488', '#15803d', '#b45309', '#b91c1c', '#7c3aed', '#334155'];

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

  if (isLoading) return <div className="h-64 animate-pulse rounded-[16px] bg-ink-100" />;

  const cor = form.corDestaque ?? '#3B82F6';
  const nome = form.nomeExibido?.trim() || 'Prefeitura Municipal';
  const alterado =
    settings && (form.nomeExibido !== settings.nomeExibido || form.corDestaque !== settings.corDestaque || form.textoRodape !== settings.textoRodape);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-extrabold tracking-tight text-ink-900">Aparência do sistema</h2>
        <p className="mt-0.5 text-sm text-ink-500">Nome, cor e brasão usados no cabeçalho dos relatórios, termos e pacotes gerados.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <form onSubmit={handleSubmit}>
            <Card>
              <CardHeader title="Identidade" description="Aparece nos documentos gerados pelo sistema" icon={Palette} />
              <CardBody className="space-y-5">
                <Field label="Nome exibido" htmlFor="ap-nome" hint="Ex.: Prefeitura Municipal de Iraucuba">
                  <Input
                    id="ap-nome"
                    value={form.nomeExibido ?? ''}
                    onChange={(e) => setForm({ ...form, nomeExibido: e.target.value })}
                    placeholder="Prefeitura Municipal de..."
                  />
                </Field>

                <Field label="Cor de destaque" hint="Cabeçalho da Mídia Legislativa, Prestação de Contas e relatórios.">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="relative flex h-11 w-14 cursor-pointer overflow-hidden rounded-[10px] border border-ink-200 shadow-xs">
                      <span className="sr-only">Escolher cor</span>
                      <input
                        type="color"
                        value={cor}
                        onChange={(e) => setForm({ ...form, corDestaque: e.target.value })}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <span className="h-full w-full" style={{ background: cor }} />
                    </label>
                    <span className="rounded-[8px] bg-ink-100 px-2.5 py-1 font-mono text-sm text-ink-700">{cor}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {CORES_SUGERIDAS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Usar a cor ${c}`}
                          onClick={() => setForm({ ...form, corDestaque: c })}
                          className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${cor.toLowerCase() === c ? 'border-ink-900' : 'border-transparent'}`}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  </div>
                </Field>

                <Field label="Texto do rodapé" htmlFor="ap-rodape" hint="Linha final dos relatórios (endereço, CNPJ, site…)">
                  <Textarea
                    id="ap-rodape"
                    value={form.textoRodape ?? ''}
                    onChange={(e) => setForm({ ...form, textoRodape: e.target.value })}
                    placeholder="Rua Tal, 100 — Centro · CNPJ 00.000.000/0001-00"
                    rows={2}
                  />
                </Field>
              </CardBody>
              <div className="flex items-center justify-end gap-3 border-t border-ink-100 px-5 py-3">
                {alterado && <span className="text-xs text-ink-500">Alterações não salvas</span>}
                <Button type="submit" loading={mutation.isPending} disabled={!alterado} leftIcon={<Save aria-hidden />}>
                  Salvar alterações
                </Button>
              </div>
            </Card>
          </form>

          <Card>
            <CardHeader title="Brasão do município" description="PNG ou JPEG, até 2 MB. Fundo transparente fica melhor." icon={ImageIcon} />
            <CardBody className="space-y-3">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[16px] border border-ink-200 bg-ink-50">
                  {branding?.brasaoUrl ? (
                    <img src={branding.brasaoUrl} alt="Brasão atual" className="h-full w-full object-contain p-1" />
                  ) : (
                    <Landmark className="h-8 w-8 text-ink-300" aria-hidden />
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
                  className={`flex min-h-24 flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[16px] border-2 border-dashed p-4 text-center transition ${
                    dragOver ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-brand-300 hover:bg-brand-50/40'
                  }`}
                >
                  <FileUp className="h-6 w-6 text-brand-600" aria-hidden />
                  <p className="text-sm text-ink-600">
                    Arraste a imagem aqui ou <span className="font-semibold text-brand-600">clique para selecionar</span>
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
              </div>
              {uploading && progress !== null && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
              {branding?.brasaoUrl && (
                <Button variant="ghost" size="sm" className="text-danger-600" onClick={handleRemoveBrasao} loading={removing} leftIcon={<Trash2 aria-hidden />}>
                  Remover brasão
                </Button>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Previa ao vivo do cabecalho/rodape dos documentos gerados. */}
        <div className="xl:sticky xl:top-4 xl:self-start">
          <Card className="overflow-hidden">
            <CardHeader title="Prévia" description="Como sai no topo dos relatórios" icon={Eye} />
            <div className="bg-ink-100 p-5">
              <div className="mx-auto aspect-[210/297] max-w-[300px] overflow-hidden rounded-[6px] bg-white shadow-lg">
                <div className="h-2" style={{ background: cor }} />
                <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                    {branding?.brasaoUrl ? (
                      <img src={branding.brasaoUrl} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <Landmark className="h-5 w-5 text-slate-400" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold uppercase text-slate-900">{nome}</p>
                    <p className="text-[9px] text-slate-500">Relatório do acervo</p>
                  </div>
                </div>
                <div className="space-y-2 px-4 py-4">
                  <p className="text-[10px] font-bold" style={{ color: cor }}>
                    INVENTÁRIO DO ACERVO
                  </p>
                  {[90, 75, 82, 60, 88, 70, 64].map((w, k) => (
                    <div key={k} className="h-1.5 rounded-full bg-slate-200" style={{ width: `${w}%` }} />
                  ))}
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {[0, 1, 2].map((k) => (
                      <div key={k} className="h-8 rounded-[4px]" style={{ background: k === 0 ? cor : '#e2e8f0', opacity: k === 0 ? 0.85 : 1 }} />
                    ))}
                  </div>
                  {[80, 68, 76].map((w, k) => (
                    <div key={k} className="h-1.5 rounded-full bg-slate-200" style={{ width: `${w}%` }} />
                  ))}
                </div>
                <p className="mt-auto border-t border-slate-200 px-4 py-2 text-center text-[8px] text-slate-500">
                  {form.textoRodape?.trim() || 'Texto do rodapé'}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
