'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { UsuarioAtual } from '@jdoc/shared';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { PainelContinuidade } from '@/components/continuidade/painel-continuidade';

export default function ContinuidadePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: me } = useQuery({ queryKey: ['auth', 'me', slug], queryFn: () => api<UsuarioAtual>(`/t/${slug}/auth/me`), staleTime: 5 * 60_000 });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Continuidade"
        description="Backups, cópia segregada, testes de restauração, disponibilidade e a exportação integral dos dados do órgão."
      />
      <PainelContinuidade base={`/t/${slug}`} podeExportar={me?.role === 'admin' && !me.impersonacao} />
    </div>
  );
}
