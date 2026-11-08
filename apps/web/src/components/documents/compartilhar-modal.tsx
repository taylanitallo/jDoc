'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, Share2 } from 'lucide-react';
import type { DestinatarioCompartilhamento } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Button, Field, Input, Modal, Textarea } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';

/** Compartilha o documento com usuarios do orgao que ja podem le-lo. */
export function CompartilharModal({
  slug,
  documentId,
  titulo,
  onClose,
}: {
  slug: string;
  documentId: string;
  titulo: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const rota = `/t/${slug}/compartilhamentos/documentos/${documentId}`;
  const { data: usuarios, error } = useQuery({
    queryKey: ['compartilhar-destinatarios', slug, documentId],
    queryFn: () => api<DestinatarioCompartilhamento[]>(`${rota}/destinatarios`),
  });

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (usuarios ?? []).filter((u) => !termo || u.nome.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo));
  }, [usuarios, busca]);

  const enviar = useMutation({
    mutationFn: () => api(rota, { method: 'POST', body: { destinatarios: [...escolhidos], mensagem: mensagem.trim() || undefined } }),
    onSuccess: () => {
      toast.success('Documento compartilhado.');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível compartilhar.'),
  });

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(id)) novo.add(id);
      return novo;
    });

  return (
    <Modal
      title="Compartilhar documento"
      subtitle={titulo}
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button leftIcon={<Share2 aria-hidden />} loading={enviar.isPending} disabled={escolhidos.size === 0} onClick={() => enviar.mutate()}>
            Compartilhar{escolhidos.size > 0 ? ` (${escolhidos.size})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-500">Aparecem só os usuários que já têm acesso a este documento pelo perfil e pela lotação.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input aria-label="Buscar usuário" placeholder="Buscar por nome ou e-mail" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger-600">
            {error instanceof ApiError ? error.message : 'Não foi possível carregar os usuários.'}
          </p>
        ) : !usuarios ? (
          <Skeleton rows={3} />
        ) : visiveis.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-500">Nenhum usuário encontrado.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-ink-100 overflow-y-auto rounded-[10px] border border-ink-200">
            {visiveis.map((u) => (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-ink-50">
                  <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" checked={escolhidos.has(u.id)} onChange={() => alternar(u.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink-800">{u.nome}</span>
                    <span className="block truncate text-xs text-ink-500">{u.email}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <Field label="Mensagem (opcional)" htmlFor="compartilhar-mensagem">
          <Textarea id="compartilhar-mensagem" rows={2} maxLength={500} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
