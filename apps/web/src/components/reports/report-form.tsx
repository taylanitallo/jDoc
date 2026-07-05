'use client';

import { useState } from 'react';
import { CalendarDays, CalendarRange, FileText, Loader2, Tags } from 'lucide-react';
import { btnPrimary, inputCls, labelCls } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useToast } from '@/components/toast';

type ReportTipo = 'prestacao_contas' | 'midia_legislativa';

interface PrestacaoContasFormProps {
  slug: string;
  tipo: ReportTipo;
  onSubmit: (jobId: string) => void;
}

const meses = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type MidiaKey = 'balancete' | 'extrato' | 'receita' | 'despesa' | 'outros';

const MIDIA_KEYS: MidiaKey[] = ['balancete', 'extrato', 'receita', 'despesa', 'outros'];

const MIDIA_META: Record<MidiaKey, { label: string; active: string; inactive: string }> = {
  balancete: {
    label: 'Balancete',
    active: 'border-transparent bg-violet-600 text-white shadow-sm',
    inactive:
      'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-800/40 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/40',
  },
  extrato: {
    label: 'Extrato',
    active: 'border-transparent bg-blue-600 text-white shadow-sm',
    inactive:
      'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40',
  },
  receita: {
    label: 'Receita',
    active: 'border-transparent bg-green-600 text-white shadow-sm',
    inactive:
      'border-green-200 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800/40 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40',
  },
  despesa: {
    label: 'Despesa',
    active: 'border-transparent bg-orange-600 text-white shadow-sm',
    inactive:
      'border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-800/40 dark:bg-orange-900/20 dark:text-orange-300 dark:hover:bg-orange-900/40',
  },
  outros: {
    label: 'Outros',
    active: 'border-transparent bg-slate-600 text-white shadow-sm',
    inactive:
      'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700/40 dark:bg-slate-800/40 dark:text-slate-300 dark:hover:bg-slate-800/60',
  },
};

export function ReportForm({ slug, tipo, onSubmit }: PrestacaoContasFormProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prestação de Contas fields
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [ordenacao, setOrdenacao] = useState<'alfabetica' | 'data'>('data');

  // Mídia Legislativa fields
  const [exercicio, setExercicio] = useState(new Date().getFullYear());
  const [competencias, setCompetencias] = useState<number[]>([]);
  const [midias, setMidias] = useState<string[]>(['balancete']);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      let payload: unknown;

      if (tipo === 'prestacao_contas') {
        payload = { periodoInicio, periodoFim, tipoData: 'documento', ordenacao, relatorio: 'resumido_categoria' };
      } else {
        payload = { exercicio, competencias, midias };
      }

      const endpoint = tipo === 'prestacao_contas'
        ? `/t/${slug}/reports/prestacao-contas`
        : `/t/${slug}/reports/midia-legislativa`;

      const data = await api<{ id: string }>(endpoint, {
        method: 'POST',
        body: payload,
      });
      toast.success('Relatório enfileirado. Acompanhe no histórico.');
      onSubmit(data.id);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erro desconhecido';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  function toggleCompetencia(mes: number) {
    setCompetencias(prev =>
      prev.includes(mes) ? prev.filter(m => m !== mes) : [...prev, mes].sort()
    );
  }

  function toggleMidia(midia: string) {
    setMidias(prev =>
      prev.includes(midia) ? prev.filter(m => m !== midia) : [...prev, midia]
    );
  }

  const chipCls = (active: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
      active
        ? 'border-transparent bg-gradient-primary text-white shadow-sm'
        : 'border-purple-100 bg-purple-50/60 text-app-muted hover:bg-purple-100/60 hover:text-app dark:border-purple-900/30 dark:bg-purple-900/10 dark:hover:bg-purple-900/25'
    }`;

  const iconLabelCls = `${labelCls} flex items-center gap-1.5`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {tipo === 'prestacao_contas' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={iconLabelCls}>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Período Início
              </label>
              <input
                type="date"
                required
                value={periodoInicio}
                onChange={e => setPeriodoInicio(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={iconLabelCls}>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Período Fim
              </label>
              <input
                type="date"
                required
                value={periodoFim}
                onChange={e => setPeriodoFim(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Ordenação</label>
            <select
              value={ordenacao}
              onChange={e => setOrdenacao(e.target.value as 'alfabetica' | 'data')}
              className={inputCls}
            >
              <option value="alfabetica">Alfabética</option>
              <option value="data">Data</option>
            </select>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={iconLabelCls}>
              <CalendarRange className="h-3.5 w-3.5" aria-hidden />
              Exercício
            </label>
            <input
              type="number"
              min={2000}
              max={2100}
              required
              value={exercicio}
              onChange={e => setExercicio(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={iconLabelCls}>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Competências (Meses)
              </label>
              {competencias.length > 0 && (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {competencias.length} selecionado{competencias.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {meses.map((nome, i) =>
                i === 0 ? null : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleCompetencia(i)}
                    aria-pressed={competencias.includes(i)}
                    className={chipCls(competencias.includes(i))}
                  >
                    {nome.slice(0, 3)}
                  </button>
                ),
              )}
            </div>
          </div>
          <div>
            <label className={iconLabelCls}>
              <Tags className="h-3.5 w-3.5" aria-hidden />
              Mídias
            </label>
            <div className="flex flex-wrap gap-1.5">
              {MIDIA_KEYS.map(midia => {
                const meta = MIDIA_META[midia];
                const active = midias.includes(midia);
                return (
                  <button
                    key={midia}
                    type="button"
                    onClick={() => toggleMidia(midia)}
                    aria-pressed={active}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                      active ? meta.active : meta.inactive
                    }`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-app-error-text">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className={`${btnPrimary} flex w-full items-center justify-center gap-2`}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <>
            <FileText className="h-4 w-4" aria-hidden />
            Gerar Relatório
          </>
        )}
      </button>
    </form>
  );
}