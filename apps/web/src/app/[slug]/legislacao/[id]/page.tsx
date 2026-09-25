'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, History, Printer, Scale, Undo2 } from 'lucide-react';
import { SITUACAO_NORMA_LABEL, hojeIso, rotuloNormaCurto, type NormaView } from '@jdoc/shared';
import { api, apiUrl, ApiError } from '@/lib/api';
import { Badge, Card, Input, Switch } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { SITUACAO_TOM, TextoCompilado, agruparRelacoes } from '@/components/legislacao/compilado';

export default function NormaPublica() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [data, setData] = useState('');
  const [historico, setHistorico] = useState(true);
  const [busca, setBusca] = useState('');
  const { data: n, error, isLoading } = useQuery<NormaView>({
    queryKey: ['legislacao-publica', slug, id, data],
    queryFn: () => api(`/t/${slug}/legislacao-publica/${id}${data ? `?data=${data}` : ''}`),
    placeholderData: (p) => p,
  });

  const voltar = (
    <Link href={`/${slug}/legislacao`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-brand-600 print:hidden">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Todas as normas
    </Link>
  );
  if (error) {
    return (
      <div className="space-y-4">
        {voltar}
        <EmptyState icon={Scale} title="Norma não encontrada" description={error instanceof ApiError && error.status !== 404 ? error.message : 'Ela pode não estar publicada.'} />
      </div>
    );
  }
  if (isLoading || !n) return <div className="h-64 animate-pulse rounded-[16px] bg-ink-100" />;

  return (
    <div className="space-y-5">
      {voltar}
      <div className="text-center">
        <h1 className="text-xl font-extrabold uppercase tracking-tight text-ink-900 sm:text-2xl">{n.rotulo}</h1>
        <div className="mt-2 flex justify-center">
          <Badge tone={SITUACAO_TOM[n.situacao]}>{SITUACAO_NORMA_LABEL[n.situacao]}</Badge>
        </div>
        <p className="mx-auto mt-4 max-w-xl text-right text-sm italic text-ink-600 sm:ml-auto sm:mr-0">{n.ementa}</p>
      </div>

      {(n.alteradaPor.length > 0 || n.altera.length > 0) && (
        <Card className="p-4 text-sm print:hidden">
          {n.alteradaPor.length > 0 && (
            <p>
              <span className="font-semibold text-ink-700">Alterada por: </span>
              {agruparRelacoes(n.alteradaPor).map((r, i) => (
                <span key={r.norma.id}>
                  {i > 0 && ', '}
                  <Link className="text-brand-600 hover:underline" href={`/${slug}/legislacao/${r.norma.id}`}>
                    {rotuloNormaCurto(r.norma)}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {n.altera.length > 0 && (
            <p className="mt-1">
              <span className="font-semibold text-ink-700">Altera: </span>
              {agruparRelacoes(n.altera).map((r, i) => (
                <span key={r.norma.id}>
                  {i > 0 && ', '}
                  <Link className="text-brand-600 hover:underline" href={`/${slug}/legislacao/${r.norma.id}`}>
                    {rotuloNormaCurto(r.norma)}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 print:hidden md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <History className="h-4 w-4 text-ink-400" aria-hidden />
            <span className="text-ink-600">Vigente em</span>
            <Input type="date" aria-label="Data" className="w-40" value={data || n.data} max={hojeIso()} onChange={(e) => setData(e.target.value)} />
            {data && (
              <button type="button" onClick={() => setData('')} className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
                <Undo2 className="h-3.5 w-3.5" aria-hidden /> Hoje
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Input type="search" aria-label="Localizar no texto" placeholder="Localizar no texto" className="w-52" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-ink-600">
              <Switch checked={historico} onChange={setHistorico} label="Mostrar redações anteriores" />
              Redações anteriores
            </label>
            <a href={apiUrl(`/t/${slug}/legislacao-publica/${id}/compilado.pdf${data ? `?data=${data}` : ''}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
              <Printer className="h-4 w-4" aria-hidden /> PDF
            </a>
          </div>
        </div>
        <div className="px-5 py-6 sm:px-10">
          <TextoCompilado nos={n.compilado} mostrarHistorico={historico} destaque={busca} linkNorma={(r) => `/${slug}/legislacao/${r.id}`} />
        </div>
      </Card>
    </div>
  );
}
