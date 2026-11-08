'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, LogOut } from 'lucide-react';
import type { AdminSessao } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';

/** "Aparelhos conectados" (orgao e superadmin; muda so a rota e o texto). */
export function SessoesAtivas({ rota, descricao }: { rota: string; descricao: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['sessoes', rota];
  const { data: sessoes } = useQuery({ queryKey: chave, queryFn: () => api<AdminSessao[]>(rota) });
  const encerrar = useMutation({
    mutationFn: (id: string) => api(`${rota}/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Sessão encerrada.');
      await qc.invalidateQueries({ queryKey: chave });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível encerrar.'),
  });

  return (
    <Card id="aparelhos" className="scroll-mt-24">
      <CardHeader icon={Laptop} title="Aparelhos conectados" description={descricao} />
      {!sessoes ? (
        <div className="p-5">
          <Skeleton rows={2} />
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {sessoes.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-ink-100 text-ink-600">
                <Laptop className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-900">
                  {s.dispositivo}
                  {s.atual && <Badge tone="success">Este aparelho</Badge>}
                </p>
                <p className="text-xs text-ink-500">
                  {s.ip ?? 'IP desconhecido'} · último uso {fmtRelative(s.ultimoUso)}
                </p>
              </div>
              {!s.atual && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<LogOut aria-hidden />}
                  loading={encerrar.isPending && encerrar.variables === s.id}
                  onClick={() => encerrar.mutate(s.id)}
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
