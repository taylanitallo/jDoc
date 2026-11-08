'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Printer, Share2 } from 'lucide-react';
import type { CompartilhadosPage, CompartilhamentoRecebido } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { imprimirPdf } from '@/lib/imprimir-pdf';
import { Badge, Button, Card, PageHeader, Pagination } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';

const POR_PAGINA = 20;

/** Documentos que outros usuarios do orgao compartilharam com quem esta logado. */
export default function CompartilhadosPage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['compartilhados', slug, page],
    queryFn: () => api<CompartilhadosPage>(`/t/${slug}/compartilhamentos/recebidos?page=${page}&pageSize=${POR_PAGINA}`),
  });

  const visto = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/compartilhamentos/recebidos/${id}/visto`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compartilhados', slug] }),
  });

  const marcar = (c: CompartilhamentoRecebido) => {
    if (!c.vistoEm) visto.mutate(c.id);
  };

  const urlDe = (c: CompartilhamentoRecebido) => api<{ url: string }>(`/t/${slug}/documents/${c.documentId}/url`).then((r) => r.url);
  const falhou = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível abrir o documento.');

  const abrir = async (c: CompartilhamentoRecebido) => {
    const janela = window.open('', '_blank');
    try {
      const url = await urlDe(c);
      if (janela) janela.location.href = url;
      else window.open(url, '_blank');
      marcar(c);
    } catch (e) {
      janela?.close();
      falhou(e);
    }
  };

  const imprimir = async (c: CompartilhamentoRecebido) => {
    try {
      await imprimirPdf(await urlDe(c));
      marcar(c);
    } catch (e) {
      falhou(e);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Compartilhados comigo" description="Documentos enviados a você por outros usuários do órgão." />
      {!data ? (
        <Skeleton rows={5} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={Share2} title="Nenhum documento compartilhado com você" />
      ) : (
        <Card>
          <ul className="divide-y divide-ink-100">
            {data.items.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
                    <span className="min-w-0 break-words">{c.titulo}</span>
                    {!c.vistoEm && <Badge tone="brand">Novo</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Enviado por {c.deNome} · {fmtRelative(c.criadoEm)}
                  </p>
                  {c.mensagem && <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-700">{c.mensagem}</p>}
                </div>
                {c.temArquivo && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="outline" leftIcon={<Eye aria-hidden />} onClick={() => void abrir(c)}>
                      Abrir
                    </Button>
                    <Button size="sm" variant="ghost" leftIcon={<Printer aria-hidden />} onClick={() => void imprimir(c)}>
                      Imprimir
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} className="border-t border-ink-100 px-5 py-3" />
        </Card>
      )}
    </div>
  );
}
