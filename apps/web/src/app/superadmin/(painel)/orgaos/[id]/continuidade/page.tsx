'use client';

import { useParams } from 'next/navigation';
import { PainelContinuidade } from '@/components/continuidade/painel-continuidade';
import { usePode } from '@/components/platform/admin-context';

export default function OrgaoContinuidadePage() {
  const { id } = useParams<{ id: string }>();
  const equipe = usePode('owner', 'support');
  return <PainelContinuidade base={`/superadmin/tenants/${id}`} plataforma podeExportar={equipe} />;
}
