'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe, Lock, Scale, Search } from 'lucide-react';
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
import { Badge, Card, Input, Pagination, SelectMenu, TONE_VIVID, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { SITUACAO_TOM } from '@/components/legislacao/compilado';
import { cn } from '@/lib/cn';

export default function NormasPage() {
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
    queryKey: ['normas', slug, q, tipo, situacao, page],
    queryFn: () =>
      api(
        `/t/${slug}/legislacao/normas?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${tipo ? `&tipo=${tipo}` : ''}${situacao ? `&situacao=${situacao}` : ''}`,
      ),
    placeholderData: (p) => p,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.brand.chip)}>
            <Scale className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Legislação</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              Leis, decretos e portarias com texto compilado: o que está vigente, o que foi alterado e por qual norma.
            </p>
          </div>
        </div>
        <a
          href={`/${slug}/legislacao`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-[10px] border border-ink-200 bg-surface px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50"
        >
          <Globe className="h-4 w-4" aria-hidden /> Portal público <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar" placeholder="Número, ementa ou palavra do texto" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <SelectMenu aria-label="Tipo" className={cn(inputCls, 'lg:w-52')} value={tipo} onChange={(e) => { setTipo(e.target.value as TipoNorma | ''); setPage(1); }}>
            <option value="">Todos os tipos</option>
            {TIPOS_NORMA.map((t) => (
              <option key={t} value={t}>{TIPO_NORMA_LABEL[t]}</option>
            ))}
          </SelectMenu>
          <SelectMenu aria-label="Situação" className={cn(inputCls, 'lg:w-56')} value={situacao} onChange={(e) => { setSituacao(e.target.value as SituacaoNorma | ''); setPage(1); }}>
            <option value="">Todas as situações</option>
            {SITUACOES_NORMA.map((s) => (
              <option key={s} value={s}>{SITUACAO_NORMA_LABEL[s]}</option>
            ))}
          </SelectMenu>
        </div>
        {error ? (
          <div className="p-5">
            <EmptyState icon={Lock} title="Sem acesso" description={error instanceof ApiError ? error.message : 'Falha ao carregar'} />
          </div>
        ) : isLoading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((k) => (
              <div key={k} className="h-14 animate-pulse rounded-[10px] bg-ink-100" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Scale}
              title={q || tipo || situacao ? 'Nada encontrado' : 'Nenhuma norma estruturada'}
              description="No Acervo, abra uma Lei, Decreto ou Portaria e use “Texto compilado” para estruturar o texto a partir do PDF."
            />
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.items.map((n) => (
              <li key={n.id}>
                <Link href={`/${slug}/normas/${n.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-brand-50/40 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-900">{n.rotulo}</span>
                      {!n.publicada && <Badge tone="neutral">Não publicada no portal</Badge>}
                    </div>
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
