'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  Clock,
  DatabaseBackup,
  ExternalLink,
  LifeBuoy,
  LogIn,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { STATUS_BACKUP_LABEL, TENANT_STATUS_LABEL, type PainelPlataforma, type TenantStatus } from '@jdoc/shared';
import { api } from '@/lib/api';
import { fmtDuracao, fmtRelative } from '@/lib/format';
import { Badge, Button, Card, CardHeader, PageHeader, StatCard, buttonClasses } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { STATUS_TOM } from '@/components/platform/orgao-ui';
import { RequisicoesLentasModal } from '@/components/platform/requisicoes-lentas';
import { useAdmin } from '@/components/platform/admin-context';

/** Painel: situacao da plataforma e de cada orgao num relance. */
export default function PainelPage() {
  const eu = useAdmin();
  const { data: p, isLoading } = useQuery({
    queryKey: ['sa-overview'],
    queryFn: () => api<PainelPlataforma>('/superadmin/overview'),
    refetchInterval: 60_000,
  });
  const [verLentas, setVerLentas] = useState(false);
  const k = p?.kpis;
  const ub = k?.ultimoBackup;

  return (
    <div className="space-y-6">
      <PageHeader title={eu ? `Olá, ${eu.nome.split(' ')[0]}` : 'Painel'} description="Situação da plataforma nas últimas 24 horas." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Órgãos ativos" value={k ? `${k.orgaosAtivos}` : '—'} hint={k ? `de ${k.orgaosTotal} cadastrados` : undefined} icon={Building2} tone="brand" loading={isLoading} href="/superadmin/orgaos" />
        <StatCard label="Usuários ativos" value={k ? k.usuariosAtivos.toLocaleString('pt-BR') : '—'} icon={Users} tone="teal" loading={isLoading} href="/superadmin/usuarios" />
        <StatCard label="Acessos (24 h)" value={k ? k.acessos24h.toLocaleString('pt-BR') : '—'} icon={LogIn} tone="info" loading={isLoading} />
        <StatCard
          label="Chamados abertos"
          value={k ? `${k.chamadosAbertos}` : '—'}
          hint={k ? (k.chamadosAtrasados ? `${k.chamadosAtrasados} atrasado(s)` : 'nenhum atrasado') : undefined}
          icon={LifeBuoy}
          tone={k?.chamadosAtrasados ? 'danger' : 'success'}
          loading={isLoading}
          href="/superadmin/chamados"
        />
        <StatCard
          label="Último backup"
          value={ub ? STATUS_BACKUP_LABEL[ub.status] : 'Nenhum'}
          hint={ub ? `${ub.orgao ?? 'completo'} · ${fmtRelative(ub.em)}` : undefined}
          icon={DatabaseBackup}
          tone={!ub || ub.status === 'erro' || (k?.backupsComFalha24h ?? 0) > 0 ? 'danger' : ub.status === 'concluido' ? 'success' : 'info'}
          loading={isLoading}
          href="/superadmin/backups"
        />
        <StatCard
          label="Jobs com falha"
          value={k ? `${k.jobsComFalha24h}` : '—'}
          icon={XCircle}
          tone={k?.jobsComFalha24h ? 'danger' : 'success'}
          loading={isLoading}
          href="/superadmin/jobs"
        />
      </div>

      {!p ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader icon={ShieldAlert} title="Falhas de login (24 h)" description="Muitas falhas de um mesmo IP podem indicar tentativa de invasão." />
              {p.falhasLogin.porOrgao.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={ShieldAlert} title="Nenhuma falha de login" />
                </div>
              ) : (
                <div className="grid gap-6 p-5 sm:grid-cols-2">
                  <div>
                    <p className="label-caps mb-2">Por órgão</p>
                    <ul className="space-y-1.5 text-sm">
                      {p.falhasLogin.porOrgao.map((o) => (
                        <li key={o.orgao} className="flex justify-between gap-2">
                          <span className="truncate text-ink-700">{o.orgao}</span>
                          <Badge tone={o.qtd >= 10 ? 'danger' : 'warning'}>{o.qtd}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="label-caps mb-2">Por IP</p>
                    <ul className="space-y-1.5 text-sm">
                      {p.falhasLogin.porIp.map((i) => (
                        <li key={i.ip} className="flex justify-between gap-2">
                          <span className="font-mono text-xs text-ink-700">{i.ip}</span>
                          <Badge tone={i.qtd >= 10 ? 'danger' : 'warning'}>{i.qtd}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader
                icon={Clock}
                title="Requisições lentas (24 h)"
                description="Rotas com tempo médio e máximo mais altos."
                action={
                  <Button size="sm" variant="outline" onClick={() => setVerLentas(true)}>
                    Ver todas
                  </Button>
                }
              />
              {p.rotasLentas.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={Clock} title="Nenhuma requisição lenta" />
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {p.rotasLentas.map((r) => (
                    <li key={`${r.method}${r.route}`} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-700" title={r.route}>
                        <strong className="font-sans text-ink-500">{r.method}</strong> {r.route}
                      </span>
                      <span className="shrink-0 text-right text-xs text-ink-500">
                        média <strong className="text-ink-900">{fmtDuracao(r.mediaMs)}</strong> · máx. {fmtDuracao(r.maxMs)} · {r.qtd}x
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink-900">Órgãos</h2>
              <Link href="/superadmin/orgaos" className="text-[13px] font-semibold text-brand-600 hover:text-brand-700">
                Ver todos
              </Link>
            </div>
            {p.orgaos.length === 0 ? (
              <EmptyState icon={Building2} title="Nenhum órgão cadastrado" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {p.orgaos.map((o) => (
                  <Card key={o.id} className="flex flex-col p-5">
                    <div className="flex items-start gap-3">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-ink-200 bg-ink-50">
                        {o.brasaoUrl ? <img src={o.brasaoUrl} alt="" className="h-full w-full object-cover" /> : <Building2 className="h-5 w-5 text-ink-400" aria-hidden />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/superadmin/orgaos/${o.id}`} className="block truncate font-semibold text-ink-900 hover:text-brand-600">
                          {o.nome}
                        </Link>
                        <p className="text-xs text-ink-500">
                          {o.cidade ?? '—'}
                          {o.uf ? `/${o.uf}` : ''}
                        </p>
                      </div>
                      <Badge tone={STATUS_TOM[o.status as TenantStatus] ?? 'neutral'}>{TENANT_STATUS_LABEL[o.status as TenantStatus] ?? o.status}</Badge>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="label-caps">Usuários</dt>
                        <dd className="font-semibold text-ink-900">{o.usuariosAtivos}</dd>
                      </div>
                      <div>
                        <dt className="label-caps">Último acesso</dt>
                        <dd className="text-ink-700">{o.ultimoAcesso ? fmtRelative(o.ultimoAcesso) : 'Nunca'}</dd>
                      </div>
                    </dl>
                    <a href={`/${o.slug}/login`} target="_blank" rel="noopener noreferrer" className={buttonClasses('outline', 'sm', 'mt-4 w-full')}>
                      <ExternalLink aria-hidden />
                      Acessar sistema
                    </a>
                  </Card>
                ))}
              </div>
            )}
          </section>
          {p.kpis.chamadosAtrasados > 0 && (
            <p className="flex items-center gap-2 text-sm text-danger-600">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              Há chamados fora do prazo. <Link href="/superadmin/chamados" className="font-semibold underline">Abrir a fila</Link>
            </p>
          )}
        </>
      )}
      <RequisicoesLentasModal aberto={verLentas} onFechar={() => setVerLentas(false)} />
    </div>
  );
}
