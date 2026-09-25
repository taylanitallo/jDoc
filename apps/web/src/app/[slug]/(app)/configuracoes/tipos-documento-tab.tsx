'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import {
  TIPOS_CAMPO,
  camposMetadadosSchema,
  classeTemTemporalidade,
  type CampoMetadado,
  type ClassificacaoView,
  type TipoCampo,
  type TipoDocumento,
} from '@jdoc/shared';
import { ArrowDown, ArrowUp, FileText, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { Badge, Button, Modal, btnGhost, btnPrimary, cardCls, inputCls, labelCls, SelectMenu } from '@/components/ui';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast';
import { useModuloAtivo } from '@/components/modulo-ativo';

const CORES = ['blue', 'green', 'orange', 'red', 'purple', 'gray'] as const;
type Modulo = 'outros' | 'acervo';

/** Cor salva no tipo (nome) -> token do Design System (o nome puro do CSS, ex. blue, fica berrante). */
const COR_TIPO: Record<string, string> = {
  blue: 'var(--color-brand-600)',
  green: 'var(--color-success-600)',
  orange: 'var(--color-orange-600)',
  red: 'var(--color-danger-600)',
  purple: 'var(--color-violet-600)',
  gray: 'var(--color-ink-500)',
};
const corTipo = (c: string) => COR_TIPO[c] ?? c;
const NOME_COR: Record<string, string> = { blue: 'Azul', green: 'Verde', orange: 'Laranja', red: 'Vermelho', purple: 'Roxo', gray: 'Cinza' };

const TIPO_CAMPO_LABEL: Record<TipoCampo, string> = {
  texto: 'Texto curto',
  texto_longo: 'Texto longo',
  numero: 'Número',
  data: 'Data',
  selecao: 'Lista de opções',
};

/** "Data de publicação" -> "data_de_publicacao" (chave estavel do jsonb). */
function chaveDoRotulo(rotulo: string): string {
  const base = rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(base) ? base : `campo_${base}`.slice(0, 40);
}

export function TiposDocumentoTab() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  // Financeiro edita os tipos de Outros arquivos; Arquivo Municipal, os do Acervo.
  const { ativo } = useModuloAtivo();
  const modulo: Modulo = ativo === 'arquivo' ? 'acervo' : 'outros';
  const [editing, setEditing] = useState<TipoDocumento | 'new' | null>(null);

  const { data, isLoading } = useQuery<{ items: TipoDocumento[]; total: number }>({
    queryKey: ['configuracoes', 'tipos-documento', modulo],
    queryFn: () => api(`/t/${slug}/configuracoes/tipos-documento?page=1&pageSize=200&modulo=${modulo}`),
  });
  const { data: classes } = useQuery<ClassificacaoView[]>({
    queryKey: ['arquivistica', 'classificacoes'],
    queryFn: () => api(`/t/${slug}/arquivistica/classificacoes`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['configuracoes', 'tipos-documento'] });
    qc.invalidateQueries({ queryKey: ['document-types'] });
  };

  const modelos = useMutation({
    mutationFn: () => api<{ criados: number }>(`/t/${slug}/configuracoes/tipos-documento/modelos-acervo`, { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.criados > 0 ? `${r.criados} tipo(s) criados. Ajuste os campos se precisar.` : 'Todos os tipos prontos já existem.');
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao criar tipos prontos'),
  });

  const [excluindo, setExcluindo] = useState<TipoDocumento | null>(null);
  const excluir = useMutation({
    mutationFn: (td: TipoDocumento) => api(`/t/${slug}/configuracoes/tipos-documento/${td.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Tipo de documento excluído.');
      setExcluindo(null);
      invalidate();
    },
    onError: (e) => {
      // 409 = ha documentos vinculados: a API explica quantos
      toast.error(e instanceof ApiError ? e.message : 'Falha ao excluir o tipo');
      setExcluindo(null);
    },
  });

  const classePorId = new Map((classes ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-ink-900">{modulo === 'acervo' ? 'Tipos de documento do Acervo' : 'Tipos de documento de Outros arquivos'}</h2>
        </div>
        <div className="flex gap-2">
          {modulo === 'acervo' && (
            <button type="button" className={btnGhost} onClick={() => modelos.mutate()} disabled={modelos.isPending}>
              <span className="flex items-center gap-2"><Wand2 className="h-4 w-4" aria-hidden /> Criar tipos prontos</span>
            </button>
          )}
          <button type="button" onClick={() => setEditing('new')} className={btnPrimary}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden /> Novo tipo</span>
          </button>
        </div>
      </div>
      {modulo === 'acervo' && (
        <p className="text-xs text-ink-500">
          Tipos do Acervo definem os campos de cada documento (ex.: Lei → número, data de publicação, ementa), a classe do
          Plano de Classificação e o nível de acesso padrão.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-ink-500">Carregando...</p>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={Pencil}
          title="Nenhum tipo cadastrado"
          description={modulo === 'acervo' ? 'Use "Criar tipos prontos" (Lei, Decreto, Portaria, Contrato, Licitação, Ficha Funcional) ou cadastre os seus.' : 'Cadastre tipos de documento para usar nos módulos do sistema.'}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.items.map((td) => {
            const classe = td.classificacaoId ? classePorId.get(td.classificacaoId) : undefined;
            return (
              <div key={td.id} className={`${cardCls} relative overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-md`}>
                {/* a cor escolhida para o tipo (dado do usuario) vira a faixa e o chip */}
                <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: corTipo(td.cor) }} />
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-white shadow-sm"
                    style={{ backgroundColor: corTipo(td.cor) }}
                  >
                    <FileText className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-900">{td.nome}</p>
                    <p className="truncate text-xs text-ink-500">{td.descricao || (td.modulo === 'acervo' ? 'Tipo do Acervo' : 'Outros arquivos')}</p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      aria-label={`Editar tipo ${td.nome}`}
                      title="Editar"
                      onClick={() => setEditing(td)}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600"
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir tipo ${td.nome}`}
                      title="Excluir"
                      onClick={() => setExcluindo(td)}
                      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-600"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 empty:hidden">
                  {td.modulo === 'acervo' && <Badge tone="violet">{td.campos.length} campo(s)</Badge>}
                  {classe && <Badge tone="info">Classe {classe.codigo}</Badge>}
                  {td.nivelAcessoPadrao === 'restrito' && <Badge tone="danger">Restrito</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={excluindo !== null}
        onClose={() => !excluir.isPending && setExcluindo(null)}
        title="Excluir tipo de documento?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setExcluindo(null)} disabled={excluir.isPending}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={excluir.isPending}
              leftIcon={<Trash2 aria-hidden />}
              onClick={() => excluindo && excluir.mutate(excluindo)}
            >
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          O tipo <strong className="text-ink-900">{excluindo?.nome}</strong> será excluído definitivamente. Só é possível
          excluir tipos que não têm nenhum documento vinculado.
        </p>
      </Modal>

      {editing && (
        <TipoDocumentoModal
          slug={String(slug)}
          tipo={editing === 'new' ? null : editing}
          moduloNovo={modulo}
          classes={classes ?? []}
          onClose={() => setEditing(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}

function TipoDocumentoModal({
  slug,
  tipo,
  moduloNovo,
  classes,
  onClose,
  onDone,
}: {
  slug: string;
  tipo: TipoDocumento | null;
  moduloNovo: Modulo;
  classes: ClassificacaoView[];
  onClose: () => void;
  onDone: () => void;
}) {
  const modulo: Modulo = tipo?.modulo ?? moduloNovo;
  const [nome, setNome] = useState(tipo?.nome ?? '');
  const [descricao, setDescricao] = useState(tipo?.descricao ?? '');
  const [cor, setCor] = useState(tipo?.cor ?? 'blue');
  const [ativo, setAtivo] = useState(tipo?.ativo ?? true);
  const [classificacaoId, setClassificacaoId] = useState(tipo?.classificacaoId ?? '');
  const [nivel, setNivel] = useState<'publico' | 'restrito'>(tipo?.nivelAcessoPadrao ?? 'restrito');
  const [campos, setCampos] = useState<CampoMetadado[]>(tipo?.campos ?? []);
  const [error, setError] = useState<string | null>(null);

  const utilizaveis = classes.filter((c) => c.ativo && classeTemTemporalidade(c));

  const setCampo = (i: number, patch: Partial<CampoMetadado>) =>
    setCampos((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const mover = (i: number, d: -1 | 1) =>
    setCampos((cs) => {
      const n = [...cs];
      const alvo = i + d;
      if (alvo < 0 || alvo >= n.length) return cs;
      [n[i], n[alvo]] = [n[alvo]!, n[i]!];
      return n;
    });

  const save = useMutation({
    mutationFn: () => {
      const camposOk = camposMetadadosSchema.safeParse(campos);
      if (!camposOk.success) throw new Error(camposOk.error.issues[0]?.message ?? 'Campos invalidos');
      const body = {
        nome,
        descricao: descricao || null,
        cor,
        ativo,
        ...(tipo ? {} : { modulo }),
        campos: modulo === 'acervo' ? camposOk.data : [],
        classificacaoId: classificacaoId || null,
        nivelAcessoPadrao: nivel,
      };
      return tipo
        ? api(`/t/${slug}/configuracoes/tipos-documento/${tipo.id}`, { method: 'PATCH', body })
        : api(`/t/${slug}/configuracoes/tipos-documento`, { method: 'POST', body });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Erro ao salvar tipo de documento'),
  });

  return (
    <Modal
      title={tipo ? 'Tipo de Documento — Edição' : 'Tipo de Documento — Inclusão'}
      subtitle={modulo === 'acervo' ? 'Acervo (Arquivo Municipal)' : 'Outros Arquivos'}
      open
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="tipo-nome">Nome<span className="ml-0.5 text-danger-600">*</span></label>
          <input id="tipo-nome" className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Contrato" />
        </div>
        <div>
          <label className={labelCls} htmlFor="tipo-descricao">Descrição</label>
          <input id="tipo-descricao" className={inputCls} value={descricao ?? ''} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição opcional" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className={labelCls} id="tipo-cor">Cor</p>
            <div role="radiogroup" aria-labelledby="tipo-cor" className="flex h-10 items-center gap-2">
              {CORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cor === c}
                  aria-label={NOME_COR[c]}
                  title={NOME_COR[c]}
                  onClick={() => setCor(c)}
                  style={{ backgroundColor: corTipo(c) }}
                  className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-surface transition ${cor === c ? 'ring-2 ring-ink-900' : 'hover:scale-110'}`}
                />
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="tipo-nivel">Acesso padrão</label>
            <SelectMenu id="tipo-nivel" className={inputCls} value={nivel} onChange={(e) => setNivel(e.target.value as 'publico' | 'restrito')}>
              <option value="publico">Público</option>
              <option value="restrito">Restrito (dados pessoais/sigilo)</option>
            </SelectMenu>
          </div>
        </div>
        {utilizaveis.length > 0 && (
          <div>
            <label className={labelCls} htmlFor="tipo-classe">Classe padrão (Plano de Classificação)</label>
            <SelectMenu id="tipo-classe" className={inputCls} value={classificacaoId} onChange={(e) => setClassificacaoId(e.target.value)}>
              <option value="">— Nenhuma —</option>
              {utilizaveis.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} — {c.descricao}</option>
              ))}
            </SelectMenu>
          </div>
        )}

        {modulo === 'acervo' && (
          <div className="rounded-[16px] border border-ink-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="label-caps">Campos do documento</p>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-accent hover:underline"
                onClick={() => setCampos((cs) => [...cs, { chave: '', rotulo: '', tipo: 'texto', obrigatorio: false }])}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar campo
              </button>
            </div>
            {campos.length === 0 && <p className="text-xs text-ink-500">Sem campos extras — só título, data e PDF.</p>}
            <div className="space-y-3">
              {campos.map((c, i) => (
                <div key={i} className="rounded-[10px] bg-ink-50/40 p-2">
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      aria-label="Rótulo do campo"
                      className={`${inputCls} col-span-5`}
                      placeholder="Rótulo (ex.: Número)"
                      value={c.rotulo}
                      onChange={(e) => {
                        const rotulo = e.target.value;
                        // Chave so e derivada enquanto o campo e novo: mudar depois orfanaria valores ja gravados.
                        const nova = !tipo?.campos.some((x) => x.chave === c.chave);
                        setCampo(i, nova ? { rotulo, chave: chaveDoRotulo(rotulo) } : { rotulo });
                      }}
                    />
                    <SelectMenu
                      aria-label="Tipo do campo"
                      className={`${inputCls} col-span-4`}
                      value={c.tipo}
                      onChange={(e) => setCampo(i, { tipo: e.target.value as TipoCampo })}
                    >
                      {TIPOS_CAMPO.map((t) => (
                        <option key={t} value={t}>{TIPO_CAMPO_LABEL[t]}</option>
                      ))}
                    </SelectMenu>
                    <div className="col-span-3 flex items-center justify-end gap-1">
                      <button type="button" aria-label="Subir campo" onClick={() => mover(i, -1)} className="text-ink-500 hover:text-accent">
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </button>
                      <button type="button" aria-label="Descer campo" onClick={() => mover(i, 1)} className="text-ink-500 hover:text-accent">
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="Remover campo"
                        onClick={() => setCampos((cs) => cs.filter((_, j) => j !== i))}
                        className="text-danger-600 hover:text-danger-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1 text-xs text-ink-800">
                      <input type="checkbox" checked={c.obrigatorio} onChange={(e) => setCampo(i, { obrigatorio: e.target.checked })} />
                      Obrigatório
                    </label>
                    <span className="font-mono text-[10px] text-ink-500">{c.chave || '—'}</span>
                  </div>
                  {c.tipo === 'selecao' && (
                    <input
                      aria-label="Opções separadas por vírgula"
                      className={`${inputCls} mt-2`}
                      placeholder="Opções separadas por vírgula (ex.: Ordinária, Complementar)"
                      defaultValue={(c.opcoes ?? []).join(', ')}
                      onBlur={(e) =>
                        setCampo(i, { opcoes: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-ink-800">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Ativo
        </label>

        {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
          <button type="button" className={btnPrimary} onClick={() => save.mutate()} disabled={save.isPending || !nome}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
