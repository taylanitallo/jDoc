'use client';

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CircleAlert,
  CircleCheck,
  Eye,
  FileText,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  ShieldCheck,
  Search,
  Sparkles,
  SlidersHorizontal,
  Tags,
  Trash2,
  TriangleAlert,
  X,
  CheckSquare,
  Layers,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Landmark,
  Library,
  MoreHorizontal,
  Scale,
  SearchX,
  Share2,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
  Lock,
} from 'lucide-react';
import {
  documentFieldsSchema,
  metadadosSchemaFor,
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
  type DocumentTypeLookup,
  type LocalFisicoView,
  type Metadados,
  type Orgao,
  caminhoLocal,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError, getAccessToken } from '@/lib/api';
import { imprimirPdf } from '@/lib/imprimir-pdf';
import { CompartilharModal } from './compartilhar-modal';
import { addExtraDocumentFile, attachDocumentFile, uploadDocument } from '@/lib/upload';
import { useExercicio } from '@/components/topbar';
import { LabelsImportModal } from '@/components/documents/labels-import-modal';
import { ClassificacaoFields } from '@/components/documents/classificacao-fields';
import { CAMPOS_CATALOGACAO, CatalogacaoFields } from '@/components/documents/catalogacao-fields';
import { DigitalizacaoFields, MetadadosFields } from '@/components/documents/metadados-fields';
import { GRAU_TOM, SigiloDocumento } from '@/components/documents/sigilo-documento';
import { FASE_LABEL, GRAU_SIGILO_LABEL, NIVEL_ACESSO_LABEL } from '@jdoc/shared';
import { useModulo } from '@/components/branding';
import { Badge, Button, DropdownMenu, buttonClasses, Modal, btnGhost, btnPrimary, cardCls, formatBytes, inputCls, labelCls, Pagination, TONE_VIVID, type Tone, SelectMenu } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/toast';
import { fmtDate } from '@/lib/format';

const MODULE_TITLES: Record<DocModule, { title: string; singular: string; description: string; icon: LucideIcon; tone: Tone }> = {
  receitas: { title: 'Receitas', singular: 'Receita', description: 'Receitas orçamentárias e extraorçamentárias do exercício', icon: TrendingUp, tone: 'success' },
  despesas: { title: 'Despesas', singular: 'Despesa', description: 'Empenhos, liquidações e pagamentos com o documento de caixa', icon: TrendingDown, tone: 'orange' },
  balancete: { title: 'Balancete orçamentário', singular: 'Balancete', description: 'Balancetes mensais do exercício', icon: Scale, tone: 'violet' },
  extrato: { title: 'Extrato de contas', singular: 'Extrato', description: 'Extratos bancários por conta e competência', icon: Landmark, tone: 'info' },
  outros: { title: 'Outros arquivos', singular: 'Documento', description: 'Documentos diversos organizados por tipo', icon: FolderOpen, tone: 'teal' },
  acervo: { title: 'Acervo', singular: 'Documento', description: 'Leis, decretos, portarias, contratos e demais documentos do Arquivo Municipal', icon: Library, tone: 'orange' },
};

/** Borda do card no celular, na cor do modulo. */
const BORDA_MODULO: Record<Tone, string> = {
  brand: 'border-l-brand-500', success: 'border-l-success-500', warning: 'border-l-warning-500', danger: 'border-l-danger-500',
  info: 'border-l-info-500', orange: 'border-l-orange-500', violet: 'border-l-violet-500', teal: 'border-l-teal-500',
  pink: 'border-l-pink-500', neutral: 'border-l-ink-400',
};

interface Lookup {
  id: string;
  nome: string;
  codigo?: string | null;
  cor?: string;
  /** Tipos do Acervo: campos de metadados + padroes (vem de /document-types?modulo=acervo). */
  campos?: DocumentTypeLookup['campos'];
  classificacaoId?: string | null;
  nivelAcessoPadrao?: DocumentTypeLookup['nivelAcessoPadrao'];
}

/** Titulo curto de um documento do Acervo: "Lei Municipal nº 1.234" quando o tipo tem campo numero. */
function acervoTitulo(d: DocumentView): string {
  const numero = d.metadados?.numero;
  return numero ? `${d.documentTypeNome ?? 'Documento'} nº ${numero}` : (d.documentTypeNome ?? '—');
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

/**
 * input[type=number] muda de valor com o scroll do mouse quando o campo esta
 * focado (comportamento nativo do Chrome) — silenciosamente decrementa/
 * incrementa pelo `step` sem o usuario perceber (ex: digitou 50000, rolou a
 * pagina, virou 49999.98). Tira o foco do campo ao rolar pra evitar isso.
 */
function blurOnWheel(e: WheelEvent<HTMLInputElement>): void {
  e.currentTarget.blur();
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
            className="pointer-events-none fixed z-[100] max-h-[80vh] overflow-y-auto rounded-[10px] border border-ink-200 bg-surface p-3 text-left text-xs text-ink-800 shadow-2xl"
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
 * "carregando", convidando a usar o botão "Analisar documento (IA)". Sem arquivo
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
    const iconColor = status === 'divergente' ? 'text-orange-500' : 'text-danger-500';
    const ariaLabel = status === 'divergente' ? 'Conferência por IA: divergência encontrada' : 'Conferência por IA: falhou';

    let tooltip: ReactNode;
    if (totalArquivos > 1) {
      // Mais de um PDF anexado: em vez de mostrar so o pior veredito (escondendo
      // os outros), manda clicar na linha — o modal ja lista cada arquivo com
      // seu proprio triangulo/erro individual.
      tooltip = (
        <p>
          Mais de um arquivo anexado com problema.{' '}
          <span className="font-semibold text-brand-500">Clique para ver detalhado.</span>
        </p>
      );
    } else if (status === 'divergente') {
      const divergencias = resultado?.divergencias ?? [];
      tooltip = (
        <div className="space-y-1">
          {resultado?.resumo && <p className="text-ink-500">{resultado.resumo}</p>}
          {divergencias.map((d, i) => (
            <p key={i}>
              <span className="font-semibold text-brand-500">{d.campo}</span>: esperado &quot;
              {d.esperado ?? '—'}&quot;, encontrado &quot;{d.encontrado ?? '—'}&quot;
            </p>
          ))}
        </div>
      );
    } else {
      tooltip = <p>{erro ? erroIaLegivel(erro) : 'Falha ao analisar — clique em "Analisar documento (IA)" para tentar de novo'}</p>;
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
          className="mx-auto h-4 w-4 text-success-600"
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
            : 'Ainda não analisado — selecione e clique em "Analisar documento (IA)"'
        }
      >
        <Loader2
          className="mx-auto h-4 w-4 animate-spin text-ink-500"
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
    const iconColor = status === 'divergente' ? 'text-orange-500' : 'text-danger-500';
    const divergencias = resultado?.divergencias ?? [];
    const tooltip =
      status === 'divergente' ? (
        <div className="space-y-1">
          {resultado?.resumo && <p className="text-ink-500">{resultado.resumo}</p>}
          {divergencias.map((d, i) => (
            <p key={i}>
              <span className="font-semibold text-brand-500">{d.campo}</span>: esperado &quot;
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
        <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden />
      </span>
    );
  }
  if (status === 'pendente') {
    return (
      <span title="Analisando por IA…">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-500" aria-hidden />
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
/** Erros gravados antes da correcao vinham com o JSON cru do provedor de IA. */
function erroIaLegivel(erro: string): string {
  if (/"code"\s*:\s*(429|5\d\d)|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(erro)) {
    return 'O serviço de IA estava sobrecarregado. Clique em "Analisar documento (IA)" para tentar de novo.';
  }
  return erro.trim().startsWith('{') ? 'Falha ao analisar — clique em "Analisar documento (IA)" para tentar de novo.' : erro;
}

/** Tipos documentais normativos: ganham o botao "Texto compilado". */
function tipoNormativo(nome: string | null | undefined): boolean {
  return /\b(lei|decreto|portaria|resolu|emenda)/i.test(nome ?? '');
}
function ehNormativo(d: DocumentView): boolean {
  return tipoNormativo(d.documentTypeNome);
}

const FASE_TOM_DOC: Partial<Record<DocumentView['fase'], 'info' | 'warning' | 'violet' | 'neutral'>> = {
  corrente: 'info',
  intermediaria: 'warning',
  permanente: 'violet',
  eliminado: 'neutral',
};

const DETAIL_COLUMNS: Record<
  DocModule,
  // render: texto (tambem vira o title da celula); cell: conteudo visual opcional (badges).
  Array<{ header: string; render: (d: DocumentView) => string; cell?: (d: DocumentView) => ReactNode; className?: string }>
> = {
  despesas: [
    { header: 'Doc. Caixa', render: (d) => d.docCaixa ?? '—', className: 'w-28 tabular-nums' },
    { header: 'Empenho', render: (d) => d.empenho ?? '—', className: 'w-24 tabular-nums' },
    { header: 'Órgão', render: orgaoLabel, className: 'w-32' },
    { header: 'Credor', render: (d) => d.credor ?? '—' },
    { header: 'Tipo', render: (d) => (d.subtype ? SUBTYPE_SHORT[d.subtype] ?? d.subtype : '—'), className: 'w-10 text-center' },
  ],
  receitas: [
    { header: 'Título/Descrição', render: (d) => d.historico ?? '—', className: 'w-[24%]' },
    { header: 'Órgão', render: orgaoLabel, className: 'w-[24%]' },
    { header: 'Tipo', render: (d) => (d.subtype ? SUBTYPE_LABEL[d.subtype] ?? d.subtype : '—'), className: 'w-[18%]' },
    { header: 'Conta', render: (d) => d.conta ?? '—', className: 'w-[14%]' },
  ],
  balancete: [
    { header: 'Título/Descrição', render: (d) => d.descricao ?? '—', className: 'w-[30%]' },
    { header: 'Órgão', render: orgaoLabel, className: 'w-[34%]' },
    { header: 'Competência', render: (d) => formatCompetencia(d.competencia), className: 'w-[16%]' },
  ],
  extrato: [
    { header: 'Título/Descrição', render: (d) => d.descricao ?? '—', className: 'w-[18%]' },
    { header: 'Órgão', render: orgaoLabel, className: 'w-[16%]' },
    { header: 'Banco', render: (d) => d.banco ?? '—', className: 'w-[16%]' },
    { header: 'Agência', render: (d) => d.agencia ?? '—', className: 'w-[10%]' },
    { header: 'Conta', render: (d) => d.conta ?? '—', className: 'w-[12%]' },
    { header: 'Competência', render: (d) => formatCompetencia(d.competencia), className: 'w-[12%]' },
  ],
  outros: [
    { header: 'Título/Descrição', render: (d) => d.descricao ?? '—', className: 'w-[32%]' },
    { header: 'Órgão', render: orgaoLabel, className: 'w-[25%]' },
    { header: 'Tipo', render: (d) => d.documentTypeNome ?? '—', className: 'w-[18%]' },
  ],
  acervo: [
    {
      header: 'Documento',
      render: acervoTitulo,
      cell: (d) => (
        <>
          <span className="block truncate font-semibold text-ink-900">{acervoTitulo(d)}</span>
          {d.normaId && (
            <Badge tone="brand" className="mt-1 flex w-fit">
              Legislação
            </Badge>
          )}
        </>
      ),
      className: 'w-[16%]',
    },
    { header: 'Título/Descrição', render: (d) => d.descricao ?? '—', className: 'w-[19%]' },
    {
      header: 'Classe',
      render: (d) => (d.classificacaoCodigo ? `${d.classificacaoCodigo} — ${d.classificacaoDescricao ?? ''}` : 'Sem classe'),
      cell: (d) =>
        d.classificacaoCodigo ? (
          <span className="rounded-[6px] bg-ink-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-ink-700">{d.classificacaoCodigo}</span>
        ) : (
          <span className="text-xs text-ink-400">—</span>
        ),
      className: 'w-[7%]',
    },
    {
      header: 'Fase',
      render: (d) => FASE_LABEL[d.fase] ?? d.fase,
      cell: (d) => <Badge tone={FASE_TOM_DOC[d.fase] ?? 'neutral'}>{FASE_LABEL[d.fase] ?? d.fase}</Badge>,
      className: 'w-[12%]',
    },
    {
      header: 'Acesso',
      render: (d) => NIVEL_ACESSO_LABEL[d.nivelEfetivo ?? d.nivelAcesso],
      cell: (d) =>
        d.nivelEfetivo === 'sigiloso' ? (
          <Badge tone="violet">
            <Lock className="mr-1 inline h-3 w-3" aria-hidden />
            Sigiloso
          </Badge>
        ) : d.nivelAcesso === 'restrito' ? (
          <Badge tone="danger">
            <Lock className="mr-1 inline h-3 w-3" aria-hidden />
            Restrito
          </Badge>
        ) : (
          <Badge tone="success">Público</Badge>
        ),
      className: 'w-[11%]',
    },
  ],
};

/**
 * Largura minima da tabela por modulo — com table-fixed + w-full, o navegador
 * espreme TODAS as colunas pra caber na tela quando ela e mais estreita que a
 * soma das larguras das colunas, fazendo o texto dos cabecalhos vazar por cima
 * um do outro. Um min-width forca a tabela a ficar mais larga que a tela
 * quando necessario, deixando o overflow-x-auto do container rolar em vez de
 * espremer.
 */
const MIN_TABLE_WIDTH: Record<DocModule, number> = {
  despesas: 980,
  receitas: 760,
  balancete: 680,
  extrato: 820,
  outros: 620,
  acervo: 1040,
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
  // Busca avancada pelos metadados padrao (numero, assunto, interessado, palavra-chave, LGPD, nivel).
  const [buscaMeta, setBuscaMeta] = useState<Record<string, string>>({});
  const setMeta = (k: string, v: string) => {
    setBuscaMeta((m) => ({ ...m, [k]: v }));
    setPage(1);
  };
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
  const [compartilhando, setCompartilhando] = useState<DocumentView | null>(null);
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
  const [exercicioAcervo, setExercicioAcervo] = useState('');
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  // Lock sincrono (nao sujeito ao atraso de re-render do useState) contra
  // duplo-clique — evita a analise disparar duas vezes e toasts duplicados.
  const analisandoRef = useRef(false);
  // Idem, checado dentro do loop de polling pra parar assim que o usuario
  // clicar em "Cancelar" (useState sozinho teria o mesmo atraso de re-render).
  const cancelarRef = useRef(false);

  const params = new URLSearchParams({ module, page: String(page), pageSize: '20' });
  // Acervo e historico (leis de 1950, fichas antigas): nao segue o ano do topo; filtro de exercicio proprio e opcional.
  const ehAcervo = module === 'acervo';
  if (!showTrash) {
    if (!ehAcervo) params.set('exercicio', String(exercicio));
    else if (exercicioAcervo) params.set('exercicio', exercicioAcervo);
    if (q) params.set('q', q);
    if (subtype) params.set('subtype', subtype);
    if (orgaoId) params.set('orgaoId', orgaoId);
    if (module === 'balancete' || module === 'extrato') {
      if (mes) params.set('competencia', `${exercicio}-${mes}`);
    }
    if (dataInicio || dataFim) {
      if (dataInicio) params.set('de', dataInicio);
      if (dataFim) params.set('ate', dataFim);
    } else if (!ehAcervo && module !== 'extrato' && module !== 'balancete' && mes) {
      const lastDay = new Date(exercicio, Number(mes), 0).getDate();
      params.set('de', `${exercicio}-${mes}-01`);
      params.set('ate', `${exercicio}-${mes}-${String(lastDay).padStart(2, '0')}`);
    }
    if (valorMin) params.set('valorMin', valorMin);
    if (valorMax) params.set('valorMax', valorMax);
    if (comArquivo) params.set('comArquivo', comArquivo);
    if (module === 'despesas' && critica) params.set('critica', critica);
    for (const [k, v] of Object.entries(buscaMeta)) if (v.trim()) params.set(k, v.trim());
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
      buscaMeta,
      page,
      ehAcervo ? exercicioAcervo : exercicio,
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
    queryKey: ['document-types', slug, module],
    queryFn: () => api<Lookup[]>(`/t/${slug}/document-types?modulo=${module === 'acervo' ? 'acervo' : 'outros'}`),
    enabled: module === 'outros' || module === 'acervo',
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

  const imprimirDocumento = async (doc: DocumentView) => {
    try {
      const { url } = await api<{ url: string }>(`/t/${slug}/documents/${doc.id}/url`);
      await imprimirPdf(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao imprimir o PDF');
    }
  };

  /** Compartilhar e imprimir: um botao so, para nao alargar a coluna de acoes. */
  const maisAcoes = (d: DocumentView) => (
    <DropdownMenu
      items={[
        { label: 'Compartilhar', icon: Share2, onSelect: () => setCompartilhando(d) },
        { label: 'Imprimir', icon: Printer, onSelect: () => void imprimirDocumento(d) },
      ]}
      trigger={({ aberto, alternar }) => (
        <button
          type="button"
          title="Compartilhar ou imprimir"
          aria-label="Compartilhar ou imprimir"
          aria-haspopup="menu"
          aria-expanded={aberto}
          onClick={alternar}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      )}
    />
  );

  /** Se o documento tem so um PDF, abre direto; se tem mais de um, pergunta qual. */
  const openPdf = (doc: DocumentView) => {
    if (doc.arquivosExtras.length === 0) {
      void openFile(doc);
      return;
    }
    setViewPicker(doc);
  };

  const hasValor = module === 'despesas' || module === 'receitas';
  const filtrosAtivos =
    [subtype, orgaoId, mes, dataInicio, dataFim, valorMin, valorMax, comArquivo, critica, exercicioAcervo].filter(Boolean).length +
    Object.values(buscaMeta).filter((v) => v.trim()).length;
  const limparFiltros = () => {
    setBuscaMeta({});
    setSubtype('');
    setOrgaoId('');
    setMes('');
    setDataInicio('');
    setDataFim('');
    setValorMin('');
    setValorMax('');
    setComArquivo('');
    setCritica('');
    setExercicioAcervo('');
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID[meta.tone].chip)}>
            <meta.icon className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">{meta.title}</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              {showTrash ? `Documentos excluídos ficam aqui por ${TRASH_RETENTION_DAYS} dias antes de sumirem de vez.` : meta.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showTrash ? (
            <Button variant="danger" leftIcon={<Trash2 aria-hidden />} onClick={() => setConfirmEmptyTrash(true)}>
              Esvaziar lixeira
            </Button>
          ) : (
            <>
              {module !== 'acervo' && (
              <DropdownMenu
                trigger={({ aberto, alternar }) => (
                  <Button variant="outline" onClick={alternar} aria-expanded={aberto} aria-haspopup="menu">
                    <MoreHorizontal aria-hidden />
                    Mais ações
                    <ChevronDown className={cn('transition-transform', aberto && 'rotate-180')} aria-hidden />
                  </Button>
                )}
                items={[
                  { label: 'Importar etiquetas', icon: Tags, hint: 'Planilha do SS, ASPEC ou JBS', onSelect: () => setLabelsOpen(true) },
                  {
                    label: imprimindo ? 'Gerando etiquetas…' : 'Imprimir etiquetas',
                    icon: Printer,
                    hint: 'PDF com o que está na tela (respeita os filtros)',
                    disabled: imprimindo,
                    onSelect: () => void imprimirEtiquetas(),
                  },
                  { label: 'Apagar etiquetas', icon: Trash2, hint: 'Remove as etiquetas ainda sem PDF', danger: true, onSelect: () => setConfirmDeleteAll(true) },
                ]}
              />
              )}
              {module === 'despesas' && (
                <Button
                  variant="outline"
                  className="border-violet-500/40 text-violet-600 hover:bg-violet-50 hover:text-violet-600"
                  onClick={() => void analisarConferencia()}
                  loading={analisando !== null}
                  leftIcon={<Sparkles aria-hidden />}
                  title="A IA confere se o PDF anexado bate com os dados cadastrados (consome tokens). Selecione os documentos na tabela antes."
                >
                  {analisando ? 'Analisando…' : 'Analisar com IA'}
                </Button>
              )}
              {module === 'acervo' && (
                <Link href={`/${slug}/acervo/lote`} className={buttonClasses('outline', 'md')}>
                  <Layers aria-hidden />
                  Enviar em lote
                </Link>
              )}
              <Button onClick={() => setIncludeOpen(true)} leftIcon={<Plus aria-hidden />}>
                Incluir {meta.singular.toLowerCase()}
              </Button>
            </>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Visão" className="inline-flex rounded-[12px] bg-ink-100 p-1">
        {[
          { id: false, label: 'Documentos', icon: FileText },
          { id: true, label: 'Lixeira', icon: Trash2 },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={showTrash === id}
            onClick={() => {
              setShowTrash(id);
              setSelected(new Set());
              setPage(1);
            }}
            className={cn(
              'flex h-9 items-center gap-2 rounded-[8px] px-4 text-sm font-semibold transition-colors',
              showTrash === id ? 'bg-surface text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {!showTrash && (
        <div className={`${cardCls} p-4`}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <input
                aria-label="Buscar"
                type="search"
                className={cn(inputCls, 'h-10 py-0 pl-9')}
                placeholder={module === 'despesas' ? 'Buscar por credor, histórico, empenho, doc. caixa…' : 'Buscar por descrição, histórico, número…'}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={filtersOpen || filtrosAtivos > 0 ? 'secondary' : 'outline'}
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}
                leftIcon={<SlidersHorizontal aria-hidden />}
                className="flex-1 sm:flex-none"
              >
                Filtros
                {filtrosAtivos > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                    {filtrosAtivos}
                  </span>
                )}
              </Button>
              {filtrosAtivos > 0 && (
                <Button variant="ghost" onClick={limparFiltros} leftIcon={<X aria-hidden />}>
                  Limpar
                </Button>
              )}
            </div>
          </div>

          {filtersOpen && (
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-ink-100 pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {(module === 'receitas' || module === 'despesas') && (
                <FiltroCampo label="Tipo" id="f-tipo">
                  <SelectMenu id="f-tipo" className={inputCls} value={subtype} onChange={(e) => { setSubtype(e.target.value); setPage(1); }}>
                    <option value="">Todos os tipos</option>
                    {subtypesFor(module).map((st) => (
                      <option key={st} value={st}>{SUBTYPE_LABEL[st] ?? st}</option>
                    ))}
                  </SelectMenu>
                </FiltroCampo>
              )}
              <FiltroCampo label="Órgão" id="f-orgao">
                <SelectMenu id="f-orgao" className={inputCls} value={orgaoId} onChange={(e) => { setOrgaoId(e.target.value); setPage(1); }}>
                  <option value="">Todos os órgãos</option>
                  {orgaos.map((o) => (
                    <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
                  ))}
                </SelectMenu>
              </FiltroCampo>
              {module === 'acervo' ? (
                <FiltroCampo label="Exercício" id="f-exercicio">
                  <input
                    id="f-exercicio"
                    type="number"
                    inputMode="numeric"
                    min={1800}
                    max={2100}
                    placeholder="Todos os anos"
                    className={inputCls}
                    value={exercicioAcervo}
                    onChange={(e) => {
                      setExercicioAcervo(e.target.value);
                      setPage(1);
                    }}
                  />
                </FiltroCampo>
              ) : (
              <FiltroCampo label="Mês" id="f-mes">
                <SelectMenu id="f-mes" className={inputCls} value={mes} onChange={(e) => { setMes(e.target.value); setPage(1); }}>
                  <option value="">Todos os meses</option>
                  {MESES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </SelectMenu>
              </FiltroCampo>
              )}
              <FiltroCampo label="Arquivo PDF" id="f-pdf">
                <SelectMenu id="f-pdf" className={inputCls} value={comArquivo} onChange={(e) => { setComArquivo(e.target.value); setPage(1); }}>
                  <option value="">Com e sem PDF</option>
                  <option value="sim">Com PDF</option>
                  <option value="nao">Sem PDF (aguardando)</option>
                </SelectMenu>
              </FiltroCampo>
              <FiltroCampo label="Data inicial" id="f-ini">
                <input id="f-ini" type="date" className={inputCls} value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setPage(1); }} />
              </FiltroCampo>
              <FiltroCampo label="Data final" id="f-fim">
                <input id="f-fim" type="date" className={inputCls} value={dataFim} onChange={(e) => { setDataFim(e.target.value); setPage(1); }} />
              </FiltroCampo>
              {(module === 'despesas' || module === 'receitas') && (
                <>
                  <FiltroCampo label="Valor mínimo (R$)" id="f-vmin">
                    <input id="f-vmin" type="number" step="0.01" min="0" placeholder="0,00" className={inputCls} value={valorMin} onWheel={blurOnWheel} onChange={(e) => { setValorMin(e.target.value); setPage(1); }} />
                  </FiltroCampo>
                  <FiltroCampo label="Valor máximo (R$)" id="f-vmax">
                    <input id="f-vmax" type="number" step="0.01" min="0" placeholder="0,00" className={inputCls} value={valorMax} onWheel={blurOnWheel} onChange={(e) => { setValorMax(e.target.value); setPage(1); }} />
                  </FiltroCampo>
                </>
              )}
              {module === 'despesas' && (
                <FiltroCampo label="Crítica" id="f-critica">
                  <SelectMenu id="f-critica" className={inputCls} value={critica} onChange={(e) => { setCritica(e.target.value); setPage(1); }}>
                    <option value="">Com e sem crítica</option>
                    <option value="sim">Com crítica</option>
                    <option value="nao">Sem crítica</option>
                  </SelectMenu>
                </FiltroCampo>
              )}
              <FiltroCampo label="Número" id="f-numero">
                <input id="f-numero" className={inputCls} placeholder="ex.: 123/2026" value={buscaMeta.numero ?? ''} onChange={(e) => setMeta('numero', e.target.value)} />
              </FiltroCampo>
              <FiltroCampo label="Assunto" id="f-assunto">
                <input id="f-assunto" className={inputCls} placeholder="Parte do assunto" value={buscaMeta.assunto ?? ''} onChange={(e) => setMeta('assunto', e.target.value)} />
              </FiltroCampo>
              <FiltroCampo label="Interessado" id="f-interessado">
                <input id="f-interessado" className={inputCls} placeholder="Nome ou setor" value={buscaMeta.interessado ?? ''} onChange={(e) => setMeta('interessado', e.target.value)} />
              </FiltroCampo>
              <FiltroCampo label="Palavra-chave" id="f-palavra">
                <input id="f-palavra" className={inputCls} placeholder="Uma palavra-chave" value={buscaMeta.palavraChave ?? ''} onChange={(e) => setMeta('palavraChave', e.target.value)} />
              </FiltroCampo>
              <FiltroCampo label="Nível de acesso" id="f-nivel">
                <SelectMenu id="f-nivel" className={inputCls} value={buscaMeta.nivel ?? ''} onChange={(e) => setMeta('nivel', e.target.value)}>
                  <option value="">Todos</option>
                  <option value="publico">Público</option>
                  <option value="restrito">Restrito</option>
                  <option value="sigiloso">Sigiloso</option>
                </SelectMenu>
              </FiltroCampo>
              <FiltroCampo label="Dados pessoais (LGPD)" id="f-lgpd">
                <SelectMenu id="f-lgpd" className={inputCls} value={buscaMeta.dadosPessoais ?? ''} onChange={(e) => setMeta('dadosPessoais', e.target.value)}>
                  <option value="">Com e sem</option>
                  <option value="sim">Com dados pessoais</option>
                  <option value="sensiveis">Com dados sensíveis</option>
                  <option value="nao">Sem dados pessoais</option>
                </SelectMenu>
              </FiltroCampo>
            </div>
          )}
        </div>
      )}

      {!showTrash && selected.size > 0 && (
        <div className="flex animate-fade-in flex-wrap items-center justify-between gap-3 rounded-[12px] border border-brand-500/30 bg-brand-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-600">
            <CheckSquare className="h-4 w-4" aria-hidden />
            {selected.size} {selected.size === 1 ? 'documento selecionado' : 'documentos selecionados'}
          </p>
          <div className="flex flex-wrap gap-2">
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
              className="shrink-0 whitespace-nowrap rounded-[10px] border border-danger-500/30 bg-surface px-4 py-2 text-[13px] font-semibold text-danger-500 transition hover:bg-danger-50"
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
        <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
          {error}
        </p>
      )}

      {/* Tablet/desktop: tabela completa com scroll horizontal. */}
      <div className={`${cardCls} hidden overflow-x-auto md:block`}>
        <table className="w-full table-fixed text-left text-[13px]" style={{ minWidth: MIN_TABLE_WIDTH[module] }}>
          <thead className="bg-ink-50/60">
            <tr className="label-caps border-b border-ink-200">
              {!showTrash && (
                <th className="w-8 px-3 py-3">
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
              <th className="w-24 whitespace-nowrap px-3 py-3">Data</th>
              {DETAIL_COLUMNS[module].map((col) => (
                <th key={col.header} className={`whitespace-nowrap px-3 py-3 ${col.className ?? ''}`}>{col.header}</th>
              ))}
              {hasValor && <th className="w-28 whitespace-nowrap px-3 py-3 text-right">Valor</th>}
              <th className="w-20 whitespace-nowrap px-3 py-3 text-right">Páginas</th>
              <th className="w-8 px-1 py-3" title="Conferência por IA" aria-label="Conferência por IA" />
              <th className="w-28 whitespace-nowrap py-3 pl-2 pr-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4 + DETAIL_COLUMNS[module].length + (showTrash ? 0 : 1) + (hasValor ? 1 : 0)} className="px-3 py-3">
                  <div className="space-y-3 py-2">
                    {[0, 1, 2, 3, 4].map((k) => (
                      <div key={k} className="h-5 animate-pulse rounded-[6px] bg-ink-100" />
                    ))}
                  </div>
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
                className={`border-b border-ink-100 transition-colors last:border-0 hover:bg-brand-50/50 ${clickable ? 'cursor-pointer' : ''}`}
              >
                {!showTrash && (
                  <td className="w-8 px-3 py-3" onClick={(e) => e.stopPropagation()}>
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
                <td className="w-24 whitespace-nowrap px-3 py-3 tabular-nums text-ink-800">
                  {d.documentDate ? fmtDate(d.documentDate) : '—'}
                  {d.grauSigilo && (
                    <Badge tone={GRAU_TOM[d.grauSigilo]} className="mt-1 flex w-fit">
                      {GRAU_SIGILO_LABEL[d.grauSigilo]}
                    </Badge>
                  )}
                </td>
                {DETAIL_COLUMNS[module].map((col) => (
                  <td
                    key={col.header}
                    title={col.render(d)}
                    className={`${col.cell ? 'overflow-hidden whitespace-nowrap' : 'break-words'} px-3 py-3 align-middle text-ink-800 ${col.className ?? ''}`}
                  >
                    {/* Texto longo quebra em ate 2 linhas em vez de sumir com "..." (o title mostra tudo). */}
                    {col.cell ? col.cell(d) : <span className="line-clamp-2">{col.render(d)}</span>}
                  </td>
                ))}
                {hasValor && (
                  <td className="w-28 whitespace-nowrap tabular-nums px-3 py-3 text-right text-ink-800">
                    {d.value !== null
                      ? d.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                      : '—'}
                  </td>
                )}
                <td className="w-20 whitespace-nowrap px-3 py-3 text-right text-ink-800 tabular-nums">
                  {semArquivo ? <Badge tone="warning">Sem PDF</Badge> : (d.pageCount ?? '—')}
                </td>
                <td className="w-8 px-1 py-3 text-center">
                  <ConferenciaBadge documento={d} />
                </td>
                <td className="w-36 py-2 pl-2 pr-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    {showTrash ? (
                      <button
                        type="button"
                        title="Restaurar"
                        onClick={() => restore.mutate(d.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-success-50 hover:text-success-600"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden />
                      </button>
                    ) : (
                      <>
                        {!semArquivo && (
                          <button
                            type="button"
                            title="Visualizar PDF (nova guia)"
                            onClick={() => openPdf(d)}
                            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                          </button>
                        )}
                        {!semArquivo && maisAcoes(d)}
                        {module === 'acervo' && ehNormativo(d) && (
                          <Link
                            href={`/${slug}/normas/documento/${d.id}`}
                            title={d.normaId ? 'Abrir em Legislação' : 'Texto compilado (legislação)'}
                            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                          >
                            <Scale className="h-4 w-4" aria-hidden />
                          </Link>
                        )}
                        <button
                          type="button"
                          title="Editar"
                          onClick={() => setEditing(d)}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          title="Excluir (lixeira)"
                          onClick={() => del.mutate(d.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-600"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
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
                <td colSpan={4 + DETAIL_COLUMNS[module].length + (showTrash ? 0 : 1) + (hasValor ? 1 : 0)} className="px-3 py-12 text-center">
                  <ListaVazia lixeira={showTrash} filtrando={filtrosAtivos > 0 || q !== ''} onIncluir={() => setIncludeOpen(true)} singular={meta.singular} arquivo={module === 'acervo'} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Celular: lista de cards (sem scroll horizontal, nada de informacao cortada). */}
      <div className="space-y-3 md:hidden">
        {isLoading && <div className="h-24 animate-pulse rounded-[16px] bg-ink-100" />}
        {data?.items.map((d) => {
          const semArquivo = d.status === 'aguardando_arquivo';
          const clickable = !showTrash;
          // Receitas usa "Historico" como titulo/descricao; os demais usam "Descricao".
          const descricaoValue = module === 'receitas' ? d.historico : d.descricao;
          const titulo = d.docCaixa
            ? `Doc. Caixa: ${d.docCaixa}`
            : descricaoValue || MODULE_TITLES[module].singular;
          return (
            <div
              key={d.id}
              onClick={clickable ? () => setAttaching(d) : undefined}
              className={`${cardCls} flex gap-3 border-l-4 ${BORDA_MODULO[meta.tone]} p-4 ${clickable ? 'cursor-pointer active:bg-ink-50' : ''}`}
            >
              {!showTrash && (
                <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
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
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-bold text-ink-800">{titulo}</p>
                  <ConferenciaBadge documento={d} />
                </div>
                <dl className="mt-1.5 space-y-1 text-xs">
                  {DETAIL_COLUMNS[module]
                    // "Doc. Caixa" ou "Titulo/Descricao" ja aparecem no titulo do card quando existem — nao repete.
                    .filter(
                      (col) =>
                        !(col.header === 'Doc. Caixa' && d.docCaixa) &&
                        !(col.header === 'Título/Descrição' && !d.docCaixa && descricaoValue),
                    )
                    .map((col) => (
                      <div key={col.header} className="flex gap-1.5">
                        <dt className="shrink-0 font-semibold text-ink-500">{col.header}:</dt>
                        <dd className="truncate text-ink-800">{col.render(d)}</dd>
                      </div>
                    ))}
                  {hasValor && (
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 font-semibold text-ink-500">Valor:</dt>
                      <dd className="text-ink-800">
                        {d.value !== null
                          ? d.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                          : '—'}
                      </dd>
                    </div>
                  )}
                </dl>
                {semArquivo && !showTrash && <Badge tone="warning" className="mt-2">Sem PDF — toque para anexar</Badge>}
                <div className="mt-2 flex items-center justify-between border-t border-ink-100 pt-2">
                  <span className="flex items-center gap-1 text-[11px] text-ink-500">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {d.documentDate ? fmtDate(d.documentDate) : '—'}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-[11px] text-ink-500">
                      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {d.pageCount ?? '—'}
                    </span>
                    <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {showTrash ? (
                        <button
                          type="button"
                          title="Restaurar"
                          onClick={() => restore.mutate(d.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-success-50 hover:text-success-600"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden />
                        </button>
                      ) : (
                        <>
                          {!semArquivo && (
                            <button
                              type="button"
                              title="Visualizar PDF (nova guia)"
                              onClick={() => openPdf(d)}
                              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                            >
                              <Eye className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                          {!semArquivo && maisAcoes(d)}
                          {module === 'acervo' && ehNormativo(d) && (
                            <Link
                              href={`/${slug}/normas/documento/${d.id}`}
                              title={d.normaId ? 'Abrir em Legislação' : 'Texto compilado (legislação)'}
                              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                            >
                              <Scale className="h-4 w-4" aria-hidden />
                            </Link>
                          )}
                          <button
                            type="button"
                            title="Editar"
                            onClick={() => setEditing(d)}
                            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            title="Excluir (lixeira)"
                            onClick={() => del.mutate(d.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-600"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {data?.items.length === 0 && (
          <div className={`${cardCls} px-4 py-10`}>
            <ListaVazia lixeira={showTrash} filtrando={filtrosAtivos > 0 || q !== ''} onIncluir={() => setIncludeOpen(true)} singular={meta.singular} arquivo={module === 'acervo'} />
          </div>
        )}
      </div>

      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}

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
            <div className="flex items-start gap-3 rounded-[10px] bg-danger-50 px-3 py-3 text-sm text-danger-600">
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

            <label className="flex items-center gap-2 text-sm text-ink-800">
              <input
                type="checkbox"
                checked={deleteApenasSemArquivo}
                onChange={(e) => setDeleteApenasSemArquivo(e.target.checked)}
              />
              Apagar apenas as que não têm PDF
            </label>

            <div>
              <label className={labelCls} htmlFor="delete-etiquetas-orgao">Restringir a um órgão (opcional)</label>
              <SelectMenu
                id="delete-etiquetas-orgao"
                className={inputCls}
                value={deleteOrgaoId}
                onChange={(e) => setDeleteOrgaoId(e.target.value)}
              >
                <option value="">Todos os órgãos</option>
                {orgaos.map((o) => (
                  <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
                ))}
              </SelectMenu>
            </div>

            {(module === 'despesas' || module === 'receitas') && (
              <div>
                <label className={labelCls} htmlFor="delete-etiquetas-tipo">Restringir a um tipo (opcional)</label>
                <SelectMenu
                  id="delete-etiquetas-tipo"
                  className={inputCls}
                  value={deleteSubtype}
                  onChange={(e) => setDeleteSubtype(e.target.value)}
                >
                  <option value="">Todos os tipos</option>
                  {subtypesFor(module).map((s) => (
                    <option key={s} value={s}>{SUBTYPE_LABEL[s] ?? s}</option>
                  ))}
                </SelectMenu>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
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
                className="rounded-[10px] bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-60"
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
            <div className="flex items-start gap-3 rounded-[10px] bg-danger-50 px-3 py-3 text-sm text-danger-600">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Isso vai excluir <strong>permanentemente</strong> todos os documentos de {meta.title.toLowerCase()}{' '}
                que estão na lixeira, incluindo os arquivos anexados. Essa ação não pode ser desfeita. Deseja continuar?
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setConfirmEmptyTrash(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-60"
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
            <div className="flex items-start gap-3 rounded-[10px] bg-danger-50 px-3 py-3 text-sm text-danger-600">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                Isso vai enviar <strong>{selected.size}</strong> documento(s) selecionado(s) para a lixeira. Deseja continuar?
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setConfirmBulkDelete(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-[10px] bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-60"
                onClick={() => bulkDelete.mutate()}
                disabled={bulkDelete.isPending}
              >
                {bulkDelete.isPending ? 'Excluindo…' : 'Excluir selecionadas'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {compartilhando && (
        <CompartilharModal
          slug={String(slug)}
          documentId={compartilhando.id}
          titulo={compartilhando.originalName}
          onClose={() => setCompartilhando(null)}
        />
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
              className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-ink-200 bg-surface px-3 py-2 text-left text-sm text-ink-800 transition hover:bg-ink-50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileConferenciaBadge
                  status={viewPicker.conferenciaStatus}
                  resultado={viewPicker.conferenciaResultado}
                  erro={viewPicker.conferenciaErro}
                />
                <span className="truncate">{viewPicker.originalName}</span>
              </span>
              <Eye className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
            </button>
            {viewPicker.arquivosExtras.map((extra) => (
              <button
                key={extra.id}
                type="button"
                onClick={() => {
                  void openFile(viewPicker, extra.id);
                  setViewPicker(null);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-[10px] border border-ink-200 bg-surface px-3 py-2 text-left text-sm text-ink-800 transition hover:bg-ink-50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileConferenciaBadge
                    status={extra.conferenciaStatus}
                    resultado={extra.conferenciaResultado}
                    erro={extra.conferenciaErro}
                  />
                  <span className="truncate">{extra.originalName}</span>
                </span>
                <Eye className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden />
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
          docTypes={docTypes ?? []}
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
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${analisando.total > 0 ? (analisando.done / analisando.total) * 100 : 0}%` }}
              />
            </div>
            <p className="text-sm text-ink-500">
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
            <p className="text-2xl font-bold text-ink-800">
              {resultadoProblemas.divergente + resultadoProblemas.falha} documento(s) com problema
            </p>
            <p className="text-sm text-ink-500">
              {resultadoProblemas.divergente > 0 && <>{resultadoProblemas.divergente} divergente(s)</>}
              {resultadoProblemas.divergente > 0 && resultadoProblemas.falha > 0 && ' · '}
              {resultadoProblemas.falha > 0 && <>{resultadoProblemas.falha} falharam na análise</>}
            </p>
            <button
              type="button"
              className="mx-auto flex items-center gap-2 rounded-[10px] bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
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
  const [metadados, setMetadados] = useState<Metadados>({});
  const tipoAcervo = module === 'acervo' ? docTypes.find((t) => t.id === fields.documentTypeId) : undefined;
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setFields((f) => {
      const v = e.target.value;
      const next = { ...f, [k]: v };
      // Acervo e historico: o exercicio acompanha o ano da data do documento.
      if (k === 'documentDate' && module === 'acervo' && /^\d{4}-/.test(v)) next.exercicio = v.slice(0, 4);
      return next;
    });

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
  };

  const validation = useMemo(() => {
    const candidate: Record<string, unknown> = { ...fields };
    if (candidate.value === '' || candidate.value === undefined) delete candidate.value;
    if (!candidate.orgaoId) delete candidate.orgaoId;
    if (!candidate.historico) delete candidate.historico;
    if (!candidate.conta && module !== 'extrato') delete candidate.conta;
    for (const k of ['classificacaoId', 'nivelAcesso', 'dataInicioContagem', ...CAMPOS_CATALOGACAO]) if (!candidate[k]) delete candidate[k];
    if (module === 'acervo') {
      for (const k of ['responsavelDigitalizacao', 'dataDigitalizacao', 'localDigitalizacao']) if (!candidate[k]) delete candidate[k];
      const md = metadadosSchemaFor(tipoAcervo?.campos ?? []).safeParse(metadados);
      if (!md.success) return md;
      candidate.metadados = md.data;
    }
    return documentFieldsSchema.safeParse(candidate);
  }, [fields, module, metadados, tipoAcervo]);

  const submit = async () => {
    setError(null);
    if (!validation.success) {
      const first = validation.error.issues[0];
      setError(first?.path.length ? `${first.path.join('.')}: ${first.message}` : (first?.message ?? 'Dados invalidos'));
      return;
    }
    // PDF e opcional: sem arquivo, o documento fica "aguardando arquivo" e o
    // PDF pode ser anexado depois (upload normal ou Pasta Monitorada).
    setProgress(0);
    const payload = module === 'acervo' ? { ...fields, metadados: JSON.stringify(metadados) } : fields;
    const result = await uploadDocument(slug, payload, file, setProgress);
    if (result.ok) {
      onDone();
      onClose();
    } else {
      setProgress(null);
      setError(result.message);
    }
  };

  return (
    <Modal title={`Incluir ${meta.singular.toLowerCase()}`} subtitle={module === 'acervo' ? undefined : `Exercício ${exercicio}`} open onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {module === 'despesas' && (
            <>
              <Field label="Doc. Caixa *" id="docCaixa">
                <input id="docCaixa" className={inputCls} placeholder="ex.: 000123" onChange={set('docCaixa')} />
              </Field>
              <Field label="Empenho *" id="empenho">
                <input id="empenho" className={inputCls} placeholder="ex.: 2026NE00045" onChange={set('empenho')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Credor *" id="credor">
                  <input id="credor" className={inputCls} placeholder="Razão social do credor" onChange={set('credor')} />
                </Field>
              </div>
            </>
          )}

          {(module === 'despesas' || module === 'receitas') && (
            <Field label="Tipo *" id="subtype">
              <SelectMenu id="subtype" className={inputCls} onChange={set('subtype')} defaultValue="">
                <option value="" disabled>Selecione…</option>
                {subtypesFor(module).map((s) => (
                  <option key={s} value={s}>{SUBTYPE_LABEL[s] ?? s}</option>
                ))}
              </SelectMenu>
            </Field>
          )}

          {module === 'outros' && (
            <>
              <Field label="Tipo de documento *" id="documentTypeId">
                <SelectMenu id="documentTypeId" className={inputCls} onChange={set('documentTypeId')} defaultValue="">
                  <option value="" disabled>Selecione…</option>
                  {docTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.nome}</option>
                  ))}
                </SelectMenu>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Título/Descrição *" id="descricao">
                  <input id="descricao" className={inputCls} placeholder="Título ou descrição do documento" onChange={set('descricao')} />
                </Field>
              </div>
            </>
          )}

          {module === 'acervo' && (
            <>
              <div className="sm:col-span-2">
                <Field label="Tipo de documento *" id="documentTypeId">
                  <SelectMenu
                    id="documentTypeId"
                    className={inputCls}
                    defaultValue=""
                    onChange={(e) => {
                      set('documentTypeId')(e);
                      setMetadados({});
                    }}
                  >
                    <option value="" disabled>Selecione…</option>
                    {docTypes.map((t) => (
                      <option key={t.id} value={t.id}>{t.nome}</option>
                    ))}
                  </SelectMenu>
                </Field>
                {docTypes.length === 0 && (
                  <p className="mt-1 text-xs text-ink-500">
                    Nenhum tipo do Acervo cadastrado. Crie em Configurações → Tipos de Documento.
                  </p>
                )}
                {tipoNormativo(tipoAcervo?.nome) && (
                  <p className="mt-2 rounded-[10px] border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
                    Leis, decretos e portarias são cadastrados em Legislação, que já guarda o PDF aqui no Acervo e evita fazer o
                    cadastro duas vezes.{' '}
                    <Link href={`/${slug}/normas/nova`} className="font-semibold underline">
                      Ir para Nova norma
                    </Link>
                  </p>
                )}
              </div>
              <MetadadosFields campos={tipoAcervo?.campos ?? []} values={metadados} onChange={setMetadados} idPrefix="inc-md" />
              <div className="sm:col-span-2">
                <Field label="Título/Descrição *" id="descricao">
                  <input id="descricao" className={inputCls} placeholder="ex.: Dispõe sobre o plano diretor do município" onChange={set('descricao')} />
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
            <SelectMenu id="orgaoId" className={inputCls} onChange={set('orgaoId')} defaultValue="">
              <option value="">— Sem vínculo —</option>
              {orgaos.map((o) => (
                <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
              ))}
            </SelectMenu>
          </Field>

          {(module === 'despesas' || module === 'receitas' || module === 'outros' || module === 'extrato' || module === 'balancete' || module === 'acervo') && (
            <Field label="Data do documento *" id="documentDate">
              <input id="documentDate" type="date" className={inputCls} onChange={set('documentDate')} />
            </Field>
          )}

          {(module === 'despesas' || module === 'receitas') && (
            <Field label="Valor (R$)" id="value">
              <input id="value" type="number" step="0.01" min="0" className={inputCls} placeholder="0,00" onWheel={blurOnWheel} onChange={set('value')} />
            </Field>
          )}

          {module === 'receitas' && (
            <Field label="Conta" id="conta-r">
              <input id="conta-r" className={inputCls} placeholder="Conta bancária (opcional)" onChange={set('conta')} />
            </Field>
          )}

          {(module === 'despesas' || module === 'receitas') && (
            <div className="sm:col-span-2">
              <Field label="Histórico" id="historico">
                <textarea id="historico" rows={2} className={inputCls} placeholder="Descrição/histórico (opcional)" onChange={set('historico')} />
              </Field>
            </div>
          )}

          {(module === 'balancete' || module === 'extrato') && (
            <div className="sm:col-span-2">
              <Field label="Título/Descrição" id="descricao">
                <textarea id="descricao" rows={2} className={inputCls} placeholder="Título ou descrição do documento (opcional)" onChange={set('descricao')} />
              </Field>
            </div>
          )}

          {module === 'acervo' && (
            <DigitalizacaoFields values={fields} onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))} idPrefix="inc-dg" />
          )}

          <CatalogacaoFields values={fields} onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))} idPrefix="inc-cat" />

          <ClassificacaoFields
            slug={slug}
            module={module}
            values={fields}
            onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))}
            documentDate={fields.documentDate || null}
            exercicio={Number(fields.exercicio) || null}
            padrao={
              tipoAcervo
                ? { classificacaoId: tipoAcervo.classificacaoId ?? null, nivelAcesso: tipoAcervo.nivelAcessoPadrao ?? 'restrito', origem: 'tipo' }
                : undefined
            }
          />
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
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-[16px] border-2 border-dashed p-6 text-center transition ${
            dragOver ? 'border-accent bg-brand-50' : 'border-ink-200 hover:border-ink-400'
          }`}
        >
          <FileUp className="h-8 w-8 text-ink-500" aria-hidden />
          {file ? (
            <p className="text-sm font-semibold text-ink-800">
              {file.name} <span className="text-ink-500">({formatBytes(file.size)})</span>
            </p>
          ) : (
            <p className="text-sm text-ink-500">
              Arraste o PDF aqui ou <span className="font-semibold text-accent">clique para selecionar</span>{' '}
              <span className="text-ink-500">(opcional — pode anexar depois)</span>
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

        {progress !== null && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-center text-[10px] text-ink-500">{progress}% enviado</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="button" className={btnPrimary} onClick={submit} disabled={progress !== null}>
            {progress !== null ? 'Enviando…' : 'Salvar documento'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Rotulo terminado em " *" vira obrigatorio (asterisco em danger). */
function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  const obrigatorio = label.endsWith(' *');
  return (
    <div>
      <label className={labelCls} htmlFor={id}>
        {obrigatorio ? label.slice(0, -2) : label}
        {obrigatorio && <span className="ml-0.5 text-danger-600">*</span>}
      </label>
      {children}
    </div>
  );
}

function FiltroCampo({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function ListaVazia({ lixeira, filtrando, onIncluir, singular, arquivo }: { lixeira: boolean; filtrando: boolean; onIncluir: () => void; singular: string; arquivo: boolean }) {
  const Icone = lixeira ? Trash2 : filtrando ? SearchX : FilePlus2;
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-ink-100 text-ink-500">
        <Icone className="h-6 w-6" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-bold text-ink-900">
        {lixeira ? 'Lixeira vazia' : filtrando ? 'Nada encontrado com esses filtros' : 'Nenhum documento ainda'}
      </p>
      <p className="mt-1 text-sm text-ink-500">
        {lixeira
          ? 'Os documentos excluídos aparecem aqui.'
          : filtrando
            ? 'Tente outra palavra ou limpe os filtros.'
            : arquivo
              ? 'Inclua a primeira lei, decreto, portaria ou contrato do acervo.'
              : 'Inclua o primeiro documento ou importe as etiquetas do sistema contábil.'}
      </p>
      {!lixeira && !filtrando && (
        <Button className="mt-4" leftIcon={<Plus aria-hidden />} onClick={onIncluir}>
          Incluir {singular.toLowerCase()}
        </Button>
      )}
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

  /** Baixa a copia autenticada (carimbo + QR de verificacao publica) do arquivo principal ou de um extra. */
  const [emitindoCopia, setEmitindoCopia] = useState<string | null>(null);
  const baixarCopia = async (extraId?: string) => {
    setEmitindoCopia(extraId ?? 'principal');
    try {
      const qs = extraId ? `?arquivo=${extraId}` : '';
      const url = await apiBlobUrl(`/t/${slug}/documents/${doc.id}/copia-autenticada${qs}`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(extraId ? extras.find((e) => e.id === extraId)?.originalName : doc.originalName)?.replace(/\.pdf$/i, '') ?? 'documento'}-autenticada.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao gerar a cópia autenticada');
    } finally {
      setEmitindoCopia(null);
    }
  };

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
            <p className="label-caps">Arquivos anexados</p>
            <div className="flex items-center justify-between gap-2 rounded-[10px] border border-ink-200 bg-surface px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                {doc.module === 'despesas' && (
                  <FileConferenciaBadge
                    status={doc.conferenciaStatus}
                    resultado={doc.conferenciaResultado}
                    erro={doc.conferenciaErro}
                  />
                )}
                <span className="truncate text-xs text-ink-800">{doc.originalName}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  title="Visualizar"
                  onClick={() => void viewFile()}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  title="Cópia autenticada (carimbo + QR de verificação)"
                  disabled={emitindoCopia !== null}
                  onClick={() => void baixarCopia()}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-success-50 hover:text-success-600 disabled:opacity-60"
                >
                  {emitindoCopia === 'principal' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  title="Excluir PDF"
                  disabled={removing}
                  onClick={removeCurrent}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-500 disabled:opacity-60"
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
                className="flex items-center justify-between gap-2 rounded-[10px] border border-ink-200 bg-surface px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {doc.module === 'despesas' && (
                    <FileConferenciaBadge
                      status={extra.conferenciaStatus}
                      resultado={extra.conferenciaResultado}
                      erro={extra.conferenciaErro}
                    />
                  )}
                  <span className="truncate text-xs text-ink-800">{extra.originalName}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    title="Visualizar"
                    onClick={() => void viewFile(extra.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden />
                  </button>
                <button
                  type="button"
                  title="Cópia autenticada (carimbo + QR de verificação)"
                  disabled={emitindoCopia !== null}
                  onClick={() => void baixarCopia(extra.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-success-50 hover:text-success-600 disabled:opacity-60"
                >
                  {emitindoCopia === extra.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
                  <button
                    type="button"
                    title="Excluir"
                    disabled={removingExtraId === extra.id}
                    onClick={() => void removeExtra(extra.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-500 disabled:opacity-60"
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
            <p className="text-xs text-ink-500">Selecionar um novo arquivo abaixo vai substituir o PDF principal.</p>
          </div>
        )}

        {temArquivo && (
          <div>
            <button
              type="button"
              onClick={() => document.getElementById('add-extra-file-input')?.click()}
              disabled={extraProgress !== null}
              className="flex items-center gap-1.5 rounded-[10px] border border-dashed border-ink-200 px-3 py-1.5 text-[13px] font-semibold text-ink-500 transition hover:border-accent hover:text-accent disabled:opacity-60"
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
              <p role="alert" className="mt-2 rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">
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
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-[16px] border-2 border-dashed p-6 text-center transition ${
            dragOver ? 'border-accent bg-brand-50' : 'border-ink-200 hover:border-ink-400'
          }`}
        >
          <FileUp className="h-8 w-8 text-ink-500" aria-hidden />
          {file ? (
            <p className="text-sm font-semibold text-ink-800">
              {file.name} <span className="text-ink-500">({formatBytes(file.size)})</span>
            </p>
          ) : (
            <p className="text-sm text-ink-500">
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
            <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-center text-[10px] text-ink-500">{progress}% enviado</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>
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
  docTypes,
  onClose,
  onDone,
}: {
  slug: string;
  doc: DocumentView;
  orgaos: Orgao[];
  docTypes: Lookup[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [metadados, setMetadados] = useState<Metadados>(doc.metadados ?? {});
  const [metadadosAlterados, setMetadadosAlterados] = useState(false);
  const tipoAcervo = doc.module === 'acervo' ? docTypes.find((t) => t.id === doc.documentTypeId) : undefined;
  const temArquivo = useModulo('arquivo');
  const { data: locaisFisicos = [] } = useQuery<LocalFisicoView[]>({
    queryKey: ['arquivo-fisico', 'locais', slug],
    queryFn: () => api<LocalFisicoView[]>(`/t/${slug}/arquivo-fisico/locais`),
    staleTime: 60_000,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setFields((f) => {
      const v = e.target.value;
      const next = { ...f, [k]: v };
      // Acervo e historico: o exercicio acompanha o ano da data do documento.
      if (k === 'documentDate' && doc.module === 'acervo' && /^\d{4}-/.test(v)) next.exercicio = v.slice(0, 4);
      return next;
    });

  const save = async () => {
    setError(null);
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (k === 'localFisicoId') body[k] = v || null; // vazio = remover da caixa
      // Catalogacao: apagar o texto apaga o valor (palavras-chave vazias = nenhuma).
      else if (k === 'palavrasChave') body[k] = v;
      else if (k === 'numero' || k === 'assunto' || k === 'interessado') body[k] = v || null;
      else if (v !== '') body[k] = k === 'value' || k === 'exercicio' ? Number(v) : k === 'digitalizado' ? v === 'true' : v;
    }
    if (doc.module === 'acervo' && metadadosAlterados) {
      const md = metadadosSchemaFor(tipoAcervo?.campos ?? []).safeParse(metadados);
      if (!md.success) {
        setError(md.error.issues[0]?.message ?? 'Metadados invalidos');
        setSaving(false);
        return;
      }
      body.metadados = md.data;
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {doc.module === 'despesas' && (
            <>
              <Field label="Doc. Caixa" id="e-docCaixa">
                <input id="e-docCaixa" className={inputCls} defaultValue={doc.docCaixa ?? ''} onChange={set('docCaixa')} />
              </Field>
              <Field label="Empenho" id="e-empenho">
                <input id="e-empenho" className={inputCls} defaultValue={doc.empenho ?? ''} onChange={set('empenho')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Credor" id="e-credor">
                  <input id="e-credor" className={inputCls} defaultValue={doc.credor ?? ''} onChange={set('credor')} />
                </Field>
              </div>
            </>
          )}
          {(doc.module === 'despesas' || doc.module === 'receitas') && (
            <>
              <Field label="Valor (R$)" id="e-value">
                <input id="e-value" type="number" step="0.01" className={inputCls} defaultValue={doc.value ?? ''} onWheel={blurOnWheel} onChange={set('value')} />
              </Field>
              <Field label="Data do Documento" id="e-date">
                <input id="e-date" type="date" className={inputCls} defaultValue={doc.documentDate ?? ''} onChange={set('documentDate')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Histórico" id="e-hist">
                  <textarea id="e-hist" rows={2} className={inputCls} defaultValue={doc.historico ?? ''} onChange={set('historico')} />
                </Field>
              </div>
            </>
          )}
          {doc.module === 'acervo' && (
            <>
              <MetadadosFields
                campos={tipoAcervo?.campos ?? []}
                values={metadados}
                onChange={(m) => {
                  setMetadados(m);
                  setMetadadosAlterados(true);
                }}
                idPrefix="ed-md"
              />
              <Field label="Data do Documento" id="e-date-acervo">
                <input id="e-date-acervo" type="date" className={inputCls} defaultValue={doc.documentDate ?? ''} onChange={set('documentDate')} />
              </Field>
              <DigitalizacaoFields
                values={{
                  digitalizado: String(doc.digitalizado),
                  responsavelDigitalizacao: doc.responsavelDigitalizacao ?? '',
                  dataDigitalizacao: doc.dataDigitalizacao ?? '',
                  localDigitalizacao: doc.localDigitalizacao ?? '',
                  ...fields,
                }}
                onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))}
                idPrefix="ed-dg"
              />
            </>
          )}
          {(doc.module === 'outros' || doc.module === 'acervo') && (
            <div className="sm:col-span-2">
              <Field label="Título/Descrição" id="e-desc">
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
          {(doc.module === 'balancete' || doc.module === 'extrato') && (
            <div className="sm:col-span-2">
              <Field label="Título/Descrição" id="e-desc-be">
                <textarea id="e-desc-be" rows={2} className={inputCls} defaultValue={doc.descricao ?? ''} onChange={set('descricao')} />
              </Field>
            </div>
          )}
          <Field label="Órgão" id="e-orgao">
            <SelectMenu id="e-orgao" className={inputCls} defaultValue={doc.orgaoId ?? ''} onChange={set('orgaoId')}>
              <option value="">— Sem vínculo —</option>
              {orgaos.map((o) => (
                <option key={o.id} value={o.id}>{o.codigo} — {o.descricao}</option>
              ))}
            </SelectMenu>
          </Field>

          {locaisFisicos.length > 0 && (
            <div className="sm:col-span-2">
              <Field label="Localização física do original" id="e-local">
                <SelectMenu
                  id="e-local"
                  className={inputCls}
                  defaultValue={doc.localFisicoId ?? ''}
                  onChange={set('localFisicoId')}
                >
                  <option value="">— Sem original em papel / não localizado —</option>
                  {locaisFisicos
                    .filter((l) => l.ativo || l.id === doc.localFisicoId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>{caminhoLocal(l.id, locaisFisicos)}</option>
                    ))}
                </SelectMenu>
              </Field>
            </div>
          )}

          <CatalogacaoFields
            values={fields}
            onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))}
            atual={{ numero: doc.numero, assunto: doc.assunto, interessado: doc.interessado, palavrasChave: doc.palavrasChave, dadosPessoais: doc.dadosPessoais }}
            idPrefix="ed-cat"
          />

          <ClassificacaoFields
            slug={slug}
            module={doc.module}
            values={fields}
            onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))}
            documentDate={fields.documentDate || doc.documentDate}
            exercicio={doc.exercicio}
            atual={{ classificacaoId: doc.classificacaoId, nivelAcesso: doc.nivelAcesso, dataInicioContagem: doc.dataInicioContagem }}
            sigiloVigente={doc.grauSigilo !== null}
          />
          {temArquivo && <SigiloDocumento slug={slug} documentId={doc.id} dataDocumento={doc.documentDate} />}
        </div>

        {error && (
          <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>
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
