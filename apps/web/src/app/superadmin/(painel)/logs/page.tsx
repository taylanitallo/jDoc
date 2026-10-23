'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import {
  ROTULOS_ACAO,
  descreverLog,
  mudancasDoLog,
  valorLegivel,
  type AdminEquipe,
  type LogRegistro,
  type TenantOverview,
} from '@jdoc/shared';
import { api } from '@/lib/api';
import { fmtDateTime, todayFortaleza } from '@/lib/format';
import { Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Card } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { usePode } from '@/components/platform/admin-context';

const POR_PAGINA = 30;
type Escopo = 'plataforma' | 'orgao';

/** Dia de Fortaleza -> inicio/fim do dia (Fortaleza) em ISO. */
const limite = (d: string, fim: boolean) => new Date(`${d}T${fim ? '23:59:59' : '00:00:00'}-03:00`).toISOString();

/** Metadados legiveis (motivo, quantidades...), nunca o JSON cru. */
const META_LABEL: Record<string, string> = {
  motivo: 'Motivo',
  email: 'E-mail informado',
  reason: 'Motivo da recusa',
  quantidade: 'Quantidade',
  orgaosAlterados: 'Órgãos alterados',
  aplicadas: 'Correções aplicadas',
  falhas: 'Falhas',
  emailEnviado: 'E-mail enviado',
  porEmail: 'Por e-mail',
  expiraEm: 'Válido até',
  sessoesEncerradas: 'Sessões encerradas',
  encerradas: 'Sessões encerradas',
  maisAntigosQueDias: 'Mais antigos que (dias)',
  via: 'Por meio de',
  origem: 'Origem',
};
const RAZAO: Record<string, string> = { credentials: 'e-mail ou senha incorretos', totp_invalid: 'código do autenticador errado' };

export default function LogsPage() {
  const owner = usePode('owner');
  const [escopo, setEscopo] = useState<Escopo>('plataforma');
  const [tenantId, setTenantId] = useState('');
  const [acao, setAcao] = useState('');
  const [adminId, setAdminId] = useState('');
  const [de, setDe] = useState(() => todayFortaleza(new Date(Date.now() - 7 * 86_400_000)));
  const [ate, setAte] = useState(todayFortaleza());
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<LogRegistro | null>(null);

  const { data: orgaos } = useQuery({ queryKey: ['sa-tenants'], queryFn: () => api<TenantOverview[]>('/superadmin/tenants') });
  const { data: equipe } = useQuery({ queryKey: ['superadmin', 'equipe'], queryFn: () => api<AdminEquipe[]>('/superadmin/admins'), enabled: owner });

  const qs = new URLSearchParams({
    page: String(pagina),
    pageSize: String(POR_PAGINA),
    de: limite(de, false),
    ate: limite(ate, true),
    ...(acao ? { action: acao } : {}),
    ...(escopo === 'plataforma' && tenantId ? { tenantId } : {}),
    ...(escopo === 'plataforma' && adminId ? { actorId: adminId } : {}),
  });
  const url = escopo === 'plataforma' ? `/superadmin/logs/global?${qs}` : `/superadmin/tenants/${tenantId}/logs?${qs}`;
  const { data, isLoading } = useQuery({
    queryKey: ['sa-logs', url],
    queryFn: () => api<{ items: LogRegistro[]; total: number }>(url),
    enabled: escopo === 'plataforma' || !!tenantId,
  });
  const filtro = <T,>(f: (v: T) => void) => (v: T) => {
    f(v);
    setPagina(1);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logs"
        description="Tudo o que a equipe fez na plataforma e o que aconteceu dentro de cada órgão, em português claro."
        actions={
          <Tabs<Escopo>
            value={escopo}
            onChange={filtro(setEscopo)}
            items={[
              { id: 'plataforma', label: 'Plataforma' },
              { id: 'orgao', label: 'Dentro de um órgão' },
            ]}
          />
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Órgão" htmlFor="lg-org">
          <Select id="lg-org" value={tenantId} onChange={(e) => filtro(setTenantId)(e.target.value)}>
            <option value="">{escopo === 'plataforma' ? 'Todos' : 'Escolha o órgão'}</option>
            {(orgaos ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Select>
        </Field>
        {escopo === 'plataforma' && (
          <Field label="Ação" htmlFor="lg-acao">
            <Select id="lg-acao" value={acao} onChange={(e) => filtro(setAcao)(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(ROTULOS_ACAO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {escopo === 'plataforma' && owner && (
          <Field label="Pessoa da equipe" htmlFor="lg-adm">
            <Select id="lg-adm" value={adminId} onChange={(e) => filtro(setAdminId)(e.target.value)}>
              <option value="">Todas</option>
              {(equipe ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="De" htmlFor="lg-de">
          <Input id="lg-de" type="date" value={de} max={ate} onChange={(e) => filtro(setDe)(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="lg-ate">
          <Input id="lg-ate" type="date" value={ate} min={de} onChange={(e) => filtro(setAte)(e.target.value)} />
        </Field>
      </div>

      {escopo === 'orgao' && !tenantId ? (
        <EmptyState icon={ScrollText} title="Escolha um órgão" description="Os registros de cada órgão ficam no banco dele." />
      ) : isLoading ? (
        <SkeletonTable rows={8} columns={3} label="Carregando registros" />
      ) : !data?.items.length ? (
        <EmptyState icon={ScrollText} title="Nenhum registro" description="Ajuste os filtros ou o período." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {data.items.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setAberto(l)} className="flex w-full flex-col gap-0.5 px-5 py-3 text-left transition hover:bg-ink-50/60 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-36 shrink-0 text-xs tabular-nums text-ink-500">{fmtDateTime(l.criadoEm)}</span>
                  <span className="min-w-0 flex-1 text-sm text-ink-800">{descreverLog(l)}</span>
                  {escopo === 'plataforma' && l.orgao && <span className="shrink-0 text-xs text-ink-500">{l.orgao}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={data.total} onPageChange={setPagina} />
          </div>
        </Card>
      )}

      <DetalheLog log={aberto} onFechar={() => setAberto(null)} />
    </div>
  );
}

function DetalheLog({ log, onFechar }: { log: LogRegistro | null; onFechar: () => void }) {
  if (!log) return null;
  const mudancas = mudancasDoLog(log);
  const meta = Object.entries(log.metadata ?? {}).filter(([k, v]) => k in META_LABEL && v !== null && v !== '' && typeof v !== 'object');
  const imp = (log.metadata?.impersonacao ?? null) as { adminNome?: string; motivo?: string } | null;
  return (
    <Modal open onClose={onFechar} title="Detalhe do registro" subtitle={fmtDateTime(log.criadoEm)} size="lg">
      <div className="space-y-4">
        <p className="text-sm font-semibold text-ink-900">{descreverLog(log)}</p>
        {imp && (
          <p className="rounded-[10px] bg-warning-50 px-3 py-2 text-sm text-warning-600">
            Feito em "entrar como" por {imp.adminNome} — motivo: {imp.motivo}
          </p>
        )}
        {mudancas.length > 0 && (
          <div className="overflow-x-auto rounded-[12px] border border-ink-200">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-3 py-2 label-caps">Campo</th>
                  <th className="px-3 py-2 label-caps">Antes</th>
                  <th className="px-3 py-2 label-caps">Depois</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {mudancas.map((m) => (
                  <tr key={m.campo}>
                    <td className="px-3 py-2 font-medium text-ink-700">{m.campo}</td>
                    <td className="px-3 py-2 text-ink-500 line-through decoration-ink-300">{m.antes}</td>
                    <td className="px-3 py-2 text-ink-900">{m.depois}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {log.orgao && (
            <div>
              <dt className="label-caps">Órgão</dt>
              <dd className="text-ink-800">{log.orgao}</dd>
            </div>
          )}
          {log.ip && (
            <div>
              <dt className="label-caps">IP</dt>
              <dd className="font-mono text-xs text-ink-800">{log.ip}</dd>
            </div>
          )}
          {meta.map(([k, v]) => (
            <div key={k}>
              <dt className="label-caps">{META_LABEL[k]}</dt>
              <dd className="text-ink-800">
                {k === 'reason' ? (RAZAO[String(v)] ?? 'recusado') : k === 'expiraEm' ? fmtDateTime(String(v)) : valorLegivel(k, v)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}
