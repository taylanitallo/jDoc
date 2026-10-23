'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, Plus, Trash2 } from 'lucide-react';
import type { ContratoItemInput, ContratoItemView } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Button, Card, CardBody, CardHeader, Input } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { usePode } from '@/components/platform/admin-context';
import { BoletimMedicao } from '@/components/medicao/boletim';

/** Itens do contrato (um por secretaria) e o boletim mensal do orgao. */
export default function OrgaoContratoPage() {
  const { id } = useParams<{ id: string }>();
  const owner = usePode('owner');
  const editor = usePode('owner', 'implantacao');
  return (
    <div className="space-y-6">
      <ItensContrato tenantId={id} podeEditar={editor} />
      <BoletimMedicao base={`/superadmin/tenants/${id}/medicoes`} podeFechar={owner} />
    </div>
  );
}

function ItensContrato({ tenantId, podeEditar }: { tenantId: string; podeEditar: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['sa-contrato-itens', tenantId], queryFn: () => api<ContratoItemView[]>(`/superadmin/tenants/${tenantId}/contrato-itens`) });
  const [itens, setItens] = useState<ContratoItemInput[] | null>(null);
  useEffect(() => {
    if (data) setItens(data.map(({ id: _id, orgaoNome: _n, ...i }) => i));
  }, [data]);
  const salvar = useMutation({
    mutationFn: () => api<ContratoItemView[]>(`/superadmin/tenants/${tenantId}/contrato-itens`, { method: 'PUT', body: { itens } }),
    onSuccess: (r) => {
      qc.setQueryData(['sa-contrato-itens', tenantId], r);
      qc.invalidateQueries({ queryKey: ['medicao'] });
      toast.success('Itens do contrato salvos.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });
  if (!itens) return <Skeleton rows={4} />;
  const set = (i: number, campo: keyof ContratoItemInput, v: string | number | boolean | null) => setItens((xs) => xs!.map((x, j) => (j === i ? { ...x, [campo]: v } : x)));
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <Card>
      <CardHeader
        icon={FileSignature}
        title="Itens do contrato"
        description="Um item por secretaria, como no termo de referência: mensalidade do GED, preço por página e quantidade contratada."
      />
      <CardBody className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left">
              <tr>
                <th className="pb-2 label-caps">Item</th>
                <th className="pb-2 label-caps">Secretaria (código)</th>
                <th className="pb-2 label-caps">Descrição</th>
                <th className="pb-2 label-caps">GED/mês (R$)</th>
                <th className="pb-2 label-caps">R$/página</th>
                <th className="pb-2 label-caps">Páginas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((it, i) => (
                <tr key={i} className="align-top">
                  <td className="pb-2 pr-2">
                    <Input aria-label="Número do item" type="number" min={1} className="w-16" value={it.numero} disabled={!podeEditar} onChange={(e) => set(i, 'numero', num(e.target.value))} />
                  </td>
                  <td className="pb-2 pr-2">
                    <Input aria-label="Código da secretaria" className="w-24" value={it.orgaoCodigo ?? ''} disabled={!podeEditar} onChange={(e) => set(i, 'orgaoCodigo', e.target.value || null)} />
                  </td>
                  <td className="pb-2 pr-2">
                    <Input aria-label="Descrição" value={it.descricao} disabled={!podeEditar} onChange={(e) => set(i, 'descricao', e.target.value)} />
                  </td>
                  <td className="pb-2 pr-2">
                    <Input aria-label="GED por mês" type="number" min={0} step="0.01" className="w-28" value={it.valorMensalGed} disabled={!podeEditar} onChange={(e) => set(i, 'valorMensalGed', num(e.target.value))} />
                  </td>
                  <td className="pb-2 pr-2">
                    <Input aria-label="Valor por página" type="number" min={0} step="0.0001" className="w-24" value={it.valorPagina} disabled={!podeEditar} onChange={(e) => set(i, 'valorPagina', num(e.target.value))} />
                  </td>
                  <td className="pb-2 pr-2">
                    <Input aria-label="Páginas contratadas" type="number" min={0} className="w-28" value={it.paginasContratadas} disabled={!podeEditar} onChange={(e) => set(i, 'paginasContratadas', num(e.target.value))} />
                  </td>
                  <td className="pb-2">
                    {podeEditar && (
                      <Button variant="ghost" size="icon" aria-label="Remover item" onClick={() => setItens((xs) => xs!.filter((_, j) => j !== i))}>
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {podeEditar && (
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Plus aria-hidden />}
              onClick={() =>
                setItens((xs) => [
                  ...xs!,
                  { numero: (xs!.reduce((m, x) => Math.max(m, x.numero), 0) || 0) + 1, orgaoCodigo: null, descricao: '', valorMensalGed: 0, valorPagina: 0, paginasContratadas: 0, ativo: true },
                ])
              }
            >
              Item
            </Button>
            <Button loading={salvar.isPending} disabled={itens.some((i) => i.descricao.trim().length < 3)} onClick={() => salvar.mutate()}>
              Salvar itens
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
