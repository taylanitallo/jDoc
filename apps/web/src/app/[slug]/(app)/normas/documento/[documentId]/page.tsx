'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { EmptyState } from '@/components/empty-state';

/** Botao "Texto compilado" do Acervo: abre a norma do documento ou o editor para estruturar. */
export default function NormaDoDocumento() {
  const { slug, documentId } = useParams<{ slug: string; documentId: string }>();
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    api<{ normaId: string | null }>(`/t/${slug}/legislacao/documentos/${documentId}`)
      .then((r) => router.replace(r.normaId ? `/${slug}/normas/${r.normaId}` : `/${slug}/normas/estruturar/${documentId}`))
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Falha ao abrir'));
  }, [slug, documentId, router]);
  return erro ? <EmptyState icon={Lock} title="Não disponível" description={erro} /> : <div className="h-40 animate-pulse rounded-[16px] bg-ink-100" />;
}
