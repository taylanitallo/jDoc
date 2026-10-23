'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import type { RequisicaoLenta } from '@jdoc/shared';
import { api } from '@/lib/api';
import { fmtDateTime, fmtDuracao } from '@/lib/format';
import { Modal } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';

/** "Ver todas": requisicoes acima do limite de lentidao nas ultimas 24 h. */
export function RequisicoesLentasModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { data } = useQuery({
    queryKey: ['sa-lentas'],
    queryFn: () => api<RequisicaoLenta[]>('/superadmin/slow-requests?limite=200'),
    enabled: aberto,
  });
  return (
    <Modal open={aberto} onClose={onFechar} title="Requisições lentas (24 h)" size="xl">
      {!data ? (
        <Skeleton rows={6} />
      ) : data.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nenhuma requisição lenta nas últimas 24 h" />
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-[12px] border border-ink-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 border-b border-ink-200 bg-ink-50 text-left">
              <tr>
                <th className="px-3 py-2 label-caps">Quando</th>
                <th className="px-3 py-2 label-caps">Rota</th>
                <th className="px-3 py-2 label-caps">Órgão</th>
                <th className="px-3 py-2 text-right label-caps">Tempo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-600">{fmtDateTime(r.em)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-800">
                    {r.method} {r.route} <span className="text-ink-400">({r.status})</span>
                  </td>
                  <td className="px-3 py-2 text-ink-600">{r.orgao ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-danger-600">{fmtDuracao(r.duracaoMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
