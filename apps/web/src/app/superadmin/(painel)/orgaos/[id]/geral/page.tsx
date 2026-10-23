'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, Archive, Building2, FileSignature, ImageUp, Palette, Power, Trash2 } from 'lucide-react';
import {
  AMBIENTES,
  AMBIENTE_LABEL,
  COR_PADRAO,
  HEX_COR,
  TENANT_STATUS_LABEL,
  type Ambiente,
  type Contrato,
  type TenantOverview,
  type TenantStatus,
  type UpdateTenantInput,
} from '@jdoc/shared';
import { api, ApiError } from '@/lib/api';
import { uploadTenantBrasao } from '@/lib/upload';
import { fmtDate, todayFortaleza } from '@/lib/format';
import { Badge, Button, Card, CardHeader, ConfirmDialog, Field, Input, Select } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { UfCidadeFields } from '@/components/superadmin/uf-cidade';
import { STATUS_TOM, useAtualizarOrgao, useOrgao } from '@/components/platform/orgao-ui';
import { usePode } from '@/components/platform/admin-context';

export default function OrgaoGeralPage() {
  const { id } = useParams<{ id: string }>();
  const { data: t } = useOrgao(id);
  if (!t) return <Skeleton rows={8} />;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <DadosCadastrais t={t} />
        <ContratoCard t={t} />
      </div>
      <div className="space-y-6">
        <SituacaoCard t={t} />
        <MarcaCard t={t} />
        <ZonaDePerigo t={t} />
      </div>
    </div>
  );
}

function usePatch(id: string) {
  const toast = useToast();
  const atualizar = useAtualizarOrgao(id);
  const [salvando, setSalvando] = useState(false);
  const patch = async (body: UpdateTenantInput, ok = 'Alterações salvas.') => {
    setSalvando(true);
    try {
      await api(`/superadmin/tenants/${id}`, { method: 'PATCH', body });
      await atualizar();
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
      return false;
    } finally {
      setSalvando(false);
    }
  };
  return { patch, salvando };
}

function DadosCadastrais({ t }: { t: TenantOverview }) {
  const pode = usePode('owner', 'implantacao');
  const toast = useToast();
  const atualizar = useAtualizarOrgao(t.id);
  const { patch, salvando } = usePatch(t.id);
  const [f, setF] = useState({ nome: '', responsavel: '', email: '', cnpj: '', cidade: '', uf: '', ambiente: 'producao' as Ambiente, quotaGb: '1' });
  useEffect(() => {
    setF({
      nome: t.nome,
      responsavel: t.responsavel ?? '',
      email: t.email ?? '',
      cnpj: t.cnpj ?? '',
      cidade: t.cidade ?? '',
      uf: t.uf ?? '',
      ambiente: t.ambiente,
      quotaGb: String(Math.round((t.quotaDiscoMb / 1024) * 10) / 10),
    });
  }, [t]);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await patch({
      nome: f.nome.trim(),
      responsavel: f.responsavel.trim(),
      email: f.email.trim(),
      cnpj: f.cnpj.trim() || null,
      ...(f.cidade ? { cidade: f.cidade } : {}),
      ...(f.uf ? { uf: f.uf as UpdateTenantInput['uf'] } : {}),
      ambiente: f.ambiente,
    });
    const quotaMb = Math.round(Number(f.quotaGb) * 1024);
    if (ok && quotaMb !== t.quotaDiscoMb) {
      try {
        await api(`/superadmin/tenants/${t.id}/quota`, { method: 'PATCH', body: { quotaDiscoMb: quotaMb } });
        await atualizar();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Não foi possível alterar a quota.');
      }
    }
  };

  return (
    <Card>
      <CardHeader icon={Building2} title="Dados do órgão" />
      <form onSubmit={salvar} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
        <Field label="Nome" htmlFor="g-nome" required className="sm:col-span-2">
          <Input id="g-nome" value={f.nome} onChange={(e) => set('nome')(e.target.value)} disabled={!pode} />
        </Field>
        <UfCidadeFields idPrefix="g" uf={f.uf} cidade={f.cidade} onUf={set('uf')} onCidade={set('cidade')} />
        <Field label="Responsável" htmlFor="g-resp">
          <Input id="g-resp" value={f.responsavel} onChange={(e) => set('responsavel')(e.target.value)} disabled={!pode} />
        </Field>
        <Field label="E-mail" htmlFor="g-email">
          <Input id="g-email" type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} disabled={!pode} />
        </Field>
        <Field label="CNPJ" htmlFor="g-cnpj">
          <Input id="g-cnpj" inputMode="numeric" value={f.cnpj} onChange={(e) => set('cnpj')(e.target.value)} disabled={!pode} />
        </Field>
        <Field label="Ambiente" htmlFor="g-amb">
          <Select id="g-amb" value={f.ambiente} onChange={(e) => set('ambiente')(e.target.value)} disabled={!pode}>
            {AMBIENTES.map((a) => (
              <option key={a} value={a}>
                {AMBIENTE_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quota de disco (GB)" htmlFor="g-quota">
          <Input id="g-quota" type="number" min={0.1} step={0.1} value={f.quotaGb} onChange={(e) => set('quotaGb')(e.target.value)} disabled={!pode} />
        </Field>
        <Field label="Identificador" htmlFor="g-slug" hint="Não muda depois de criado.">
          <Input id="g-slug" value={t.slug} disabled className="font-mono" />
        </Field>
        {pode && (
          <div className="sm:col-span-2">
            <Button type="submit" loading={salvando} disabled={f.nome.trim().length < 3}>
              Salvar dados
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

/** Dias ate a data (YYYY-MM-DD), contados em Fortaleza. */
function diasAte(data: string): number {
  const hoje = new Date(`${todayFortaleza()}T12:00:00-03:00`).getTime();
  return Math.round((new Date(`${data}T12:00:00-03:00`).getTime() - hoje) / 86_400_000);
}

function ContratoCard({ t }: { t: TenantOverview }) {
  const pode = usePode('owner', 'implantacao');
  const { patch, salvando } = usePatch(t.id);
  const [c, setC] = useState<Record<keyof Contrato, string>>({ numero: '', vigenciaInicio: '', vigenciaFim: '', valor: '', preposto: '', fiscal: '' });
  useEffect(() => {
    const k = t.contrato ?? {};
    setC({
      numero: k.numero ?? '',
      vigenciaInicio: k.vigenciaInicio ?? '',
      vigenciaFim: k.vigenciaFim ?? '',
      valor: k.valor == null ? '' : String(k.valor),
      preposto: k.preposto ?? '',
      fiscal: k.fiscal ?? '',
    });
  }, [t]);
  const fim = t.contrato?.vigenciaFim;
  const dias = fim ? diasAte(fim) : null;

  const salvar = (e: FormEvent) => {
    e.preventDefault();
    const n = (v: string) => (v.trim() ? v.trim() : null);
    void patch(
      {
        contrato: {
          numero: n(c.numero),
          vigenciaInicio: n(c.vigenciaInicio),
          vigenciaFim: n(c.vigenciaFim),
          valor: c.valor.trim() ? Number(c.valor.replace(',', '.')) : null,
          preposto: n(c.preposto),
          fiscal: n(c.fiscal),
        },
      },
      'Contrato salvo.',
    );
  };

  return (
    <Card>
      <CardHeader icon={FileSignature} title="Contrato" description="Número, vigência e responsáveis do contrato com a JEOS." />
      {dias !== null && dias <= 30 && (
        <div
          role="alert"
          className={`mx-5 mt-5 flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-sm font-medium ring-1 ring-inset ${
            dias < 0 ? 'bg-danger-50 text-danger-600 ring-danger-600/15' : 'bg-warning-50 text-warning-600 ring-warning-600/20'
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {dias < 0 ? `Contrato vencido em ${fmtDate(fim)}.` : dias === 0 ? 'O contrato vence hoje.' : `O contrato vence em ${dias} dia(s), em ${fmtDate(fim)}.`}
        </div>
      )}
      <form onSubmit={salvar} className="grid gap-4 p-5 sm:grid-cols-3" noValidate>
        <Field label="Número" htmlFor="c-num">
          <Input id="c-num" value={c.numero} onChange={(e) => setC((s) => ({ ...s, numero: e.target.value }))} disabled={!pode} />
        </Field>
        <Field label="Início da vigência" htmlFor="c-ini">
          <Input id="c-ini" type="date" value={c.vigenciaInicio} onChange={(e) => setC((s) => ({ ...s, vigenciaInicio: e.target.value }))} disabled={!pode} />
        </Field>
        <Field label="Fim da vigência" htmlFor="c-fim">
          <Input id="c-fim" type="date" value={c.vigenciaFim} onChange={(e) => setC((s) => ({ ...s, vigenciaFim: e.target.value }))} disabled={!pode} />
        </Field>
        <Field label="Valor (R$)" htmlFor="c-valor">
          <Input id="c-valor" inputMode="decimal" value={c.valor} onChange={(e) => setC((s) => ({ ...s, valor: e.target.value }))} disabled={!pode} />
        </Field>
        <Field label="Preposto" htmlFor="c-prep">
          <Input id="c-prep" value={c.preposto} onChange={(e) => setC((s) => ({ ...s, preposto: e.target.value }))} disabled={!pode} />
        </Field>
        <Field label="Fiscal do contrato" htmlFor="c-fiscal">
          <Input id="c-fiscal" value={c.fiscal} onChange={(e) => setC((s) => ({ ...s, fiscal: e.target.value }))} disabled={!pode} />
        </Field>
        {pode && (
          <div className="sm:col-span-3">
            <Button type="submit" loading={salvando}>
              Salvar contrato
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function SituacaoCard({ t }: { t: TenantOverview }) {
  const pode = usePode('owner', 'implantacao');
  const toast = useToast();
  const atualizar = useAtualizarOrgao(t.id);
  const [acao, setAcao] = useState<TenantStatus | null>(null);
  const [enviando, setEnviando] = useState(false);
  const status = t.status as TenantStatus;

  const mudar = async (novo: TenantStatus, motivo: string) => {
    setEnviando(true);
    try {
      await api(`/superadmin/tenants/${t.id}/status`, { method: 'PATCH', body: { status: novo, ...(motivo ? { motivo } : {}) } });
      await atualizar();
      setAcao(null);
      toast.success(novo === 'ativo' ? 'Órgão reativado.' : `Órgão ${TENANT_STATUS_LABEL[novo].toLowerCase()}.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível alterar a situação.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={Power} title="Situação" />
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TOM[status] ?? 'neutral'}>{TENANT_STATUS_LABEL[status] ?? status}</Badge>
          <span className="text-xs text-ink-500">desde o cadastro em {fmtDate(t.criadoEm)}</span>
        </div>
        {t.motivoStatus && status !== 'ativo' && (
          <p className="rounded-[10px] bg-ink-50 px-3 py-2 text-sm text-ink-700">
            <span className="label-caps block">Motivo</span>
            {t.motivoStatus}
          </p>
        )}
        {status === 'manutencao' && <p className="text-sm text-ink-600">Restauração de backup em andamento: o órgão volta sozinho ao terminar.</p>}
        {pode && status !== 'manutencao' && (
          <div className="flex flex-wrap gap-2">
            {status === 'ativo' ? (
              <Button variant="outline" leftIcon={<Power aria-hidden />} onClick={() => setAcao('inativo')}>
                Suspender
              </Button>
            ) : (
              <Button variant="success" leftIcon={<Power aria-hidden />} onClick={() => setAcao('ativo')}>
                Reativar
              </Button>
            )}
            {status !== 'arquivado' && (
              <Button variant="ghost" leftIcon={<Archive aria-hidden />} onClick={() => setAcao('arquivado')}>
                Arquivar
              </Button>
            )}
          </div>
        )}
      </div>
      {acao && (
        <ConfirmDialog
          open
          onClose={() => setAcao(null)}
          title={acao === 'ativo' ? 'Reativar o órgão?' : acao === 'inativo' ? 'Suspender o órgão?' : 'Arquivar o órgão?'}
          description={
            acao === 'ativo'
              ? 'Os usuários voltam a entrar no sistema na hora.'
              : acao === 'inativo'
                ? 'Ninguém do órgão consegue entrar enquanto estiver suspenso. Os dados ficam preservados.'
                : 'Use quando o contrato acabou: o acesso fica bloqueado e os dados preservados.'
          }
          confirmLabel={acao === 'ativo' ? 'Reativar' : acao === 'inativo' ? 'Suspender' : 'Arquivar'}
          tone={acao === 'ativo' ? 'primary' : 'danger'}
          motivo={acao === 'ativo' ? undefined : { label: 'Motivo', placeholder: 'Ex.: inadimplência, pedido do órgão, fim do contrato' }}
          loading={enviando}
          onConfirm={(m) => mudar(acao, m)}
        />
      )}
    </Card>
  );
}

function MarcaCard({ t }: { t: TenantOverview }) {
  const pode = usePode('owner', 'implantacao');
  const toast = useToast();
  const atualizar = useAtualizarOrgao(t.id);
  const { patch, salvando } = usePatch(t.id);
  const [cor, setCor] = useState(t.corMarca ?? '');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => setCor(t.corMarca ?? ''), [t.corMarca]);

  const enviarBrasao = async (file: File) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error('Envie uma imagem PNG ou JPEG.');
    if (file.size > 2 * 1024 * 1024) return toast.error('A imagem deve ter no máximo 2 MB.');
    setEnviando(true);
    const r = await uploadTenantBrasao(t.id, file, () => undefined);
    setEnviando(false);
    if (!r.ok) return toast.error(r.message);
    await atualizar();
    toast.success('Brasão atualizado.');
  };

  const removerBrasao = async () => {
    try {
      await api(`/superadmin/tenants/${t.id}/brasao`, { method: 'DELETE' });
      await atualizar();
      toast.success('Brasão removido.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível remover.');
    }
  };

  return (
    <Card>
      <CardHeader icon={Palette} title="Marca" description="Brasão e cor padrão do tema dos usuários do órgão." />
      <div className="space-y-5 p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-ink-200 bg-ink-50">
            {t.brasaoUrl ? <img src={t.brasaoUrl} alt="Brasão do órgão" className="h-full w-full object-cover" /> : <Building2 className="h-6 w-6 text-ink-400" aria-hidden />}
          </span>
          {pode && (
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex">
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void enviarBrasao(f);
                  }}
                />
                <span className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[8px] border border-ink-200 px-3 text-[13px] font-semibold text-ink-700 hover:bg-ink-50">
                  <ImageUp className="h-4 w-4" aria-hidden />
                  {enviando ? 'Enviando…' : 'Enviar imagem'}
                </span>
              </label>
              {t.brasaoUrl && (
                <Button size="sm" variant="ghost" onClick={removerBrasao}>
                  Remover
                </Button>
              )}
            </div>
          )}
        </div>
        <Field label="Cor da marca" htmlFor="m-cor" hint="Vazio usa o padrão (Cosmos). Cada usuário ainda pode escolher o próprio tema.">
          <div className="flex gap-2">
            <input
              type="color"
              aria-label="Escolher cor da marca"
              value={HEX_COR.test(cor) ? cor : COR_PADRAO}
              onChange={(e) => setCor(e.target.value)}
              disabled={!pode}
              className="h-10 w-12 cursor-pointer rounded-[10px] border border-ink-200 bg-surface p-1"
            />
            <Input id="m-cor" value={cor} onChange={(e) => setCor(e.target.value.trim())} placeholder={COR_PADRAO} maxLength={7} className="font-mono" disabled={!pode} />
          </div>
        </Field>
        {pode && (
          <Button
            size="sm"
            loading={salvando}
            disabled={(cor !== '' && !HEX_COR.test(cor)) || cor === (t.corMarca ?? '')}
            onClick={() => void patch({ corMarca: cor || null }, 'Cor da marca salva.')}
          >
            Salvar cor
          </Button>
        )}
      </div>
    </Card>
  );
}

function ZonaDePerigo({ t }: { t: TenantOverview }) {
  const owner = usePode('owner');
  const router = useRouter();
  const toast = useToast();
  const [abrir, setAbrir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  if (!owner) return null;
  const liberado = t.status === 'inativo' || t.status === 'arquivado';

  const excluir = async () => {
    setExcluindo(true);
    try {
      await api(`/superadmin/tenants/${t.id}`, { method: 'DELETE', body: { confirmacao: t.slug } });
      toast.success('Órgão excluído definitivamente.');
      router.replace('/superadmin/orgaos');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível excluir.');
    } finally {
      setExcluindo(false);
    }
  };

  return (
    <Card className="border-danger-500/30">
      <CardHeader icon={Trash2} title="Excluir órgão" description="Apaga o banco do órgão, os usuários e todos os arquivos. Não tem volta." />
      <div className="p-5">
        {!liberado && <p className="mb-3 text-sm text-ink-600">Suspenda ou arquive o órgão antes de excluir.</p>}
        <Button variant="danger" disabled={!liberado} onClick={() => setAbrir(true)} leftIcon={<Trash2 aria-hidden />}>
          Excluir definitivamente
        </Button>
      </div>
      <ConfirmDialog
        open={abrir}
        onClose={() => setAbrir(false)}
        title="Excluir o órgão definitivamente?"
        description="Todos os documentos, usuários, configurações e arquivos do órgão serão apagados. O registro desta exclusão fica na auditoria."
        confirmLabel="Excluir"
        digitar={t.slug}
        loading={excluindo}
        onConfirm={excluir}
      />
    </Card>
  );
}
