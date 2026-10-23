'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  Clock,
  CloudOff,
  Copy,
  DatabaseBackup,
  Download,
  FileArchive,
  FileText,
  HardDriveDownload,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { STATUS_EXPORTACAO_LABEL, type ContinuidadeView, type ExportacaoView, type RestauracaoTesteView } from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, StatCard, Textarea, formatBytes } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

/**
 * Continuidade do servico (TR): RPO/RTO, backups, copia segregada, testes de
 * restauracao, disponibilidade, relatorio mensal e exportacao integral. A
 * mesma tela serve ao orgao (`/t/<slug>`) e ao painel da plataforma
 * (`/superadmin/tenants/<id>`), com acoes extras para a equipe.
 */
export function PainelContinuidade({ base, plataforma = false, podeExportar }: { base: string; plataforma?: boolean; podeExportar: boolean }) {
  const { data: c } = useQuery({ queryKey: ['continuidade', base], queryFn: () => api<ContinuidadeView>(`${base}/continuidade`) });
  if (!c) return <Skeleton rows={8} />;
  const ultimo = c.ultimoTesteRestauracao;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Perda máxima de dados (RPO)" value={`${c.rpoHoras} h`} icon={DatabaseBackup} tone="brand" hint="Backup diário" />
        <StatCard label="Tempo para voltar (RTO)" value={`${c.rtoHoras} h`} icon={Clock} tone="info" />
        <StatCard
          label="Disponibilidade no mês"
          value={c.disponibilidadeMes === null ? '—' : `${c.disponibilidadeMes.toFixed(2)}%`}
          icon={Activity}
          tone={c.disponibilidadeMes !== null && c.disponibilidadeMes < c.metaDisponibilidade ? 'danger' : 'success'}
          hint={`Meta: ${c.metaDisponibilidade}%`}
        />
        <StatCard
          label="Último backup"
          value={c.ultimoBackup ? fmtDateTime(c.ultimoBackup.em) : 'Nenhum'}
          icon={HardDriveDownload}
          tone={c.ultimoBackup ? 'teal' : 'danger'}
          hint={`${c.backupsNoMes} no mês${c.ultimoBackup?.bytes ? ` · ${formatBytes(c.ultimoBackup.bytes)}` : ''}`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            icon={c.copiaSegregada.configurada ? Copy : CloudOff}
            title="Cópia segregada"
            description="PDFs e backups do banco copiados todo dia para um armazenamento separado do principal."
          />
          <CardBody className="space-y-1 text-sm">
            {c.copiaSegregada.configurada ? (
              <>
                <p className="font-semibold text-ink-900">{c.copiaSegregada.destino}</p>
                <p className="text-ink-700">
                  {c.copiaSegregada.arquivosCopiados.toLocaleString('pt-BR')} arquivo(s) copiado(s)
                  {c.copiaSegregada.arquivosPendentes > 0 ? ` · ${c.copiaSegregada.arquivosPendentes.toLocaleString('pt-BR')} na próxima cópia` : ' · tudo copiado'}
                </p>
                <p className="text-xs text-ink-500">Última cópia: {c.copiaSegregada.ultimaCopia ? fmtDateTime(c.copiaSegregada.ultimaCopia) : '—'}</p>
              </>
            ) : (
              <p className="text-danger-600">Destino segregado ainda não configurado no servidor.</p>
            )}
          </CardBody>
        </Card>

        <TestesRestauracao base={base} plataforma={plataforma} testes={c.testesRestauracao} ultimo={ultimo} />
      </div>

      <Disponibilidade dias={c.disponibilidade} meta={c.metaDisponibilidade} />
      <RelatorioMensal base={base} />
      {podeExportar && <Exportacao base={base} plataforma={plataforma} />}
      {plataforma && <AceiteMigracao base={base} migracao={c.migracao} />}
    </div>
  );
}

function TestesRestauracao({
  base,
  plataforma,
  testes,
  ultimo,
}: {
  base: string;
  plataforma: boolean;
  testes: RestauracaoTesteView[];
  ultimo: RestauracaoTesteView | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const testar = useMutation({
    mutationFn: () => api<RestauracaoTesteView>(`${base}/continuidade/teste-restauracao`, { method: 'POST' }),
    onSuccess: (r) => {
      toast[r.status === 'sucesso' ? 'success' : 'error'](r.status === 'sucesso' ? 'Backup restaurado e conferido.' : `Teste falhou: ${r.erro ?? ''}`);
      qc.invalidateQueries({ queryKey: ['continuidade', base] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível testar.'),
  });
  return (
    <Card>
      <CardHeader
        icon={ShieldCheck}
        title="Testes de restauração"
        description="O último backup é restaurado num banco temporário, conferido (documentos, auditoria, arquivos) e descartado."
        action={
          plataforma && (
            <Button size="sm" variant="outline" leftIcon={<PlayCircle aria-hidden />} loading={testar.isPending} onClick={() => testar.mutate()}>
              Testar agora
            </Button>
          )
        }
      />
      <CardBody className="space-y-2 text-sm">
        {!ultimo ? (
          <p className="text-ink-500">Nenhum teste ainda. O sistema testa um órgão por dia, em rodízio.</p>
        ) : (
          <ul className="space-y-1.5">
            {testes.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-start gap-2">
                {t.status === 'sucesso' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" aria-hidden />
                )}
                <span>
                  <span className="font-semibold text-ink-900">{fmtDateTime(t.criadoEm)}</span>
                  <span className="text-ink-600">
                    {' '}
                    · {t.status === 'sucesso' ? `${t.documentos ?? 0} documento(s), auditoria ${t.auditoriaIntegra === false ? 'com falha' : 'íntegra'}, ${t.arquivosOk ?? 0}/${t.arquivosConferidos ?? 0} arquivo(s) conferidos` : t.erro}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Disponibilidade({ dias, meta }: { dias: ContinuidadeView['disponibilidade']; meta: number }) {
  return (
    <Card>
      <CardHeader icon={Activity} title="Disponibilidade nos últimos 30 dias" description="Minutos do dia em que o sistema respondeu." />
      <CardBody>
        {dias.length === 0 ? (
          <p className="text-sm text-ink-500">Medição começa a contar a partir de agora.</p>
        ) : (
          <div className="flex h-28 items-end gap-1" role="img" aria-label="Disponibilidade por dia">
            {dias.map((d) => (
              <div key={d.dia} className="flex h-full flex-1 flex-col justify-end" title={`${d.dia.split('-').reverse().join('/')}: ${d.percentual.toFixed(2)}%`}>
                <div className={cn('w-full rounded-t-[3px]', d.percentual >= meta ? 'bg-success-500' : 'bg-danger-500')} style={{ height: `${Math.max(4, d.percentual)}%` }} />
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RelatorioMensal({ base }: { base: string }) {
  const toast = useToast();
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [gerando, setGerando] = useState(false);
  const baixar = async () => {
    setGerando(true);
    const aba = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(`${base}/continuidade/relatorio-mensal?mes=${mes}`);
      if (aba) aba.location.href = url;
    } catch (e) {
      aba?.close();
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível gerar o relatório.');
    } finally {
      setGerando(false);
    }
  };
  return (
    <Card>
      <CardHeader
        icon={FileText}
        title="Relatório mensal"
        description="Disponibilidade, backups, testes de restauração, chamados com SLA e páginas digitalizadas aceitas: anexo da medição do mês."
      />
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Mês" htmlFor="rm-mes">
          <Input id="rm-mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </Field>
        <Button leftIcon={<Download aria-hidden />} loading={gerando} disabled={!mes} onClick={() => void baixar()}>
          Gerar PDF
        </Button>
      </CardBody>
    </Card>
  );
}

function Exportacao({ base, plataforma }: { base: string; plataforma: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [secretaria, setSecretaria] = useState('');
  const { data: lista } = useQuery({
    queryKey: ['exportacoes', base],
    queryFn: () => api<ExportacaoView[]>(`${base}/exportacoes`),
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'pendente' || e.status === 'processando') ? 3000 : false),
  });
  const gerar = useMutation({
    mutationFn: () => api<ExportacaoView>(`${base}/exportacoes`, { method: 'POST', body: secretaria.trim() ? { orgaoCodigo: secretaria.trim() } : {} }),
    onSuccess: () => {
      toast.success('Exportação na fila. Os pacotes aparecem aqui quando ficarem prontos.');
      qc.invalidateQueries({ queryKey: ['exportacoes', base] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível gerar.'),
  });
  const baixar = async (e: ExportacaoView, numero: number) => {
    try {
      const r = await api<{ url: string }>(`${base}/exportacoes/${e.id}/partes/${numero}/url`);
      window.open(r.url, '_blank');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível baixar.');
    }
  };
  return (
    <Card>
      <CardHeader
        icon={FileArchive}
        title="Exportação integral"
        description="Todos os PDFs na estrutura de pastas padrão, metadados em CSV e JSON, plano de classificação, trilha de auditoria, dicionário e hashes SHA-256. Formatos abertos, prontos para migrar."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Só uma secretaria (código, opcional)" htmlFor="ex-sec">
            <Input id="ex-sec" value={secretaria} onChange={(e) => setSecretaria(e.target.value)} placeholder="Ex.: 06" className="sm:w-48" />
          </Field>
          <Button leftIcon={<FileArchive aria-hidden />} loading={gerar.isPending} onClick={() => gerar.mutate()}>
            Gerar exportação
          </Button>
        </div>
        {!lista?.length ? (
          <p className="text-sm text-ink-500">Nenhuma exportação gerada.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-[12px] border border-ink-200/70">
            {lista.map((e) => (
              <li key={e.id} className="space-y-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.status === 'concluido' ? (e.expirada ? 'neutral' : 'success') : e.status === 'erro' ? 'danger' : 'warning'}>
                    {e.expirada ? 'Expirada' : STATUS_EXPORTACAO_LABEL[e.status]}
                  </Badge>
                  <span className="font-semibold text-ink-900">{fmtDateTime(e.criadoEm)}</span>
                  <span className="text-ink-500">
                    {e.orgaoCodigo ? `Secretaria ${e.orgaoCodigo}` : 'Órgão inteiro'} · {e.solicitadoPor ?? '—'}
                    {e.documentos !== null ? ` · ${e.documentos} documento(s), ${e.arquivos} arquivo(s), ${formatBytes(e.bytes ?? 0)}` : ''}
                  </span>
                </div>
                {e.erro && <p className="text-xs text-danger-600">{e.erro}</p>}
                {e.status === 'concluido' && !e.expirada && (
                  <div className="flex flex-wrap gap-2">
                    {e.partes.map((p) => (
                      <Button key={p.numero} size="sm" variant="outline" leftIcon={<Download aria-hidden />} onClick={() => void baixar(e, p.numero)}>
                        Parte {p.numero} de {e.partes.length} ({formatBytes(p.bytes)})
                      </Button>
                    ))}
                  </div>
                )}
                {e.status === 'concluido' && !e.expirada && e.expiraEm && (
                  <p className="text-xs text-ink-500">
                    Disponível até {fmtDateTime(e.expiraEm)}. {plataforma ? 'O download pede confirmação de identidade.' : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function AceiteMigracao({ base, migracao }: { base: string; migracao: ContinuidadeView['migracao'] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [obs, setObs] = useState('');
  const registrar = useMutation({
    mutationFn: () => api(`${base}/migracao-aceite`, { method: 'POST', body: { observacao: obs.trim() } }),
    onSuccess: () => {
      toast.success('Aceite da migração registrado.');
      qc.invalidateQueries({ queryKey: ['continuidade', base] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível registrar.'),
  });
  return (
    <Card>
      <CardHeader
        icon={CheckCircle2}
        title="Plano de saída — aceite da migração"
        description="O órgão só pode ser excluído depois de receber a exportação integral e confirmar que conferiu os dados."
      />
      <CardBody className="space-y-3">
        {migracao.aceitaEm ? (
          <p className="text-sm text-success-600">
            Aceite registrado por {migracao.aceitaPor} em {fmtDateTime(migracao.aceitaEm)}: {migracao.observacao}
          </p>
        ) : (
          <>
            <Field label="Quem recebeu e como conferiu" htmlFor="am-obs">
              <Textarea id="am-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: Secretário de Administração recebeu os 3 pacotes em 20/10; hashes conferidos." />
            </Field>
            <Button loading={registrar.isPending} disabled={obs.trim().length < 5} onClick={() => registrar.mutate()}>
              Registrar aceite
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
