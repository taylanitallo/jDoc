'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  LOTE_MAX_ARQUIVOS,
  classeTemTemporalidade,
  modeloCsvLote,
  montarLote,
  validarItemLote,
  type ClassificacaoView,
  type DocumentTypeLookup,
  type ItemLote,
} from '@jdoc/shared';
import { api, renovarSessao } from '@/lib/api';
import { uploadDocument } from '@/lib/upload';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, PageHeader, SelectMenu, formatBytes, inputCls, labelCls } from '@/components/ui';
import { MetadadosFields } from '@/components/documents/metadados-fields';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

type Estado = 'pronto' | 'invalido' | 'enviando' | 'enviado' | 'erro';
interface Linha extends ItemLote {
  file: File;
  estado: Estado;
  progresso: number;
  erroEnvio?: string;
}

/** Envios simultaneos: rapido sem sobrecarregar a API nem a conexao da prefeitura. */
const PARALELOS = 2;

export default function EnvioEmLotePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();

  const [tipoId, setTipoId] = useState('');
  const [classeId, setClasseId] = useState('');
  const [nivel, setNivel] = useState<'restrito' | 'publico'>('restrito');
  const [dataPadrao, setDataPadrao] = useState('');
  const [digitalizado, setDigitalizado] = useState(false);
  const [resp, setResp] = useState('');
  const [dataDig, setDataDig] = useState('');
  const [localDig, setLocalDig] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [planilha, setPlanilha] = useState<{ nome: string; texto: string } | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cancelar = useRef(false);
  const inputPdf = useRef<HTMLInputElement>(null);
  const inputCsv = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

  const { data: tipos } = useQuery<DocumentTypeLookup[]>({
    queryKey: ['document-types', slug, 'acervo'],
    queryFn: () => api(`/t/${slug}/document-types?modulo=acervo`),
  });
  const { data: classes } = useQuery<ClassificacaoView[]>({
    queryKey: ['arquivistica', 'classificacoes'],
    queryFn: () => api(`/t/${slug}/arquivistica/classificacoes`),
    staleTime: 60_000,
  });
  const tipo = tipos?.find((t) => t.id === tipoId);
  const campos = useMemo(() => tipo?.campos ?? [], [tipo]);
  const classesUteis = (classes ?? []).filter((c) => c.ativo && classeTemTemporalidade(c));

  // Trocar de tipo: classe e acesso padrao do tipo.
  useEffect(() => {
    if (!tipo) return;
    setClasseId(tipo.classificacaoId ?? '');
    setNivel(tipo.nivelAcessoPadrao ?? 'restrito');
  }, [tipo]);

  const validar = (l: Omit<Linha, 'estado'> & { estado?: Estado }): Estado => {
    if (l.estado === 'enviado') return 'enviado';
    return validarItemLote(l, campos).length === 0 ? 'pronto' : 'invalido';
  };

  /** Remonta as linhas (novos PDFs, nova planilha, novo tipo ou nova data padrao), preservando o que ja foi enviado. */
  const remontar = (files: File[], csv: string | null) => {
    const r = montarLote(files.map((f) => f.name), csv, campos, { dataDocumento: dataPadrao || undefined });
    setAvisos(r.avisos);
    setLinhas((atuais) =>
      r.itens.map((it, i) => {
        const antiga = atuais.find((a) => a.file === files[i]);
        if (antiga?.estado === 'enviado') return antiga;
        const base = { ...it, file: files[i]!, progresso: 0 };
        return { ...base, estado: validar(base) };
      }),
    );
  };
  const arquivosAtuais = linhas.map((l) => l.file);
  useEffect(() => {
    if (linhas.length) remontar(arquivosAtuais, planilha?.texto ?? null);
    // remonta quando o tipo (campos) ou a data padrao mudam
  }, [campos, dataPadrao]);

  const adicionarPdfs = (lista: FileList | File[] | null) => {
    if (!lista) return;
    const novos = Array.from(lista).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    const ignorados = Array.from(lista).length - novos.length;
    const nomes = new Set(arquivosAtuais.map((f) => f.name));
    const unicos = novos.filter((f) => !nomes.has(f.name));
    const todos = [...arquivosAtuais, ...unicos].slice(0, LOTE_MAX_ARQUIVOS);
    if (arquivosAtuais.length + unicos.length > LOTE_MAX_ARQUIVOS) toast.error(`Limite de ${LOTE_MAX_ARQUIVOS} arquivos por lote.`);
    if (ignorados > 0) toast.info(`${ignorados} arquivo(s) ignorado(s): só PDF.`);
    remontar(todos, planilha?.texto ?? null);
  };

  const carregarPlanilha = async (f: File | undefined) => {
    if (!f) return;
    const texto = await f.text();
    setPlanilha({ nome: f.name, texto });
    remontar(arquivosAtuais, texto);
  };

  const baixarModelo = () => {
    if (!tipo) return;
    const blob = new Blob([modeloCsvLote(campos)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `modelo-lote-${tipo.nome.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const atualizar = (i: number, parcial: Partial<Linha>) =>
    setLinhas((ls) => ls.map((l, n) => (n === i ? { ...l, ...parcial, estado: validar({ ...l, ...parcial }) } : l)));
  const remover = (i: number) => setLinhas((ls) => ls.filter((_, n) => n !== i));

  const contagem = linhas.reduce<Record<Estado, number>>(
    (acc, l) => ({ ...acc, [l.estado]: acc[l.estado] + 1 }),
    { pronto: 0, invalido: 0, enviando: 0, enviado: 0, erro: 0 },
  );
  const paraEnviar = contagem.pronto + contagem.erro;

  // Aviso ao sair no meio do envio.
  useEffect(() => {
    if (!enviando) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [enviando]);

  const enviar = async () => {
    if (!tipo) return;
    setEnviando(true);
    cancelar.current = false;
    const fila = linhas.map((l, i) => ({ l, i })).filter(({ l }) => l.estado === 'pronto' || l.estado === 'erro');
    const enviarUm = async ({ l, i }: { l: Linha; i: number }) => {
      setLinhas((ls) => ls.map((x, n) => (n === i ? { ...x, estado: 'enviando', progresso: 0, erroEnvio: undefined } : x)));
      const campos: Record<string, string> = {
        module: 'acervo',
        documentTypeId: tipo.id,
        descricao: l.descricao,
        documentDate: l.dataDocumento,
        exercicio: l.dataDocumento.slice(0, 4),
        nivelAcesso: nivel,
        metadados: JSON.stringify(l.metadados),
      };
      // Metadados padrao da planilha; sem coluna "numero" propria, vale o numero do tipo.
      for (const [k, v] of Object.entries(l.catalogacao ?? {})) if (v) campos[k] = v;
      if (!campos.numero && l.metadados.numero) campos.numero = String(l.metadados.numero);
      if (classeId) campos.classificacaoId = classeId;
      if (digitalizado) {
        campos.digitalizado = 'true';
        if (resp) campos.responsavelDigitalizacao = resp;
        if (dataDig) campos.dataDigitalizacao = dataDig;
        if (localDig) campos.localDigitalizacao = localDig;
      }
      const progresso = (p: number) => setLinhas((ls) => ls.map((x, n) => (n === i ? { ...x, progresso: p } : x)));
      let r = await uploadDocument(slug, campos, l.file, progresso);
      if (!r.ok && r.status === 401 && (await renovarSessao())) r = await uploadDocument(slug, campos, l.file, progresso);
      setLinhas((ls) =>
        ls.map((x, n) => (n === i ? { ...x, estado: r.ok ? 'enviado' : 'erro', progresso: r.ok ? 100 : 0, erroEnvio: r.ok ? undefined : r.message } : x)),
      );
    };
    let pos = 0;
    await Promise.all(
      Array.from({ length: PARALELOS }, async () => {
        while (pos < fila.length && !cancelar.current) await enviarUm(fila[pos++]!);
      }),
    );
    setEnviando(false);
    qc.invalidateQueries({ queryKey: ['docs'] });
    qc.invalidateQueries({ queryKey: ['documents'] });
    toast.success(cancelar.current ? 'Envio interrompido. Os que já foram continuam no Acervo.' : 'Lote processado. Confira o resultado de cada arquivo.');
  };

  const linhaEditando = editando !== null ? linhas[editando] : null;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    const fs = Array.from(e.dataTransfer.files);
    const csv = fs.find((f) => /\.(csv|txt)$/i.test(f.name));
    if (csv) void carregarPlanilha(csv);
    adicionarPdfs(fs.filter((f) => f !== csv));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: `/${slug}/acervo`, label: 'Acervo' }}
        title="Envio em lote"
        description="Vários PDFs de uma vez, com os dados de cada documento vindos de uma planilha (opcional)."
      />

      {/* 1. Configuracao */}
      <Card>
        <CardHeader title="1. O que está sendo enviado" description="Vale para todos os arquivos deste lote" icon={Layers} />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Tipo documental" htmlFor="l-tipo" required>
            <SelectMenu id="l-tipo" className={inputCls} value={tipoId} onChange={(e) => setTipoId(e.target.value)} disabled={enviando}>
              <option value="" disabled>
                Selecione…
              </option>
              {(tipos ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </SelectMenu>
          </Field>
          <Field label="Classe (Plano de Classificação)" htmlFor="l-classe" hint={tipo?.classificacaoId ? 'Padrão do tipo' : undefined}>
            <SelectMenu id="l-classe" className={inputCls} value={classeId} onChange={(e) => setClasseId(e.target.value)} disabled={enviando}>
              <option value="">Padrão do módulo / sem classe</option>
              {classesUteis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} — {c.descricao}
                </option>
              ))}
            </SelectMenu>
          </Field>
          <Field label="Nível de acesso" htmlFor="l-nivel">
            <SelectMenu id="l-nivel" className={inputCls} value={nivel} onChange={(e) => setNivel(e.target.value as 'restrito' | 'publico')} disabled={enviando}>
              <option value="restrito">Restrito (dados pessoais/sigilo)</option>
              <option value="publico">Público</option>
            </SelectMenu>
          </Field>
          <Field label="Data padrão" htmlFor="l-data" hint="Para PDFs sem data na planilha">
            <Input id="l-data" type="date" value={dataPadrao} onChange={(e) => setDataPadrao(e.target.value)} disabled={enviando} />
          </Field>
          <div className="rounded-[12px] border border-ink-200/70 p-3 sm:col-span-2 lg:col-span-4">
            <label className="flex items-center gap-2 text-sm font-medium text-ink-800">
              <input type="checkbox" checked={digitalizado} onChange={(e) => setDigitalizado(e.target.checked)} disabled={enviando} />
              Documentos digitalizados a partir de originais em papel (Decreto 10.278/2020)
            </label>
            {digitalizado && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Responsável pela digitalização" htmlFor="l-resp">
                  <Input id="l-resp" value={resp} onChange={(e) => setResp(e.target.value)} />
                </Field>
                <Field label="Data da digitalização" htmlFor="l-datadig">
                  <Input id="l-datadig" type="date" value={dataDig} onChange={(e) => setDataDig(e.target.value)} />
                </Field>
                <Field label="Local da digitalização" htmlFor="l-localdig">
                  <Input id="l-localdig" value={localDig} onChange={(e) => setLocalDig(e.target.value)} placeholder="ex.: Arquivo Municipal — sala de digitalização" />
                </Field>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* 2. Arquivos e planilha */}
      <Card>
        <CardHeader
          title="2. Arquivos"
          description={`Até ${LOTE_MAX_ARQUIVOS} PDFs por lote. A planilha é opcional: sem ela, a descrição vem do nome do arquivo.`}
          icon={UploadCloud}
          action={
            <Button variant="outline" leftIcon={<FileSpreadsheet aria-hidden />} onClick={baixarModelo} disabled={!tipo}>
              Planilha-modelo
            </Button>
          }
        />
        <CardBody className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div
            role="button"
            tabIndex={0}
            aria-disabled={!tipo || enviando}
            onClick={() => tipo && !enviando && inputPdf.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && tipo && inputPdf.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => (tipo && !enviando ? onDrop(e) : e.preventDefault())}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed p-8 text-center transition lg:col-span-2',
              !tipo ? 'cursor-not-allowed border-ink-200 opacity-55' : arrastando ? 'border-brand-500 bg-brand-50' : 'cursor-pointer border-ink-200 hover:border-brand-500 hover:bg-ink-50',
            )}
          >
            <UploadCloud className="h-8 w-8 text-brand-600" aria-hidden />
            <p className="text-sm font-semibold text-ink-900">{tipo ? 'Arraste os PDFs (e a planilha) aqui ou clique para escolher' : 'Escolha o tipo documental primeiro'}</p>
            <p className="text-xs text-ink-500">Dá para selecionar vários de uma vez (Ctrl+A na pasta).</p>
            <input ref={inputPdf} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => adicionarPdfs(e.target.files)} />
          </div>
          <div className="flex flex-col justify-between gap-3 rounded-[16px] border border-ink-200/70 p-4">
            <div>
              <p className={labelCls}>Planilha (CSV)</p>
              {planilha ? (
                <p className="flex items-center gap-2 text-sm text-ink-800">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-success-600" aria-hidden />
                  <span className="truncate">{planilha.nome}</span>
                  <button
                    type="button"
                    aria-label="Remover planilha"
                    className="ml-auto flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-500 hover:bg-danger-50 hover:text-danger-600"
                    onClick={() => {
                      setPlanilha(null);
                      remontar(arquivosAtuais, null);
                    }}
                    disabled={enviando}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </p>
              ) : (
                <p className="text-xs text-ink-500">
                  Baixe a planilha-modelo, preencha uma linha por PDF (a coluna <b>arquivo</b> é o nome do PDF) e salve como CSV no Excel.
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => inputCsv.current?.click()} disabled={!tipo || enviando}>
              {planilha ? 'Trocar planilha' : 'Carregar planilha'}
            </Button>
            <input ref={inputCsv} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => void carregarPlanilha(e.target.files?.[0])} />
          </div>
          {avisos.length > 0 && (
            <ul className="space-y-1 rounded-[12px] bg-warning-50 px-4 py-3 text-xs text-warning-600 lg:col-span-3">
              {avisos.map((a) => (
                <li key={a} className="flex items-start gap-1.5">
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  {a}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 3. Revisao e envio */}
      {linhas.length > 0 && (
        <Card>
          <CardHeader
            title="3. Revisar e enviar"
            description={`${linhas.length} arquivo(s): ${contagem.pronto} pronto(s), ${contagem.invalido} com pendência, ${contagem.enviado} enviado(s)${contagem.erro ? `, ${contagem.erro} com erro` : ''}`}
            icon={CheckCircle2}
            action={
              enviando ? (
                <Button variant="outline" onClick={() => (cancelar.current = true)}>
                  Interromper
                </Button>
              ) : contagem.enviado === linhas.length ? (
                <Button onClick={() => router.push(`/${slug}/acervo`)}>Ver no Acervo</Button>
              ) : (
                <Button onClick={() => void enviar()} disabled={paraEnviar === 0} leftIcon={<UploadCloud aria-hidden />}>
                  {contagem.erro ? `Enviar ${paraEnviar} (reenviar com erro)` : `Enviar ${paraEnviar} documento(s)`}
                </Button>
              )
            }
          />
          {contagem.invalido > 0 && !enviando && (
            <p className="border-b border-ink-100 px-5 py-2 text-xs text-ink-500">
              Os arquivos com pendência não são enviados: corrija na linha (lápis) ou na planilha e carregue de novo.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-ink-50/60">
                <tr className="label-caps border-b border-ink-200 text-left">
                  <th className="px-5 py-3">Arquivo</th>
                  <th className="px-3 py-3">Descrição</th>
                  <th className="px-3 py-3">Data</th>
                  <th className="px-3 py-3">Situação</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {linhas.map((l, i) => {
                  const erros = l.estado === 'invalido' ? validarItemLote(l, campos) : [];
                  const travada = enviando || l.estado === 'enviado' || l.estado === 'enviando';
                  return (
                    <tr key={`${l.arquivo}-${i}`} className="align-top">
                      <td className="max-w-[220px] px-5 py-3">
                        <p className="flex items-center gap-2 truncate font-medium text-ink-900" title={l.arquivo}>
                          <FileText className="h-4 w-4 shrink-0 text-danger-600" aria-hidden />
                          <span className="truncate">{l.arquivo}</span>
                        </p>
                        <p className="text-xs text-ink-400">{formatBytes(l.file.size)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Input aria-label={`Descrição de ${l.arquivo}`} value={l.descricao} onChange={(e) => atualizar(i, { descricao: e.target.value })} disabled={travada} className="h-9" />
                      </td>
                      <td className="px-3 py-3">
                        <Input aria-label={`Data de ${l.arquivo}`} type="date" value={l.dataDocumento} onChange={(e) => atualizar(i, { dataDocumento: e.target.value })} disabled={travada} className="h-9 w-40" />
                      </td>
                      <td className="min-w-[200px] px-3 py-3">
                        {l.estado === 'pronto' && <Badge tone="success">Pronto</Badge>}
                        {l.estado === 'enviado' && <Badge tone="success">Enviado</Badge>}
                        {l.estado === 'enviando' && (
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${l.progresso}%` }} />
                            </div>
                          </div>
                        )}
                        {l.estado === 'invalido' && (
                          <div>
                            <Badge tone="warning">Pendência</Badge>
                            <p className="mt-1 text-xs text-warning-600">{erros.join(' · ')}</p>
                          </div>
                        )}
                        {l.estado === 'erro' && (
                          <div>
                            <Badge tone="danger">Erro</Badge>
                            <p className="mt-1 text-xs text-danger-600">{l.erroEnvio}</p>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          {campos.length > 0 && (
                            <button
                              type="button"
                              title="Editar campos do tipo"
                              aria-label={`Editar campos de ${l.arquivo}`}
                              onClick={() => setEditando(i)}
                              disabled={travada}
                              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-brand-50 hover:text-brand-600 disabled:opacity-40"
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                          {l.estado === 'erro' && !enviando && (
                            <span title="Será reenviado no próximo envio" className="flex h-8 w-8 items-center justify-center text-ink-400">
                              <RotateCcw className="h-4 w-4" aria-hidden />
                            </span>
                          )}
                          <button
                            type="button"
                            title="Tirar do lote"
                            aria-label={`Tirar ${l.arquivo} do lote`}
                            onClick={() => remover(i)}
                            disabled={travada}
                            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-500 transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={linhaEditando !== null}
        onClose={() => setEditando(null)}
        title="Campos do documento"
        subtitle={linhaEditando?.arquivo}
        footer={<Button onClick={() => setEditando(null)}>Concluir</Button>}
      >
        {linhaEditando && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetadadosFields
              campos={campos}
              values={linhaEditando.metadados}
              onChange={(m) => editando !== null && atualizar(editando, { metadados: m })}
              idPrefix="lote-md"
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
