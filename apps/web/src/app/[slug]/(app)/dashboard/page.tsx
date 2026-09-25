'use client';

import { useModuloAtivo } from '@/components/modulo-ativo';
import {
  TrendingUp,
  TrendingDown,
  Scale,
  Landmark,
  FolderOpen,
  HardDrive,
  FileCheck,
  Film,
  Archive,
  ArrowRightLeft,
  Trash2,
  HandHelping,
  Library,
  ScanSearch,
  Warehouse,
  ChevronRight,
  ShieldCheck,
  MessagesSquare,
  Zap,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  SISTEMA_LABEL,
  sistemaDoModulo,
  type ArquivoFisicoResumo,
  type DocModule,
  type DocumentPage,
  type IntegridadeResumo,
  type AtendimentoResumo,
  type TemporalidadeResumo,
} from '@jdoc/shared';
import { useExercicio } from '@/components/topbar';
import { Card, CardBody, CardHeader, PageHeader, StatCard, TONE_VIVID, UsageBar, type Tone } from '@/components/ui';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';

interface UsoDisco {
  usoBytes: number;
  quotaBytes: number;
  usoPercent: number;
}

function formatGb(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}

const todosCards = [
  { label: 'Receitas', icon: TrendingUp, tone: 'success', module: 'receitas' },
  { label: 'Despesas', icon: TrendingDown, tone: 'orange', module: 'despesas' },
  { label: 'Balancetes', icon: Scale, tone: 'violet', module: 'balancete' },
  { label: 'Extratos', icon: Landmark, tone: 'info', module: 'extrato' },
  { label: 'Outros', icon: FolderOpen, tone: 'teal', module: 'outros' },
  { label: 'Acervo', icon: Library, tone: 'orange', module: 'acervo' },
] as const satisfies ReadonlyArray<{ label: string; icon: unknown; tone: Tone; module: DocModule }>;

/**
 * Largura de cada card numa grade de 12 colunas (lg+), para a ultima linha nunca
 * ficar com buraco: 5 cards = 3 + 2 mais largos; 1 card = linha inteira.
 * No sm (2 colunas), o ultimo card de uma quantidade impar ocupa a linha toda.
 */
const SPAN_LG: Record<number, string> = { 3: 'lg:col-span-3', 4: 'lg:col-span-4', 6: 'lg:col-span-6', 12: 'lg:col-span-12' };
function larguraCard(i: number, n: number): string {
  const porLinha = n === 1 ? 1 : n === 2 || n === 4 ? (n === 4 ? 4 : 2) : 3;
  const linhasCheias = Math.floor(n / porLinha) * porLinha;
  const naUltima = i >= linhasCheias ? n - linhasCheias : porLinha;
  const lg = SPAN_LG[12 / naUltima] ?? 'lg:col-span-4';
  const sm = n % 2 === 1 && i === n - 1 ? 'sm:col-span-2' : '';
  return cn(sm, lg);
}

export default function DashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const { exercicio } = useExercicio();
  const { data: uso } = useQuery({
    queryKey: ['documents', 'usage', slug],
    queryFn: () => api<UsoDisco>(`/t/${slug}/documents/usage`),
  });

  // pageSize=1: so precisamos do "total" da busca, nao dos itens.
  // Cada modulo tem o seu Inicio: so os numeros do modulo ativo.
  const { ativo } = useModuloAtivo();
  const cards = todosCards.filter((c) => sistemaDoModulo(c.module) === ativo);
  const temArquivo = ativo === 'arquivo';
  const temFinanceiro = ativo === 'financeiro';
  // Cards do Arquivo: 403 (sem permissao) apenas esconde o card — retry desligado.
  const { data: ttd } = useQuery({
    queryKey: ['arquivistica', 'resumo'],
    queryFn: () => api<TemporalidadeResumo>(`/t/${slug}/arquivistica/temporalidade/resumo`),
    enabled: !!slug && temArquivo,
    retry: false,
  });
  const { data: fisico } = useQuery({
    queryKey: ['arquivo-fisico', 'resumo', slug],
    queryFn: () => api<ArquivoFisicoResumo>(`/t/${slug}/arquivo-fisico/resumo`),
    enabled: !!slug && temArquivo,
    retry: false,
  });
  const { data: integridade } = useQuery({
    queryKey: ['integridade', 'resumo', slug],
    queryFn: () => api<IntegridadeResumo>(`/t/${slug}/integridade/resumo`),
    enabled: !!slug && temArquivo,
    retry: false,
  });
  const { data: atendimento } = useQuery({
    queryKey: ['atendimentos', 'resumo', slug],
    queryFn: () => api<AtendimentoResumo>(`/t/${slug}/atendimentos/resumo`),
    enabled: !!slug && temArquivo,
    retry: false,
  });
  const cardsArquivo = (!temArquivo ? [] : [
    ttd && { label: 'A transferir', valor: ttd.aTransferir, icon: ArrowRightLeft, tone: 'info' as Tone, href: 'temporalidade', nota: 'Prazo corrente vencido' },
    ttd && { label: 'A eliminar', valor: ttd.aEliminar, icon: Trash2, tone: 'danger' as Tone, href: 'temporalidade', nota: 'Aguardando listagem/CPAD' },
    ttd && { label: 'Sem classificação', valor: ttd.semClassificacao, icon: Archive, tone: 'warning' as Tone, href: 'temporalidade', nota: `De ${ttd.totalAtivos} documentos` },
    fisico && { label: 'Empréstimos atrasados', valor: fisico.emprestimosAtrasados, icon: HandHelping, tone: (fisico.emprestimosAtrasados > 0 ? 'pink' : 'teal') as Tone, href: 'arquivo-fisico', nota: `${fisico.emprestimosAbertos} em aberto` },
    integridade && {
      label: 'Integridade',
      valor: integridade.ocorrenciasAbertas,
      icon: ShieldCheck,
      tone: (integridade.ocorrenciasAbertas > 0 ? 'danger' : 'teal') as Tone,
      href: 'integridade',
      nota: integridade.ocorrenciasAbertas > 0 ? 'Arquivos com problema' : 'Nenhum arquivo com problema',
    },
    atendimento && {
      label: 'Atendimentos atrasados',
      valor: atendimento.atrasados,
      icon: MessagesSquare,
      tone: (atendimento.atrasados > 0 ? 'danger' : 'pink') as Tone,
      href: 'atendimento',
      nota: `${atendimento.abertos} em andamento · prazo da LAI`,
    },
  ]).filter((c): c is NonNullable<typeof c> => Boolean(c));

  const countQueries = useQueries({
    queries: cards.map((c) => ({
      // Acervo e historico: conta o acervo todo, nao so o exercicio do topo.
      queryKey: ['documents', 'count', slug, c.module, c.module === 'acervo' ? 'todos' : exercicio],
      queryFn: () =>
        api<DocumentPage>(
          c.module === 'acervo'
            ? `/t/${slug}/documents?module=acervo&page=1&pageSize=1`
            : `/t/${slug}/documents?module=${c.module}&exercicio=${exercicio}&page=1&pageSize=1`,
        ),
      enabled: !!slug,
    })),
  });

  const totalDocs = countQueries.reduce((soma, q) => soma + (q.data?.total ?? 0), 0);

  const acoes = [
    ...(temFinanceiro
      ? [
          { label: 'Receitas', href: 'receitas', icon: TrendingUp, tone: 'success' as Tone },
          { label: 'Despesas', href: 'despesas', icon: TrendingDown, tone: 'orange' as Tone },
          { label: 'Prestação de contas', href: 'prestacao-contas', icon: FileCheck, tone: 'brand' as Tone },
          { label: 'Mídia legislativa', href: 'midia-legislativa', icon: Film, tone: 'violet' as Tone },
        ]
      : []),
    ...(temArquivo
      ? [
          { label: 'Acervo', href: 'acervo', icon: Library, tone: 'orange' as Tone },
          { label: 'Arquivo físico', href: 'arquivo-fisico', icon: Warehouse, tone: 'teal' as Tone },
          { label: 'Temporalidade', href: 'temporalidade', icon: Archive, tone: 'info' as Tone },
        ]
      : []),
    { label: 'Busca no conteúdo', href: 'busca', icon: ScanSearch, tone: 'pink' as Tone },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={ativo ? SISTEMA_LABEL[ativo] : 'Visão geral'}
        description={temArquivo ? 'Acervo, prazos de guarda e originais em papel' : `Documentos do exercício ${exercicio}`}
      />

      {cards.length > 0 && (
        <section aria-label="Documentos por módulo" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
          {cards.map(({ label, icon, tone, module }, i) => {
            const q = countQueries[i];
            return (
              <StatCard
                key={module}
                className={larguraCard(i, cards.length)}
                label={label}
                icon={icon}
                tone={tone}
                value={(q?.data?.total ?? 0).toLocaleString('pt-BR')}
                loading={q?.isLoading}
                hint={module === 'acervo' ? 'Documentos no acervo' : 'Documentos no exercício'}
                href={`/${slug}/${module}`}
              />
            );
          })}
        </section>
      )}

      {cardsArquivo.length > 0 && (
        <section>
          <h2 className="label-caps mb-3">Gestão documental</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
            {cardsArquivo.map(({ label, valor, icon, tone, href, nota }, i) => (
              <StatCard
                key={label}
                className={larguraCard(i, cardsArquivo.length)}
                label={label}
                icon={icon}
                tone={tone}
                value={valor.toLocaleString('pt-BR')}
                hint={nota}
                href={`/${slug}/${href}`}
              />
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col lg:col-span-2">
          <CardHeader title="Ações rápidas" description="Atalhos para as áreas mais usadas" icon={Zap} />
          <CardBody className="grid flex-1 auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2">
            {acoes.map(({ label, href, icon: Icon, tone }, i) => (
              <Link
                key={href}
                href={`/${slug}/${href}`}
                className={cn(
                  'group flex items-center gap-3 rounded-[12px] border border-ink-200/70 px-4 py-3.5 text-sm font-semibold text-ink-700 transition-colors hover:border-brand-500/40 hover:bg-brand-50 hover:text-brand-600',
                  acoes.length % 2 === 1 && i === acoes.length - 1 && 'sm:col-span-2',
                )}
              >
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-[10px] text-white shadow-sm transition-transform group-hover:scale-105', TONE_VIVID[tone].chip)}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="flex-1">{label}</span>
                <ChevronRight className="h-4 w-4 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Uso do disco" description="Armazenamento contratado" icon={HardDrive} />
          <CardBody>
            {uso ? (
              <>
                <p className="text-2xl font-bold tracking-tight text-ink-900 tabular-nums">{formatGb(uso.usoBytes)}</p>
                <p className="mb-3 text-xs text-ink-500">de {formatGb(uso.quotaBytes)} contratados</p>
                <UsageBar percent={uso.usoPercent} />
                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-ink-100 pt-4">
                  <div className="rounded-[12px] bg-success-50 p-3">
                    <dt className="label-caps">Espaço livre</dt>
                    <dd className="mt-1 text-lg font-bold text-success-600 tabular-nums">{formatGb(Math.max(uso.quotaBytes - uso.usoBytes, 0))}</dd>
                  </div>
                  <div className="rounded-[12px] bg-brand-50 p-3">
                    <dt className="label-caps">Documentos</dt>
                    <dd className="mt-1 text-lg font-bold text-brand-600 tabular-nums">{totalDocs.toLocaleString('pt-BR')}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <div className="space-y-2">
                <div className="h-8 w-28 animate-pulse rounded-[8px] bg-ink-100" />
                <div className="h-2 w-full animate-pulse rounded-full bg-ink-100" />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
