'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, FileStack, LogOut } from 'lucide-react';
import type { Sistema } from '@jdoc/shared';
import { useBranding } from '@/components/branding';
import { MODULO_VISUAL, useModuloAtivo } from '@/components/modulo-ativo';
import { cn } from '@/lib/cn';

const DESTAQUES: Record<Sistema, string[]> = {
  financeiro: ['Receitas, despesas, balancete e extratos', 'Prestação de contas ao Tribunal', 'Mídia legislativa para a Câmara'],
  arquivo: ['Acervo com leis, decretos, contratos e RH', 'Temporalidade e eliminação legal', 'Caixas e originais em papel'],
};

/**
 * Tela logo apos o login quando o orgao contratou os dois modulos: dois
 * quadrados para escolher onde trabalhar. Com um modulo so, segue direto ao Inicio.
 */
export function EscolhaModulo({ slug, nome, onSair }: { slug: string; nome: string | null; onSair: () => void }) {
  const router = useRouter();
  const { modulos, nomeExibido } = useBranding();
  const { ativo, trocar } = useModuloAtivo();

  useEffect(() => {
    if (modulos.length === 1) router.replace(`/${slug}/dashboard`);
  }, [modulos, router, slug]);

  const escolher = (s: Sistema) => {
    trocar(s);
    router.push(`/${slug}/dashboard`);
  };

  const primeiroNome = nome?.split(' ')[0];

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-ink-200/70 bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600 text-white">
            <FileStack className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[15px] font-bold text-ink-900">jDoc</p>
            <p className="truncate text-xs text-ink-500">{nomeExibido ?? 'Gestão de documentos'}</p>
          </div>
          <button
            type="button"
            onClick={onSair}
            className="flex h-10 items-center gap-2 rounded-[10px] px-3 text-sm font-semibold text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mb-8 text-center animate-fade-in">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            {primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!'} Onde você vai trabalhar?
          </h1>
          <p className="mt-2 text-sm text-ink-500">Escolha o módulo. Dá para trocar depois pelo menu lateral.</p>
        </div>

        {modulos.length < 2 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2" aria-hidden>
            {[0, 1].map((k) => (
              <div key={k} className="aspect-[4/3] animate-pulse rounded-[20px] bg-ink-100 sm:aspect-square" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {(['financeiro', 'arquivo'] as const).map((s, i) => {
              const v = MODULO_VISUAL[s];
              const Icon = v.icon;
              const ultimo = ativo === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => escolher(s)}
                  style={{ animationDelay: `${i * 80}ms` }}
                  className={cn(
                    'group relative flex animate-slide-up flex-col overflow-hidden rounded-[20px] border-2 border-ink-200/70 bg-surface p-6 text-left shadow-xs transition',
                    'hover:-translate-y-1 hover:shadow-xl sm:aspect-square sm:p-8',
                    v.anel,
                  )}
                >
                  {/* faixa de cor do modulo */}
                  <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1.5', v.solido)} />
                  <span aria-hidden className={cn('pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-60 blur-2xl', v.suave)} />

                  <span className={cn('relative flex h-16 w-16 items-center justify-center rounded-[16px] text-white shadow-lg sm:h-20 sm:w-20', v.solido)}>
                    <Icon className="h-8 w-8 sm:h-10 sm:w-10" aria-hidden />
                  </span>

                  <span className="relative mt-6 flex items-center gap-2">
                    <span className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">{v.nome}</span>
                    {ultimo && (
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', v.suave, v.texto)}>Último usado</span>
                    )}
                  </span>

                  <ul className="relative mt-4 space-y-2">
                    {DESTAQUES[s].map((d) => (
                      <li key={d} className="flex items-start gap-2 text-sm text-ink-600">
                        <Check className={cn('mt-0.5 h-4 w-4 shrink-0', v.texto)} aria-hidden />
                        {d}
                      </li>
                    ))}
                  </ul>

                  <span className={cn('relative mt-auto flex items-center gap-1.5 pt-6 text-sm font-bold', v.texto)}>
                    Entrar no {v.curto}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
