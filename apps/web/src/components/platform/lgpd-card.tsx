'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { LgpdPlataforma } from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, Card, CardBody, CardHeader, Field, Input, Textarea } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

/**
 * O que a JEOS publica como operadora na pagina de privacidade de todo orgao:
 * dados do operador, onde os dados ficam, suboperadores e compromissos.
 */
export function LgpdCard({ podeEditar }: { podeEditar: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['sa-lgpd'], queryFn: () => api<LgpdPlataforma>('/superadmin/lgpd') });
  const [f, setF] = useState<LgpdPlataforma | null>(null);
  const [compromissos, setCompromissos] = useState('');
  useEffect(() => {
    if (!data) return;
    setF(data);
    setCompromissos(data.compromissos.join('\n'));
  }, [data]);

  const salvar = useMutation({
    mutationFn: () =>
      api<LgpdPlataforma>('/superadmin/lgpd', {
        method: 'PUT',
        body: { ...f, compromissos: compromissos.split('\n').map((c) => c.trim()).filter(Boolean) },
      }),
    onSuccess: (d) => {
      qc.setQueryData(['sa-lgpd'], d);
      toast.success('Informações de privacidade salvas. Valem para a página de todos os órgãos.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });

  if (!f) return <Skeleton rows={6} />;
  const set = <K extends keyof LgpdPlataforma>(k: K, v: LgpdPlataforma[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const setSub = (i: number, k: 'nome' | 'finalidade' | 'local', v: string) =>
    set('suboperadores', f.suboperadores.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="Privacidade (LGPD)"
        description="Aparece na página pública de privacidade de cada órgão: a JEOS como operadora, onde os dados ficam e os compromissos do contrato."
      />
      <CardBody>
        <fieldset disabled={!podeEditar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Operador" htmlFor="lg-op">
              <Input id="lg-op" value={f.operadorNome} onChange={(e) => set('operadorNome', e.target.value)} />
            </Field>
            <Field label="CNPJ" htmlFor="lg-cnpj">
              <Input id="lg-cnpj" value={f.operadorCnpj} onChange={(e) => set('operadorCnpj', e.target.value)} />
            </Field>
            <Field label="E-mail de privacidade" htmlFor="lg-email">
              <Input id="lg-email" type="email" value={f.operadorEmail} onChange={(e) => set('operadorEmail', e.target.value)} />
            </Field>
          </div>
          <Field label="Região de hospedagem" htmlFor="lg-regiao">
            <Input id="lg-regiao" value={f.regiaoHospedagem} onChange={(e) => set('regiaoHospedagem', e.target.value)} />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-ink-700">Suboperadores</p>
            <div className="space-y-2">
              {f.suboperadores.map((s, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]">
                  <Input aria-label="Nome" value={s.nome} onChange={(e) => setSub(i, 'nome', e.target.value)} />
                  <Input aria-label="Finalidade" value={s.finalidade} onChange={(e) => setSub(i, 'finalidade', e.target.value)} />
                  <Input aria-label="Local" value={s.local} onChange={(e) => setSub(i, 'local', e.target.value)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${s.nome}`}
                    onClick={() => set('suboperadores', f.suboperadores.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              leftIcon={<Plus aria-hidden />}
              onClick={() => set('suboperadores', [...f.suboperadores, { nome: '', finalidade: '', local: '' }])}
            >
              Adicionar suboperador
            </Button>
          </div>
          <Field label="Compromissos (um por linha)" htmlFor="lg-comp">
            <Textarea id="lg-comp" rows={5} value={compromissos} onChange={(e) => setCompromissos(e.target.value)} />
          </Field>
          {podeEditar && (
            <div className="flex justify-end">
              <Button loading={salvar.isPending} onClick={() => salvar.mutate()}>
                Salvar privacidade
              </Button>
            </div>
          )}
        </fieldset>
      </CardBody>
    </Card>
  );
}
