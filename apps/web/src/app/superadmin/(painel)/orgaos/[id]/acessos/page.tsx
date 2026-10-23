'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import type { AcessoView } from '@jdoc/shared';
import { api } from '@/lib/api';
import { fmtDateTime, todayFortaleza } from '@/lib/format';
import { Badge, Card, Field, Input, Pagination } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';

const POR_PAGINA = 50;
const TIPO = {
  login: { label: 'Entrada', tom: 'success' },
  falha: { label: 'Falha', tom: 'danger' },
  logout: { label: 'Saída', tom: 'neutral' },
} as const;

/** Dia YYYY-MM-DD de Fortaleza -> instante de inicio ou fim do dia (em Fortaleza). */
const limite = (d: string, fim: boolean) => new Date(`${d}T${fim ? '23:59:59' : '00:00:00'}-03:00`).toISOString();

export default function OrgaoAcessosPage() {
  const { id } = useParams<{ id: string }>();
  const hoje = todayFortaleza();
  const [de, setDe] = useState(() => todayFortaleza(new Date(Date.now() - 7 * 86_400_000)));
  const [ate, setAte] = useState(hoje);
  const [pagina, setPagina] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['sa-acessos', id, de, ate, pagina],
    queryFn: () =>
      api<{ items: AcessoView[]; total: number }>(
        `/superadmin/tenants/${id}/access?de=${encodeURIComponent(limite(de, false))}&ate=${encodeURIComponent(limite(ate, true))}&page=${pagina}&pageSize=${POR_PAGINA}`,
      ),
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="De" htmlFor="ac-de">
          <Input
            id="ac-de"
            type="date"
            value={de}
            max={ate}
            onChange={(e) => {
              setDe(e.target.value);
              setPagina(1);
            }}
          />
        </Field>
        <Field label="Até" htmlFor="ac-ate">
          <Input
            id="ac-ate"
            type="date"
            value={ate}
            min={de}
            max={hoje}
            onChange={(e) => {
              setAte(e.target.value);
              setPagina(1);
            }}
          />
        </Field>
      </div>
      {isLoading ? (
        <SkeletonTable rows={6} columns={5} label="Carregando acessos" />
      ) : !data?.items.length ? (
        <EmptyState icon={History} title="Nenhum acesso no período" description="Ajuste as datas." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Quando</th>
                  <th className="px-4 py-3 label-caps">Tipo</th>
                  <th className="px-4 py-3 label-caps">Usuário</th>
                  <th className="px-4 py-3 label-caps">IP</th>
                  <th className="px-4 py-3 label-caps">Navegador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">{fmtDateTime(a.quando)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={TIPO[a.tipo].tom}>{TIPO[a.tipo].label}</Badge>
                      {a.impersonacao && <span className="mt-1 block text-xs text-warning-600">por {a.impersonacao} (entrar como)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{a.usuario ?? '—'}</p>
                      <p className="text-xs text-ink-500">{a.email ?? ''}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600">{a.ip ?? '—'}</td>
                    <td className="px-4 py-3 text-ink-600">{a.navegador}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={data.total} onPageChange={setPagina} />
          </div>
        </Card>
      )}
    </div>
  );
}
