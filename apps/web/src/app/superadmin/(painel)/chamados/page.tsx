'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LifeBuoy, Plus, Search } from 'lucide-react';
import {
  CANAIS_CHAMADO,
  CANAL_CHAMADO_LABEL,
  CATEGORIAS_CHAMADO,
  CATEGORIA_CHAMADO_LABEL,
  CRITICIDADES,
  CRITICIDADE_DESCRICAO,
  CRITICIDADE_LABEL,
  STATUS_CHAMADO,
  STATUS_CHAMADO_LABEL,
  type ChamadoDetalhe,
  type ChamadoResumo,
  type TenantOverview,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { BadgesChamado } from '@/components/chamados/conversa';

const POR_PAGINA = 25;
type Visao = 'abertos' | 'atrasados' | 'todos';

export default function ChamadosPage() {
  const router = useRouter();
  const [visao, setVisao] = useState<Visao>('abertos');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState('');
  const [criticidade, setCriticidade] = useState('');
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(texto.trim());
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const { data: orgaos } = useQuery({ queryKey: ['sa-tenants'], queryFn: () => api<TenantOverview[]>('/superadmin/tenants') });
  const qs = new URLSearchParams({
    page: String(pagina),
    pageSize: String(POR_PAGINA),
    ...(visao === 'abertos' ? { abertos: 'true' } : visao === 'atrasados' ? { atrasados: 'true' } : {}),
    ...(q ? { q } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(status ? { status } : {}),
    ...(criticidade ? { criticidade } : {}),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['sa-chamados', qs.toString()],
    queryFn: () => api<{ items: ChamadoResumo[]; total: number }>(`/superadmin/tickets?${qs}`),
    refetchInterval: 60_000,
  });
  const muda = <T,>(f: (v: T) => void) => (v: T) => {
    f(v);
    setPagina(1);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chamados"
        description="Fila de atendimento dos órgãos, com prazos em horas úteis (seg. a sex., 8h–12h e 13h–17h, sem feriados)."
        actions={
          <Button leftIcon={<Plus aria-hidden />} onClick={() => setNovo(true)}>
            Registrar chamado
          </Button>
        }
      />
      <Tabs<Visao>
        value={visao}
        onChange={muda(setVisao)}
        items={[
          { id: 'abertos', label: 'Em aberto' },
          { id: 'atrasados', label: 'Atrasados' },
          { id: 'todos', label: 'Todos' },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_220px_180px_160px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Número, título ou órgão" className="pl-9" aria-label="Buscar" />
        </div>
        <Select value={tenantId} onChange={(e) => muda(setTenantId)(e.target.value)} aria-label="Órgão">
          <option value="">Todos os órgãos</option>
          {(orgaos ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => muda(setStatus)(e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          {STATUS_CHAMADO.map((s) => (
            <option key={s} value={s}>
              {STATUS_CHAMADO_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select value={criticidade} onChange={(e) => muda(setCriticidade)(e.target.value)} aria-label="Criticidade">
          <option value="">Toda criticidade</option>
          {CRITICIDADES.map((c) => (
            <option key={c} value={c}>
              {CRITICIDADE_LABEL[c]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={6} columns={6} label="Carregando chamados" />
      ) : !data?.items.length ? (
        <EmptyState icon={LifeBuoy} title="Nenhum chamado" description={visao === 'atrasados' ? 'Nenhum chamado fora do prazo.' : 'Ajuste os filtros.'} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Nº</th>
                  <th className="px-4 py-3 label-caps">Chamado</th>
                  <th className="px-4 py-3 label-caps">Situação</th>
                  <th className="px-4 py-3 label-caps">Responsável</th>
                  <th className="px-4 py-3 label-caps">Resposta até</th>
                  <th className="px-4 py-3 label-caps">Solução até</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-ink-50/60" onClick={() => router.push(`/superadmin/chamados/${c.id}`)}>
                    <td className="px-4 py-3 font-mono text-xs text-ink-500">{c.numero}</td>
                    <td className="px-4 py-3">
                      <Link href={`/superadmin/chamados/${c.id}`} className="font-semibold text-ink-900 hover:text-brand-600" onClick={(e) => e.stopPropagation()}>
                        {c.titulo}
                      </Link>
                      <p className="text-xs text-ink-500">
                        {c.orgao} · {c.abertoPor} · {fmtRelative(c.criadoEm)}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <BadgesChamado c={c} />
                    </td>
                    <td className="px-4 py-3 text-ink-600">{c.responsavel ?? '—'}</td>
                    <td className={`whitespace-nowrap px-4 py-3 ${c.respostaAtrasada ? 'font-semibold text-danger-600' : 'text-ink-600'}`}>
                      {c.respondidoEm ? 'Respondido' : fmtDateTime(c.prazoResposta)}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 ${c.solucaoAtrasada ? 'font-semibold text-danger-600' : 'text-ink-600'}`}>
                      {c.resolvidoEm ? 'Resolvido' : fmtDateTime(c.prazoSolucao)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={data.total} onPageChange={setPagina} />
          </div>
        </Card>
      )}

      {novo && <NovoChamadoModal orgaos={orgaos ?? []} onFechar={() => setNovo(false)} onCriado={(id) => router.push(`/superadmin/chamados/${id}`)} />}
    </div>
  );
}

function NovoChamadoModal({ orgaos, onFechar, onCriado }: { orgaos: TenantOverview[]; onFechar: () => void; onCriado: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    tenantId: '',
    canal: 'telefone',
    solicitanteNome: '',
    solicitanteEmail: '',
    categoria: 'duvida',
    criticidade: 'media',
    titulo: '',
    descricao: '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const criar = useMutation({
    mutationFn: () =>
      api<ChamadoDetalhe>('/superadmin/tickets', {
        method: 'POST',
        body: { ...f, solicitanteEmail: f.solicitanteEmail.trim() || null, anexos: [] },
      }),
    onSuccess: (c) => {
      toast.success(`Chamado nº ${c.numero} registrado.`);
      onCriado(c.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível registrar.'),
  });
  return (
    <Modal
      open
      onClose={onFechar}
      title="Registrar chamado"
      subtitle="Para pedidos que chegaram por telefone, e-mail, WhatsApp ou pessoalmente."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button loading={criar.isPending} disabled={!f.tenantId || f.titulo.trim().length < 5 || f.descricao.trim().length < 10 || f.solicitanteNome.trim().length < 2} onClick={() => criar.mutate()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Órgão" htmlFor="nc-org" required>
          <Select id="nc-org" value={f.tenantId} onChange={(e) => set('tenantId')(e.target.value)}>
            <option value="">Selecione</option>
            {orgaos.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Canal" htmlFor="nc-canal" required>
          <Select id="nc-canal" value={f.canal} onChange={(e) => set('canal')(e.target.value)}>
            {CANAIS_CHAMADO.map((c) => (
              <option key={c} value={c}>
                {CANAL_CHAMADO_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quem pediu" htmlFor="nc-nome" required>
          <Input id="nc-nome" value={f.solicitanteNome} onChange={(e) => set('solicitanteNome')(e.target.value)} />
        </Field>
        <Field label="E-mail de quem pediu" htmlFor="nc-email" hint="Recebe as respostas por e-mail.">
          <Input id="nc-email" type="email" value={f.solicitanteEmail} onChange={(e) => set('solicitanteEmail')(e.target.value)} />
        </Field>
        <Field label="Categoria" htmlFor="nc-cat">
          <Select id="nc-cat" value={f.categoria} onChange={(e) => set('categoria')(e.target.value)}>
            {CATEGORIAS_CHAMADO.map((c) => (
              <option key={c} value={c}>
                {CATEGORIA_CHAMADO_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Criticidade" htmlFor="nc-crit" hint={CRITICIDADE_DESCRICAO[f.criticidade as keyof typeof CRITICIDADE_DESCRICAO]}>
          <Select id="nc-crit" value={f.criticidade} onChange={(e) => set('criticidade')(e.target.value)}>
            {CRITICIDADES.map((c) => (
              <option key={c} value={c}>
                {CRITICIDADE_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Título" htmlFor="nc-tit" required className="sm:col-span-2">
          <Input id="nc-tit" value={f.titulo} onChange={(e) => set('titulo')(e.target.value)} />
        </Field>
        <Field label="Descrição" htmlFor="nc-desc" required className="sm:col-span-2">
          <Textarea id="nc-desc" value={f.descricao} onChange={(e) => set('descricao')(e.target.value)} className="min-h-28" />
        </Field>
      </div>
    </Modal>
  );
}
