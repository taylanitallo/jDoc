'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookText, Bot, ExternalLink, FileSpreadsheet, ShieldCheck, UserCheck } from 'lucide-react';
import type { PrivacidadeOrgao } from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

/**
 * LGPD do lado do orgao (controlador): encarregado de dados, uso de IA com
 * os documentos e o dicionario de metadados. A pagina publica junta isso com
 * o que a JEOS publica como operadora.
 */
export function PrivacidadeTab() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['configuracoes', 'privacidade'], queryFn: () => api<PrivacidadeOrgao>(`/t/${slug}/privacidade`) });
  const [form, setForm] = useState<PrivacidadeOrgao | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const salvar = useMutation({
    mutationFn: (f: PrivacidadeOrgao) => api<PrivacidadeOrgao>(`/t/${slug}/privacidade`, { method: 'PUT', body: f }),
    onSuccess: (f) => {
      qc.setQueryData(['configuracoes', 'privacidade'], f);
      qc.invalidateQueries({ queryKey: ['auth', 'me', slug] });
      toast.success('Privacidade salva.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'),
  });

  const dicionario = async (formato: 'pdf' | 'csv') => {
    setBaixando(formato);
    const aba = formato === 'pdf' ? window.open('', '_blank') : null;
    try {
      const url = await apiBlobUrl(`/t/${slug}/relatorios-arquivo/dicionario/${formato}`);
      if (aba) aba.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dicionario-metadados.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      aba?.close();
      toast.error(e instanceof ApiError && e.status === 403 ? 'Você não tem permissão (Acervo: ver).' : 'Não foi possível gerar o dicionário.');
    } finally {
      setBaixando(null);
    }
  };

  if (!form) return <Skeleton rows={6} />;
  const set = <K extends keyof PrivacidadeOrgao>(k: K, v: PrivacidadeOrgao[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={UserCheck}
          title="Encarregado pelo tratamento de dados (DPO)"
          description="Quem responde pelos dados pessoais no órgão (LGPD, art. 41). Aparece na página pública de privacidade."
          action={
            <a href={`/${slug}/privacidade`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
              Ver página pública <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          }
        />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nome" htmlFor="pv-nome">
              <Input id="pv-nome" value={form.encarregadoNome} onChange={(e) => set('encarregadoNome', e.target.value)} />
            </Field>
            <Field label="E-mail" htmlFor="pv-email">
              <Input id="pv-email" type="email" value={form.encarregadoEmail} onChange={(e) => set('encarregadoEmail', e.target.value)} />
            </Field>
            <Field label="Telefone" htmlFor="pv-tel">
              <Input id="pv-tel" value={form.encarregadoTelefone} onChange={(e) => set('encarregadoTelefone', e.target.value)} />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={Bot}
          title="Inteligência artificial"
          description="O assistente Ayla e a conferência por IA enviam trechos dos documentos para o provedor de IA. Os documentos nunca são usados para treinar modelos."
        />
        <CardBody>
          <label className="flex items-start gap-3 text-sm text-ink-800">
            <input type="checkbox" className="mt-0.5" checked={form.iaDesligada} onChange={(e) => set('iaDesligada', e.target.checked)} />
            <span>
              <span className="font-semibold">Não usar inteligência artificial com os documentos do órgão</span>
              <span className="block text-xs text-ink-500">Desliga o assistente e a conferência por IA para todos os usuários.</span>
            </span>
          </label>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button leftIcon={<ShieldCheck aria-hidden />} loading={salvar.isPending} onClick={() => salvar.mutate(form)}>
          Salvar privacidade
        </Button>
      </div>

      <Card>
        <CardHeader
          icon={BookText}
          title="Dicionário de metadados"
          description="Lista dos campos que descrevem cada documento (padrão e próprios de cada tipo) e o padrão de nomes usado na exportação."
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" leftIcon={<FileSpreadsheet aria-hidden />} loading={baixando === 'csv'} onClick={() => void dicionario('csv')}>
                CSV
              </Button>
              <Button size="sm" loading={baixando === 'pdf'} onClick={() => void dicionario('pdf')}>
                PDF
              </Button>
            </div>
          }
        />
      </Card>
    </div>
  );
}
