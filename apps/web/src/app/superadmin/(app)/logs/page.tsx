'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import type { TenantOverview } from '@jdoc/shared';
import { api } from '@/lib/api';
import { Badge, cardCls, inputCls, labelCls, Pagination, SelectMenu } from '@/components/ui';

interface LogItem {
  id: string;
  actor_id: string | null;
  actor_type?: string;
  action: string;
  target_tenant_id?: string | null;
  resource_type?: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  criado_em: string;
}

interface LogPage {
  items: LogItem[];
  total: number;
  page: number;
  pageSize: number;
}

const SECURITY_ACTIONS = new Set([
  'cross_tenant_attempt',
  'cross_tenant_refresh_attempt',
  'refresh_reuse_or_invalid',
  'superadmin_login_failed',
  'superadmin_refresh_reuse_or_invalid',
  'login_failed',
]);

export default function LogsPage() {
  const [scope, setScope] = useState<'global' | 'tenant'>('global');
  const [tenantId, setTenantId] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [action, setAction] = useState('');
  const [ip, setIp] = useState('');
  const [page, setPage] = useState(1);

  const { data: tenants } = useQuery({
    queryKey: ['sa-tenants'],
    queryFn: () => api<TenantOverview[]>('/superadmin/tenants'),
  });

  const params = new URLSearchParams();
  if (de) params.set('de', new Date(de).toISOString());
  if (ate) params.set('ate', new Date(ate).toISOString());
  if (action) params.set('action', action);
  if (ip) params.set('ip', ip);
  params.set('page', String(page));
  params.set('pageSize', '25');

  const path =
    scope === 'global'
      ? `/superadmin/logs/global?${params}`
      : `/superadmin/tenants/${tenantId}/logs?${params}`;

  const { data, isLoading } = useQuery({
    queryKey: ['sa-logs', scope, tenantId, de, ate, action, ip, page],
    queryFn: () => api<LogPage>(path),
    enabled: scope === 'global' || !!tenantId,
  });


  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">Logs de Auditoria</h1>

      {/* Filtros */}
      <div className={`${cardCls} p-4`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-6">
          <div>
            <label className={labelCls} htmlFor="l-scope">Escopo</label>
            <SelectMenu
              id="l-scope"
              className={inputCls}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as 'global' | 'tenant');
                setPage(1);
              }}
            >
              <option value="global">Global (segurança)</option>
              <option value="tenant">Por órgão</option>
            </SelectMenu>
          </div>
          {scope === 'tenant' && (
            <div>
              <label className={labelCls} htmlFor="l-tenant">Órgão</label>
              <SelectMenu
                id="l-tenant"
                className={inputCls}
                value={tenantId}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Selecione…</option>
                {tenants?.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </SelectMenu>
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="l-de">De</label>
            <input
              id="l-de"
              type="date"
              className={inputCls}
              value={de}
              onChange={(e) => {
                setDe(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="l-ate">Até</label>
            <input
              id="l-ate"
              type="date"
              className={inputCls}
              value={ate}
              onChange={(e) => {
                setAte(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="l-action">Ação</label>
            <input
              id="l-action"
              className={inputCls}
              placeholder="ex.: login_failed"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="l-ip">IP</label>
            <input
              id="l-ip"
              className={inputCls}
              placeholder="ex.: 10.0.0.1"
              value={ip}
              onChange={(e) => {
                setIp(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="w-full text-left text-sm">
          <thead className="bg-ink-50/60">
            <tr className="border-b border-ink-200 label-caps">
              <th className="px-4 py-3">Quando</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Ator</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-3">
                  <div className="h-6 animate-pulse rounded bg-ink-100" />
                </td>
              </tr>
            )}
            {data?.items.map((log) => {
              const isSecurity = SECURITY_ACTIONS.has(log.action);
              return (
                <tr
                  key={log.id}
                  className={`border-b border-ink-200 ${
                    isSecurity
                      ? 'bg-danger-50/60'
                      : 'hover:bg-ink-50'
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {new Date(log.criado_em).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      {isSecurity && (
                        <ShieldAlert className="h-4 w-4 text-danger-500" aria-hidden />
                      )}
                      <Badge color={isSecurity ? 'red' : 'blue'}>{log.action}</Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {log.actor_type ? `${log.actor_type}: ` : ''}
                    {log.actor_id ? `${log.actor_id.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="px-4 py-3 text-ink-500">{log.ip ?? '—'}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-ink-500">
                    {log.metadata ? JSON.stringify(log.metadata) : '—'}
                  </td>
                </tr>
              );
            })}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-500">
                  Nenhum log encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginacao */}
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />}
    </div>
  );
}