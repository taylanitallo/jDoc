'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Scale, Search } from 'lucide-react';
import {
  SITUACAO_NORMA_LABEL,
  SITUACOES_NORMA,
  TIPOS_NORMA,
  TIPO_NORMA_LABEL,
  type NormasPage,
  type SituacaoNorma,
  type TipoNorma,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Card, Input, Pagination, SelectMenu, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { SITUACAO_TOM } from '@/components/legislacao/compilado';
import { cn } from '@/lib/cn';

export default function LegislacaoPublica() {
  const { slug } = useParams<{ slug: string }>();
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<TipoNorma | ''>('');
  const [situacao, setSituacao] = useState<SituacaoNorma | ''>('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(busca.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  const { data, isLoading, error } = useQuery<NormasPage>({
    queryKey: ['legislacao-publica', slug, q, tipo, situacao, page],
    queryFn: () =>
      api(`/t/${slug}/legislacao-publica?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${tipo ? `&tipo=${tipo}` : ''}${situacao ? `&situacao=${situacao}` : ''}`),
    placeholderData: (p) => p,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">Legislação municipal</h1>
        <p className="mt-1 text-sm text-ink-500">Consulte leis, decretos e portarias com o texto atualizado e o histórico de alterações.</p>
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 md:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar" placeholder="Número, assunto ou palavra do texto" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <SelectMenu aria-label="Tipo" className={cn(inputCls, 'md:w-48')} value={tipo} onChange={(e) => { setTipo(e.target.value as TipoNorma | ''); setPage(1); }}>
            <option value="">Todos os tipos</option>
            {TIPOS_NORMA.map((t) => (
              <option key={t} value={t}>{TIPO_NORMA_LABEL[t]}</option>
            ))}
          </SelectMenu>
          <SelectMenu aria-label="Situação" className={cn(inputCls, 'md:w-52')} value={situacao} onChange={(e) => { setSituacao(e.target.value as SituacaoNorma | ''); setPage(1); }}>
            <option value="">Todas as situações</option>
            {SITUACOES_NORMA.map((s) => (
              <option key={s} value={s}>{SITUACAO_NORMA_LABEL[s]}</option>
            ))}
          </SelectMenu>
        </div>
        {error ? (
          <div className="p-6">
            <EmptyState icon={Scale} title="Legislação indisponível" description={error instanceof ApiError ? error.message : 'Tente novamente mais tarde.'} />
          </div>
        ) : isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((k) => (
              <div key={k} className="h-14 animate-pulse rounded-[10px] bg-ink-100" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={Scale} title="Nenhuma norma encontrada" description={q ? 'Tente outras palavras.' : 'Ainda não há normas publicadas.'} />
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.items.map((n) => (
              <li key={n.id}>
                <Link href={`/${slug}/legislacao/${n.id}`} className="flex flex-col gap-2 px-5 py-4 hover:bg-brand-50/40 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-brand-700">{n.rotulo}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{n.ementa}</p>
                  </div>
                  <Badge tone={SITUACAO_TOM[n.situacao]}>{SITUACAO_NORMA_LABEL[n.situacao]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 0 && (
          <div className="border-t border-ink-100 px-5 py-3">
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}
