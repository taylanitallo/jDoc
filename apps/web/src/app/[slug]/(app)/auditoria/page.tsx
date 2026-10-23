'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Fingerprint, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  ROTULOS_ACAO_ORGAO,
  descreverLog,
  valorLegivel,
  type AuditoriaPagina,
  type AuditoriaRegistro,
  type VerificacaoCadeia,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { fmtDateTime, todayFortaleza } from '@/lib/format';
import { Button, Card, Field, Input, Modal, PageHeader, Pagination, Select } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';

const POR_PAGINA = 30;

/** Dia de Fortaleza -> inicio/fim do dia (Fortaleza) em ISO. */
const limite = (d: string, fim: boolean) => new Date(`${d}T${fim ? '23:59:59' : '00:00:00'}-03:00`).toISOString();

/** Dados extras mostrados no detalhe, sempre com rotulo (nunca o JSON cru). */
const META_LABEL: Record<string, string> = {
  email: 'E-mail informado',
  termo: 'Termo pesquisado',
  resultados: 'Resultados',
  count: 'Quantidade',
  arquivos: 'Arquivos',
  module: 'Módulo',
  modulo: 'Módulo',
  originalName: 'Arquivo',
  motivo: 'Motivo',
  registros: 'Registros',
};

export default function AuditoriaPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();
  const [acao, setAcao] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [de, setDe] = useState(() => todayFortaleza(new Date(Date.now() - 7 * 86_400_000)));
  const [ate, setAte] = useState(todayFortaleza());
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<AuditoriaRegistro | null>(null);
  const [baixando, setBaixando] = useState(false);
  const [verificacao, setVerificacao] = useState<VerificacaoCadeia | null>(null);

  const filtros = new URLSearchParams({
    de: limite(de, false),
    ate: limite(ate, true),
    ...(acao ? { acao } : {}),
    ...(usuarioId ? { usuarioId } : {}),
  });
  const qs = new URLSearchParams({ ...Object.fromEntries(filtros), page: String(pagina), pageSize: String(POR_PAGINA) });

  const { data: usuarios } = useQuery({
    queryKey: ['auditoria', slug, 'usuarios'],
    queryFn: () => api<Array<{ id: string; nome: string }>>(`/t/${slug}/auditoria/usuarios`),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['auditoria', slug, qs.toString()],
    queryFn: () => api<AuditoriaPagina>(`/t/${slug}/auditoria?${qs}`),
  });

  const verificar = useMutation({
    mutationFn: () => api<VerificacaoCadeia>(`/t/${slug}/auditoria/verificar`, { method: 'POST' }),
    onSuccess: setVerificacao,
    onError: (e) =>
      toast.error(e instanceof ApiError && e.status === 403 ? 'Você não tem permissão para verificar a trilha (Auditoria: exportar).' : 'Não foi possível verificar.'),
  });

  const filtro = <T,>(f: (v: T) => void) => (v: T) => {
    f(v);
    setPagina(1);
  };

  const exportar = async () => {
    setBaixando(true);
    try {
      const url = await apiBlobUrl(`/t/${slug}/auditoria/exportar?${filtros}`);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditoria-${de}-a-${ate}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 403 ? 'Você não tem permissão para exportar a auditoria.' : 'Não foi possível exportar.');
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Auditoria"
        description="Tudo o que foi feito no órgão: entradas, documentos abertos, baixados e alterados, pesquisas e cadastros. Os registros não podem ser alterados nem apagados."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" leftIcon={<Fingerprint aria-hidden />} loading={verificar.isPending} onClick={() => verificar.mutate()}>
              Verificar integridade
            </Button>
            <Button leftIcon={<Download aria-hidden />} loading={baixando} onClick={() => void exportar()}>
              Exportar CSV
            </Button>
          </div>
        }
      />

      {verificacao && <ResultadoVerificacao v={verificacao} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ação" htmlFor="au-acao">
          <Select id="au-acao" value={acao} onChange={(e) => filtro(setAcao)(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(ROTULOS_ACAO_ORGAO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Usuário" htmlFor="au-usuario">
          <Select id="au-usuario" value={usuarioId} onChange={(e) => filtro(setUsuarioId)(e.target.value)}>
            <option value="">Todos</option>
            {(usuarios ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="De" htmlFor="au-de">
          <Input id="au-de" type="date" value={de} max={ate} onChange={(e) => filtro(setDe)(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="au-ate">
          <Input id="au-ate" type="date" value={ate} min={de} onChange={(e) => filtro(setAte)(e.target.value)} />
        </Field>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} columns={3} label="Carregando registros" />
      ) : !data?.items.length ? (
        <EmptyState icon={ScrollText} title="Nenhum registro" description="Ajuste os filtros ou o período." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {data.items.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setAberto(l)}
                  className="flex w-full flex-col gap-0.5 px-5 py-3 text-left transition hover:bg-ink-50/60 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="w-36 shrink-0 text-xs tabular-nums text-ink-500">{fmtDateTime(l.criadoEm)}</span>
                  <span className="min-w-0 flex-1 text-sm text-ink-800">{descreverLog(l)}</span>
                  {l.ip && <span className="shrink-0 font-mono text-[11px] text-ink-400">{l.ip}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={data.total} onPageChange={setPagina} />
          </div>
        </Card>
      )}

      <DetalheRegistro log={aberto} onFechar={() => setAberto(null)} />
    </div>
  );
}

function ResultadoVerificacao({ v }: { v: VerificacaoCadeia }) {
  const Icone = v.integra ? ShieldCheck : ShieldAlert;
  return (
    <Card className={v.integra ? 'p-4 ring-1 ring-success-600/20' : 'p-4 ring-2 ring-danger-600/40'}>
      <div className="flex items-start gap-3">
        <Icone className={v.integra ? 'mt-0.5 h-5 w-5 text-success-600' : 'mt-0.5 h-5 w-5 text-danger-600'} aria-hidden />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-bold text-ink-900">
            {v.integra
              ? `Trilha íntegra: ${v.registros.toLocaleString('pt-BR')} registro(s) conferidos, nenhum alterado ou apagado.`
              : `Adulteração encontrada em ${v.quebras.length} ponto(s) da trilha.`}
          </p>
          {!v.integra && (
            <ul className="list-disc pl-5 text-ink-700">
              {v.quebras.map((q) => (
                <li key={q.seq}>
                  Registro nº {q.seq} ({fmtDateTime(q.criadoEm)}):{' '}
                  {q.motivo === 'conteudo_alterado' ? 'conteúdo alterado depois de gravado' : 'registro anterior apagado ou fora de ordem'}
                </li>
              ))}
            </ul>
          )}
          {v.ultimoHash && (
            <p className="break-all text-xs text-ink-500">
              Selo da trilha em {fmtDateTime(v.verificadoEm)}: <span className="font-mono">{v.ultimoHash}</span>. Guarde este código fora do sistema
              para provar, depois, que nada foi reescrito.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function DetalheRegistro({ log, onFechar }: { log: AuditoriaRegistro | null; onFechar: () => void }) {
  if (!log) return null;
  const meta = Object.entries(log.metadata ?? {}).filter(([k, v]) => k in META_LABEL && v !== null && v !== '' && typeof v !== 'object');
  const imp = (log.metadata?.impersonacao ?? null) as { adminNome?: string; motivo?: string } | null;
  return (
    <Modal open onClose={onFechar} title="Detalhe do registro" subtitle={`Nº ${log.seq} · ${fmtDateTime(log.criadoEm)}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm font-semibold text-ink-900">{descreverLog(log)}</p>
        {imp && (
          <p className="rounded-[10px] bg-warning-50 px-3 py-2 text-sm text-warning-600">
            Feito pela equipe JEOS em "entrar como" ({imp.adminNome}) — motivo: {imp.motivo}
          </p>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="label-caps">Usuário</dt>
            <dd className="text-ink-800">{log.adminName ?? (log.usuarioId ? 'Usuário excluído' : 'Sistema')}</dd>
          </div>
          {log.ip && (
            <div>
              <dt className="label-caps">IP</dt>
              <dd className="font-mono text-xs text-ink-800">{log.ip}</dd>
            </div>
          )}
          {log.entityId && (
            <div>
              <dt className="label-caps">Registro afetado</dt>
              <dd className="break-all font-mono text-xs text-ink-800">{log.entityId}</dd>
            </div>
          )}
          {meta.map(([k, v]) => (
            <div key={k}>
              <dt className="label-caps">{META_LABEL[k]}</dt>
              <dd className="text-ink-800">{valorLegivel(k, v)}</dd>
            </div>
          ))}
          {log.userAgent && (
            <div className="sm:col-span-2">
              <dt className="label-caps">Navegador</dt>
              <dd className="break-all text-xs text-ink-600">{log.userAgent}</dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="label-caps">Hash do registro (SHA-256)</dt>
            <dd className="break-all font-mono text-[11px] text-ink-500">{log.hash}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
