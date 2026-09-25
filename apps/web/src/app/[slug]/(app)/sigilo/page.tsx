'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Info, Lock, LockOpen, ScrollText, ShieldAlert, Timer } from 'lucide-react';
import { GRAUS_SIGILO, GRAU_SIGILO_LABEL, PRAZO_SIGILO_ANOS, type SigiloResumo, type TermoSigiloView } from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Field, Modal, StatCard, Tabs, Textarea, TONE_VIVID } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { GRAU_TOM } from '@/components/documents/sigilo-documento';
import { cn } from '@/lib/cn';

const br = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—');

export default function SigiloPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();
  const [situacao, setSituacao] = useState<'vigentes' | 'encerrados'>('vigentes');
  const [desclassificando, setDesclassificando] = useState<TermoSigiloView | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const { data: resumo } = useQuery<SigiloResumo>({ queryKey: ['sigilo', 'resumo', slug], queryFn: () => api(`/t/${slug}/sigilo/resumo`) });
  const { data: termos, isLoading, error } = useQuery<TermoSigiloView[]>({
    queryKey: ['sigilo', 'termos', slug, situacao],
    queryFn: () => api(`/t/${slug}/sigilo/termos?situacao=${situacao}`),
  });

  const abrirPdf = async (chave: string, path: string) => {
    setBaixando(chave);
    const aba = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(path);
      if (aba) aba.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      aba?.close();
      toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar o PDF');
    } finally {
      setBaixando(null);
    }
  };
  const totalVigentes = resumo ? GRAUS_SIGILO.reduce((s, g) => s + resumo.vigentesPorGrau[g], 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.danger.chip)}>
            <ShieldAlert className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Sigilo (Lei de Acesso à Informação)</h1>
            <p className="mt-0.5 text-sm text-ink-500">Informações classificadas, prazos e desclassificação. Vencido o prazo, o documento volta a ser público sozinho.</p>
          </div>
        </div>
        <Button variant="outline" leftIcon={<ScrollText aria-hidden />} loading={baixando === 'rol'} onClick={() => void abrirPdf('rol', `/t/${slug}/sigilo/rol`)}>
          Rol anual (art. 30)
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {GRAUS_SIGILO.map((g) => (
          <StatCard
            key={g}
            label={GRAU_SIGILO_LABEL[g]}
            value={resumo?.vigentesPorGrau[g] ?? 0}
            icon={Lock}
            tone={GRAU_TOM[g]}
            loading={!resumo}
            hint={`Até ${PRAZO_SIGILO_ANOS[g]} anos da produção`}
          />
        ))}
      </div>
      {resumo && (resumo.expirandoEm30Dias > 0 || resumo.desclassificados12Meses > 0) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {resumo.expirandoEm30Dias > 0 && (
            <span className="flex items-center gap-2 rounded-[10px] bg-warning-50 px-3 py-2 text-warning-600">
              <Timer className="h-4 w-4" aria-hidden />
              {resumo.expirandoEm30Dias} perde(m) o sigilo nos próximos 30 dias
            </span>
          )}
          {resumo.desclassificados12Meses > 0 && (
            <span className="flex items-center gap-2 rounded-[10px] bg-success-50 px-3 py-2 text-success-600">
              <LockOpen className="h-4 w-4" aria-hidden />
              {resumo.desclassificados12Meses} desclassificado(s) nos últimos 12 meses
            </span>
          )}
        </div>
      )}

      <Card>
        <CardHeader
          title="Termos de classificação"
          description="Cada classificação gera um Termo de Classificação de Informação (TCI)"
          icon={FileText}
          action={
            <Tabs
              value={situacao}
              onChange={setSituacao}
              items={[
                { id: 'vigentes', label: 'Vigentes', count: totalVigentes },
                { id: 'encerrados', label: 'Encerrados' },
              ]}
            />
          }
        />
        {error ? (
          <CardBody>
            <EmptyState icon={Lock} title="Sem acesso" description={error instanceof ApiError ? error.message : 'Falha ao carregar'} />
          </CardBody>
        ) : isLoading ? (
          <CardBody className="space-y-3">
            {[0, 1].map((k) => (
              <div key={k} className="h-14 animate-pulse rounded-[10px] bg-ink-100" />
            ))}
          </CardBody>
        ) : !termos || termos.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={situacao === 'vigentes' ? LockOpen : FileText}
              title={situacao === 'vigentes' ? 'Nenhuma informação classificada' : 'Nenhum termo encerrado'}
              description={situacao === 'vigentes' ? 'Para classificar, abra o documento no Acervo (editar) e use "Classificar sigilo".' : 'Desclassificações e fins de prazo aparecem aqui.'}
            />
          </CardBody>
        ) : (
          <ul className="divide-y divide-ink-100">
            {termos.map((t) => (
              <li key={t.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-ink-500">{t.numeroTci}</span>
                    <Badge tone={GRAU_TOM[t.grau]}>{GRAU_SIGILO_LABEL[t.grau]}</Badge>
                    {t.status !== 'vigente' && <Badge tone="success">{t.status === 'expirado' ? 'Prazo encerrado' : 'Desclassificado'}</Badge>}
                  </div>
                  <p className="mt-0.5 truncate font-semibold text-ink-900">{t.documento}</p>
                  <p className="truncate text-xs text-ink-500">{t.fundamento}</p>
                  <p className="text-xs text-ink-400">
                    {t.autoridadeNome} ({t.autoridadeCargo}) · classificado em {br(t.dataClassificacao)}
                    {t.status === 'vigente' ? ` · até ${br(t.prazoFim)}` : ` · encerrado em ${br(t.encerradoEm)}`}
                  </p>
                  {t.motivoEncerramento && <p className="mt-1 text-xs text-success-600">{t.motivoEncerramento}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {t.diasRestantes !== null && (
                    <Badge tone={t.diasRestantes <= 30 ? 'warning' : 'neutral'}>
                      {t.diasRestantes > 365 ? `${Math.floor(t.diasRestantes / 365)} ano(s)` : `${t.diasRestantes} dia(s)`}
                    </Badge>
                  )}
                  <Button size="sm" variant="outline" leftIcon={<FileText aria-hidden />} loading={baixando === t.id} onClick={() => void abrirPdf(t.id, `/t/${slug}/sigilo/termos/${t.id}/tci`)}>
                    TCI
                  </Button>
                  {t.status === 'vigente' && (
                    <Button size="sm" variant="outline" leftIcon={<LockOpen aria-hidden />} onClick={() => setDesclassificando(t)}>
                      Desclassificar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Como funciona" icon={Info} />
        <CardBody className="grid grid-cols-1 gap-4 text-sm text-ink-600 md:grid-cols-3">
          <p>
            <strong className="text-ink-900">Classificar:</strong> no documento, informe o grau, a hipótese legal (art. 23 ou 31), as razões e a autoridade. O
            documento passa a ser restrito e o TCI fica registrado.
          </p>
          <p>
            <strong className="text-ink-900">Prazo:</strong> conta da data de produção — reservado 5 anos, secreto 15, ultrassecreto 25 e informação pessoal
            100. Vencido, o sigilo cai sozinho e o acesso anterior volta.
          </p>
          <p>
            <strong className="text-ink-900">Publicação:</strong> o rol anual (art. 30) lista quantos documentos há em cada grau e o que foi desclassificado nos
            últimos 12 meses.
          </p>
        </CardBody>
      </Card>

      {desclassificando && <DesclassificarModal slug={String(slug)} termo={desclassificando} onClose={() => setDesclassificando(null)} />}
    </div>
  );
}

function DesclassificarModal({ slug, termo, onClose }: { slug: string; termo: TermoSigiloView; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const salvar = useMutation({
    mutationFn: () => api(`/t/${slug}/sigilo/termos/${termo.id}/desclassificar`, { method: 'POST', body: { motivo: motivo.trim() } }),
    onSuccess: () => {
      toast.success('Informação desclassificada. O acesso anterior foi restaurado.');
      qc.invalidateQueries({ queryKey: ['sigilo'] });
      qc.invalidateQueries({ queryKey: ['docs'] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Você não tem permissão para desclassificar.' : e.message) : 'Falha'),
  });
  return (
    <Modal
      open
      onClose={() => !salvar.isPending && onClose()}
      title="Desclassificar informação"
      subtitle={`${termo.numeroTci} · ${termo.documento}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button leftIcon={<LockOpen aria-hidden />} onClick={() => salvar.mutate()} loading={salvar.isPending} disabled={motivo.trim().length < 10}>
            Desclassificar
          </Button>
        </>
      }
    >
      <Field label="Motivo" htmlFor="ds-motivo" required hint="Ex.: fiscalização concluída; risco deixou de existir (art. 29).">
        <Textarea id="ds-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Field>
    </Modal>
  );
}
