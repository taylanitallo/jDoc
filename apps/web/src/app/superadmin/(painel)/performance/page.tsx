'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Layers,
  ListChecks,
  Server,
  Timer,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  SEVERIDADE_LABEL,
  type Correcao,
  type PainelPerformance,
  type RequisicaoLenta,
  type ResultadoCorrecoes,
  type SeveridadeCorrecao,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtDuracao, fmtRelative, fmtTime } from '@/lib/format';
import { Badge, Button, Card, CardHeader, Modal, PageHeader, StatCard, Tabs, type Tone } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { Linhas } from '@/components/charts';
import { useToast } from '@/components/toast';
import { usePode } from '@/components/platform/admin-context';

const PERIODOS = [
  { id: '1', label: '1 h' },
  { id: '6', label: '6 h' },
  { id: '24', label: '24 h' },
  { id: '168', label: '7 dias' },
] as const;
const TOM_SEV: Record<SeveridadeCorrecao, Tone> = { critica: 'danger', media: 'warning', baixa: 'neutral' };
const NOME_FILA: Record<string, string> = {
  'document-ocr': 'Leitura de texto (OCR)',
  'document-conferencia': 'Conferência por IA',
  'signature-validation': 'Validação de assinaturas',
  'labels-import': 'Importação de etiquetas',
  reports: 'Relatórios',
  integridade: 'Integridade',
  sigilo: 'Sigilo',
  'jdoc-backups': 'Backups',
};

export default function PerformancePage() {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id']>('24');
  const horas = Number(periodo);
  const { data, isLoading } = useQuery({
    queryKey: ['sa-performance', horas],
    queryFn: () => api<PainelPerformance>(`/superadmin/performance?horas=${horas}`),
    refetchInterval: 60_000,
  });
  const [verLentas, setVerLentas] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        description="Tempo de resposta, erros e saúde do servidor. Atualiza a cada minuto."
        actions={<Tabs value={periodo} onChange={setPeriodo} items={PERIODOS} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Tempo p95" value={data ? fmtDuracao(data.kpis.p95Ms) : '—'} icon={Gauge} tone={data && data.kpis.p95Ms > (data.limiteLentaMs ?? 1000) ? 'danger' : 'brand'} loading={isLoading} hint="95% das respostas abaixo disto" />
        <StatCard label="Tempo médio" value={data ? fmtDuracao(data.kpis.mediaMs) : '—'} icon={Timer} tone="info" loading={isLoading} />
        <StatCard label="Requisições/min" value={data ? data.kpis.porMinuto.toLocaleString('pt-BR') : '—'} icon={Activity} tone="teal" loading={isLoading} hint={data ? `${data.kpis.requisicoes.toLocaleString('pt-BR')} no período` : undefined} />
        <StatCard label="Taxa de erro" value={data ? `${data.kpis.taxaErroPct.toLocaleString('pt-BR')}%` : '—'} icon={AlertTriangle} tone={data && data.kpis.taxaErroPct > 1 ? 'danger' : 'success'} loading={isLoading} hint="Erros internos (5xx)" />
        <StatCard
          label="Lentas"
          value={data ? data.kpis.lentas.toLocaleString('pt-BR') : '—'}
          icon={Clock}
          tone={data && data.kpis.lentas > 0 ? 'warning' : 'success'}
          loading={isLoading}
          hint={data ? `acima de ${fmtDuracao(data.limiteLentaMs)}` : undefined}
        />
        <StatCard label="Filas com falha" value={data ? String(data.kpis.filasComFalha) : '—'} icon={Layers} tone={data && data.kpis.filasComFalha > 0 ? 'danger' : 'success'} loading={isLoading} />
      </div>

      {isLoading || !data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader icon={Gauge} title="Tempo de resposta por hora" />
              <div className="p-5">
                <Linhas
                  rotulos={data.serie.map((p) => fmtTime(p.hora))}
                  series={[
                    { nome: 'p95', valores: data.serie.map((p) => p.p95Ms), cor: 'var(--color-brand-600)' },
                    { nome: 'Média', valores: data.serie.map((p) => p.mediaMs), cor: 'var(--color-info-500)' },
                  ]}
                  formatar={fmtDuracao}
                />
              </div>
            </Card>
            <Card>
              <CardHeader icon={Activity} title="Requisições e erros por hora" />
              <div className="p-5">
                <Linhas
                  rotulos={data.serie.map((p) => fmtTime(p.hora))}
                  series={[
                    { nome: 'Requisições', valores: data.serie.map((p) => p.qtd), cor: 'var(--color-success-500)' },
                    { nome: 'Erros', valores: data.serie.map((p) => p.erros5xx), cor: 'var(--color-danger-500)' },
                  ]}
                />
              </div>
            </Card>
          </div>

          <Correcoes />

          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <Card className="overflow-hidden">
              <CardHeader
                icon={Clock}
                title="Rotas mais lentas"
                description="Ordenadas pelo p95 no período. A rota aparece sem ids (ex.: /superadmin/tenants/:id)."
                action={
                  <Button size="sm" variant="outline" onClick={() => setVerLentas(true)}>
                    Ver requisições lentas
                  </Button>
                }
              />
              {data.rotas.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={CheckCircle2} title="Sem requisições no período" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                      <tr>
                        <th className="px-4 py-2.5 label-caps">Rota</th>
                        <th className="px-3 py-2.5 text-right label-caps">Qtd.</th>
                        <th className="px-3 py-2.5 text-right label-caps">Média</th>
                        <th className="px-3 py-2.5 text-right label-caps">p95</th>
                        <th className="px-3 py-2.5 text-right label-caps">Máx.</th>
                        <th className="px-4 py-2.5 text-right label-caps">Erros</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {data.rotas.map((r) => (
                        <tr key={`${r.method} ${r.route}`}>
                          <td className="max-w-80 truncate px-4 py-2 font-mono text-xs text-ink-800" title={r.route}>
                            <span className="mr-1.5 font-sans font-bold text-ink-500">{r.method}</span>
                            {r.route}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-600">{r.qtd.toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-600">{fmtDuracao(r.mediaMs)}</td>
                          <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.p95Ms > data.limiteLentaMs ? 'text-danger-600' : 'text-ink-800'}`}>
                            {fmtDuracao(r.p95Ms)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-600">{fmtDuracao(r.maxMs)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.erros5xx > 0 ? <Badge tone="danger">{r.erros5xx}</Badge> : <span className="text-ink-400">0</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Saude data={data} />
          </div>

          <ErrosAgrupados erros={data.erros} />

          {data.consultas && data.consultas.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader icon={Database} title="Consultas mais lentas no banco" description="Pelo tempo médio de execução (pg_stat_statements)." />
              <ul className="divide-y divide-ink-100">
                {data.consultas.map((c, i) => (
                  <li key={i} className="flex items-start gap-4 px-5 py-3">
                    <code className="min-w-0 flex-1 break-all text-xs text-ink-700">{c.consulta}</code>
                    <span className="shrink-0 text-right text-xs text-ink-500">
                      <strong className="block text-sm text-ink-900">{fmtDuracao(c.mediaMs)}</strong>
                      {c.chamadas.toLocaleString('pt-BR')} chamadas
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <RequisicoesLentasModal aberto={verLentas} onFechar={() => setVerLentas(false)} />
    </div>
  );
}

function Saude({ data }: { data: PainelPerformance }) {
  const s = data.saude;
  if (!s) {
    return (
      <Card>
        <CardHeader icon={Server} title="Saúde do servidor" />
        <div className="p-5">
          <EmptyState icon={Server} title="Sem amostras ainda" description="A primeira amostra é gravada um minuto depois que a API sobe." />
        </div>
      </Card>
    );
  }
  const item = (Icon: typeof Cpu, label: string, valor: string, ruim = false) => (
    <div className="flex items-center gap-3">
      <span className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${ruim ? 'bg-danger-50 text-danger-600' : 'bg-ink-100 text-ink-600'}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="label-caps">{label}</p>
        <p className="text-sm font-bold text-ink-900">{valor}</p>
      </div>
    </div>
  );
  const filas = Object.entries(s.filas);
  return (
    <Card>
      <CardHeader icon={Server} title="Saúde do servidor" description={`Última amostra ${fmtRelative(s.em)}`} />
      <div className="grid grid-cols-2 gap-4 p-5">
        {item(HardDrive, 'Memória', `${s.memoriaMb.toLocaleString('pt-BR')} MB`, s.memoriaMb > 1500)}
        {item(Cpu, 'CPU', `${s.cpuPct.toLocaleString('pt-BR')}%`, s.cpuPct > 85)}
        {item(Database, 'Banco', s.dbMs === null ? 'sem resposta' : `${s.dbMs} ms`, s.dbMs === null || s.dbMs > 200)}
        {item(Zap, 'Redis', s.redisMs === null ? 'sem resposta' : `${s.redisMs} ms`, s.redisMs === null || s.redisMs > 100)}
        {item(Activity, 'Conexões', s.dbConexoes === null ? '—' : String(s.dbConexoes))}
        {item(Database, 'Tamanho do banco', s.dbTamanhoMb === null ? '—' : `${s.dbTamanhoMb.toLocaleString('pt-BR')} MB`)}
      </div>
      {data.serieSaude.length > 1 && (
        <div className="border-t border-ink-100 px-5 py-4">
          <p className="label-caps mb-2">Memória (MB)</p>
          <Linhas
            className="[&_svg]:h-24"
            rotulos={data.serieSaude.map((p) => fmtTime(p.em))}
            series={[{ nome: 'Memória', valores: data.serieSaude.map((p) => p.memoriaMb), cor: 'var(--color-brand-600)' }]}
          />
        </div>
      )}
      {filas.length > 0 && (
        <div className="border-t border-ink-100 px-5 py-4">
          <p className="label-caps mb-2">Filas</p>
          <ul className="space-y-1.5 text-sm">
            {filas.map(([nome, f]) => (
              <li key={nome} className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-700">{NOME_FILA[nome] ?? nome}</span>
                <span className="flex shrink-0 gap-1">
                  {f.ativos > 0 && <Badge tone="info">{f.ativos} rodando</Badge>}
                  {f.aguardando > 0 && <Badge tone="neutral">{f.aguardando} na fila</Badge>}
                  {f.falhas > 0 && <Badge tone="danger">{f.falhas} falha(s)</Badge>}
                  {f.ativos + f.aguardando + f.falhas === 0 && <span className="text-xs text-ink-400">ociosa</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ErrosAgrupados({ erros }: { erros: PainelPerformance['erros'] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const resolver = useMutation({
    mutationFn: (fp: string) => api(`/superadmin/performance/erros/${fp}/resolver`, { method: 'PATCH' }),
    onSuccess: async () => {
      toast.success('Erro marcado como resolvido. Se acontecer de novo, volta para a lista.');
      await qc.invalidateQueries({ queryKey: ['sa-performance'] });
    },
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader icon={AlertTriangle} title="Erros internos" description="Agrupados pela rota e mensagem; o detalhe técnico fica no registro do servidor." />
      {erros.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={CheckCircle2} title="Nenhum erro interno no período" />
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {erros.map((e) => (
            <li key={e.fingerprint} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-ink-500">
                  {e.method} {e.route}
                </p>
                <p className="text-sm text-ink-800">{e.mensagem}</p>
                <p className="text-xs text-ink-500">
                  {e.qtd}x · primeira {fmtDateTime(e.primeiraEm)} · última {fmtRelative(e.ultimaEm)}
                </p>
              </div>
              {e.resolvido ? (
                <Badge tone="success">Resolvido</Badge>
              ) : (
                <Button size="sm" variant="outline" loading={resolver.isPending && resolver.variables === e.fingerprint} onClick={() => resolver.mutate(e.fingerprint)}>
                  Marcar como resolvido
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Diagnostico + "Executar correcoes". As criticas tambem rodam sozinhas ao meio-dia. */
function Correcoes() {
  const owner = usePode('owner');
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['sa-correcoes'], queryFn: () => api<Correcao[]>('/superadmin/correcoes') });
  const [resultado, setResultado] = useState<ResultadoCorrecoes | null>(null);
  const executar = useMutation({
    mutationFn: () => api<ResultadoCorrecoes>('/superadmin/correcoes/executar', { method: 'POST', body: {} }),
    onSuccess: async (r) => {
      setResultado(r);
      if (r.falhas.length === 0) toast.success(`${r.aplicadas.length} correção(ões) aplicada(s).`);
      await Promise.all([qc.invalidateQueries({ queryKey: ['sa-correcoes'] }), qc.invalidateQueries({ queryKey: ['sa-performance'] })]);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível executar.'),
  });
  const automaticas = (data ?? []).filter((c) => c.automatica);
  const codigo = (data ?? []).filter((c) => !c.automatica);

  return (
    <Card>
      <CardHeader
        icon={Wrench}
        title="Correções"
        description="O sistema corrige sozinho o que é seguro. As críticas rodam todo dia às 12h00 (horário de menor uso); as demais, por este botão."
        action={
          owner && (
            <Button leftIcon={<ListChecks aria-hidden />} loading={executar.isPending} disabled={automaticas.length === 0} onClick={() => executar.mutate()}>
              Executar correções
            </Button>
          )
        }
      />
      <div className="p-5">
        {isLoading ? (
          <Skeleton rows={3} />
        ) : !data?.length ? (
          <EmptyState icon={CheckCircle2} title="Nada para corrigir" description="Banco, filas, backups e órgãos estão em ordem." />
        ) : (
          <div className="space-y-5">
            {automaticas.length > 0 && (
              <ul className="divide-y divide-ink-100 rounded-[12px] border border-ink-200">
                {automaticas.map((c) => (
                  <ItemCorrecao key={c.id} c={c} />
                ))}
              </ul>
            )}
            {codigo.length > 0 && (
              <div>
                <p className="label-caps mb-2">Requer correção no código</p>
                <ul className="divide-y divide-ink-100 rounded-[12px] border border-ink-200">
                  {codigo.map((c) => (
                    <ItemCorrecao key={c.id} c={c} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      <Modal open={!!resultado} onClose={() => setResultado(null)} title="Resultado das correções" footer={<Button onClick={() => setResultado(null)}>Fechar</Button>}>
        {resultado && (
          <div className="space-y-3 text-sm">
            {resultado.aplicadas.map((a) => (
              <p key={a.id} className="flex items-start gap-2 text-ink-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden />
                {a.titulo}
              </p>
            ))}
            {resultado.falhas.map((f) => (
              <p key={f.id} className="flex items-start gap-2 text-danger-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {f.titulo}: {f.erro}
                </span>
              </p>
            ))}
            {resultado.aplicadas.length + resultado.falhas.length === 0 && <p className="text-ink-600">Nada a aplicar agora.</p>}
          </div>
        )}
      </Modal>
    </Card>
  );
}

function ItemCorrecao({ c }: { c: Correcao }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <Badge tone={TOM_SEV[c.severidade]}>{SEVERIDADE_LABEL[c.severidade]}</Badge>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">{c.titulo}</p>
        <p className="text-sm text-ink-600">{c.descricao}</p>
        {c.evidencia && <p className="mt-0.5 break-words text-xs text-ink-500">{c.evidencia}</p>}
      </div>
      {c.acao && <span className="shrink-0 text-xs font-medium text-brand-600">{c.acao}</span>}
    </li>
  );
}

function RequisicoesLentasModal({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
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
