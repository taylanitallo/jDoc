'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, RefreshCw, ScanSearch, Search } from 'lucide-react';
import { sistemaDoModulo, type BuscaConteudoResult, type DocModule, type IndexacaoResumo } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { btnGhost, btnPrimary, cardCls, inputCls, PageHeader, Pagination, SelectMenu } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { useModuloAtivo } from '@/components/modulo-ativo';
import { fmtDate } from '@/lib/format';

const MODULOS: Array<{ id: DocModule | ''; label: string }> = [
  { id: '', label: 'Tudo neste módulo' },
  { id: 'acervo', label: 'Acervo' },
  { id: 'despesas', label: 'Despesas' },
  { id: 'receitas', label: 'Receitas' },
  { id: 'balancete', label: 'Balancete' },
  { id: 'extrato', label: 'Extrato' },
  { id: 'outros', label: 'Outros' },
];
const MODULO_LABEL = Object.fromEntries(MODULOS.map((m) => [m.id, m.label]));

export default function BuscaConteudoPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();
  const qc = useQueryClient();
  // Busca dentro do modulo em uso (Financeiro/Contabil ou Arquivo Municipal).
  const { ativo } = useModuloAtivo();
  const opcoes = MODULOS.filter((m) => m.id === '' || sistemaDoModulo(m.id) === ativo);
  const [texto, setTexto] = useState('');
  const [modulo, setModulo] = useState<DocModule | ''>('');
  const [consulta, setConsulta] = useState<{ q: string; modulo: DocModule | '' } | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: indexacao } = useQuery<IndexacaoResumo>({
    queryKey: ['busca', 'indexacao', slug],
    queryFn: () => api(`/t/${slug}/busca/indexacao`),
    refetchInterval: (q) => ((q.state.data?.pendentes ?? 0) > 0 ? 5000 : false),
  });

  const { data, isFetching, error } = useQuery<BuscaConteudoResult>({
    queryKey: ['busca', slug, ativo, consulta, page],
    enabled: consulta !== null,
    queryFn: () => {
      const p = new URLSearchParams({ q: consulta!.q, page: String(page), pageSize: String(pageSize) });
      if (consulta!.modulo) p.set('module', consulta!.modulo);
      if (ativo) p.set('sistema', ativo);
      return api(`/t/${slug}/busca?${p.toString()}`);
    },
  });

  const reindexar = useMutation({
    mutationFn: () => api<{ enfileirados: number }>(`/t/${slug}/busca/reindexar`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.enfileirados > 0 ? `${r.enfileirados} arquivo(s) na fila de indexação.` : 'Nada pendente para indexar.');
      qc.invalidateQueries({ queryKey: ['busca', 'indexacao', slug] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError && e.status === 403 ? 'Somente administradores podem reindexar.' : 'Falha ao reindexar'),
  });

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    if (texto.trim().length < 2) return;
    setPage(1);
    setConsulta({ q: texto.trim(), modulo });
  };

  const abrir = async (documentId: string, documentFileId: string | null, pagina: number) => {
    const win = window.open('', '_blank');
    try {
      const path = documentFileId
        ? `/t/${slug}/documents/${documentId}/files/${documentFileId}/url`
        : `/t/${slug}/documents/${documentId}/url`;
      const { url } = await api<{ url: string }>(path);
      // #page=N: o visualizador de PDF do navegador abre direto na pagina encontrada.
      const alvo = `${url}#page=${pagina}`;
      if (win) win.location.href = alvo;
      else window.open(alvo, '_blank');
    } catch (err) {
      win?.close();
      toast.error(err instanceof ApiError ? err.message : 'Erro ao abrir PDF');
    }
  };


  return (
    <div className="space-y-6">
      <PageHeader
        title="Busca no conteúdo"
        description="Procura dentro do texto dos PDFs — inclusive documentos escaneados (OCR)."
      />

      <form onSubmit={buscar} className={`${cardCls} flex flex-wrap items-center gap-3 p-4`}>
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
          <input
            aria-label="Texto a procurar"
            className={`${inputCls} pl-9`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder='ex.: reforma escola   ·   "plano diretor"   ·   contrato -aditivo'
          />
        </div>
        <SelectMenu aria-label="Módulo" className={`${inputCls} sm:max-w-[14rem]`} value={modulo} onChange={(e) => setModulo(e.target.value as DocModule | '')}>
          {opcoes.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </SelectMenu>
        <button type="submit" className={btnPrimary} disabled={texto.trim().length < 2}>Buscar</button>
      </form>

      {indexacao && (
        <div className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}>
          {indexacao.habilitado ? (
            <p className="text-ink-500">
              <strong className="text-ink-800">{indexacao.concluidos}</strong> arquivo(s) indexados
              {indexacao.pendentes > 0 && <> · <strong className="text-ink-800">{indexacao.pendentes}</strong> na fila</>}
              {indexacao.semTexto > 0 && <> · {indexacao.semTexto} sem texto legível</>}
              {indexacao.erros > 0 && <> · <span className="text-danger-600">{indexacao.erros} com erro</span></>}
              {indexacao.semIndice > 0 && <> · {indexacao.semIndice} ainda não indexados</>}
            </p>
          ) : (
            <p className="text-ink-500">Indexação de conteúdo indisponível neste servidor (poppler/tesseract não instalados).</p>
          )}
          {indexacao.habilitado && (indexacao.semIndice > 0 || indexacao.erros > 0) && (
            <button type="button" className={btnGhost} onClick={() => reindexar.mutate()} disabled={reindexar.isPending}>
              <span className="flex items-center gap-2">
                <RefreshCw className={`h-4 w-4 ${reindexar.isPending ? 'animate-spin' : ''}`} aria-hidden /> Indexar documentos antigos
              </span>
            </button>
          )}
        </div>
      )}

      {consulta === null ? (
        <EmptyState icon={ScanSearch} title="Digite o que procura" description="Palavras soltas, frase entre aspas ou -palavra para excluir. Acentos não importam." />
      ) : error ? (
        <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-sm text-danger-600">
          {error instanceof ApiError ? error.message : 'Falha na busca'}
        </p>
      ) : isFetching && !data ? (
        <div className="h-24 animate-pulse rounded-[16px] bg-ink-100" />
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={Search} title="Nada encontrado" description="Tente outras palavras ou confira se os documentos já foram indexados." />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">{data?.total} documento(s)</p>
          {data?.items.map((it) => (
            <button
              key={it.documentId}
              type="button"
              onClick={() => abrir(it.documentId, it.documentFileId, it.pagina)}
              className={`${cardCls} block w-full p-4 text-left transition hover:shadow-md`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-ink-500" aria-hidden />
                <span className="font-semibold text-ink-800">{it.titulo}</span>
                <span className="text-xs text-ink-500">
                  {MODULO_LABEL[it.module] ?? it.module} · {it.documentDate ? fmtDate(it.documentDate) : it.exercicio} · pág. {it.pagina}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">
                {it.trecho.map((s, i) =>
                  s.destaque ? (
                    <mark key={i} className="rounded bg-warning-200 px-0.5 text-ink-800">{s.texto}</mark>
                  ) : (
                    <span key={i}>{s.texto}</span>
                  ),
                )}
              </p>
            </button>
          ))}
          <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} className="pt-1" />
        </div>
      )}
    </div>
  );
}
