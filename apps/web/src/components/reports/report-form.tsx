'use client';

import { useState } from 'react';
import { CalendarDays, CalendarRange, FileText, Loader2, Tags } from 'lucide-react';
import { btnPrimary, inputCls, labelCls, SelectMenu } from '@/components/ui';
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
    active: 'border-transparent bg-brand-600 text-white shadow-xs',
    inactive:
      'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100',
  },
  extrato: {
    label: 'Extrato',
    active: 'border-transparent bg-brand-600 text-white shadow-xs',
    inactive:
      'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100',
  },
  receita: {
    label: 'Receita',
    active: 'border-transparent bg-success-600 text-white shadow-xs',
    inactive:
      'border-success-500/30 bg-success-50 text-success-600 hover:bg-success-50',
  },
  despesa: {
    label: 'Despesa',
    active: 'border-transparent bg-orange-600 text-white shadow-xs',
    inactive:
      'border-orange-500/30 bg-orange-50 text-orange-600 hover:bg-orange-50',
  },
  outros: {
    label: 'Outros',
    active: 'border-transparent bg-ink-600 text-white shadow-xs',
    inactive:
      'border-ink-200 bg-ink-50 text-ink-700 hover:bg-ink-100',
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
    `rounded-[10px] border px-2.5 py-1.5 text-xs font-medium transition ${
      active
        ? 'border-transparent bg-brand-600 text-white shadow-xs'
        : 'border-brand-100 bg-brand-50/60 text-ink-500 hover:bg-brand-100/60 hover:text-ink-800'
    }`;

  const iconLabelCls = `${labelCls} flex items-center gap-1.5`;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {tipo === 'prestacao_contas' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={iconLabelCls}>
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                Período — início
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
                Período — fim
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
            <SelectMenu
              value={ordenacao}
              onChange={e => setOrdenacao(e.target.value as 'alfabetica' | 'data')}
              className={inputCls}
            >
              <option value="alfabetica">Alfabética</option>
              <option value="data">Data</option>
            </SelectMenu>
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
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
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
                    className={`rounded-[10px] border px-2.5 py-1.5 text-xs font-medium transition ${
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
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className={`${btnPrimary} flex w-full items-center justify-center gap-2`}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <>
            <FileText className="h-4 w-4" aria-hidden />
            Gerar relatório
          </>
        )}
      </button>
    </form>
  );
}