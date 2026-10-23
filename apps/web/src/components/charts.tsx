'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Graficos em SVG puro (sem biblioteca): rosca, colunas e anel de percentual.
 * Cores pelos tokens do tema (var(--color-*)), entao acompanham o modo escuro.
 */

export const PALETA = [
  'var(--color-brand-600)',
  'var(--color-violet-500)',
  'var(--color-teal-500)',
  'var(--color-orange-500)',
  'var(--color-pink-500)',
  'var(--color-warning-500)',
  'var(--color-info-500)',
  'var(--color-success-500)',
] as const;
export const COR_OUTROS = 'var(--color-ink-300)';

export interface Fatia {
  rotulo: string;
  valor: number;
  cor?: string;
}

const fmt = (n: number) => n.toLocaleString('pt-BR');
const pct = (v: number, t: number) =>
  t > 0 ? `${((v / t) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '0%';

/** Mantem as `max` maiores fatias e soma o resto em "Outros". */
export function agruparOutros(fatias: Fatia[], max = 6): Fatia[] {
  const ordenadas = [...fatias].filter((f) => f.valor > 0).sort((a, b) => b.valor - a.valor);
  if (ordenadas.length <= max) return ordenadas;
  const resto = ordenadas.slice(max - 1).reduce((t, f) => t + f.valor, 0);
  return [...ordenadas.slice(0, max - 1), { rotulo: 'Outros', valor: resto, cor: COR_OUTROS }];
}

/** Rosca com total no centro e legenda com percentuais. Passar o mouse destaca a fatia. */
export function Rosca({
  fatias,
  rotuloCentro = 'total',
  className,
}: {
  fatias: Fatia[];
  rotuloCentro?: string;
  className?: string;
}) {
  const [ativa, setAtiva] = useState<number | null>(null);
  const total = fatias.reduce((t, f) => t + f.valor, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  const cor = (f: Fatia, i: number) => f.cor ?? PALETA[i % PALETA.length]!;
  const destaque = ativa !== null ? fatias[ativa] : null;

  return (
    // Container query: em card estreito a legenda vai para baixo da rosca.
    <div className={cn('@container', className)}>
      <div className="flex flex-col items-center gap-5 @md:flex-row">
        <div className="relative h-40 w-40 shrink-0">
          <svg
            viewBox="0 0 100 100"
            className="h-full w-full -rotate-90"
            role="img"
            aria-label={fatias.map((f) => `${f.rotulo}: ${f.valor}`).join('; ')}
          >
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="var(--color-ink-100)"
              strokeWidth="12"
            />
            {total > 0 &&
              fatias.map((f, i) => {
                const tam = (f.valor / total) * C;
                const el = (
                  <circle
                    key={f.rotulo}
                    cx="50"
                    cy="50"
                    r={R}
                    fill="none"
                    stroke={cor(f, i)}
                    strokeWidth={ativa === i ? 15 : 12}
                    strokeDasharray={`${Math.max(tam - (fatias.length > 1 ? 0.8 : 0), 0.001)} ${C}`}
                    strokeDashoffset={-acumulado}
                    className="cursor-pointer transition-[stroke-width] duration-150"
                    onMouseEnter={() => setAtiva(i)}
                    onMouseLeave={() => setAtiva(null)}
                  />
                );
                acumulado += tam;
                return el;
              })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-extrabold tabular-nums text-ink-900">
              {fmt(destaque ? destaque.valor : total)}
            </span>
            <span className="max-w-[90px] truncate text-[11px] text-ink-500">
              {destaque ? pct(destaque.valor, total) : rotuloCentro}
            </span>
          </div>
        </div>
        <ul className="w-full min-w-0 space-y-1.5">
          {fatias.length === 0 && <li className="text-sm text-ink-500">Sem dados.</li>}
          {fatias.map((f, i) => (
            <li
              key={f.rotulo}
              onMouseEnter={() => setAtiva(i)}
              onMouseLeave={() => setAtiva(null)}
              className={cn(
                'flex items-center gap-2 rounded-[8px] px-2 py-1 text-sm transition-colors',
                ativa === i && 'bg-ink-50',
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: cor(f, i) }}
              />
              <span className="min-w-0 flex-1 truncate text-ink-700" title={f.rotulo}>
                {f.rotulo}
              </span>
              <span className="shrink-0 tabular-nums font-semibold text-ink-900">
                {fmt(f.valor)}
              </span>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-400">
                {pct(f.valor, total)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Colunas verticais (ex.: documentos por ano). Rotulos pulam quando nao cabem. */
export function Colunas({
  dados,
  cor = 'var(--color-brand-600)',
  unidade = 'documento(s)',
  className,
}: {
  dados: Array<{ rotulo: string; valor: number; extra?: string }>;
  cor?: string;
  unidade?: string;
  className?: string;
}) {
  const [ativa, setAtiva] = useState<number | null>(null);
  const max = Math.max(1, ...dados.map((d) => d.valor));
  const passo = Math.max(1, Math.ceil(dados.length / 12));
  if (dados.length === 0) return <p className="text-sm text-ink-500">Sem dados.</p>;
  return (
    <div className={cn('w-full', className)}>
      <div className="relative flex h-48 items-end gap-1.5 border-b border-ink-200 pb-px">
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <span
            key={g}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-100"
            style={{ bottom: `${g * 100}%` }}
          />
        ))}
        {dados.map((d, i) => (
          <div
            key={d.rotulo}
            className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
            onMouseEnter={() => setAtiva(i)}
            onMouseLeave={() => setAtiva(null)}
          >
            {ativa === i && (
              <div className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-ink-900 px-2 py-1 text-xs text-white shadow-lg">
                <strong>{d.rotulo}</strong>: {fmt(d.valor)} {unidade}
                {d.extra ? ` · ${d.extra}` : ''}
              </div>
            )}
            <div
              className="mx-auto w-full max-w-14 rounded-t-[6px] transition-opacity"
              style={{
                height: `${Math.max(d.valor > 0 ? 2 : 0, (d.valor / max) * 100)}%`,
                background: cor,
                opacity: ativa === null || ativa === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {dados.map((d, i) => (
          <span
            key={d.rotulo}
            className="min-w-0 flex-1 truncate text-center text-[11px] tabular-nums text-ink-500"
          >
            {i % passo === 0 ? d.rotulo : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Anel de percentual (indicador). */
export function Anel({
  valor,
  total,
  rotulo,
  dica,
  cor = 'var(--color-brand-600)',
}: {
  valor: number;
  total: number;
  rotulo: string;
  dica?: string;
  cor?: string;
}) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const p = total > 0 ? Math.min(1, valor / total) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-20 w-20 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="var(--color-ink-100)"
            strokeWidth="10"
          />
          {/* Com 0% nao desenha: a ponta arredondada viraria um ponto solto. */}
          {p > 0 && (
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={cor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${p * C} ${C}`}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold tabular-nums text-ink-900">
          {pct(valor, total)}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-800">{rotulo}</p>
        <p className="text-xs text-ink-500">
          {fmt(valor)} de {fmt(total)}
          {dica ? ` · ${dica}` : ''}
        </p>
      </div>
    </div>
  );
}

/** Barra empilhada unica (composicao em 100%). */
export function BarraEmpilhada({ fatias, className }: { fatias: Fatia[]; className?: string }) {
  const total = fatias.reduce((t, f) => t + f.valor, 0);
  return (
    <div className={className}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100">
        {total > 0 &&
          fatias.map((f, i) =>
            f.valor > 0 ? (
              <span
                key={f.rotulo}
                title={`${f.rotulo}: ${fmt(f.valor)}`}
                style={{
                  width: `${(f.valor / total) * 100}%`,
                  background: f.cor ?? PALETA[i % PALETA.length],
                }}
              />
            ) : null,
          )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {fatias.map((f, i) => (
          <span key={f.rotulo} className="flex items-center gap-1.5 text-xs text-ink-600">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: f.cor ?? PALETA[i % PALETA.length] }}
            />
            {f.rotulo} <strong className="tabular-nums text-ink-900">{fmt(f.valor)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Linhas no tempo (uma ou mais series na mesma escala). Passar o mouse mostra
 * os valores do ponto. SVG proprio, no padrao dos outros graficos.
 */
export function Linhas({
  rotulos,
  series,
  formatar = fmt,
  className,
}: {
  rotulos: string[];
  series: Array<{ nome: string; valores: number[]; cor?: string }>;
  formatar?: (v: number) => string;
  className?: string;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const n = rotulos.length;
  const max = Math.max(1, ...series.flatMap((s) => s.valores));
  if (n === 0) return <p className="text-sm text-ink-500">Sem dados.</p>;
  const L = 600;
  const A = 180;
  const x = (i: number) => (n === 1 ? L / 2 : (i / (n - 1)) * L);
  const y = (v: number) => A - (v / max) * (A - 8);
  const passo = Math.max(1, Math.ceil(n / 8));
  return (
    <div className={cn('w-full', className)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${L} ${A}`}
          preserveAspectRatio="none"
          className="h-48 w-full overflow-visible"
          role="img"
          aria-label={series.map((s) => s.nome).join(', ')}
          onMouseLeave={() => setAtivo(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAtivo(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
          }}
        >
          {[0.25, 0.5, 0.75, 1].map((g) => (
            <line key={g} x1={0} x2={L} y1={A - g * (A - 8)} y2={A - g * (A - 8)} stroke="var(--color-ink-100)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={L} y1={A} y2={A} stroke="var(--color-ink-200)" vectorEffect="non-scaling-stroke" />
          {series.map((s, si) => (
            <polyline
              key={s.nome}
              fill="none"
              stroke={s.cor ?? PALETA[si % PALETA.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={s.valores.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            />
          ))}
          {ativo !== null && <line x1={x(ativo)} x2={x(ativo)} y1={0} y2={A} stroke="var(--color-ink-300)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {ativo !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-ink-900 px-2 py-1 text-xs text-white shadow-lg"
            style={{ left: `${(x(ativo) / L) * 100}%` }}
          >
            <strong>{rotulos[ativo]}</strong>
            {series.map((s) => (
              <span key={s.nome} className="block">
                {s.nome}: {formatar(s.valores[ativo] ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between">
        {rotulos.map((r, i) => (
          <span key={`${r}-${i}`} className="text-[11px] tabular-nums text-ink-500">
            {i % passo === 0 ? r : ''}
          </span>
        ))}
      </div>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-3">
          {series.map((s, si) => (
            <span key={s.nome} className="flex items-center gap-1.5 text-xs text-ink-600">
              <span className="h-2 w-3 rounded-full" style={{ background: s.cor ?? PALETA[si % PALETA.length] }} />
              {s.nome}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
