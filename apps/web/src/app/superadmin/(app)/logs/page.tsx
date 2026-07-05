'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import type { TenantOverview } from '@jdoc/shared';
import { api } from '@/lib/api';
import { Badge, btnGhost, cardCls, inputCls, labelCls } from '@/components/ui';

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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-app">Logs de Auditoria</h1>

      {/* Filtros */}
      <div className={`${cardCls} p-4 card-accent-orange`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div>
            <label className={labelCls} htmlFor="l-scope">Escopo</label>
            <select
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
            </select>
          </div>
          {scope === 'tenant' && (
            <div>
              <label className={labelCls} htmlFor="l-tenant">Órgão</label>
              <select
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
              </select>
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
      <div className={`${cardCls} overflow-x-auto card-accent-purple`}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-app-border text-[11px] font-bold uppercase text-app-muted">
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
                  <div className="h-6 animate-pulse rounded bg-app-skeleton" />
                </td>
              </tr>
            )}
            {data?.items.map((log) => {
              const isSecurity = SECURITY_ACTIONS.has(log.action);
              return (
                <tr
                  key={log.id}
                  className={`border-b border-app-border ${
                    isSecurity
                      ? 'bg-red-50/60 dark:bg-red-900/20'
                      : 'hover:bg-app-hover'
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-app-muted">
                    {new Date(log.criado_em).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      {isSecurity && (
                        <ShieldAlert className="h-4 w-4 text-red-500" aria-hidden />
                      )}
                      <Badge color={isSecurity ? 'red' : 'blue'}>{log.action}</Badge>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-app-muted">
                    {log.actor_type ? `${log.actor_type}: ` : ''}
                    {log.actor_id ? `${log.actor_id.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="px-4 py-3 text-app-muted">{log.ip ?? '—'}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-app-muted">
                    {log.metadata ? JSON.stringify(log.metadata) : '—'}
                  </td>
                </tr>
              );
            })}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-app-muted">
                  Nenhum log encontrado com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginacao */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-app-muted">
            {data.total} registro(s) — página {data.page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={btnGhost}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}