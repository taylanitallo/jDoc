'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CheckCircle2, Clock, FileQuestion, FileWarning, History, Info, PieChart, RefreshCw, ShieldCheck, ShieldAlert, User } from 'lucide-react';
import {
  INTEGRIDADE_CICLO_DIAS,
  type IntegridadeResumo,
  type OcorrenciaIntegridadeView,
  type VerificacaoIntegridadeView,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHeader, Field, Modal, StatCard, Tabs, Textarea, TONE_VIVID } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { Colunas, Rosca } from '@/components/charts';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime } from '@/lib/format';

const fmtDataHora = (iso: string | null) =>
  fmtDateTime(iso, '—');
const MODULO_LABEL: Record<string, string> = {
  receitas: 'Receitas',
  despesas: 'Despesas',
  balancete: 'Balancete',
  extrato: 'Extrato',
  outros: 'Outros arquivos',
  acervo: 'Acervo',
};

export default function IntegridadePage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [situacao, setSituacao] = useState<'abertas' | 'resolvidas'>('abertas');
  const [tratando, setTratando] = useState<OcorrenciaIntegridadeView | null>(null);

  const { data: resumo } = useQuery<IntegridadeResumo>({
    queryKey: ['integridade', 'resumo', slug],
    queryFn: () => api(`/t/${slug}/integridade/resumo`),
    // Enquanto a verificacao roda, atualiza sozinho.
    refetchInterval: (q) => (q.state.data?.ultimaVerificacao?.status === 'processando' ? 3000 : false),
  });
  const processando = resumo?.ultimaVerificacao?.status === 'processando';

  const { data: ocorrencias, isLoading: carregandoOc } = useQuery<OcorrenciaIntegridadeView[]>({
    queryKey: ['integridade', 'ocorrencias', slug, situacao, resumo?.ultimaVerificacao?.status],
    queryFn: () => api(`/t/${slug}/integridade/ocorrencias?situacao=${situacao}`),
  });
  const { data: verificacoes } = useQuery<VerificacaoIntegridadeView[]>({
    queryKey: ['integridade', 'verificacoes', slug, resumo?.ultimaVerificacao?.status],
    queryFn: () => api(`/t/${slug}/integridade/verificacoes`),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['integridade'] });
  const verificar = useMutation({
    mutationFn: () => api<VerificacaoIntegridadeView>(`/t/${slug}/integridade/verificar`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Verificação iniciada. O resultado aparece aqui quando terminar.');
      invalidar();
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 403
          ? 'Você não tem permissão para iniciar a verificação.'
          : e instanceof ApiError
            ? e.message
            : 'Falha ao iniciar a verificação',
      ),
  });

  const pctCiclo = resumo && resumo.totalArquivos > 0 ? Math.round((resumo.verificadosNoCiclo / resumo.totalArquivos) * 100) : 0;
  const abertas = resumo?.ocorrenciasAbertas ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-white shadow-md', TONE_VIVID.teal.chip)}>
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Integridade do acervo digital</h1>
            <p className="mt-0.5 text-sm text-ink-500">
              Confere se cada arquivo continua idêntico ao que foi arquivado (impressão digital SHA-256).
            </p>
          </div>
        </div>
        <Button onClick={() => verificar.mutate()} loading={verificar.isPending || processando} leftIcon={<RefreshCw aria-hidden />}>
          {processando ? 'Verificando…' : 'Verificar agora'}
        </Button>
      </div>

      {abertas > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-[12px] border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-600">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            <strong>{abertas === 1 ? '1 arquivo com problema' : `${abertas} arquivos com problema`}.</strong> Restaure a partir do backup
            ou redigitalize o original em papel e registre o tratamento abaixo.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Arquivos no acervo digital" value={(resumo?.totalArquivos ?? 0).toLocaleString('pt-BR')} icon={ShieldCheck} tone="teal" loading={!resumo} hint="Documentos e anexos com impressão digital" />
        <StatCard
          label={`Conferidos (${INTEGRIDADE_CICLO_DIAS} dias)`}
          value={`${pctCiclo}%`}
          icon={CheckCircle2}
          tone="success"
          loading={!resumo}
          hint={`${(resumo?.verificadosNoCiclo ?? 0).toLocaleString('pt-BR')} íntegros no ciclo`}
        />
        <StatCard label="Nunca conferidos" value={(resumo?.nuncaVerificados ?? 0).toLocaleString('pt-BR')} icon={History} tone="info" loading={!resumo} hint="Entram nas próximas verificações" />
        <StatCard label="Ocorrências abertas" value={abertas.toLocaleString('pt-BR')} icon={AlertTriangle} tone={abertas > 0 ? 'danger' : 'neutral'} loading={!resumo} hint={abertas > 0 ? 'Exigem tratamento' : 'Nenhum problema'} />
      </div>

      {resumo && resumo.totalArquivos > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader title="Situação dos arquivos" description={`Ciclo de ${INTEGRIDADE_CICLO_DIAS} dias`} icon={PieChart} />
            <CardBody>
              <Rosca
                rotuloCentro="arquivos"
                fatias={[
                  { rotulo: 'Íntegros no ciclo', valor: resumo.verificadosNoCiclo, cor: 'var(--color-success-500)' },
                  {
                    rotulo: 'Aguardando reconferência',
                    valor: Math.max(0, resumo.totalArquivos - resumo.verificadosNoCiclo - resumo.nuncaVerificados - abertas),
                    cor: 'var(--color-info-500)',
                  },
                  { rotulo: 'Nunca conferidos', valor: resumo.nuncaVerificados, cor: 'var(--color-ink-300)' },
                  { rotulo: 'Com problema', valor: abertas, cor: 'var(--color-danger-500)' },
                ]}
              />
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader title="Arquivos conferidos por verificação" description="Últimas execuções, da mais antiga para a mais recente" icon={BarChart3} />
            <CardBody>
              <Colunas
                cor="var(--color-teal-500)"
                unidade="arquivo(s)"
                dados={[...(verificacoes ?? [])]
                  .slice(0, 14)
                  .reverse()
                  .map((v) => ({
                    rotulo: fmtDate(v.iniciadaEm).slice(0, 5),
                    valor: v.total,
                    extra: v.divergentes + v.ausentes > 0 ? `${v.divergentes + v.ausentes} problema(s)` : 'sem problemas',
                  }))}
              />
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader
          title="Ocorrências"
          description="Arquivos alterados ou que sumiram do armazenamento"
          icon={FileWarning}
          action={
            <Tabs
              value={situacao}
              onChange={setSituacao}
              items={[
                { id: 'abertas', label: 'Abertas', count: abertas },
                { id: 'resolvidas', label: 'Resolvidas' },
              ]}
            />
          }
        />
        <CardBody className="p-0">
          {carregandoOc ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((k) => (
                <div key={k} className="h-12 animate-pulse rounded-[10px] bg-ink-100" />
              ))}
            </div>
          ) : !ocorrencias || ocorrencias.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={situacao === 'abertas' ? CheckCircle2 : History}
                title={situacao === 'abertas' ? 'Nenhum problema encontrado' : 'Nenhuma ocorrência resolvida'}
                description={
                  situacao === 'abertas'
                    ? 'Todos os arquivos conferidos estão idênticos ao original arquivado.'
                    : 'As ocorrências tratadas aparecem aqui, com o registro do que foi feito.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {ocorrencias.map((o) => (
                <li key={o.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-white shadow-sm',
                      o.tipo === 'divergente' ? TONE_VIVID.danger.chip : TONE_VIVID.warning.chip,
                    )}
                  >
                    {o.tipo === 'divergente' ? <FileWarning className="h-5 w-5" aria-hidden /> : <FileQuestion className="h-5 w-5" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-ink-900">{o.documento}</p>
                      <Badge tone={o.tipo === 'divergente' ? 'danger' : 'warning'}>{o.tipo === 'divergente' ? 'Alterado' : 'Ausente'}</Badge>
                      <Badge tone="neutral">{MODULO_LABEL[o.modulo] ?? o.modulo}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {o.arquivo} · detectado em {fmtDataHora(o.detectadaEm)}
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      {o.tipo === 'divergente'
                        ? 'O conteúdo do arquivo mudou desde o arquivamento: pode ter sido corrompido ou adulterado.'
                        : 'O arquivo não foi encontrado no armazenamento.'}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] text-ink-400">
                      esperado {o.hashEsperado.slice(0, 16)}… {o.hashEncontrado ? `· encontrado ${o.hashEncontrado.slice(0, 16)}…` : ''}
                    </p>
                    {o.resolvidaEm && (
                      <p className="mt-2 rounded-[8px] bg-success-50 px-3 py-2 text-xs text-success-600">
                        <strong>Resolvida em {fmtDataHora(o.resolvidaEm)}</strong>
                        {o.resolvidaPor ? ` por ${o.resolvidaPor}` : ' automaticamente'}: {o.observacao}
                      </p>
                    )}
                  </div>
                  {!o.resolvidaEm && (
                    <Button variant="outline" size="sm" onClick={() => setTratando(o)}>
                      Registrar tratamento
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Histórico de verificações" description="Execuções automáticas e manuais" icon={History} />
          <CardBody className="p-0">
            {verificacoes && verificacoes.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-500">
                Nenhuma verificação ainda. A primeira roda automaticamente esta madrugada, ou clique em “Verificar agora”.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {(verificacoes ?? []).map((v) => {
                  const problemas = v.divergentes + v.ausentes;
                  return (
                    <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                      <span
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-white shadow-sm',
                          v.status === 'erro' || problemas > 0 ? TONE_VIVID.danger.chip : v.status === 'processando' ? TONE_VIVID.info.chip : TONE_VIVID.success.chip,
                        )}
                      >
                        {v.origem === 'manual' ? <User className="h-4 w-4" aria-hidden /> : <Clock className="h-4 w-4" aria-hidden />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink-900">{fmtDataHora(v.iniciadaEm)}</p>
                        <p className="truncate text-xs text-ink-500">
                          {v.origem === 'manual' ? `Manual${v.iniciadaPor ? ` · ${v.iniciadaPor}` : ''}` : 'Automática (madrugada)'}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-xs tabular-nums">
                        <span className="text-ink-500">
                          <strong className="text-sm text-ink-900">{v.total.toLocaleString('pt-BR')}</strong> arquivos
                        </span>
                        <span className="text-success-600">
                          <strong className="text-sm">{v.ok.toLocaleString('pt-BR')}</strong> íntegros
                        </span>
                        <span className={problemas > 0 ? 'font-semibold text-danger-600' : 'text-ink-400'}>
                          <strong className="text-sm">{problemas.toLocaleString('pt-BR')}</strong> problemas
                        </span>
                      </div>
                      <Badge tone={v.status === 'concluida' ? 'success' : v.status === 'erro' ? 'danger' : 'info'}>
                        {v.status === 'concluida' ? 'Concluída' : v.status === 'erro' ? 'Erro' : 'Em andamento'}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Como funciona" icon={Info} />
          <CardBody className="space-y-3 text-sm text-ink-600">
            <p>Ao arquivar, o sistema grava a impressão digital (SHA-256) de cada PDF.</p>
            <p>
              Toda madrugada ele confere os arquivos que não são verificados há mais de {INTEGRIDADE_CICLO_DIAS} dias. Assim, todo o
              acervo é conferido ao menos uma vez por mês.
            </p>
            <p>
              Se um arquivo mudar ou sumir, abre uma ocorrência. Ela fecha sozinha se o arquivo for restaurado, ou quando alguém
              registrar o que foi feito.
            </p>
          </CardBody>
        </Card>
      </div>

      <TratarModal
        slug={String(slug)}
        ocorrencia={tratando}
        onClose={() => setTratando(null)}
        onDone={() => {
          setTratando(null);
          invalidar();
        }}
      />
    </div>
  );
}

function TratarModal({
  slug,
  ocorrencia,
  onClose,
  onDone,
}: {
  slug: string;
  ocorrencia: OcorrenciaIntegridadeView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [observacao, setObservacao] = useState('');
  const salvar = useMutation({
    mutationFn: () =>
      api(`/t/${slug}/integridade/ocorrencias/${ocorrencia!.id}/resolver`, { method: 'POST', body: { observacao: observacao.trim() } }),
    onSuccess: () => {
      toast.success('Tratamento registrado.');
      setObservacao('');
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao registrar'),
  });
  const valido = observacao.trim().length >= 5;

  return (
    <Modal
      open={ocorrencia !== null}
      onClose={() => !salvar.isPending && onClose()}
      title="Registrar tratamento"
      subtitle={ocorrencia?.documento}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={!valido} loading={salvar.isPending}>
            Registrar
          </Button>
        </>
      }
    >
      <Field label="O que foi feito" htmlFor="obs-integridade" required hint="Ex.: restaurado do backup de 12/09; redigitalizado do original da caixa CX-0012.">
        <Textarea id="obs-integridade" rows={4} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </Field>
    </Modal>
  );
}
