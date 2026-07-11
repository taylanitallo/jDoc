'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  Eye,
  FileSignature,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Sparkles,
  SlidersHorizontal,
  Tags,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  documentFieldsSchema,
  DOC_SUBTYPES,
  TRASH_RETENTION_DAYS,
  type AnalisarConferenciaResult,
  type ConferenciaResultado,
  type ConferenciaStatus,
  type ConferenciaStatusItem,
  type DocModule,
  type DocumentFileView,
  type DocumentPage,
  type DocumentView,
  type Orgao,
} from '@jdoc/shared';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { addExtraDocumentFile, attachDocumentFile, uploadDocument } from '@/lib/upload';
import { useExercicio } from '@/components/topbar';
import { LabelsImportModal } from '@/components/documents/labels-import-modal';
import { DesktopSignModal } from '@/components/documents/desktop-sign-modal';
import { isDesktopApp } from '@/lib/desktop-bridge';
import { Modal, btnGhost, btnPrimary, cardCls, formatBytes, inputCls, labelCls } from '@/components/ui';
import { useToast } from '@/components/toast';

const MODULE_TITLES: Record<DocModule, { title: string; singular: string }> = {
  receitas: { title: 'Receitas', singular: 'Receita' },
  despesas: { title: 'Despesas', singular: 'Despesa' },
  balancete: { title: 'Balancete Orçamentário', singular: 'Balancete' },
  extrato: { title: 'Extrato de Contas', singular: 'Extrato' },
  outros: { title: 'Outros Arquivos', singular: 'Documento' },
};

interface Lookup {
  id: string;
  nome: string;
  codigo?: string | null;
  cor?: string;
}

const SUBTYPE_SHORT: Record<string, string> = {
  orcamentaria: 'O',
  extraorcamentaria: 'E',
  resto_a_pagar: 'R',
};

const SUBTYPE_LABEL: Record<string, string> = {
  orcamentaria: 'ORÇAMENTÁRIA',
  extraorcamentaria: 'EXTRAORÇAMENTÁRIA',
  resto_a_pagar: 'RESTO A PAGAR',
};

/** Resto a Pagar so existe para despesas — receitas so tem Orçamentária/Extraorçamentária. */
function subtypesFor(module: DocModule): readonly string[] {
  return module === 'despesas' ? DOC_SUBTYPES : DOC_SUBTYPES.filter((s) => s !== 'resto_a_pagar');
}

const MESES = [
  { value: '01', label: 'Janeiro' },
  { value: '02', label: 'Fevereiro' },
  { value: '03', label: 'Março' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Maio' },
  { value: '06', label: 'Junho' },
  { value: '07', label: 'Julho' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Setembro' },
  { value: '10', label: 'Outubro' },
  { value: '11', label: 'Novembro' },
  { value: '12', label: 'Dezembro' },
];

/** Orgao (novo cadastro) tem prioridade; cai para budget_unit (antigo) se nao houver. */
function orgaoLabel(d: DocumentView): string {
  if (d.orgaoCodigo || d.orgaoNome) return [d.orgaoCodigo, d.orgaoNome].filter(Boolean).join(' — ');
  return d.budgetUnitNome ?? '—';
}

/** Competencia "YYYY-MM" -> "Mês/AAAA" (por extenso, em vez do número do mês). */
function formatCompetencia(competencia: string | null): string {
  if (!competencia) return '—';
  const [ano, mes] = competencia.split('-');
  const nome = MESES.find((m) => m.value === mes)?.label;
  return nome ? `${nome.toUpperCase()}/${ano}` : competencia;
}

/** "125" -> "2min 5s" / "45" -> "45s" — usado no tempo estimado da analise. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}min ${seconds}s`;
}

const TOOLTIP_WIDTH = 340;

/**
 * Tooltip colorido que renderiza via portal em document.body — evita ser
 * cortado por ancestrais com overflow-hidden/auto (tabela com scroll
 * horizontal, modal com scroll vertical), que sempre cortavam o balao de
 * conferencia quando ele nascia perto da borda. Posicao calculada na hora do
 * hover a partir do icone; abre pra cima se nao houver espaco embaixo, e
 * nunca deixa a caixa sair da largura da tela.
 */
function HoverTooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Mede a altura REAL do balao (que varia com o conteudo) antes de decidir
  // se abre pra baixo ou pra cima — uma estimativa fixa sempre erra pra
  // conteudo mais longo. Roda antes do paint (useLayoutEffect), entao o
  // usuario nunca ve o balao "pulando" de posicao.
  useLayoutEffect(() => {
    if (!visible) {
      setCoords(null);
      return;
    }
    const anchor = anchorRef.current;
    const box = boxRef.current;
    if (!anchor || !box) return;
    const anchorRect = anchor.getBoundingClientRect();
    const boxHeight = box.offsetHeight;

    let left = anchorRect.right - TOOLTIP_WIDTH;
    left = Math.min(Math.max(left, 8), window.innerWidth - TOOLTIP_WIDTH - 8);

    let top = anchorRect.bottom + 8;
    if (top + boxHeight > window.innerHeight - 8) {
      const topAbove = anchorRect.top - 8 - boxHeight;
      top = topAbove > 8 ? topAbove : Math.max(8, window.innerHeight - boxHeight - 8);
    }
    setCoords({ top, left });
  }, [visible, content]);

  return (
    <span
      ref={anchorRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      className="inline-flex shrink-0"
    >
      {children}
      {visible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={boxRef}
            className="pointer-events-none fixed z-[100] max-h-[80vh] overflow-y-auto rounded-lg border border-app-border bg-app-card p-3 text-left text-xs text-app shadow-2xl"
            style={{
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              width: TOOLTIP_WIDTH,
              visibility: coords ? 'visible' : 'hidden',
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Quanto maior, mais grave — usado pra achar o "pior caso" entre varios arquivos do mesmo documento. */
const CONFERENCIA_SEVERITY: Record<string, number> = { divergente: 4, falha: 3, pendente: 2, conforme: 1 };

/** Pior veredito entre o arquivo principal e os extras — o selo da listagem reflete esse. */
function worstConferencia(documento: DocumentView): {
  status: ConferenciaStatus | null;
  resultado: ConferenciaResultado | null;
  erro: string | null;
} {
  let best = {
    status: documento.conferenciaStatus,
    resultado: documento.conferenciaResultado,
    erro: documento.conferenciaErro,
  };
  let bestSeverity = best.status ? CONFERENCIA_SEVERITY[best.status] ?? 0 : 0;
  for (const extra of documento.arquivosExtras) {
    const severity = extra.conferenciaStatus ? CONFERENCIA_SEVERITY[extra.conferenciaStatus] ?? 0 : 0;
    if (severity > bestSeverity) {
      bestSeverity = severity;
      best = { status: extra.conferenciaStatus, resultado: extra.conferenciaResultado, erro: extra.conferenciaErro };
    }
  }
  return best;
}

/**
 * Selo da conferência por IA: cruza o(s) PDF(s) anexado(s) com os dados da
 * etiqueta. Verde = conforme. Laranja = divergência. Sem veredito ainda (nunca
 * analisado, falhou, ou está rodando agora) e com arquivo anexado = ícone de
 * "carregando", convidando a usar o botão "Analisar Doc (IA)". Sem arquivo
 * anexado (etiqueta aguardando PDF) não mostra nada — não há o que analisar.
 * Quando o documento tem mais de um PDF, mostra o pior veredito entre eles.
 */
function ConferenciaBadge({ documento }: { documento: DocumentView }) {
  // A conferencia so existe no modulo despesas — nos demais nao ha o que mostrar.
  if (documento.module !== 'despesas') return null;
  const { status, resultado, erro } = worstConferencia(documento);
  if (status === 'divergente' || status === 'falha') {
    const totalArquivos = 1 + documento.arquivosExtras.length;
    const Icon = status === 'divergente' ? TriangleAlert : CircleAlert;
    const iconColor = status === 'divergente' ? 'text-orange-500' : 'text-red-500';
    const ariaLabel = status === 'divergente' ? 'Conferência por IA: divergência encontrada' : 'Conferência por IA: falhou';

    let tooltip: ReactNode;
    if (totalArquivos > 1) {
      // Mais de um PDF anexado: em vez de mostrar so o pior veredito (escondendo
      // os outros), manda clicar na linha — o modal ja lista cada arquivo com
      // seu proprio triangulo/erro individual.
      tooltip = (
        <p>
          Mais de um arquivo anexado com problema.{' '}
          <span className="font-semibold text-blue-500 dark:text-blue-400">Clique para ver detalhado.</span>
        </p>
      );
    } else if (status === 'divergente') {
      const divergencias = resultado?.divergencias ?? [];
      tooltip = (
        <div className="space-y-1">
          {resultado?.resumo && <p className="text-app-muted">{resultado.resumo}</p>}
          {divergencias.map((d, i) => (
            <p key={i}>
              <span className="font-semibold text-blue-500 dark:text-blue-400">{d.campo}</span>: esperado &quot;
              {d.esperado ?? '—'}&quot;, encontrado &quot;{d.encontrado ?? '—'}&quot;
            </p>
          ))}
        </div>
      );
    } else {
      tooltip = <p>{erro ?? 'Falha ao analisar — clique em "Analisar Doc (IA)" para tentar de novo'}</p>;
    }

    return (
      <HoverTooltip content={tooltip}>
        <Icon className={`mx-auto h-4 w-4 ${iconColor}`} aria-label={ariaLabel} />
      </HoverTooltip>
    );
  }
  if (status === 'conforme') {
    return (
      <span title="Conferência automática: dados conferem com o PDF">
        <CircleCheck
          className="mx-auto h-4 w-4 text-green-600 dark:text-green-400"
          aria-label="Conferência por IA: conforme"
        />
      </span>
    );
  }
  if (documento.status === 'disponivel') {
    return (
      <span
        title={
          status === 'pendente'
            ? 'Analisando por IA…'
            : 'Ainda não analisado — selecione e clique em "Analisar Doc (IA)"'
        }
      >
        <Loader2
          className="mx-auto h-4 w-4 animate-spin text-app-muted"
          aria-label="Conferência por IA: aguardando análise"
        />
      </span>
    );
  }
  return null;
}

/** Selo compacto de conferência por IA pra uma linha de arquivo individual (dentro do modal Anexar PDF). */
function FileConferenciaBadge({
  status,
  resultado,
  erro,
}: {
  status: ConferenciaStatus | null;
  resultado: ConferenciaResultado | null;
  erro: string | null;
}) {
  if (status === 'divergente' || status === 'falha') {
    const Icon = status === 'divergente' ? TriangleAlert : CircleAlert;
    const iconColor = status === 'divergente' ? 'text-orange-500' : 'text-red-500';
    const divergencias = resultado?.divergencias ?? [];
    const tooltip =
      status === 'divergente' ? (
        <div className="space-y-1">
          {resultado?.resumo && <p className="text-app-muted">{resultado.resumo}</p>}
          {divergencias.map((d, i) => (
            <p key={i}>
              <span className="font-semibold text-blue-500 dark:text-blue-400">{d.campo}</span>: esperado &quot;
              {d.esperado ?? '—'}&quot;, encontrado &quot;{d.encontrado ?? '—'}&quot;
            </p>
          ))}
        </div>
      ) : (
        <p>{erro ?? 'Falha ao analisar'}</p>
      );
    return (
      <HoverTooltip content={tooltip}>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} aria-hidden />
      </HoverTooltip>
    );
  }
  if (status === 'conforme') {
    return (
      <span title="Conferência automática: dados conferem com o PDF">
        <CircleCheck className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
      </span>
    );
  }
  if (status === 'pendente') {
    return (
      <span title="Analisando por IA…">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-app-muted" aria-hidden />
      </span>
    );
  }
  return null;
}

/** Colunas de detalhe por modulo — cada modulo tem seus proprios campos relevantes.
 *  className define a largura (tabela usa table-fixed). So despesas tem um
 *  campo livre garantidamente longo (Credor), por isso fica sem largura
 *  explicita pra absorver o espaço restante. Os demais modulos usam larguras
 *  percentuais proporcionais entre si, senao uma unica coluna sem limite
 *  acaba engolindo todo o espaço vazio sozinha quando o conteudo e curto. */
const DETAIL_COLUMNS: Record<
  DocModule,
  Array<{ header: string; render: (d: DocumentView) => string; className?: string }>
> = {
  despesas: [
    { header: 'Doc. Caixa', render: (d) => d.docCaixa ?? '—', className: 'w-20' },
    { header: 'Empenho', render: (d) => d.empenho ?? '—', className: 'w-24' },
    { header: 'Órgão', render: orgaoLabel, className: 'w-44' },
    { header: 'Credor', render: (d) => d.credor ?? '—' },
    { header: 'Tipo', render: (d) => (d.subtype ? SUBTYPE_SHORT[d.subtype] ?? d.subtype : '—'), className: 'w-10 text-center' },
  ],
  receitas: [
    { header: 'Órgão', render: orgaoLabel, className: 'w-[30%]' },
    { header: 'Tipo', render: (d) => (d.subtype ? SUBTYPE_LABEL[d.subtype] ?? d.subtype : '—'), className: 'w-[22%]' },
    { header: 'Conta', render: (d) => d.conta ?? '—', className: 'w-[18%]' },
  ],
  balancete: [
    { header: 'Órgão', render: orgaoLabel, className: 'w-[48%]' },
    { header: 'Competência', render: (d) => formatCompetencia(d.competencia), className: 'w-[20%]' },
  ],
  extrato: [
    { header: 'Órgão', render: orgaoLabel, className: 'w-[24%]' },
    { header: 'Banco', render: (d) => d.banco ?? '—', className: 'w-[22%]' },
    { header: 'Agência', render: (d) => d.agencia ?? '—', className: 'w-[14%]' },
    { header: 'Conta', render: (d) => d.conta ?? '—', className: 'w-[16%]' },
    { header: 'Competência', render: (d) => formatCompetencia(d.competencia), className: 'w-[16%]' },
  ],
  outros: [
    { header: 'Órgão', render: orgaoLabel, className: 'w-[25%]' },
    { header: 'Tipo', render: (d) => d.documentTypeNome ?? '—', className: 'w-[18%]' },
    { header: 'Descrição', render: (d) => d.descricao ?? '—', className: 'w-[32%]' },
  ],
};

export function DocumentsModule({ module }: { module: DocModule }) {
  const { slug } = useParams<{ slug: string }>();
  const { exercicio } = useExercicio();
  const qc = useQueryClient();
  const toast = useToast();
  const meta = MODULE_TITLES[module];

  const [q, setQ] = useState('');
  const [subtype, setSubtype] = useState('');
  const [orgaoId, setOrgaoId] = useState('');
  const [mes, setMes] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [valorMin, setValorMin] = useState('');
  const [valorMax, setValorMax] = useState('');
  const [comArquivo, setComArquivo] = useState('');
  const [critica, setCritica] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [showTrash, setShowTrash] = useState(false);
  const [includeOpen, setIncludeOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [deleteOrgaoId, setDeleteOrgaoId] = useState('');
  const [deleteSubtype, setDeleteSubtype] = useState('');
  const [deleteApenasSemArquivo, setDeleteApenasSemArquivo] = useState(true);
  const [attaching, setAttaching] = useState<DocumentView | null>(null);
  const [viewPicker, setViewPicker] = useState<DocumentView | null>(null);
  const [editing, setEditing] = useState<DocumentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [zipDownloading, setZipDownloading] = useState(false);
  const [analisando, setAnalisando] = useState<{
    ids: string[];
    done: number;
    total: number;
    startedAt: number;
  } | null>(null);
  const [resultadoProblemas, setResultadoProblemas] = useState<{
    ids: string[];
    divergente: number;
    falha: number;
  } | null>(null);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  // Lock sincrono (nao sujeito ao atraso de re-render do useState) contra
  // duplo-clique — evita a analise disparar duas vezes e toasts duplicados.
  const analisandoRef = useRef(false);
  // Idem, checado dentro do loop de polling pra parar assim que o usuario
  // clicar em "Cancelar" (useState sozinho teria o mesmo atraso de re-render).
  const cancelarRef = useRef(false);

  const params = new URLSearchParams({ module, page: String(page), pageSize: '20' });
  if (!showTrash) {
    params.set('exercicio', String(exercicio));
    if (q) params.set('q', q);
    if (subtype) params.set('subtype', subtype);
    if (orgaoId) params.set('orgaoId', orgaoId);
    if (module === 'balancete' || module === 'extrato') {
      if (mes) params.set('competencia', `${exercicio}-${mes}`);
    }
    if (dataInicio || dataFim) {
      if (dataInicio) params.set('de', dataInicio);
      if (dataFim) params.set('ate', dataFim);
    } else if (module !== 'extrato' && module !== 'balancete' && mes) {
      const lastDay = new Date(exercicio, Number(mes), 0).getDate();
      params.set('de', `${exercicio}-${mes}-01`);
      params.set('ate', `${exercicio}-${mes}-${String(lastDay).padStart(2, '0')}`);
    }
    if (valorMin) params.set('valorMin', valorMin);
    if (valorMax) params.set('valorMax', valorMax);
    if (comArquivo) params.set('comArquivo', comArquivo);
    if (module === 'despesas' && critica) params.set('critica', critica);
  }

  const { data, isLoading } = useQuery({
    queryKey: [
      'docs',
      slug,
      module,
      showTrash,
      q,
      subtype,
      orgaoId,
      mes,
      dataInicio,
      dataFim,
      valorMin,
      valorMax,
      comArquivo,
      critica,
      page,
      exercicio,
    ],
    queryFn: () =>
      api<DocumentPage>(
        showTrash
          ? `/t/${slug}/documents/trash?module=${module}&page=${page}&pageSize=20`
          : `/t/${slug}/documents?${params}`,
      ),
  });

  const { data: orgaosData } = useQuery({
    queryKey: ['configuracoes', 'orgaos', slug, exercicio],
    queryFn: () => api<{ items: Orgao[]; total: number }>(`/t/${slug}/configuracoes/orgaos?exercicio=${exercicio}&pageSize=200`),
  });
  const orgaos = orgaosData?.items ?? [];
  const { data: docTypes } = useQuery({
    queryKey: ['document-types', slug],
    queryFn: () => api<Lookup[]>(`/t/${slug}/document-types`),
    enabled: module === 'outros',
  });

  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ['docs', slug, module] }),
    [qc, slug, module],
  );

  const del = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/documents/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao excluir'),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/documents/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao restaurar'),
  });
  const deleteAllEtiquetas = useMutation({
    mutationFn: () => {
      const qs = new URLSearchParams({ module, apenasSemArquivo: String(deleteApenasSemArquivo) });
      if (deleteOrgaoId) qs.set('orgaoId', deleteOrgaoId);
      if (deleteSubtype) qs.set('subtype', deleteSubtype);
      return api(`/t/${slug}/documents/etiquetas?${qs}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      invalidate();
      setConfirmDeleteAll(false);
      setDeleteOrgaoId('');
      setDeleteSubtype('');
      setDeleteApenasSemArquivo(true);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao apagar etiquetas'),
  });

  const emptyTrash = useMutation({
    mutationFn: () => api(`/t/${slug}/documents/trash?module=${module}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      setConfirmEmptyTrash(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao esvaziar lixeira'),
  });

  const bulkDelete = useMutation({
    mutationFn: () => api(`/t/${slug}/documents/bulk-delete`, { method: 'POST', body: { ids: [...selected] } }),
    onSuccess: () => {
      invalidate();
      setSelected(new Set());
      setConfirmBulkDelete(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Erro ao excluir selecionados'),
  });

  const downloadZip = async () => {
    setError(null);
    setZipDownloading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
      const token = getAccessToken();
      const res = await fetch(`${apiUrl}/t/${slug}/documents/bulk-download`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids: [...selected] }),
      });
      if (!res.ok) {
        let message = 'Erro ao gerar ZIP';
        try {
          message = ((await res.json()) as { message?: string }).message ?? message;
        } catch {
          // sem corpo
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `documentos-${module}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar ZIP');
    } finally {
      setZipDownloading(false);
    }
  };

  /**
   * Dispara a conferência por IA para os documentos selecionados (sob
   * demanda — evita gastar tokens automaticamente). Enfileira, depois faz
   * polling do status até todos terminarem, atualizando a barra de progresso,
   * e no fim mostra um diagnóstico (quantos conformes/divergentes/falharam).
   */
  const analisarConferencia = async () => {
    // Lock sincrono — o `disabled` do botao so reflete o estado apos o
    // re-render (React bateja updates), entao um duplo-clique rapido pode
    // disparar duas execucoes antes do disabled surtir efeito.
    if (analisandoRef.current) return;
    if (selected.size === 0) {
      toast.info('Selecione ao menos um documento para analisar.');
      return;
    }
    analisandoRef.current = true;
    cancelarRef.current = false;
    setError(null);
    setResultadoProblemas(null);
    try {
      const ids = [...selected];
      const res = await api<AnalisarConferenciaResult>(`/t/${slug}/documents/conferencia/analisar`, {
        method: 'POST',
        body: { ids },
      });
      if (res.enqueued.length === 0) {
        toast.info('Nenhum documento selecionado tem PDF anexado — nada para analisar.');
        return;
      }
      setAnalisando({ ids: res.enqueued, done: 0, total: res.enqueued.length, startedAt: Date.now() });

      let statuses: ConferenciaStatusItem[] = [];
      // Poll ate todos saírem de 'pendente' (ou timeout de seguranca ~5min),
      // checando o cancelarRef entre cada espera pra parar assim que o
      // usuario clicar em "Cancelar".
      for (let tentativa = 0; tentativa < 150 && !cancelarRef.current; tentativa++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelarRef.current) break;
        statuses = await api<ConferenciaStatusItem[]>(`/t/${slug}/documents/conferencia/status`, {
          method: 'POST',
          body: { ids: res.enqueued },
        });
        const done = statuses.filter((s) => s.conferenciaStatus && s.conferenciaStatus !== 'pendente').length;
        // Preserva o startedAt original (funcional update) — resetar a cada
        // poll quebraria a conta do tempo estimado (elapsed sempre ~0).
        setAnalisando((prev) => (prev ? { ...prev, done } : prev));
        qc.invalidateQueries({ queryKey: ['docs', slug] });
        if (done >= res.enqueued.length) break;
      }

      if (cancelarRef.current) {
        toast.info('Análise cancelada.');
        return;
      }

      const conforme = statuses.filter((s) => s.conferenciaStatus === 'conforme').length;
      const divergente = statuses.filter((s) => s.conferenciaStatus === 'divergente').length;
      const falha = statuses.filter((s) => s.conferenciaStatus === 'falha').length;
      const partes = [`${conforme} conforme(s)`];
      if (divergente > 0) partes.push(`${divergente} divergente(s)`);
      if (falha > 0) partes.push(`${falha} falharam`);
      if (res.skipped > 0) partes.push(`${res.skipped} sem PDF (ignorado)`);
      const resumo = `Análise concluída: ${partes.join(', ')}.`;
      // Quando ha problema (divergencia ou falha), o painel central com o
      // botao "Abrir Críticas" e mais visivel que um toast — que some rapido.
      if (divergente > 0 || falha > 0) {
        setResultadoProblemas({ ids: res.enqueued, divergente, falha });
      } else {
        toast.success(resumo);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Falha ao analisar por IA';
      setError(msg);
      toast.error(msg);
    } finally {
      setAnalisando(null);
      analisandoRef.current = false;
      cancelarRef.current = false;
      await qc.invalidateQueries({ queryKey: ['docs', slug] });
    }
  };

  /** Cancela a analise em andamento — para de esperar e tira da fila os que ainda nem comecaram. */
  const cancelarAnalise = async () => {
    if (!analisando || cancelarRef.current) return;
    cancelarRef.current = true;
    try {
      await api(`/t/${slug}/documents/conferencia/cancelar`, {
        method: 'POST',
        body: { ids: analisando.ids },
      });
    } catch {
      // best-effort — o loop de polling ja para de qualquer forma pelo ref.
    }
  };

  /** Abre em nova guia o PDF com a lista de documentos divergentes/falhos do lote. */
  const abrirCriticas = async () => {
    if (!resultadoProblemas) return;
    // Abre a janela AGORA (sincrono) — se esperar o fetch, navegadores
    // bloqueiam como popup.
    const win = window.open('', '_blank');
    setGerandoRelatorio(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
      const token = getAccessToken();
      const res = await fetch(`${apiUrl}/t/${slug}/documents/conferencia/relatorio`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids: resultadoProblemas.ids }),
      });
      if (!res.ok) throw new Error('Falha ao gerar o relatório de críticas');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar o relatório de críticas');
    } finally {
      setGerandoRelatorio(false);
    }
  };

  /**
   * Imprime (PDF em nova guia) todas as etiquetas que batem com os filtros
   * atuais da tela — mesmo objeto `params` da busca, entao respeita
   * exatamente o que esta filtrado (ou tudo, se nenhum filtro ativo).
   */
  const imprimirEtiquetas = async () => {
    const win = window.open('', '_blank');
    setImprimindo(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
      const token = getAccessToken();
      const res = await fetch(`${apiUrl}/t/${slug}/documents/relatorio-etiquetas`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(Object.fromEntries(params)),
      });
      if (!res.ok) throw new Error('Falha ao gerar o relatório de etiquetas');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar o relatório de etiquetas');
    } finally {
      setImprimindo(false);
    }
  };

  /** Abre um arquivo especifico (principal se extraId for undefined) em nova guia. */
  const openFile = async (doc: DocumentView, extraId?: string) => {
    const win = window.open('', '_blank');
    try {
      const path = extraId
        ? `/t/${slug}/documents/${doc.id}/files/${extraId}/url`
        : `/t/${slug}/documents/${doc.id}/url`;
      const { url } = await api<{ url: string }>(path);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Erro ao abrir PDF');
    }
  };

  /** Se o documento tem so um PDF, abre direto; se tem mais de um, pergunta qual. */
  const openPdf = (doc: DocumentView) => {
    if (doc.arquivosExtras.length === 0) {
      void openFile(doc);
      return;
    }
    setViewPicker(doc);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasValor = module === 'despesas' || module === 'receitas';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-app">
          {meta.title} {showTrash && `— Lixeira (retenção ${TRASH_RETENTION_DAYS} dias)`}
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            className={btnGhost}
            onClick={() => {
              setShowTrash((v) => !v);
              setPage(1);
            }}
          >
            <span className="flex items-center gap-2">
              {showTrash ? <X className="h-4 w-4" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              {showTrash ? 'Fechar lixeira' : 'Lixeira'}
            </span>
          </button>
          {showTrash && (
            <button type="button" className={btnGhost} onClick={() => setConfirmEmptyTrash(true)}>
              <span className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" aria-hidden /> Esvaziar Lixeira
              </span>
            </button>
          )}
          {!showTrash && (
            <>
              <button type="button" className={btnGhost} onClick={() => setConfirmDeleteAll(true)}>
                <span className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4" aria-hidden /> Apagar Etiquetas
                </span>
              </button>
              <button type="button" className={btnGhost} onClick={() => setLabelsOpen(true)}>
                <span className="flex items-center gap-2">
                  <Tags className="h-4 w-4" aria-hidden /> Importar Etiquetas
                </span>
              </button>
              <button
                type="button"
                className={btnGhost}
                onClick={() => void imprimirEtiquetas()}
                disabled={imprimindo}
                title="Gera um PDF com as etiquetas que aparecem na tela — respeita os filtros ativos"
              >
                <span className="flex items-center gap-2">
                  <Printer className="h-4 w-4" aria-hidden />
                  {imprimindo ? 'Gerando…' : 'Imprimir Etiquetas'}
                </span>
              </button>
              {module === 'despesas' && (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg bg-gradient-primary px-4 py-2 text-xs font-bold uppercase text-white transition hover:opacity-90 disabled:opacity-60"
                  onClick={() => void analisarConferencia()}
                  disabled={analisando !== null}
                  title="Usa a IA pra conferir se o PDF anexado bate com os dados cadastrados (consome tokens) — selecione os documentos na tabela antes de clicar"
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {analisando ? 'Analisando…' : 'Analisar Doc (IA)'}
                </button>
              )}
              <button type="button" className={btnPrimary} onClick={() => setIncludeOpen(true)}>
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" aria-hidden /> Incluir
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {!showTrash && (
        <div className={`${cardCls} p-4 card-accent-blue`}>
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-app-muted" aria-hidden />
              <input
                aria-label="Buscar"
                className={inputCls + ' pl-9'}
                placeholder="Buscar por credor, histórico, empenho…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <button
              type="button"
              className={btnGhost}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                {filtersOpen ? 'Ocultar filtros' : 'Mais filtros'}
              </span>
            </button>
          </div>

          {filtersOpen && (
            <div className="mt-3 flex flex-wrap gap-3">
              {(module === 'receitas' || module === 'despesas') && (
                <select
                  aria-label="Tipo"
                  className={inputCls + ' w-52'}
                  value={subtype}
                  onChange={(e) => {
                    setSubtype(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todos os tipos</option>
                  {subtypesFor(module).map((s) => (
                    <option key={s} value={s}>
                      {SUBTYPE_LABEL[s] ?? s}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="Órgão"
                className={inputCls + ' w-64'}
                value={orgaoId}
                onChange={(e) => {
                  setOrgaoId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos os órgãos</option>
                {orgaos.map((o) => (
                  <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
                ))}
              </select>
              <select
                aria-label="Mês"
                className={inputCls + ' w-44'}
                value={mes}
                onChange={(e) => {
                  setMes(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos os meses</option>
                {MESES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <input
                aria-label="Data início"
                type="date"
                className={inputCls + ' w-40'}
                value={dataInicio}
                onChange={(e) => {
                  setDataInicio(e.target.value);
                  setPage(1);
                }}
              />
              <input
                aria-label="Data fim"
                type="date"
                className={inputCls + ' w-40'}
                value={dataFim}
                onChange={(e) => {
                  setDataFim(e.target.value);
                  setPage(1);
                }}
              />
              {(module === 'despesas' || module === 'receitas') && (
                <>
                  <input
                    aria-label="Valor mínimo"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Valor mín."
                    className={inputCls + ' w-32'}
                    value={valorMin}
                    onChange={(e) => {
                      setValorMin(e.target.value);
                      setPage(1);
                    }}
                  />
                  <input
                    aria-label="Valor máximo"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Valor máx."
                    className={inputCls + ' w-32'}
                    value={valorMax}
                    onChange={(e) => {
                      setValorMax(e.target.value);
                      setPage(1);
                    }}
                  />
                </>
              )}
              <select
                aria-label="Com/sem PDF"
                className={inputCls + ' w-40'}
                value={comArquivo}
                onChange={(e) => {
                  setComArquivo(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Com/sem PDF</option>
                <option value="sim">Com PDF</option>
                <option value="nao">Sem PDF</option>
              </select>
              {module === 'despesas' && (
                <select
                  aria-label="Com/sem crítica"
                  className={inputCls + ' w-44'}
                  value={critica}
                  onChange={(e) => {
                    setCritica(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Com/sem crítica</option>
                  <option value="sim">Com crítica</option>
                  <option value="nao">Sem crítica</option>
                </select>
              )}
            </div>
          )}
        </div>
      )}

      {!showTrash && selected.size > 0 && (
        <div className={`${cardCls} flex items-center justify-between gap-3 p-3`}>
          <p className="text-sm font-semibold text-app">{selected.size} selecionada(s)</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={btnGhost}
              onClick={downloadZip}
              disabled={zipDownloading}
            >
              <span className="flex items-center gap-2">
                <FileUp className="h-4 w-4 rotate-180" aria-hidden />
                {zipDownloading ? 'Gerando ZIP…' : 'Baixar ZIP'}
              </span>
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-300 bg-app-input-bg px-4 py-2 text-xs font-bold uppercase text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/20"
              onClick={() => setConfirmBulkDelete(true)}
            >
              <span className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" aria-hidden /> Excluir selecionadas
              </span>
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
          {error}
        </p>
      )}

      <div className={`${cardCls} overflow-x-auto card-accent-purple`}>
        <table className="w-full table-fixed text-left text-xs">
          <thead>
            <tr className="border-b border-app-border text-[10px] font-bold uppercase text-app-muted">
              {!showTrash && (
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas"
                    checked={(data?.items.length ?? 0) > 0 && data!.items.every((d) => selected.has(d.id))}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(data?.items.map((d) => d.id) ?? []));
                      else setSelected(new Set());
                    }}
                  />
                </th>
              )}
              <th className="w-20 whitespace-nowrap px-2 py-2">Data</th>
              {DETAIL_COLUMNS[module].map((col) => (
                <th key={col.header} className={`whitespace-nowrap px-2 py-2 ${col.className ?? ''}`}>{col.header}</th>
              ))}
              {hasValor && <th className="w-24 whitespace-nowrap px-2 py-2 text-right">Valor</th>}
              <th className="w-16 whitespace-nowrap px-3 py-2 text-right">Páginas</th>
              <th className="w-8 px-1 py-2" title="Conferência por IA" aria-label="Conferência por IA" />
              <th className="w-24 whitespace-nowrap py-2 pl-4 pr-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4 + DETAIL_COLUMNS[module].length + (showTrash ? 0 : 1) + (hasValor ? 1 : 0)} className="px-2 py-2">
                  <div className="h-5 animate-pulse rounded bg-app-skeleton" />
                </td>
              </tr>
            )}
            {data?.items.map((d) => {
              const semArquivo = d.status === 'aguardando_arquivo';
              const clickable = !showTrash;
              return (
              <tr
                key={d.id}
                onClick={clickable ? () => setAttaching(d) : undefined}
                title={clickable ? (semArquivo ? 'Clique para anexar o PDF' : 'Clique para substituir o PDF') : undefined}
                className={`border-b border-app-border hover:bg-app-hover ${clickable ? 'cursor-pointer' : ''}`}
              >
                {!showTrash && (
                  <td className="w-8 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar documento ${d.originalName}`}
                      checked={selected.has(d.id)}
                      onChange={(e) => {
                        setSelected((cur) => {
                          const next = new Set(cur);
                          if (e.target.checked) next.add(d.id);
                          else next.delete(d.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                )}
                <td className="w-20 whitespace-nowrap px-2 py-1.5 text-app">
                  {d.documentDate ? new Date(d.documentDate + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                </td>
                {DETAIL_COLUMNS[module].map((col) => (
                  <td
                    key={col.header}
                    title={col.render(d)}
                    className={`truncate px-2 py-1.5 text-app ${col.className ?? ''}`}
                  >
                    {col.render(d)}
                  </td>
                ))}
                {hasValor && (
                  <td className="w-24 whitespace-nowrap px-2 py-1.5 text-right text-app">
                    {d.value !== null
                      ? d.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                      : '—'}
                  </td>
                )}
                <td className="w-16 whitespace-nowrap px-3 py-1.5 text-right text-app">
                  {d.pageCount ?? '—'}
                </td>
                <td className="w-8 px-1 py-1.5 text-center">
                  <ConferenciaBadge documento={d} />
                </td>
                <td className="w-24 py-1.5 pl-4 pr-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-0.5">
                    {showTrash ? (
                      <button
                        type="button"
                        title="Restaurar"
                        onClick={() => restore.mutate(d.id)}
                        className="rounded p-1 text-app-muted hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : (
                      <>
                        {!semArquivo && (
                          <button
                            type="button"
                            title="Visualizar PDF (nova guia)"
                            onClick={() => openPdf(d)}
                            className="rounded p-1 text-app-muted hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Editar"
                          onClick={() => setEditing(d)}
                          className="rounded p-1 text-app-muted hover:bg-purple-50 hover:text-purple-600 dark:hover:bg-purple-900/20"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          title="Excluir (lixeira)"
                          onClick={() => del.mutate(d.id)}
                          className="rounded p-1 text-app-muted hover:bg-red-50 hover:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={4 + DETAIL_COLUMNS[module].length + (showTrash ? 0 : 1) + (hasValor ? 1 : 0)} className="px-2 py-6 text-center text-app-muted">
                  {showTrash ? 'Lixeira vazia.' : 'Nenhum documento encontrado.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-app-muted">
            {data.total} documento(s) — página {data.page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {includeOpen && (
        <IncludeModal
          module={module}
          slug={String(slug)}
          exercicio={exercicio}
          orgaos={orgaos}
          docTypes={docTypes ?? []}
          onClose={() => setIncludeOpen(false)}
          onDone={invalidate}
        />
      )}
      {labelsOpen && (
        <LabelsImportModal
          slug={String(slug)}
          module={module}
          onClose={() => setLabelsOpen(false)}
          onDone={invalidate}
        />
      )}
      {confirmDeleteAll && (
        <Modal
          title="Apagar todas as etiquetas"
          subtitle={meta.title}
          open
          onClose={() => {
            setConfirmDeleteAll(false);
            setDeleteOrgaoId('');
            setDeleteSubtype('');
            setDeleteApenasSemArquivo(true);
          }}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-app-error-bg px-3 py-3 text-sm text-app-error-text">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Isso vai enviar para a lixeira as etiquetas de {meta.title.toLowerCase()}{' '}
                {deleteApenasSemArquivo ? 'que ainda estão aguardando arquivo ' : ''}
                (todos os exercícios){deleteOrgaoId && ' do órgão selecionado'}
                {deleteSubtype && ` do tipo ${SUBTYPE_LABEL[deleteSubtype] ?? deleteSubtype}`}.{' '}
                {deleteApenasSemArquivo
                  ? 'Documentos com PDF já anexado não são afetados.'
                  : 'Documentos com PDF já anexado também serão afetados.'}{' '}
                Deseja continuar?
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-app">
              <input
                type="checkbox"
                checked={deleteApenasSemArquivo}
                onChange={(e) => setDeleteApenasSemArquivo(e.target.checked)}
              />
              Apagar apenas as que não têm PDF
            </label>

            <div>
              <label className={labelCls} htmlFor="delete-etiquetas-orgao">Restringir a um órgão (opcional)</label>
              <select
                id="delete-etiquetas-orgao"
                className={inputCls}
                value={deleteOrgaoId}
                onChange={(e) => setDeleteOrgaoId(e.target.value)}
              >
                <option value="">Todos os órgãos</option>
                {orgaos.map((o) => (
                  <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
                ))}
              </select>
            </div>

            {(module === 'despesas' || module === 'receitas') && (
              <div>
                <label className={labelCls} htmlFor="delete-etiquetas-tipo">Restringir a um tipo (opcional)</label>
                <select
                  id="delete-etiquetas-tipo"
                  className={inputCls}
                  value={deleteSubtype}
                  onChange={(e) => setDeleteSubtype(e.target.value)}
                >
                  <option value="">Todos os tipos</option>
                  {subtypesFor(module).map((s) => (
                    <option key={s} value={s}>{SUBTYPE_LABEL[s] ?? s}</option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  setConfirmDeleteAll(false);
                  setDeleteOrgaoId('');
                  setDeleteSubtype('');
                  setDeleteApenasSemArquivo(true);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={() => deleteAllEtiquetas.mutate()}
                disabled={deleteAllEtiquetas.isPending}
              >
                {deleteAllEtiquetas.isPending ? 'Apagando…' : 'Apagar todas'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmEmptyTrash && (
        <Modal
          title="Esvaziar lixeira"
          subtitle={meta.title}
          open
          onClose={() => setConfirmEmptyTrash(false)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-app-error-bg px-3 py-3 text-sm text-app-error-text">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Isso vai excluir <strong>permanentemente</strong> todos os documentos de {meta.title.toLowerCase()}{' '}
                que estão na lixeira, incluindo os arquivos anexados. Essa ação não pode ser desfeita. Deseja continuar?
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setConfirmEmptyTrash(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={() => emptyTrash.mutate()}
                disabled={emptyTrash.isPending}
              >
                {emptyTrash.isPending ? 'Esvaziando…' : 'Esvaziar lixeira'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmBulkDelete && (
        <Modal
          title="Excluir selecionadas"
          subtitle={`${selected.size} documento(s)`}
          open
          onClose={() => setConfirmBulkDelete(false)}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-app-error-bg px-3 py-3 text-sm text-app-error-text">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Isso vai enviar <strong>{selected.size}</strong> documento(s) selecionado(s) para a lixeira. Deseja continuar?
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setConfirmBulkDelete(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={() => bulkDelete.mutate()}
                disabled={bulkDelete.isPending}
              >
                {bulkDelete.isPending ? 'Excluindo…' : 'Excluir selecionadas'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {attaching && (
        <AttachPdfModal
          slug={String(slug)}
          doc={attaching}
          onClose={() => setAttaching(null)}
          onDone={invalidate}
        />
      )}
      {viewPicker && (
        <Modal title="Qual arquivo deseja visualizar?" subtitle={`${viewPicker.arquivosExtras.length + 1} PDFs neste documento`} open onClose={() => setViewPicker(null)}>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                void openFile(viewPicker);
                setViewPicker(null);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-app-border bg-app-input-bg px-3 py-2 text-left text-sm text-app transition hover:bg-app-hover"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileConferenciaBadge
                  status={viewPicker.conferenciaStatus}
                  resultado={viewPicker.conferenciaResultado}
                  erro={viewPicker.conferenciaErro}
                />
                <span className="truncate">{viewPicker.originalName}</span>
              </span>
              <Eye className="h-3.5 w-3.5 shrink-0 text-app-muted" aria-hidden />
            </button>
            {viewPicker.arquivosExtras.map((extra) => (
              <button
                key={extra.id}
                type="button"
                onClick={() => {
                  void openFile(viewPicker, extra.id);
                  setViewPicker(null);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-app-border bg-app-input-bg px-3 py-2 text-left text-sm text-app transition hover:bg-app-hover"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileConferenciaBadge
                    status={extra.conferenciaStatus}
                    resultado={extra.conferenciaResultado}
                    erro={extra.conferenciaErro}
                  />
                  <span className="truncate">{extra.originalName}</span>
                </span>
                <Eye className="h-3.5 w-3.5 shrink-0 text-app-muted" aria-hidden />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {editing && (
        <EditModal
          slug={String(slug)}
          doc={editing}
          orgaos={orgaos}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}
      {analisando && (
        <Modal
          title="Analisando documentos por IA"
          subtitle={`${analisando.done}/${analisando.total} concluído(s)`}
          open
          onClose={() => void cancelarAnalise()}
        >
          <div className="space-y-4 text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-accent" aria-hidden />
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-app-skeleton">
              <div
                className="h-full rounded-full bg-gradient-primary transition-all"
                style={{ width: `${analisando.total > 0 ? (analisando.done / analisando.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-sm text-app-muted">
              {analisando.done === 0
                ? 'Calculando tempo estimado…'
                : `~${formatDuration(
                    ((Date.now() - analisando.startedAt) / analisando.done) * (analisando.total - analisando.done),
                  )} restante(s)`}
            </p>
            <button type="button" className={btnGhost} onClick={() => void cancelarAnalise()}>
              Cancelar
            </button>
          </div>
        </Modal>
      )}
      {resultadoProblemas && (
        <Modal
          title="Análise concluída com problemas"
          subtitle="A conferência por IA encontrou itens que precisam da sua atenção"
          open
          onClose={() => setResultadoProblemas(null)}
        >
          <div className="space-y-4 text-center">
            <TriangleAlert className="mx-auto h-12 w-12 text-orange-500" aria-hidden />
            <p className="text-2xl font-bold text-app">
              {resultadoProblemas.divergente + resultadoProblemas.falha} documento(s) com problema
            </p>
            <p className="text-sm text-app-muted">
              {resultadoProblemas.divergente > 0 && <>{resultadoProblemas.divergente} divergente(s)</>}
              {resultadoProblemas.divergente > 0 && resultadoProblemas.falha > 0 && ' · '}
              {resultadoProblemas.falha > 0 && <>{resultadoProblemas.falha} falharam na análise</>}
            </p>
            <button
              type="button"
              className="mx-auto flex items-center gap-2 rounded-lg bg-gradient-primary px-5 py-2.5 text-sm font-bold uppercase text-white transition hover:opacity-90 disabled:opacity-60"
              onClick={() => void abrirCriticas()}
              disabled={gerandoRelatorio}
            >
              <FileUp className="h-4 w-4 rotate-180" aria-hidden />
              {gerandoRelatorio ? 'Gerando PDF…' : 'Abrir Críticas (PDF)'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Modal de inclusao: campos por modulo + drag-and-drop de PDF + barra de progresso. */
function IncludeModal({
  module,
  slug,
  exercicio,
  orgaos,
  docTypes,
  onClose,
  onDone,
}: {
  module: DocModule;
  slug: string;
  exercicio: number;
  orgaos: Orgao[];
  docTypes: Lookup[];
  onClose: () => void;
  onDone: () => void;
}) {
  const meta = MODULE_TITLES[module];
  const [fields, setFields] = useState<Record<string, string>>({ module, exercicio: String(exercicio) });
  const [file, setFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [signingOpen, setSigningOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const acceptFile = (f: File) => {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Apenas arquivos PDF são aceitos');
      return;
    }
    setError(null);
    setFile(f);
    setFileId(crypto.randomUUID());
    setSigned(false);
  };

  const validation = useMemo(() => {
    const candidate: Record<string, unknown> = { ...fields };
    if (candidate.value === '' || candidate.value === undefined) delete candidate.value;
    if (!candidate.orgaoId) delete candidate.orgaoId;
    if (!candidate.historico) delete candidate.historico;
    if (!candidate.conta && module !== 'extrato') delete candidate.conta;
    return documentFieldsSchema.safeParse(candidate);
  }, [fields, module]);

  const submit = async () => {
    setError(null);
    if (!validation.success) {
      const first = validation.error.issues[0];
      setError(`${first?.path.join('.')}: ${first?.message}`);
      return;
    }
    // PDF e opcional: sem arquivo, o documento fica "aguardando arquivo" e o
    // PDF pode ser anexado depois (upload normal ou Pasta Monitorada).
    setProgress(0);
    const result = await uploadDocument(slug, fields, file, setProgress);
    if (result.ok) {
      onDone();
      onClose();
    } else {
      setProgress(null);
      setError(result.message);
    }
  };

  return (
    <Modal title={`Incluir ${meta.singular}`} subtitle={`Exercício ${exercicio}`} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {module === 'despesas' && (
            <>
              <Field label="Doc. Caixa *" id="docCaixa">
                <input id="docCaixa" className={inputCls} placeholder="ex.: 000123" onChange={set('docCaixa')} />
              </Field>
              <Field label="Empenho *" id="empenho">
                <input id="empenho" className={inputCls} placeholder="ex.: 2026NE00045" onChange={set('empenho')} />
              </Field>
              <div className="col-span-2">
                <Field label="Credor *" id="credor">
                  <input id="credor" className={inputCls} placeholder="Razão social do credor" onChange={set('credor')} />
                </Field>
              </div>
            </>
          )}

          {(module === 'despesas' || module === 'receitas') && (
            <Field label="Tipo *" id="subtype">
              <select id="subtype" className={inputCls} onChange={set('subtype')} defaultValue="">
                <option value="" disabled>Selecione…</option>
                {subtypesFor(module).map((s) => (
                  <option key={s} value={s}>{SUBTYPE_LABEL[s] ?? s}</option>
                ))}
              </select>
            </Field>
          )}

          {module === 'outros' && (
            <>
              <Field label="Tipo de Documento *" id="documentTypeId">
                <select id="documentTypeId" className={inputCls} onChange={set('documentTypeId')} defaultValue="">
                  <option value="" disabled>Selecione…</option>
                  {docTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.nome}</option>
                  ))}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Descrição *" id="descricao">
                  <input id="descricao" className={inputCls} placeholder="Descrição do documento" onChange={set('descricao')} />
                </Field>
              </div>
            </>
          )}

          {module === 'extrato' && (
            <>
              <Field label="Banco *" id="banco">
                <input id="banco" className={inputCls} placeholder="ex.: Banco do Brasil" onChange={set('banco')} />
              </Field>
              <Field label="Agência *" id="agencia">
                <input id="agencia" className={inputCls} placeholder="ex.: 1234-5" onChange={set('agencia')} />
              </Field>
              <Field label="Conta *" id="conta">
                <input id="conta" className={inputCls} placeholder="ex.: 98765-0" onChange={set('conta')} />
              </Field>
            </>
          )}

          {(module === 'balancete' || module === 'extrato') && (
            <Field label="Competência (mês) *" id="competencia">
              <input id="competencia" type="month" className={inputCls} onChange={set('competencia')} />
            </Field>
          )}

          <Field label="Órgão" id="orgaoId">
            <select id="orgaoId" className={inputCls} onChange={set('orgaoId')} defaultValue="">
              <option value="">— Sem vínculo —</option>
              {orgaos.map((o) => (
                <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
              ))}
            </select>
          </Field>

          {(module === 'despesas' || module === 'receitas' || module === 'outros' || module === 'extrato' || module === 'balancete') && (
            <Field label="Data do Documento *" id="documentDate">
              <input id="documentDate" type="date" className={inputCls} onChange={set('documentDate')} />
            </Field>
          )}

          {(module === 'despesas' || module === 'receitas') && (
            <Field label="Valor (R$)" id="value">
              <input id="value" type="number" step="0.01" min="0" className={inputCls} placeholder="0,00" onChange={set('value')} />
            </Field>
          )}

          {module === 'receitas' && (
            <Field label="Conta" id="conta-r">
              <input id="conta-r" className={inputCls} placeholder="Conta bancária (opcional)" onChange={set('conta')} />
            </Field>
          )}

          {(module === 'despesas' || module === 'receitas') && (
            <div className="col-span-2">
              <Field label="Histórico" id="historico">
                <textarea id="historico" rows={2} className={inputCls} placeholder="Descrição/histórico (opcional)" onChange={set('historico')} />
              </Field>
            </div>
          )}
        </div>

        {/* Drag-and-drop PDF */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Área de upload de PDF"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById('doc-file-input')?.click()}
          onKeyDown={(e) => e.key === 'Enter' && document.getElementById('doc-file-input')?.click()}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragOver ? 'border-accent bg-purple-50 dark:bg-purple-900/10' : 'border-app-border hover:border-app-muted'
          }`}
        >
          <FileUp className="h-8 w-8 text-app-muted" aria-hidden />
          {file ? (
            <p className="text-sm font-semibold text-app">
              {file.name} <span className="text-app-muted">({formatBytes(file.size)})</span>
            </p>
          ) : (
            <p className="text-sm text-app-muted">
              Arraste o PDF aqui ou <span className="font-semibold text-accent">clique para selecionar</span>{' '}
              <span className="text-app-muted">(opcional — pode anexar depois)</span>
            </p>
          )}
          <input
            id="doc-file-input"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f);
            }}
          />
        </div>

        {file && isDesktopApp() && (
          <div className="flex items-center gap-2">
            {signed ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600 dark:text-green-400">
                <FileSignature className="h-3.5 w-3.5" aria-hidden /> assinada com certificado ICP-Brasil
              </span>
            ) : (
              <button type="button" className={btnGhost} onClick={() => setSigningOpen(true)}>
                <FileSignature className="h-4 w-4" aria-hidden /> assinar com certificado
              </button>
            )}
          </div>
        )}

        {progress !== null && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-app-skeleton">
              <div className="h-full rounded-full bg-gradient-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-center text-[10px] text-app-muted">{progress}% enviado</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="button" className={btnPrimary} onClick={submit} disabled={progress !== null}>
            {progress !== null ? 'Enviando…' : 'Salvar documento'}
          </button>
        </div>
      </div>

      {signingOpen && file && fileId && (
        <DesktopSignModal
          fileId={fileId}
          file={file}
          onSigned={(bytes) => {
            setFile(new File([bytes as BlobPart], file.name, { type: 'application/pdf' }));
            setSigned(true);
          }}
          onClose={() => setSigningOpen(false)}
        />
      )}
    </Modal>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls} htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

/** Anexa o PDF a uma etiqueta (documento importado sem arquivo). */
function AttachPdfModal({
  slug,
  doc,
  onClose,
  onDone,
}: {
  slug: string;
  doc: DocumentView;
  onClose: () => void;
  onDone: () => void;
}) {
  const temArquivo = doc.status !== 'aguardando_arquivo';
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [extras, setExtras] = useState<DocumentFileView[]>(doc.arquivosExtras);
  const [extraProgress, setExtraProgress] = useState<number | null>(null);
  const [extraError, setExtraError] = useState<string | null>(null);
  const [removingExtraId, setRemovingExtraId] = useState<string | null>(null);

  /** Abre um arquivo especifico (principal se extraId for undefined) em nova guia. */
  const viewFile = async (extraId?: string) => {
    const win = window.open('', '_blank');
    try {
      const path = extraId
        ? `/t/${slug}/documents/${doc.id}/files/${extraId}/url`
        : `/t/${slug}/documents/${doc.id}/url`;
      const { url } = await api<{ url: string }>(path);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Erro ao abrir PDF');
    }
  };

  const removeCurrent = async () => {
    setError(null);
    setRemoving(true);
    try {
      await api(`/t/${slug}/documents/${doc.id}/file`, { method: 'DELETE' });
      onDone();
      onClose();
    } catch (e) {
      setRemoving(false);
      setError(e instanceof ApiError ? e.message : 'Erro ao excluir PDF');
    }
  };

  const acceptFile = (f: File) => {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Apenas arquivos PDF são aceitos');
      return;
    }
    setError(null);
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const submit = async () => {
    if (!file) {
      setError('Selecione o arquivo PDF');
      return;
    }
    setError(null);
    setProgress(0);
    const result = await attachDocumentFile(slug, doc.id, file, setProgress);
    if (result.ok) {
      onDone();
      onClose();
    } else {
      setProgress(null);
      setError(result.message);
    }
  };

  const addExtra = async (f: File) => {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setExtraError('Apenas arquivos PDF são aceitos');
      return;
    }
    setExtraError(null);
    setExtraProgress(0);
    const result = await addExtraDocumentFile(slug, doc.id, f, setExtraProgress);
    setExtraProgress(null);
    if (result.ok) {
      const updated = result.body as DocumentView;
      setExtras(updated.arquivosExtras);
      onDone();
    } else {
      setExtraError(result.message);
    }
  };

  const removeExtra = async (extraId: string) => {
    setExtraError(null);
    setRemovingExtraId(extraId);
    try {
      const updated = await api<DocumentView>(`/t/${slug}/documents/${doc.id}/files/${extraId}`, { method: 'DELETE' });
      setExtras(updated.arquivosExtras);
      onDone();
    } catch (e) {
      setExtraError(e instanceof ApiError ? e.message : 'Erro ao excluir arquivo');
    } finally {
      setRemovingExtraId(null);
    }
  };

  return (
    <Modal title={temArquivo ? 'Substituir PDF' : 'Anexar PDF'} subtitle={doc.originalName} open onClose={onClose}>
      <div className="space-y-4">
        {temArquivo && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase text-app-muted">Arquivos anexados</p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-app-border bg-app-input-bg px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                {doc.module === 'despesas' && (
                  <FileConferenciaBadge
                    status={doc.conferenciaStatus}
                    resultado={doc.conferenciaResultado}
                    erro={doc.conferenciaErro}
                  />
                )}
                <span className="truncate text-xs text-app">{doc.originalName}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  title="Visualizar"
                  onClick={() => void viewFile()}
                  className="rounded p-1 text-app-muted hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  title="Excluir PDF"
                  disabled={removing}
                  onClick={removeCurrent}
                  className="rounded p-1 text-app-muted hover:bg-red-50 hover:text-red-500 disabled:opacity-60 dark:hover:bg-red-900/20"
                >
                  {removing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              </span>
            </div>
            {extras.map((extra) => (
              <div
                key={extra.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-app-border bg-app-input-bg px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {doc.module === 'despesas' && (
                    <FileConferenciaBadge
                      status={extra.conferenciaStatus}
                      resultado={extra.conferenciaResultado}
                      erro={extra.conferenciaErro}
                    />
                  )}
                  <span className="truncate text-xs text-app">{extra.originalName}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    title="Visualizar"
                    onClick={() => void viewFile(extra.id)}
                    className="rounded p-1 text-app-muted hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    title="Excluir"
                    disabled={removingExtraId === extra.id}
                    onClick={() => void removeExtra(extra.id)}
                    className="rounded p-1 text-app-muted hover:bg-red-50 hover:text-red-500 disabled:opacity-60 dark:hover:bg-red-900/20"
                  >
                    {removingExtraId === extra.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                </span>
              </div>
            ))}
            <p className="text-xs text-app-muted">Selecionar um novo arquivo abaixo vai substituir o PDF principal.</p>
          </div>
        )}

        {temArquivo && (
          <div>
            <button
              type="button"
              onClick={() => document.getElementById('add-extra-file-input')?.click()}
              disabled={extraProgress !== null}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-app-border px-3 py-1.5 text-xs font-bold uppercase text-app-muted transition hover:border-accent hover:text-accent disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />{' '}
              {extraProgress !== null ? `Enviando… ${extraProgress}%` : 'Adicionar outro PDF'}
            </button>
            <input
              id="add-extra-file-input"
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addExtra(f);
                e.target.value = '';
              }}
            />
            {extraError && (
              <p role="alert" className="mt-2 rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">
                {extraError}
              </p>
            )}
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          aria-label="Área de upload de PDF"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById('attach-file-input')?.click()}
          onKeyDown={(e) => e.key === 'Enter' && document.getElementById('attach-file-input')?.click()}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragOver ? 'border-accent bg-purple-50 dark:bg-purple-900/10' : 'border-app-border hover:border-app-muted'
          }`}
        >
          <FileUp className="h-8 w-8 text-app-muted" aria-hidden />
          {file ? (
            <p className="text-sm font-semibold text-app">
              {file.name} <span className="text-app-muted">({formatBytes(file.size)})</span>
            </p>
          ) : (
            <p className="text-sm text-app-muted">
              Arraste o PDF aqui ou <span className="font-semibold text-accent">clique para selecionar</span>
            </p>
          )}
          <input
            id="attach-file-input"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) acceptFile(f);
            }}
          />
        </div>

        {progress !== null && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-app-skeleton">
              <div className="h-full rounded-full bg-gradient-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-center text-[10px] text-app-muted">{progress}% enviado</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="button" className={btnPrimary} onClick={submit} disabled={!file || progress !== null}>
            {progress !== null ? 'Enviando…' : temArquivo ? 'Substituir PDF' : 'Anexar PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Edicao de metadados (arquivo permanece o mesmo). */
function EditModal({
  slug,
  doc,
  orgaos,
  onClose,
  onDone,
}: {
  slug: string;
  doc: DocumentView;
  orgaos: Orgao[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setError(null);
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== '') body[k] = k === 'value' || k === 'exercicio' ? Number(v) : v;
    }
    try {
      await api(`/t/${slug}/documents/${doc.id}`, { method: 'PATCH', body });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Editar documento" subtitle={doc.originalName} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {doc.module === 'despesas' && (
            <>
              <Field label="Doc. Caixa" id="e-docCaixa">
                <input id="e-docCaixa" className={inputCls} defaultValue={doc.docCaixa ?? ''} onChange={set('docCaixa')} />
              </Field>
              <Field label="Empenho" id="e-empenho">
                <input id="e-empenho" className={inputCls} defaultValue={doc.empenho ?? ''} onChange={set('empenho')} />
              </Field>
              <div className="col-span-2">
                <Field label="Credor" id="e-credor">
                  <input id="e-credor" className={inputCls} defaultValue={doc.credor ?? ''} onChange={set('credor')} />
                </Field>
              </div>
            </>
          )}
          {(doc.module === 'despesas' || doc.module === 'receitas') && (
            <>
              <Field label="Valor (R$)" id="e-value">
                <input id="e-value" type="number" step="0.01" className={inputCls} defaultValue={doc.value ?? ''} onChange={set('value')} />
              </Field>
              <Field label="Data do Documento" id="e-date">
                <input id="e-date" type="date" className={inputCls} defaultValue={doc.documentDate ?? ''} onChange={set('documentDate')} />
              </Field>
              <div className="col-span-2">
                <Field label="Histórico" id="e-hist">
                  <textarea id="e-hist" rows={2} className={inputCls} defaultValue={doc.historico ?? ''} onChange={set('historico')} />
                </Field>
              </div>
            </>
          )}
          {doc.module === 'outros' && (
            <div className="col-span-2">
              <Field label="Descrição" id="e-desc">
                <input id="e-desc" className={inputCls} defaultValue={doc.descricao ?? ''} onChange={set('descricao')} />
              </Field>
            </div>
          )}
          {(doc.module === 'extrato' || doc.module === 'balancete') && (
            <Field label="Data do Documento" id="e-date-extrato">
              <input id="e-date-extrato" type="date" className={inputCls} defaultValue={doc.documentDate ?? ''} onChange={set('documentDate')} />
            </Field>
          )}
          {(doc.module === 'balancete' || doc.module === 'extrato') && (
            <Field label="Competência" id="e-comp">
              <input id="e-comp" type="month" className={inputCls} defaultValue={doc.competencia ?? ''} onChange={set('competencia')} />
            </Field>
          )}
          <Field label="Órgão" id="e-orgao">
            <select id="e-orgao" className={inputCls} defaultValue={doc.orgaoId ?? ''} onChange={set('orgaoId')}>
              <option value="">— Sem vínculo —</option>
              {orgaos.map((o) => (
                <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-app-error-bg px-3 py-2 text-xs text-app-error-text">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="button" className={btnPrimary} onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
