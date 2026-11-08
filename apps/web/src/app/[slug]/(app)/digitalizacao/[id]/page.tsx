'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Boxes,
  ClipboardCheck,
  FileText,
  History,
  Link2,
  Plus,
  Printer,
  Search,
  Trash2,
  Unlink,
} from 'lucide-react';
import {
  CHECKLIST_QC,
  CHECKLIST_QC_LABEL,
  ESTADOS_CONSERVACAO,
  ESTADO_CONSERVACAO_LABEL,
  ETAPAS_LOTE,
  ETAPA_LOTE_LABEL,
  TIPOS_ITEM_LOTE,
  TIPOS_NAO_CONFORMIDADE,
  TIPO_ITEM_LOTE_LABEL,
  TIPO_NAO_CONFORMIDADE_LABEL,
  etapasPermitidas,
  type DocumentPage,
  type EtapaLote,
  type ItemChecklistQc,
  type ItemLoteInput,
  type LoteDetalheView,
  type TermoLote,
  type TipoNaoConformidade,
  type UsuarioAtual,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, SelectMenu, Textarea, inputCls } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import { ETAPA_TOM } from '@/components/digitalizacao/etapa';

export default function LotePage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['digit', 'lote', slug, id];
  const { data: l, error } = useQuery({ queryKey: chave, queryFn: () => api<LoteDetalheView>(`/t/${slug}/digitalizacao/lotes/${id}`) });
  const { data: me } = useQuery({ queryKey: ['auth', 'me', slug], queryFn: () => api<UsuarioAtual>(`/t/${slug}/auth/me`), staleTime: 5 * 60_000 });
  const atualizar = () => qc.invalidateQueries({ queryKey: ['digit'] });
  const [imprimindo, setImprimindo] = useState<TermoLote | null>(null);

  const termo = async (tipo: TermoLote) => {
    setImprimindo(tipo);
    const aba = window.open('', '_blank');
    try {
      const url = await apiBlobUrl(`/t/${slug}/digitalizacao/lotes/${id}/termo/${tipo}`);
      if (aba) aba.location.href = url;
    } catch {
      aba?.close();
      toast.error('Não foi possível gerar o termo.');
    } finally {
      setImprimindo(null);
    }
  };

  if (error) return <p className="text-sm text-danger-600">{error instanceof ApiError ? error.message : 'Lote não encontrado'}</p>;
  if (!l) return <Skeleton rows={8} />;
  const encerrado = l.etapa === 'devolvido';
  const aceito = l.etapa === 'disponibilizado' || l.etapa === 'devolvido';

  return (
    <div className="space-y-5">
      <Link href={`/${slug}/digitalizacao`} className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-800">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Lotes
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-ink-500">{l.protocolo}</span>
            <Badge tone={ETAPA_TOM[l.etapa]}>{ETAPA_LOTE_LABEL[l.etapa]}</Badge>
            {l.sigiloso && <Badge tone="violet">Sigiloso</Badge>}
            {l.fragil && <Badge tone="orange">Frágil</Badge>}
            {l.grandeFormato && <Badge tone="info">Grande formato</Badge>}
            {l.contaminado && <Badge tone="danger">Contaminado</Badge>}
          </div>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-ink-900">{l.descricao}</h1>
          <p className="text-sm text-ink-500">
            {l.orgaoNome ? `${l.orgaoCodigo} — ${l.orgaoNome}` : (l.orgaoCodigo ?? 'Sem secretaria')}
            {l.planoTitulo ? ` · Plano: ${l.planoTitulo}` : ''} · {l.caixas} caixa(s) · conservação {ESTADO_CONSERVACAO_LABEL[l.estadoConservacao].toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" leftIcon={<Printer aria-hidden />} loading={imprimindo === 'recebimento'} onClick={() => void termo('recebimento')}>
            Termo de recebimento
          </Button>
          {aceito && (
            <Button size="sm" variant="outline" leftIcon={<Printer aria-hidden />} loading={imprimindo === 'aceite'} onClick={() => void termo('aceite')}>
              Termo de aceite
            </Button>
          )}
          {encerrado && (
            <Button size="sm" variant="outline" leftIcon={<Printer aria-hidden />} loading={imprimindo === 'devolucao'} onClick={() => void termo('devolucao')}>
              Termo de devolução
            </Button>
          )}
        </div>
      </div>

      <Fluxo lote={l} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero rotulo="Documentos" valor={l.documentos} />
        <Numero rotulo="Páginas digitalizadas" valor={l.paginas} />
        <Numero rotulo="Páginas aceitas" valor={l.paginasAceitas ?? '—'} destaque />
        <Numero rotulo="Não conformidades abertas" valor={l.ncAbertas} alerta={l.ncAbertas > 0} />
      </div>

      <Avancar slug={slug} lote={l} onFeito={atualizar} />

      {l.etapa === 'controle_qualidade' && <ControleQualidade slug={slug} lote={l} podeAceitar={!!me?.podeFiscalizar} onFeito={atualizar} />}

      <NaoConformidades slug={slug} lote={l} onFeito={atualizar} />
      <Inventario slug={slug} lote={l} onFeito={atualizar} />
      <Documentos slug={slug} lote={l} onFeito={atualizar} />
      <Custodia lote={l} />
    </div>
  );
}

function Numero({ rotulo, valor, destaque, alerta }: { rotulo: string; valor: number | string; destaque?: boolean; alerta?: boolean }) {
  return (
    <Card className="p-4">
      <p className="label-caps">{rotulo}</p>
      <p className={cn('mt-1 text-2xl font-extrabold tabular-nums', destaque ? 'text-success-600' : alerta ? 'text-danger-600' : 'text-ink-900')}>
        {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
      </p>
    </Card>
  );
}

/** Linha do tempo das etapas (feitas, atual e futuras). */
function Fluxo({ lote }: { lote: LoteDetalheView }) {
  const atual = ETAPAS_LOTE.indexOf(lote.etapa);
  return (
    <ol className="no-scrollbar flex gap-1 overflow-x-auto rounded-[14px] bg-ink-100 p-1">
      {ETAPAS_LOTE.map((e, i) => (
        <li
          key={e}
          className={cn(
            'flex min-w-[8.5rem] flex-1 items-center gap-2 rounded-[10px] px-3 py-2 text-xs font-semibold',
            i < atual && 'text-success-600',
            i === atual && 'bg-surface text-ink-900 shadow-xs',
            i > atual && 'text-ink-400',
          )}
        >
          <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]', i <= atual ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500')}>{i + 1}</span>
          {ETAPA_LOTE_LABEL[e]}
        </li>
      ))}
    </ol>
  );
}

function Avancar({ slug, lote, onFeito }: { slug: string; lote: LoteDetalheView; onFeito: () => void }) {
  const toast = useToast();
  const [obs, setObs] = useState('');
  const proximas = etapasPermitidas(lote.etapa);
  const mover = useMutation({
    mutationFn: (para: EtapaLote) => api(`/t/${slug}/digitalizacao/lotes/${lote.id}/etapa`, { method: 'POST', body: { para, ...(obs.trim() ? { observacao: obs.trim() } : {}) } }),
    onSuccess: () => {
      setObs('');
      toast.success('Etapa registrada na cadeia de custódia.');
      onFeito();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível mudar a etapa.'),
  });
  if (!proximas.length) return null;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
      <Field label="Observação para a cadeia de custódia" htmlFor="av-obs" className="flex-1">
        <Input id="av-obs" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional: quem levou, onde ficou, o que foi feito" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {proximas.map((p) => {
          const volta = ETAPAS_LOTE.indexOf(p) < ETAPAS_LOTE.indexOf(lote.etapa);
          return (
            <Button
              key={p}
              variant={volta ? 'outline' : 'primary'}
              leftIcon={volta ? undefined : <ArrowRight aria-hidden />}
              loading={mover.isPending && mover.variables === p}
              onClick={() => mover.mutate(p)}
            >
              {volta ? `Voltar para ${ETAPA_LOTE_LABEL[p].toLowerCase()} (retrabalho)` : `Enviar para ${ETAPA_LOTE_LABEL[p].toLowerCase()}`}
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

function ControleQualidade({ slug, lote, podeAceitar, onFeito }: { slug: string; lote: LoteDetalheView; podeAceitar: boolean; onFeito: () => void }) {
  const toast = useToast();
  const [amostra, setAmostra] = useState(lote.amostraSugerida);
  const [checklist, setChecklist] = useState<Record<ItemChecklistQc, boolean>>(() => Object.fromEntries(CHECKLIST_QC.map((k) => [k, true])) as Record<ItemChecklistQc, boolean>);
  const [obs, setObs] = useState('');
  const [ncs, setNcs] = useState<Array<{ tipo: TipoNaoConformidade; descricao: string }>>([]);
  const [aceiteObs, setAceiteObs] = useState('');
  useEffect(() => setAmostra(lote.amostraSugerida), [lote.amostraSugerida]);
  const v = lote.verificacao;
  const ultimo = lote.qcs[0];

  const registrar = useMutation({
    mutationFn: () =>
      api<{ aprovado: boolean }>(`/t/${slug}/digitalizacao/lotes/${lote.id}/qc`, {
        method: 'POST',
        body: { amostra, checklist, ...(obs.trim() ? { observacao: obs.trim() } : {}), naoConformidades: ncs.filter((n) => n.descricao.trim().length >= 3) },
      }),
    onSuccess: (r) => {
      toast.success(r.aprovado ? 'Controle de qualidade aprovado. O fiscal já pode dar o aceite.' : 'Reprovado: corrija as não conformidades e avalie de novo.');
      setNcs([]);
      setObs('');
      onFeito();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Não foi possível registrar.'),
  });
  const aceitar = useMutation({
    mutationFn: () => api(`/t/${slug}/digitalizacao/lotes/${lote.id}/aceite`, { method: 'POST', body: aceiteObs.trim() ? { observacao: aceiteObs.trim() } : {} }),
    onSuccess: () => {
      toast.success('Aceite registrado. As páginas do lote entram na medição.');
      onFeito();
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.status === 403 ? 'Só o fiscal do contrato dá o aceite.' : e.message) : 'Falha no aceite'),
  });

  return (
    <Card>
      <CardHeader
        icon={ClipboardCheck}
        title="Controle de qualidade"
        description={`Amostragem de ${lote.amostragemPct}%: confira ao menos ${lote.amostraSugerida} ${lote.paginas ? 'página(s)' : 'documento(s)'}.`}
      />
      <CardBody className="space-y-4">
        <div className="rounded-[12px] bg-ink-50 p-3 text-sm">
          <p className="font-semibold text-ink-800">Conferência automática</p>
          <ul className="mt-1 grid gap-1 text-ink-700 sm:grid-cols-2">
            <li>{v.documentos} documento(s) vinculados</li>
            <li className={v.semArquivo ? 'text-danger-600' : ''}>{v.semArquivo} sem arquivo</li>
            <li className={v.semPaginas ? 'text-danger-600' : ''}>{v.semPaginas} sem páginas contadas</li>
            <li className={v.semDescricaoOuData ? 'text-warning-600' : ''}>{v.semDescricaoOuData} sem descrição ou data</li>
            <li className={v.semCamadaTexto ? 'text-danger-600' : ''}>
              {v.semCamadaTexto} sem camada de texto (não é PDF pesquisável){v.leituraPendente ? ` · ${v.leituraPendente} em leitura` : ''}
            </li>
            <li className={v.duplicadosPorHash.length ? 'text-danger-600' : ''}>
              {v.duplicadosPorHash.length ? `${v.duplicadosPorHash.length} arquivo(s) duplicado(s)` : 'Sem arquivos duplicados'}
            </li>
          </ul>
        </div>

        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Amostra conferida" htmlFor="qc-amostra">
            <Input id="qc-amostra" type="number" min={1} value={amostra} onChange={(e) => setAmostra(Number(e.target.value) || 1)} />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-semibold text-ink-700">Checklist</legend>
            <div className="grid gap-1.5 text-sm text-ink-800 sm:grid-cols-2">
              {CHECKLIST_QC.map((k) => (
                <label key={k} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={checklist[k]} onChange={(e) => setChecklist((c) => ({ ...c, [k]: e.target.checked }))} />
                  {CHECKLIST_QC_LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-ink-700">Não conformidades encontradas</p>
          {ncs.map((n, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <SelectMenu aria-label="Tipo" className={inputCls} value={n.tipo} onChange={(e) => setNcs((xs) => xs.map((x, j) => (j === i ? { ...x, tipo: e.target.value as TipoNaoConformidade } : x)))}>
                {TIPOS_NAO_CONFORMIDADE.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_NAO_CONFORMIDADE_LABEL[t]}
                  </option>
                ))}
              </SelectMenu>
              <Input aria-label="Descrição" placeholder="Onde e o quê (ex.: processo 12, pág. 3 borrada)" value={n.descricao} onChange={(e) => setNcs((xs) => xs.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label="Remover" onClick={() => setNcs((xs) => xs.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" leftIcon={<Plus aria-hidden />} onClick={() => setNcs((xs) => [...xs, { tipo: 'ilegivel', descricao: '' }])}>
            Registrar não conformidade
          </Button>
        </div>
        <Field label="Observação" htmlFor="qc-obs">
          <Textarea id="qc-obs" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button loading={registrar.isPending} onClick={() => registrar.mutate()}>
            Registrar avaliação
          </Button>
        </div>

        {ultimo && (
          <div className={cn('rounded-[12px] p-3 text-sm', ultimo.aprovado ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600')}>
            Última avaliação: {ultimo.aprovado ? 'aprovada' : 'reprovada'} por {ultimo.avaliadoPor ?? '—'} em {fmtDateTime(ultimo.criadoEm)} (amostra de {ultimo.amostra}).
          </div>
        )}

        <div className="space-y-3 border-t border-ink-100 pt-4">
          <p className="flex items-center gap-2 text-sm font-bold text-ink-900">
            <BadgeCheck className="h-4 w-4 text-success-600" aria-hidden /> Aceite do fiscal do contrato
          </p>
          <p className="text-xs text-ink-500">
            Exige a última avaliação aprovada e nenhuma não conformidade aberta. Registra quem, quando e de onde, e congela as {lote.paginas.toLocaleString('pt-BR')} página(s) para a
            medição.
          </p>
          <Field label="Observação do fiscal" htmlFor="ac-obs">
            <Input id="ac-obs" value={aceiteObs} onChange={(e) => setAceiteObs(e.target.value)} />
          </Field>
          <Button
            leftIcon={<BadgeCheck aria-hidden />}
            disabled={!ultimo?.aprovado || lote.ncAbertas > 0 || !podeAceitar}
            loading={aceitar.isPending}
            onClick={() => aceitar.mutate()}
          >
            Dar aceite e disponibilizar
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function NaoConformidades({ slug, lote, onFeito }: { slug: string; lote: LoteDetalheView; onFeito: () => void }) {
  const toast = useToast();
  const [corrigindo, setCorrigindo] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const corrigir = useMutation({
    mutationFn: (ncId: string) => api(`/t/${slug}/digitalizacao/lotes/${lote.id}/nao-conformidades/${ncId}/corrigir`, { method: 'POST', body: { correcao: texto.trim() } }),
    onSuccess: () => {
      setCorrigindo(null);
      setTexto('');
      toast.success('Correção registrada.');
      onFeito();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao registrar.'),
  });
  if (!lote.naoConformidades.length) return null;
  return (
    <Card>
      <CardHeader icon={AlertTriangle} title="Não conformidades" description="Tudo o que o controle de qualidade apontou e como foi corrigido." />
      <ul className="divide-y divide-ink-100">
        {lote.naoConformidades.map((n) => (
          <li key={n.id} className="space-y-1 px-5 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={n.status === 'aberta' ? 'danger' : 'success'}>{n.status === 'aberta' ? 'Aberta' : 'Corrigida'}</Badge>
              <span className="font-semibold text-ink-900">{TIPO_NAO_CONFORMIDADE_LABEL[n.tipo]}</span>
              <span className="text-ink-700">{n.descricao}</span>
            </div>
            <p className="text-xs text-ink-500">
              Apontada por {n.criadoPor ?? '—'} em {fmtDateTime(n.criadoEm)}
              {n.correcao ? ` · Corrigida por ${n.corrigidaPor ?? '—'} em ${fmtDateTime(n.corrigidaEm)}: ${n.correcao}` : ''}
            </p>
            {n.status === 'aberta' &&
              (corrigindo === n.id ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input aria-label="Correção" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que foi feito" />
                  <Button size="sm" loading={corrigir.isPending} disabled={texto.trim().length < 3} onClick={() => corrigir.mutate(n.id)}>
                    Salvar
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setCorrigindo(n.id)}>
                  Registrar correção
                </Button>
              ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Inventario({ slug, lote, onFeito }: { slug: string; lote: LoteDetalheView; onFeito: () => void }) {
  const toast = useToast();
  const [novo, setNovo] = useState(false);
  const devolvendo = lote.etapa === 'disponibilizado';
  const conferir = useMutation({
    mutationFn: ({ itemId, ok }: { itemId: string; ok: boolean }) =>
      api(`/t/${slug}/digitalizacao/lotes/${lote.id}/itens/${itemId}`, { method: 'PATCH', body: { conferidoDevolucao: ok } }),
    onSuccess: onFeito,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao conferir.'),
  });
  const remover = useMutation({
    mutationFn: (itemId: string) => api(`/t/${slug}/digitalizacao/lotes/${lote.id}/itens/${itemId}`, { method: 'DELETE' }),
    onSuccess: onFeito,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao remover.'),
  });
  return (
    <Card>
      <CardHeader
        icon={Boxes}
        title="Inventário"
        description={devolvendo ? 'Confira cada item na devolução dos originais.' : 'Caixas, pastas, livros e processos recebidos, com estado de conservação.'}
        action={
          lote.etapa !== 'devolvido' && (
            <Button size="sm" variant="outline" leftIcon={<Plus aria-hidden />} onClick={() => setNovo(true)}>
              Item
            </Button>
          )
        }
      />
      {lote.itens.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-ink-500">Nenhum item inventariado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-y border-ink-100 bg-ink-50/60 text-left">
              <tr>
                <th className="px-5 py-2 label-caps">Item</th>
                <th className="px-5 py-2 label-caps">Datas</th>
                <th className="px-5 py-2 label-caps">Folhas</th>
                <th className="px-5 py-2 label-caps">Conservação</th>
                <th className="px-5 py-2 label-caps">{devolvendo || lote.etapa === 'devolvido' ? 'Devolvido' : ''}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {lote.itens.map((i) => (
                <tr key={i.id}>
                  <td className="px-5 py-2">
                    <span className="font-semibold text-ink-900">
                      {TIPO_ITEM_LOTE_LABEL[i.tipo]} {i.identificacao}
                    </span>
                    {i.localFisicoCodigo && <span className="block text-xs text-ink-500">{i.localFisicoCodigo}</span>}
                    {i.observacao && <span className="block text-xs text-ink-500">{i.observacao}</span>}
                  </td>
                  <td className="px-5 py-2 text-ink-700">{i.datasLimite ?? '—'}</td>
                  <td className="px-5 py-2 tabular-nums text-ink-700">{i.folhas ?? '—'}</td>
                  <td className="px-5 py-2 text-ink-700">{ESTADO_CONSERVACAO_LABEL[i.estadoConservacao]}</td>
                  <td className="px-5 py-2">
                    {devolvendo ? (
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={i.conferidoDevolucao} onChange={(e) => conferir.mutate({ itemId: i.id, ok: e.target.checked })} />
                        Conferido
                      </label>
                    ) : lote.etapa === 'devolvido' ? (
                      <Badge tone="success">Sim</Badge>
                    ) : lote.etapa === 'recebido' ? (
                      <Button variant="ghost" size="icon" aria-label={`Remover ${i.identificacao}`} onClick={() => remover.mutate(i.id)}>
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {novo && <NovoItem slug={slug} loteId={lote.id} onClose={() => setNovo(false)} onFeito={onFeito} />}
    </Card>
  );
}

function NovoItem({ slug, loteId, onClose, onFeito }: { slug: string; loteId: string; onClose: () => void; onFeito: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<ItemLoteInput>({ tipo: 'caixa', identificacao: '', estadoConservacao: 'bom' });
  const set = <K extends keyof ItemLoteInput>(k: K, v: ItemLoteInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => api(`/t/${slug}/digitalizacao/lotes/${loteId}/itens`, { method: 'POST', body: f }),
    onSuccess: () => {
      onFeito();
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao incluir.'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Item do inventário"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={salvar.isPending} disabled={!f.identificacao.trim()} onClick={() => salvar.mutate()}>
            Incluir
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="it-tipo">
          <SelectMenu id="it-tipo" className={inputCls} value={f.tipo} onChange={(e) => set('tipo', e.target.value as ItemLoteInput['tipo'])}>
            {TIPOS_ITEM_LOTE.map((t) => (
              <option key={t} value={t}>
                {TIPO_ITEM_LOTE_LABEL[t]}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Identificação" htmlFor="it-id" required>
          <Input id="it-id" value={f.identificacao} onChange={(e) => set('identificacao', e.target.value)} placeholder="Ex.: CX-012" />
        </Field>
        <Field label="Datas-limite" htmlFor="it-datas">
          <Input id="it-datas" value={f.datasLimite ?? ''} onChange={(e) => set('datasLimite', e.target.value)} placeholder="Ex.: 2010–2012" />
        </Field>
        <Field label="Folhas" htmlFor="it-folhas">
          <Input id="it-folhas" type="number" min={0} value={f.folhas ?? ''} onChange={(e) => set('folhas', e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label="Estado de conservação" htmlFor="it-estado">
          <SelectMenu id="it-estado" className={inputCls} value={f.estadoConservacao} onChange={(e) => set('estadoConservacao', e.target.value as ItemLoteInput['estadoConservacao'])}>
            {ESTADOS_CONSERVACAO.map((s) => (
              <option key={s} value={s}>
                {ESTADO_CONSERVACAO_LABEL[s]}
              </option>
            ))}
          </SelectMenu>
        </Field>
        <Field label="Observação" htmlFor="it-obs">
          <Input id="it-obs" value={f.observacao ?? ''} onChange={(e) => set('observacao', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Documentos({ slug, lote, onFeito }: { slug: string; lote: LoteDetalheView; onFeito: () => void }) {
  const toast = useToast();
  const [termo, setTermo] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(termo.trim()), 350);
    return () => clearTimeout(t);
  }, [termo]);
  const bloqueado = lote.etapa === 'disponibilizado' || lote.etapa === 'devolvido';
  const { data: docs } = useQuery({
    queryKey: ['digit', 'lote-docs', slug, lote.id],
    queryFn: () => api<Array<{ id: string; titulo: string; paginas: number | null; temArquivo: boolean }>>(`/t/${slug}/digitalizacao/lotes/${lote.id}/documentos`),
  });
  const { data: achados } = useQuery({
    queryKey: ['digit', 'busca-doc', slug, debounced],
    queryFn: () => api<DocumentPage>(`/t/${slug}/documents?module=acervo&pageSize=8&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2 && !bloqueado,
  });
  const vincular = useMutation({
    mutationFn: (ids: string[]) => api<{ vinculados: number }>(`/t/${slug}/digitalizacao/lotes/${lote.id}/documentos`, { method: 'POST', body: { ids } }),
    onSuccess: () => {
      setTermo('');
      onFeito();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao vincular.'),
  });
  const desvincular = useMutation({
    mutationFn: (documentId: string) => api(`/t/${slug}/digitalizacao/lotes/${lote.id}/documentos/${documentId}`, { method: 'DELETE' }),
    onSuccess: onFeito,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao retirar.'),
  });
  const ja = new Set((docs ?? []).map((d) => d.id));
  return (
    <Card>
      <CardHeader icon={FileText} title="Documentos digitalizados" description="Vínculo entre o arquivo digital e o lote (e as caixas) do original." />
      <CardBody className="space-y-3">
        {!bloqueado && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden />
              <Input aria-label="Buscar documento do acervo" className="pl-9" placeholder="Buscar documento do acervo para vincular…" value={termo} onChange={(e) => setTermo(e.target.value)} />
            </div>
            {debounced.length >= 2 && (
              <ul className="max-h-48 overflow-y-auto rounded-[10px] border border-ink-200/70">
                {achados?.items.length === 0 && <li className="px-3 py-2 text-xs text-ink-500">Nenhum documento encontrado.</li>}
                {achados?.items
                  .filter((d) => !ja.has(d.id))
                  .map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{d.descricao || d.assunto || d.originalName}</span>
                      <Button size="sm" variant="outline" leftIcon={<Link2 aria-hidden />} onClick={() => vincular.mutate([d.id])}>
                        Vincular
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
        {!docs?.length ? (
          <p className="text-sm text-ink-500">Nenhum documento vinculado.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-[10px] border border-ink-200/70">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {d.titulo}
                  <span className="ml-2 text-xs text-ink-500">{d.temArquivo ? `${d.paginas ?? 0} pág.` : 'sem arquivo'}</span>
                </span>
                {!bloqueado && (
                  <Button variant="ghost" size="icon" aria-label="Retirar do lote" onClick={() => desvincular.mutate(d.id)}>
                    <Unlink aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Custodia({ lote }: { lote: LoteDetalheView }) {
  return (
    <Card>
      <CardHeader icon={History} title="Cadeia de custódia" description="Cada mudança de etapa: quem, quando e de onde." />
      <ol className="space-y-3 px-5 pb-5">
        {lote.eventos.map((e) => (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden />
            <div>
              <p className="font-semibold text-ink-900">
                {e.etapaDe ? `${ETAPA_LOTE_LABEL[e.etapaDe]} → ` : ''}
                {ETAPA_LOTE_LABEL[e.etapaPara]}
              </p>
              <p className="text-xs text-ink-500">
                {fmtDateTime(e.criadoEm)} · {e.usuario ?? '—'}
                {e.ip ? ` · IP ${e.ip}` : ''}
              </p>
              {e.observacao && <p className="text-xs text-ink-700">{e.observacao}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
