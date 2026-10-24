'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BookMarked, Lock, MapPin, Search } from 'lucide-react';
import { ESFERAS_LEI, ESFERA_LEI_LABEL, type EscopoLeis, type EsferaLei, type LeisPage } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Card, Input, Pagination, SelectMenu, TONE_VIVID, inputCls } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/cn';

function dataBr(iso: string | null): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export default function LeisReferenciaPage() {
  const { slug } = useParams<{ slug: string }>();
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [esfera, setEsfera] = useState<EsferaLei | ''>('');
  const [tipo, setTipo] = useState('');
  const [vigentes, setVigentes] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(busca.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  const escopo = useQuery<EscopoLeis>({ queryKey: ['leis-escopo', slug], queryFn: () => api(`/t/${slug}/leis-referencia/escopo`) });
  const { data, isLoading, error } = useQuery<LeisPage>({
    queryKey: ['leis-ref', slug, q, esfera, tipo, vigentes, page],
    queryFn: () =>
      api(
        `/t/${slug}/leis-referencia?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${esfera ? `&esfera=${esfera}` : ''}${tipo ? `&tipo=${tipo}` : ''}${vigentes ? '&vigentes=sim' : ''}`,
      ),
    placeholderData: (p) => p,
  });
  const e = escopo.data;
  const abrangencia = e
    ? ['Federal', e.uf ? `Estado ${e.uf}` : null, e.municipioNome ? `Município de ${e.municipioNome}` : null].filter(Boolean).join(' + ')
    : '';

  return (
    <div className="space-y-6">
      <div className="flex min-w-0 items-start gap-4">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.brand.chip)}>
          <BookMarked className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Leis de referência</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Legislação que vale para este órgão: federal, do seu estado e do seu município. Atualizada todo dia. Não substitui o Diário Oficial.
          </p>
        </div>
      </div>

      {e && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm text-ink-700">
          <MapPin className="h-4 w-4 text-brand-600" aria-hidden />
          <span className="font-semibold">Mostrando: {abrangencia}</span>
          {e.esferas.map((x) => (
            <Badge key={x.esfera} tone="neutral">
              {x.rotulo}: {x.total.toLocaleString('pt-BR')}
            </Badge>
          ))}
          {!e.uf && <span className="text-ink-500">Estado do órgão não cadastrado: só aparecem leis federais.</span>}
          {e.uf && !e.municipioCoberto && (
            <span className="text-ink-500">A origem ainda não tem leis do seu município; aparecem as federais e estaduais.</span>
          )}
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input aria-label="Buscar" placeholder="Número, assunto ou palavra do texto" className="pl-9" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
          </div>
          <SelectMenu aria-label="Esfera" className={cn(inputCls, 'lg:w-44')} value={esfera} onChange={(ev) => { setEsfera(ev.target.value as EsferaLei | ''); setPage(1); }}>
            <option value="">Todas as esferas</option>
            {ESFERAS_LEI.map((s) => (
              <option key={s} value={s}>{ESFERA_LEI_LABEL[s]}</option>
            ))}
          </SelectMenu>
          <SelectMenu aria-label="Tipo" className={cn(inputCls, 'lg:w-52')} value={tipo} onChange={(ev) => { setTipo(ev.target.value); setPage(1); }}>
            <option value="">Todos os tipos</option>
            {(data?.tipos ?? []).map((t) => (
              <option key={t.tipo} value={t.tipo}>{t.rotulo} ({t.total.toLocaleString('pt-BR')})</option>
            ))}
          </SelectMenu>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={vigentes} onChange={(ev) => { setVigentes(ev.target.checked); setPage(1); }} /> Só vigentes
          </label>
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
            <EmptyState icon={BookMarked} title="Nenhuma lei encontrada" description={q || esfera || tipo || vigentes ? 'Tente outros filtros.' : 'A biblioteca ainda está sendo carregada.'} />
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.items.map((l) => (
              <li key={l.id}>
                <Link href={`/${slug}/leis-referencia/${l.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-brand-50/40 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink-900">{l.titulo}</span>
                      <Badge tone="neutral">{ESFERA_LEI_LABEL[l.esfera]}</Badge>
                    </div>
                    {l.ementa && <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{l.ementa}</p>}
                    <p className="mt-0.5 text-xs text-ink-500">{[l.tipoRotulo, dataBr(l.data)].filter(Boolean).join(' · ')}</p>
                  </div>
                  {l.revogada && <Badge tone="danger">Revogada</Badge>}
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
