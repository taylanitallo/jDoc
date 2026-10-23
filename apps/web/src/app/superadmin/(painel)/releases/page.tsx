'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { TIPOS_RELEASE, TIPO_RELEASE_LABEL, type ReleaseInput, type ReleaseView } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, Field, Input, Modal, PageHeader, Select, Textarea } from '@/components/ui';
import { TOM_RELEASE } from '@/components/chamados/conversa';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';

/** Notas de versao: publicadas aqui, aparecem em "Novidades" para todos os orgaos. */
export default function ReleasesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['sa-releases'], queryFn: () => api<ReleaseView[]>('/superadmin/releases') });
  const [form, setForm] = useState<ReleaseView | 'nova' | null>(null);
  const [excluir, setExcluir] = useState<ReleaseView | null>(null);
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/superadmin/releases/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setExcluir(null);
      toast.success('Nota de versão removida.');
      await qc.invalidateQueries({ queryKey: ['sa-releases'] });
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Releases"
        description='Notas de versão publicadas para os órgãos, que as veem em "Novidades".'
        actions={
          <Button leftIcon={<Plus aria-hidden />} onClick={() => setForm('nova')}>
            Nova versão
          </Button>
        }
      />
      {!data ? (
        <Skeleton rows={5} />
      ) : data.length === 0 ? (
        <EmptyState icon={Megaphone} title="Nenhuma nota de versão" description="Publique a primeira para os órgãos verem o que mudou." />
      ) : (
        <div className="space-y-4">
          {data.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-ink-900">v{r.versao}</span>
                    <Badge tone={TOM_RELEASE[r.tipo]}>{TIPO_RELEASE_LABEL[r.tipo]}</Badge>
                    <span className="text-xs text-ink-500">{fmtDate(r.publicadoEm)}</span>
                  </p>
                  <h2 className="mt-1 text-base font-bold text-ink-900">{r.titulo}</h2>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setForm(r)}>
                    <Pencil aria-hidden />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Remover" onClick={() => setExcluir(r)}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-ink-700">{r.corpo}</p>
            </Card>
          ))}
        </div>
      )}
      {form && <ReleaseForm release={form === 'nova' ? null : form} onFechar={() => setForm(null)} />}
      <ConfirmDialog
        open={!!excluir}
        onClose={() => setExcluir(null)}
        title="Remover a nota de versão?"
        description="Ela some das Novidades dos órgãos."
        confirmLabel="Remover"
        loading={apagar.isPending}
        onConfirm={() => {
          if (excluir) apagar.mutate(excluir.id);
        }}
      />
    </div>
  );
}

function ReleaseForm({ release, onFechar }: { release: ReleaseView | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<ReleaseInput>({
    versao: release?.versao ?? '',
    titulo: release?.titulo ?? '',
    tipo: release?.tipo ?? 'evolutiva',
    corpo: release?.corpo ?? '',
  });
  const salvar = useMutation({
    mutationFn: () => api(release ? `/superadmin/releases/${release.id}` : '/superadmin/releases', { method: release ? 'PUT' : 'POST', body: f }),
    onSuccess: async () => {
      toast.success(release ? 'Nota de versão atualizada.' : 'Nota de versão publicada.');
      await qc.invalidateQueries({ queryKey: ['sa-releases'] });
      onFechar();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  return (
    <Modal
      open
      onClose={onFechar}
      title={release ? `Editar v${release.versao}` : 'Nova versão'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={salvar.isPending} disabled={!/^\d+\.\d+(\.\d+)?$/.test(f.versao) || f.titulo.trim().length < 3 || f.corpo.trim().length < 3} onClick={() => salvar.mutate()}>
            {release ? 'Salvar' : 'Publicar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[140px_1fr_180px]">
        <Field label="Versão" htmlFor="rl-v" required hint="Ex.: 1.6.0">
          <Input id="rl-v" value={f.versao} onChange={(e) => setF({ ...f, versao: e.target.value.trim() })} className="font-mono" />
        </Field>
        <Field label="Título" htmlFor="rl-t" required>
          <Input id="rl-t" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
        </Field>
        <Field label="Tipo" htmlFor="rl-tipo">
          <Select id="rl-tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as ReleaseInput['tipo'] })}>
            {TIPOS_RELEASE.map((t) => (
              <option key={t} value={t}>
                {TIPO_RELEASE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="O que mudou" htmlFor="rl-c" required className="sm:col-span-3" hint="Escreva para quem usa o sistema, sem termos técnicos.">
          <Textarea id="rl-c" value={f.corpo} onChange={(e) => setF({ ...f, corpo: e.target.value })} className="min-h-48" />
        </Field>
      </div>
    </Modal>
  );
}
