'use client';

import {
  TrendingUp,
  TrendingDown,
  Scale,
  Landmark,
  FolderOpen,
  HardDrive,
  FileCheck,
  Film,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { DocModule, DocumentPage } from '@jdoc/shared';
import { useExercicio } from '@/components/topbar';
import { cardCls } from '@/components/ui';
import { api } from '@/lib/api';

interface UsoDisco {
  usoBytes: number;
  quotaBytes: number;
  usoPercent: number;
}

function formatGb(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const cards = [
  { label: 'RECEITAS', icon: TrendingUp, accent: 'card-accent-green', module: 'receitas' },
  { label: 'DESPESAS', icon: TrendingDown, accent: 'card-accent-orange', module: 'despesas' },
  { label: 'BALANCETES', icon: Scale, accent: 'card-accent-blue', module: 'balancete' },
  { label: 'EXTRATOS', icon: Landmark, accent: 'card-accent-purple', module: 'extrato' },
  { label: 'OUTROS', icon: FolderOpen, accent: 'card-accent-blue', module: 'outros' },
] as const satisfies ReadonlyArray<{ label: string; icon: unknown; accent: string; module: DocModule }>;

export default function DashboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const { exercicio } = useExercicio();
  const { data: uso } = useQuery({
    queryKey: ['documents', 'usage', slug],
    queryFn: () => api<UsoDisco>(`/t/${slug}/documents/usage`),
  });

  // pageSize=1: so precisamos do "total" da busca, nao dos itens.
  const countQueries = useQueries({
    queries: cards.map((c) => ({
      queryKey: ['documents', 'count', slug, c.module, exercicio],
      queryFn: () =>
        api<DocumentPage>(
          `/t/${slug}/documents?module=${c.module}&exercicio=${exercicio}&page=1&pageSize=1`,
        ),
      enabled: !!slug,
    })),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-app">
        Dashboard — Exercício {exercicio}
      </h1>

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map(({ label, icon: Icon, accent }, i) => {
          const q = countQueries[i];
          return (
            <div key={label} className={`${cardCls} p-4 ${accent}`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase text-app-muted">{label}</p>
                <Icon className="h-5 w-5 text-app-muted" aria-hidden />
              </div>
              {q?.isLoading ? (
                <div className="mt-2 h-8 w-12 animate-pulse rounded bg-app-skeleton" />
              ) : (
                <p className="mt-2 text-2xl font-extrabold text-app">{q?.data?.total ?? 0}</p>
              )}
              <p className="text-[10px] text-app-muted">documentos no exercício</p>
            </div>
          );
        })}
      </div>

      {/* Uso de disco */}
      <div className={`${cardCls} p-5 card-accent-purple`}>
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-app-muted" aria-hidden />
          <p className="text-xs font-bold uppercase text-app-muted">Uso do disco</p>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-app-skeleton">
          <div
            className="h-full rounded-full bg-gradient-primary"
            style={{ width: `${Math.min(uso?.usoPercent ?? 0, 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[10px] text-app-muted">
          {uso
            ? `${formatGb(uso.usoBytes)} de ${formatGb(uso.quotaBytes)} utilizados (${uso.usoPercent}%)`
            : 'Carregando...'}
        </p>
      </div>

      {/* Acoes rapidas */}
      <div>
        <p className="mb-3 text-xs font-bold uppercase text-app-muted">Ações Rápidas</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Nova Receita', href: 'receitas', icon: TrendingUp },
            { label: 'Nova Despesa', href: 'despesas', icon: TrendingDown },
            { label: 'Prestação de Contas', href: 'prestacao-contas', icon: FileCheck },
            { label: 'Mídia Legislativa', href: 'midia-legislativa', icon: Film },
          ].map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={`/${slug}/${href}`}
              className="flex items-center gap-3 rounded-xl bg-gradient-primary px-4 py-3 text-xs font-bold uppercase text-white shadow transition hover:opacity-90"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}