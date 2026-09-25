'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import {
  ELIMINACAO_STATUS_LABEL,
  fraseConfirmacaoEliminacao,
  type EliminacaoItemView,
  type EliminacaoView,
  hojeIso,
} from '@jdoc/shared';
import { api, apiBlobUrl, ApiError } from '@/lib/api';
import { Badge, Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from '@/components/ui';
import { useToast } from '@/components/toast';

const fmt = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—');
const num = (e: { numero: number; ano: number }) => `${String(e.numero).padStart(3, '0')}/${e.ano}`;
const COR: Record<EliminacaoView['status'], 'gray' | 'blue' | 'orange' | 'green' | 'red'> = {
  rascunho: 'gray',
  aprovada: 'blue',
  edital_publicado: 'orange',
  concluida: 'green',
  cancelada: 'red',
};

async function abrirPdf(path: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const url = await apiBlobUrl(path);
    if (win) win.location.href = url;
    else window.open(url, '_blank');
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Inclui documentos selecionados em "A eliminar" na listagem em elaboracao (cria uma se nao houver). */
export async function incluirNaListagem(slug: string, ids: string[]): Promise<EliminacaoView> {
  const lista = await api<EliminacaoView[]>(`/t/${slug}/arquivistica/eliminacoes`);
  const rascunho = lista.find((e) => e.status === 'rascunho') ?? (await api<EliminacaoView>(`/t/${slug}/arquivistica/eliminacoes`, { method: 'POST', body: {} }));
  await api(`/t/${slug}/arquivistica/eliminacoes/${rascunho.id}/itens`, { method: 'POST', body: { ids } });
  return rascunho;
}

export function Eliminacoes({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [aberta, setAberta] = useState<string | null>(null);
  const [modal, setModal] = useState<{ tipo: 'aprovar' | 'edital' | 'concluir' | 'cancelar'; e: EliminacaoView } | null>(null);
  const { data = [] } = useQuery<EliminacaoView[]>({
    queryKey: ['arquivistica', 'eliminacoes', slug],
    queryFn: () => api(`/t/${slug}/arquivistica/eliminacoes`),
  });
  const pdf = (path: string) => abrirPdf(`/t/${slug}/arquivistica/eliminacoes/${path}`).catch((e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao gerar PDF'));
  const hoje = hojeIso();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['arquivistica'] });

  return (
    <div className={`${cardCls} p-4`}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink-800">Eliminações (Resolução CONARQ nº 40)</h2>
      </div>
      <p className="mb-3 text-xs text-ink-500">
        Listagem → aprovação da CPAD → edital de ciência publicado → prazo do edital → termo de eliminação. Os PDFs só são
        apagados na conclusão; metadados e hash de cada documento ficam registrados para sempre.
      </p>
      {data.length === 0 ? (
        <p className="text-xs text-ink-500">Nenhuma eliminação. Selecione documentos em “A eliminar” e use “Incluir em listagem”.</p>
      ) : (
        <ul className="divide-y divide-ink-200">
          {data.map((e) => (
            <li key={e.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="flex items-center gap-2 text-left text-sm text-ink-800" onClick={() => setAberta(aberta === e.id ? null : e.id)}>
                  {aberta === e.id ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                  <span className="font-semibold">Listagem nº {num(e)}</span>
                  <Badge color={COR[e.status]}>{ELIMINACAO_STATUS_LABEL[e.status]}</Badge>
                  <span className="text-xs text-ink-500">{e.totalItens} doc(s)</span>
                  {e.status === 'edital_publicado' && e.liberadaEm && (
                    <span className="text-xs text-ink-500">· liberada a partir de {fmt(e.liberadaEm)}</span>
                  )}
                </button>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} onClick={() => pdf(`${e.id}/listagem.pdf`)}>
                    <span className="flex items-center gap-1"><FileText className="h-4 w-4" aria-hidden /> Listagem</span>
                  </button>
                  {['aprovada', 'edital_publicado', 'concluida'].includes(e.status) && (
                    <button type="button" className={btnGhost} onClick={() => pdf(`${e.id}/edital.pdf`)}>
                      <span className="flex items-center gap-1"><FileText className="h-4 w-4" aria-hidden /> Edital</span>
                    </button>
                  )}
                  {e.status === 'concluida' && (
                    <button type="button" className={btnGhost} onClick={() => pdf(`${e.id}/termo.pdf`)}>
                      <span className="flex items-center gap-1"><FileText className="h-4 w-4" aria-hidden /> Termo</span>
                    </button>
                  )}
                  {e.status === 'rascunho' && (
                    <button type="button" className={btnPrimary} disabled={e.totalItens === 0} onClick={() => setModal({ tipo: 'aprovar', e })}>
                      Registrar aprovação da CPAD
                    </button>
                  )}
                  {e.status === 'aprovada' && (
                    <button type="button" className={btnPrimary} onClick={() => setModal({ tipo: 'edital', e })}>
                      Registrar publicação do edital
                    </button>
                  )}
                  {e.status === 'edital_publicado' && (
                    <button
                      type="button"
                      className="rounded-[10px] bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-50"
                      disabled={!e.liberadaEm || hoje < e.liberadaEm}
                      title={e.liberadaEm && hoje < e.liberadaEm ? `Prazo do edital termina em ${fmt(e.liberadaEm)}` : undefined}
                      onClick={() => setModal({ tipo: 'concluir', e })}
                    >
                      Concluir eliminação
                    </button>
                  )}
                  {['rascunho', 'aprovada', 'edital_publicado'].includes(e.status) && (
                    <button type="button" aria-label="Cancelar eliminação" className="text-danger-600 hover:text-danger-600" onClick={() => setModal({ tipo: 'cancelar', e })}>
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              {aberta === e.id && <Itens slug={slug} e={e} onChanged={invalidate} />}
            </li>
          ))}
        </ul>
      )}
      {modal && <ModalFluxo slug={slug} tipo={modal.tipo} e={modal.e} onClose={() => setModal(null)} onDone={invalidate} />}
    </div>
  );
}

function Itens({ slug, e, onChanged }: { slug: string; e: EliminacaoView; onChanged: () => void }) {
  const toast = useToast();
  const { data = [], refetch } = useQuery<EliminacaoItemView[]>({
    queryKey: ['arquivistica', 'eliminacoes', slug, e.id, 'itens'],
    queryFn: () => api(`/t/${slug}/arquivistica/eliminacoes/${e.id}/itens`),
  });
  const remover = useMutation({
    mutationFn: (id: string) => api(`/t/${slug}/arquivistica/eliminacoes/${e.id}/itens`, { method: 'DELETE', body: { ids: [id] } }),
    onSuccess: () => {
      void refetch();
      onChanged();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Falha ao remover'),
  });
  return (
    <ul className="ml-6 mt-2 space-y-1 text-xs">
      {data.map((i) => (
        <li key={i.documentId} className="flex items-center justify-between gap-2 text-ink-800">
          <span>
            <span className="mr-2 font-mono text-ink-500">{i.classificacaoCodigo ?? '—'}</span>
            {i.descricao}
            <span className="ml-2 text-ink-500">{i.exercicio}{i.localFisico ? ` · ${i.localFisico}` : ''}</span>
          </span>
          {e.status === 'rascunho' && (
            <button type="button" aria-label="Remover da listagem" className="text-danger-600 hover:text-danger-600" onClick={() => remover.mutate(i.documentId)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ModalFluxo({
  slug,
  tipo,
  e,
  onClose,
  onDone,
}: {
  slug: string;
  tipo: 'aprovar' | 'edital' | 'concluir' | 'cancelar';
  e: EliminacaoView;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [ata, setAta] = useState('');
  const [dataAprov, setDataAprov] = useState(hojeIso());
  const [membros, setMembros] = useState([{ nome: '', cargo: '' }, { nome: '', cargo: '' }]);
  const [veiculo, setVeiculo] = useState('');
  const [dataPub, setDataPub] = useState(hojeIso());
  const [frase, setFrase] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const esperado = fraseConfirmacaoEliminacao(e.numero, e.ano);

  const enviar = useMutation({
    mutationFn: () => {
      const b = `/t/${slug}/arquivistica/eliminacoes/${e.id}`;
      if (tipo === 'aprovar') {
        return api(`${b}/aprovar`, {
          method: 'POST',
          body: { ataAprovacao: ata.trim(), dataAprovacao: dataAprov, comissao: membros.filter((m) => m.nome.trim()).map((m) => ({ nome: m.nome.trim(), cargo: m.cargo.trim() })) },
        });
      }
      if (tipo === 'edital') return api(`${b}/edital`, { method: 'POST', body: { veiculoPublicacao: veiculo.trim(), dataPublicacaoEdital: dataPub } });
      if (tipo === 'concluir') return api(`${b}/concluir`, { method: 'POST', body: { confirmacao: frase.trim() } });
      return api(`${b}/cancelar`, { method: 'POST', body: { motivo: motivo.trim() } });
    },
    onSuccess: () => {
      toast.success(
        tipo === 'concluir' ? `Eliminação nº ${num(e)} concluída. Emita o Termo de Eliminação.` : 'Registrado.',
      );
      onDone();
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao registrar'),
  });

  const titulo = {
    aprovar: 'Aprovação da CPAD',
    edital: 'Publicação do Edital de Ciência',
    concluir: 'Concluir eliminação',
    cancelar: 'Cancelar eliminação',
  }[tipo];

  return (
    <Modal title={titulo} subtitle={`Listagem nº ${num(e)} · ${e.totalItens} documento(s)`} open onClose={onClose}>
      <div className="space-y-4">
        {tipo === 'aprovar' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="el-ata">Nº da ata<span className="ml-0.5 text-danger-600">*</span></label>
                <input id="el-ata" className={inputCls} value={ata} onChange={(ev) => setAta(ev.target.value)} placeholder="ex.: 07/2026" />
              </div>
              <div>
                <label className={labelCls} htmlFor="el-data">Data da reunião<span className="ml-0.5 text-danger-600">*</span></label>
                <input id="el-data" type="date" className={inputCls} value={dataAprov} onChange={(ev) => setDataAprov(ev.target.value)} />
              </div>
            </div>
            <div>
              <p className={labelCls}>Membros da CPAD (mínimo 2)<span className="ml-0.5 text-danger-600">*</span></p>
              <div className="space-y-2">
                {membros.map((m, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input aria-label="Nome" className={inputCls} placeholder="Nome" value={m.nome} onChange={(ev) => setMembros((ms) => ms.map((x, j) => (j === i ? { ...x, nome: ev.target.value } : x)))} />
                    <input aria-label="Cargo" className={inputCls} placeholder="Cargo na comissão" value={m.cargo} onChange={(ev) => setMembros((ms) => ms.map((x, j) => (j === i ? { ...x, cargo: ev.target.value } : x)))} />
                  </div>
                ))}
              </div>
              <button type="button" className="mt-2 flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => setMembros((ms) => [...ms, { nome: '', cargo: '' }])}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar membro
              </button>
            </div>
          </>
        )}
        {tipo === 'edital' && (
          <>
            <p className="text-sm text-ink-800">
              Gere o PDF do edital, publique no veículo oficial e registre aqui. A eliminação só poderá ser concluída{' '}
              {e.prazoEditalDias} dias após a data de publicação.
            </p>
            <div>
              <label className={labelCls} htmlFor="el-veic">Veículo de publicação<span className="ml-0.5 text-danger-600">*</span></label>
              <input id="el-veic" className={inputCls} value={veiculo} onChange={(ev) => setVeiculo(ev.target.value)} placeholder="ex.: Diário Oficial do Município, edição 1.234" />
            </div>
            <div>
              <label className={labelCls} htmlFor="el-pub">Data da publicação<span className="ml-0.5 text-danger-600">*</span></label>
              <input id="el-pub" type="date" className={inputCls} value={dataPub} onChange={(ev) => setDataPub(ev.target.value)} />
            </div>
          </>
        )}
        {tipo === 'concluir' && (
          <>
            <div className="flex items-start gap-3 rounded-[10px] border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-600">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>
                <strong>Ação irreversível.</strong> Os arquivos PDF dos {e.totalItens} documento(s) serão apagados
                definitivamente. Ficam guardados só os metadados e o hash de cada arquivo, como prova. Originais em papel
                aparecerão no anexo de destruição do Termo.
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="el-frase">Para confirmar, digite: {esperado}</label>
              <input id="el-frase" className={inputCls} value={frase} onChange={(ev) => setFrase(ev.target.value)} autoComplete="off" />
            </div>
          </>
        )}
        {tipo === 'cancelar' && (
          <div>
            <label className={labelCls} htmlFor="el-mot">Motivo<span className="ml-0.5 text-danger-600">*</span></label>
            <input id="el-mot" className={inputCls} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="ex.: Pendência judicial sobre documentos da listagem" />
          </div>
        )}
        {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Voltar</button>
          <button
            type="button"
            className={tipo === 'concluir' ? 'rounded-[10px] bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-600 disabled:opacity-50' : btnPrimary}
            disabled={
              enviar.isPending ||
              (tipo === 'aprovar' && (!ata.trim() || membros.filter((m) => m.nome.trim() && m.cargo.trim()).length < 2)) ||
              (tipo === 'edital' && veiculo.trim().length < 3) ||
              (tipo === 'concluir' && frase.trim() !== esperado) ||
              (tipo === 'cancelar' && motivo.trim().length < 5)
            }
            onClick={() => enviar.mutate()}
          >
            {enviar.isPending ? 'Processando…' : tipo === 'concluir' ? 'Eliminar definitivamente' : 'Confirmar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
