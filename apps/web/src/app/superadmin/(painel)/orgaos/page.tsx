'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, ChevronRight, Plus, Search } from 'lucide-react';
import {
  AMBIENTES,
  AMBIENTE_LABEL,
  TENANT_STATUS,
  TENANT_STATUS_LABEL,
  UFS,
  createTenantSchema,
  slugDeTexto,
  type CreateTenantInput,
  type SenhaProvisoriaResposta,
  type TenantOverview,
  type TenantStatus,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { fmtRelative } from '@/lib/format';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Pagination, Select, UsageBar, formatBytes } from '@/components/ui';
import { SkeletonTable } from '@/components/skeleton';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { UfCidadeFields } from '@/components/superadmin/uf-cidade';
import { ModulosBadges, ModulosContratados } from '@/components/superadmin/modulos-contratados';
import { usePode } from '@/components/platform/admin-context';
import { SenhaProvisoriaModal, STATUS_TOM } from '@/components/platform/orgao-ui';

const POR_PAGINA = 20;

export default function OrgaosPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const podeCriar = usePode('owner', 'implantacao');
  const { data: tenants, isLoading } = useQuery({ queryKey: ['sa-tenants'], queryFn: () => api<TenantOverview[]>('/superadmin/tenants') });
  const [busca, setBusca] = useState('');
  const [status, setStatus] = useState<'' | TenantStatus>('');
  const [uf, setUf] = useState('');
  const [ambiente, setAmbiente] = useState('');
  const [pagina, setPagina] = useState(1);
  const [criar, setCriar] = useState(false);
  const [convite, setConvite] = useState<{ email: string; senha: string } | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (tenants ?? []).filter(
      (t) =>
        (!status || t.status === status) &&
        (!uf || t.uf === uf) &&
        (!ambiente || t.ambiente === ambiente) &&
        (!q || t.nome.toLowerCase().includes(q) || t.slug.includes(q) || (t.cidade ?? '').toLowerCase().includes(q) || (t.cnpj ?? '').includes(q.replace(/\D/g, '') || '§')),
    );
  }, [tenants, busca, status, uf, ambiente]);
  const visiveis = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const mudarFiltro = <T,>(f: (v: T) => void) => (v: T) => {
    f(v);
    setPagina(1);
  };

  return (
    <div>
      <PageHeader
        title="Órgãos"
        description="Cada órgão tem banco isolado, módulos contratados, perfis, usuários e integrações próprios."
        actions={
          podeCriar && (
            <Button leftIcon={<Plus aria-hidden />} onClick={() => setCriar(true)}>
              Novo órgão
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_140px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input value={busca} onChange={(e) => mudarFiltro(setBusca)(e.target.value)} placeholder="Buscar por nome, cidade, endereço ou CNPJ" className="pl-9" aria-label="Buscar" />
        </div>
        <Select value={status} onChange={(e) => mudarFiltro(setStatus)(e.target.value as '' | TenantStatus)} aria-label="Status">
          <option value="">Todos os status</option>
          {TENANT_STATUS.map((s) => (
            <option key={s} value={s}>
              {TENANT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select value={uf} onChange={(e) => mudarFiltro(setUf)(e.target.value)} aria-label="UF">
          <option value="">Todas as UFs</option>
          {UFS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Select>
        <Select value={ambiente} onChange={(e) => mudarFiltro(setAmbiente)(e.target.value)} aria-label="Ambiente">
          <option value="">Todos os ambientes</option>
          {AMBIENTES.map((a) => (
            <option key={a} value={a}>
              {AMBIENTE_LABEL[a]}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={4} columns={6} label="Carregando órgãos" />
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={tenants?.length ? 'Nenhum órgão com esses filtros' : 'Nenhum órgão cadastrado'}
          description={tenants?.length ? 'Ajuste a busca ou os filtros.' : 'Cadastre o primeiro órgão para começar.'}
          action={podeCriar && !tenants?.length ? <Button onClick={() => setCriar(true)}>Novo órgão</Button> : undefined}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-ink-200 bg-ink-50/60 text-left">
                <tr>
                  <th className="px-4 py-3 label-caps">Órgão</th>
                  <th className="px-4 py-3 label-caps">Cidade/UF</th>
                  <th className="px-4 py-3 label-caps">Módulos</th>
                  <th className="px-4 py-3 label-caps">Status</th>
                  <th className="px-4 py-3 label-caps">Usuários</th>
                  <th className="w-48 px-4 py-3 label-caps">Uso do disco</th>
                  <th className="px-4 py-3" aria-label="Abrir" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visiveis.map((t) => (
                  <tr key={t.id} className="cursor-pointer hover:bg-ink-50/60" onClick={() => router.push(`/superadmin/orgaos/${t.id}`)}>
                    <td className="px-4 py-3">
                      <Link href={`/superadmin/orgaos/${t.id}`} className="font-semibold text-ink-900 hover:text-brand-600" onClick={(e) => e.stopPropagation()}>
                        {t.nome}
                      </Link>
                      <p className="text-xs text-ink-500">
                        /{t.slug}
                        {t.ambiente !== 'producao' && <span> · {AMBIENTE_LABEL[t.ambiente]}</span>}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {t.cidade ?? '—'}
                      {t.uf ? `/${t.uf}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <ModulosBadges modulos={t.modulos} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TOM[t.status as TenantStatus] ?? 'neutral'}>{TENANT_STATUS_LABEL[t.status as TenantStatus] ?? t.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {t.usuariosAtivos}
                      <span className="block text-xs text-ink-500">{t.ultimoAcesso ? `último acesso ${fmtRelative(t.ultimoAcesso)}` : 'sem acessos'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <UsageBar percent={t.usoPercent} />
                      <p className="text-[11px] text-ink-500">
                        {formatBytes(t.usoBytes)} de {(t.quotaDiscoMb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right text-ink-400">
                      <ChevronRight className="ml-auto h-4 w-4" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <Pagination page={pagina} pageSize={POR_PAGINA} total={filtrados.length} onPageChange={setPagina} />
          </div>
        </Card>
      )}

      <NovoOrgaoModal
        aberto={criar}
        onFechar={() => setCriar(false)}
        onCriado={async (id, email, r) => {
          setCriar(false);
          await qc.invalidateQueries({ queryKey: ['sa-tenants'] });
          if (r?.senhaProvisoria && email) setConvite({ email, senha: r.senhaProvisoria });
          router.push(`/superadmin/orgaos/${id}`);
        }}
      />

      <SenhaProvisoriaModal dados={convite} onFechar={() => setConvite(null)} />
    </div>
  );
}

function NovoOrgaoModal({
  aberto,
  onFechar,
  onCriado,
}: {
  aberto: boolean;
  onFechar: () => void;
  onCriado: (id: string, emailAdmin: string | null, r?: SenhaProvisoriaResposta) => void;
}) {
  const toast = useToast();
  const slugEditado = useRef(false);
  const [quotaGb, setQuotaGb] = useState(1);
  const [comAdmin, setComAdmin] = useState(true);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateTenantInput>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { quotaDiscoMb: 1024, modulos: ['financeiro'], ambiente: 'producao' },
    // Desmarcar "administrador inicial" tira os campos dele da validacao.
    shouldUnregister: true,
  });
  const modulos = watch('modulos') ?? [];

  const enviar = async (data: CreateTenantInput) => {
    try {
      const r = await api<{ id: string; adminInicial?: SenhaProvisoriaResposta }>('/superadmin/tenants', {
        method: 'POST',
        body: comAdmin ? data : { ...data, adminInicial: undefined },
      });
      toast.success(r.adminInicial?.emailEnviado ? 'Órgão criado. O convite foi enviado ao administrador.' : 'Órgão criado.');
      reset();
      slugEditado.current = false;
      setQuotaGb(1);
      onCriado(r.id, comAdmin ? (data.adminInicial?.email ?? null) : null, r.adminInicial);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível criar o órgão.');
    }
  };

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      title="Novo órgão"
      subtitle="Cria o banco isolado do órgão, os perfis padrão e o administrador inicial."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="form-novo-orgao" loading={isSubmitting}>
            Criar órgão
          </Button>
        </>
      }
    >
      <form id="form-novo-orgao" onSubmit={handleSubmit(enviar)} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do órgão" htmlFor="no-nome" required error={errors.nome?.message} className="sm:col-span-2">
          <Input id="no-nome" placeholder="Prefeitura Municipal de..." {...register('nome')} invalid={!!errors.nome} />
        </Field>
        <UfCidadeFields
          idPrefix="no"
          obrigatorio
          uf={watch('uf') ?? ''}
          cidade={watch('cidade') ?? ''}
          onUf={(v) => setValue('uf', v as CreateTenantInput['uf'], { shouldValidate: true })}
          onCidade={(v) => {
            setValue('cidade', v, { shouldValidate: !!v });
            if (v && !slugEditado.current) setValue('slug', slugDeTexto(v), { shouldValidate: true });
          }}
          erroUf={errors.uf ? 'Selecione a UF' : undefined}
          erroCidade={errors.cidade ? 'Selecione a cidade' : undefined}
        />
        <Field
          label="Identificador (endereço)"
          htmlFor="no-slug"
          required
          error={errors.slug?.message}
          hint={`doc.jeossistemas.com/${watch('slug') || 'endereco'}`}
        >
          <Input
            id="no-slug"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            value={watch('slug') ?? ''}
            onChange={(e) => {
              slugEditado.current = e.target.value.trim().length > 0;
              setValue('slug', slugDeTexto(e.target.value), { shouldValidate: true });
            }}
            invalid={!!errors.slug}
          />
        </Field>
        <Field label="CNPJ" htmlFor="no-cnpj" error={errors.cnpj?.message}>
          <Input id="no-cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" {...register('cnpj', { setValueAs: (v: string) => (v ? v : null) })} />
        </Field>
        <Field label="Responsável" htmlFor="no-resp" required error={errors.responsavel?.message}>
          <Input id="no-resp" placeholder="Nome completo" {...register('responsavel')} />
        </Field>
        <Field label="E-mail do órgão" htmlFor="no-email" required error={errors.email?.message}>
          <Input id="no-email" type="email" placeholder="contato@orgao.gov.br" {...register('email')} />
        </Field>
        <Field label="Ambiente" htmlFor="no-amb">
          <Select id="no-amb" {...register('ambiente')}>
            {AMBIENTES.map((a) => (
              <option key={a} value={a}>
                {AMBIENTE_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quota de disco (GB)" htmlFor="no-quota" required error={errors.quotaDiscoMb?.message}>
          <Input
            id="no-quota"
            type="number"
            min={0.1}
            step={0.1}
            value={quotaGb}
            onChange={(e) => {
              const gb = Number(e.target.value);
              setQuotaGb(gb);
              setValue('quotaDiscoMb', Math.round(gb * 1024), { shouldValidate: true });
            }}
          />
        </Field>
        <ModulosContratados value={modulos} onChange={(v) => setValue('modulos', v, { shouldValidate: true })} erro={errors.modulos?.message} />

        <div className="rounded-[12px] border border-ink-200 p-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
            <input type="checkbox" checked={comAdmin} onChange={(e) => setComAdmin(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Criar o administrador inicial e enviar o convite por e-mail
          </label>
          {comAdmin && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Nome do administrador" htmlFor="no-adm-nome" required error={errors.adminInicial?.nome?.message}>
                <Input id="no-adm-nome" {...register('adminInicial.nome')} />
              </Field>
              <Field label="E-mail do administrador" htmlFor="no-adm-email" required error={errors.adminInicial?.email?.message}>
                <Input id="no-adm-email" type="email" {...register('adminInicial.email')} />
              </Field>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
