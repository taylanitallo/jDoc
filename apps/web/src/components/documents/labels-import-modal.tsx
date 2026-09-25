'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardType, FileUp, Loader2, ShieldAlert } from 'lucide-react';
import type { DocModule, LabelsImportView, LabelsPreview } from '@jdoc/shared';
import { getAccessToken } from '@/lib/api';
import { api, ApiError } from '@/lib/api';
import { Modal, btnGhost, btnPrimary, inputCls, labelCls, SelectMenu } from '@/components/ui';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

async function multipart<T>(
  path: string,
  fields: Record<string, string>,
  file: File,
): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== '') form.append(k, v);
  form.append('file', file);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    let message = 'Erro na requisição';
    try {
      message = ((await res.json()) as { message?: string }).message ?? message;
    } catch {
      // sem corpo
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

type Step = 'upload' | 'preview' | 'processing' | 'done';

export function LabelsImportModal({
  slug,
  module,
  onClose,
  onDone,
}: {
  slug: string;
  module: DocModule;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>('upload');
  const [formato, setFormato] = useState('');
  const [origem, setOrigem] = useState<'arquivo' | 'colar'>('arquivo');
  const [file, setFile] = useState<File | null>(null);
  const [texto, setTexto] = useState('');
  const [preview, setPreview] = useState<LabelsPreview | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [status, setStatus] = useState<LabelsImportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling de status em tempo real.
  useEffect(() => {
    if (step !== 'processing' || !importId) return;
    pollRef.current = setInterval(() => {
      api<LabelsImportView>(`/t/${slug}/labels-imports/${importId}`)
        .then((s) => {
          setStatus(s);
          if (s.status === 'concluido' || s.status === 'erro') {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep('done');
            onDone();
          }
        })
        .catch(() => undefined);
    }, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, importId, slug, onDone]);

  // Resolve o arquivo a enviar: seleção direta ou texto colado embrulhado num File.
  const resolveFile = (): File | null => {
    if (origem === 'arquivo') return file;
    const conteudo = texto.trim();
    if (!conteudo) return null;
    return new File([texto], 'colado.txt', { type: 'text/plain' });
  };

  const doPreview = async () => {
    const alvo = resolveFile();
    if (!alvo) {
      setError(
        origem === 'arquivo'
          ? 'Selecione o arquivo TXT/CSV do sistema contábil'
          : 'Cole o conteúdo do arquivo TXT/CSV do sistema contábil',
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const p = await multipart<LabelsPreview>(
        `/t/${slug}/labels-imports/preview`,
        { module, formato },
        alvo,
      );
      setPreview(p);
      setStep('preview');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha no preview');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const alvo = resolveFile();
    if (!alvo) return;
    setError(null);
    setBusy(true);
    try {
      const r = await multipart<{ id: string }>(
        `/t/${slug}/labels-imports`,
        { module, formato: preview?.formato ?? formato },
        alvo,
      );
      setImportId(r.id);
      setStep('processing');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao enfileirar importação');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Importar Etiquetas"
      subtitle="SS, ASPEC ou JBS — preview e validação antes de gravar"
      open
      onClose={onClose}
    >
      {step === 'upload' && (
        <div className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="li-formato">Formato</label>
            <SelectMenu id="li-formato" className={inputCls} value={formato} onChange={(e) => setFormato(e.target.value)}>
              <option value="">Detectar automaticamente</option>
              <option value="SS">SS (CSV ;)</option>
              <option value="ASPEC">ASPEC (etiquetas)</option>
              <option value="JBS">JBS (CSV |)</option>
            </SelectMenu>
          </div>

          {/* Origem dos dados: arquivo ou colar texto */}
          <div className="flex gap-1 rounded-[10px] bg-surface p-1">
            {(['arquivo', 'colar'] as const).map((op) => (
              <button
                key={op}
                type="button"
                onClick={() => setOrigem(op)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-[8px] px-3 py-1.5 text-[13px] font-semibold transition ${
                  origem === op
                    ? 'bg-brand-600 text-white'
                    : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {op === 'arquivo' ? (
                  <><FileUp className="h-4 w-4" aria-hidden /> Selecionar arquivo</>
                ) : (
                  <><ClipboardType className="h-4 w-4" aria-hidden /> Colar texto</>
                )}
              </button>
            ))}
          </div>

          {origem === 'arquivo' ? (
            <div>
              <label className={labelCls} htmlFor="li-file">Arquivo TXT/CSV</label>
              <label
                htmlFor="li-file"
                className="flex cursor-pointer items-center gap-2 rounded-[10px] border-2 border-dashed border-ink-200 px-3 py-6 text-sm text-ink-500 hover:border-accent"
              >
                <FileUp className="h-4 w-4" aria-hidden />
                <span className="truncate">{file ? file.name : 'Selecionar arquivo…'}</span>
              </label>
              <input
                id="li-file"
                type="file"
                accept=".txt,.csv,text/plain,text/csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <div>
              <label className={labelCls} htmlFor="li-texto">Conteúdo do arquivo</label>
              <textarea
                id="li-texto"
                rows={7}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Cole aqui as informações do arquivo TXT/CSV do sistema contábil"
                className={`${inputCls} resize-y font-mono text-xs leading-snug`}
              />
              {texto.trim() && (
                <p className="mt-1 text-[11px] text-ink-500">
                  {texto.trim().split(/\r?\n/).filter(Boolean).length} linha(s) coladas
                </p>
              )}
            </div>
          )}

          {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>Cancelar</button>
            <button type="button" className={btnPrimary} onClick={doPreview} disabled={busy}>
              {busy ? 'Analisando…' : 'Analisar arquivo'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-[10px] bg-brand-50 p-3">
              <p className="text-xl font-extrabold text-brand-700">{preview.totalLinhas}</p>
              <p className="text-[10px] font-bold uppercase text-brand-500">
                {preview.formato === 'ASPEC' ? 'Documentos' : 'Linhas'} ({preview.formato})
              </p>
            </div>
            <div className="rounded-[10px] bg-success-50 p-3">
              <p className="text-xl font-extrabold text-success-600">{preview.totalValidos}</p>
              <p className="text-[10px] font-bold uppercase text-success-600">Válidos</p>
            </div>
            <div className="rounded-[10px] bg-danger-50 p-3">
              <p className="text-xl font-extrabold text-danger-600">{preview.totalErros}</p>
              <p className="text-[10px] font-bold uppercase text-danger-500">Com erro</p>
            </div>
          </div>

          {preview.amostra.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-[10px] border border-ink-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface">
                  <tr className="label-caps">
                    <th className="px-2 py-1.5">Doc</th>
                    <th className="px-2 py-1.5">Empenho</th>
                    <th className="px-2 py-1.5">Credor</th>
                    <th className="px-2 py-1.5">Valor</th>
                    <th className="px-2 py-1.5">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.amostra.map((r, i) => (
                    <tr key={i} className="border-t border-ink-200">
                      <td className="px-2 py-1 text-ink-800">{r.docCaixa}</td>
                      <td className="px-2 py-1 text-ink-800">{r.empenho}</td>
                      <td className="max-w-40 truncate px-2 py-1 text-ink-800">{r.credor}</td>
                      <td className="px-2 py-1 text-ink-800">
                        {r.valor !== null ? r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                      </td>
                      <td className="px-2 py-1 text-ink-800">{r.data}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.erros.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1 text-xs font-bold uppercase text-danger-600">
                <ShieldAlert className="h-4 w-4" aria-hidden /> Erros linha a linha
              </p>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {preview.erros.map((e, i) => (
                  <p key={i} className="rounded bg-danger-50 px-2 py-1 text-[11px] text-danger-600">
                    <strong>Linha {e.line}:</strong> {e.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {error && <p role="alert" className="rounded-[10px] bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" className={btnGhost} onClick={() => setStep('upload')}>Voltar</button>
            <button
              type="button"
              className={btnPrimary}
              onClick={confirm}
              disabled={busy || preview.totalValidos === 0}
            >
              {busy ? 'Enfileirando…' : `Importar ${preview.totalValidos} registro(s)`}
            </button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="h-8 w-8 animate-spin text-accent" aria-hidden />
          <p className="text-sm text-ink-500">Processando importação em segundo plano…</p>
          {status && <p className="text-xs text-ink-500">Status: {status.status}</p>}
        </div>
      )}

      {step === 'done' && status && (
        <div className="space-y-4 py-2 text-center">
          {status.status === 'concluido' ? (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-success-500" aria-hidden />
              <p className="text-sm font-semibold text-ink-800">
                Importação concluída: {status.registrosOk} registro(s) gravado(s)
                {status.registrosErro > 0 && `, ${status.registrosErro} com erro`}.
              </p>
            </>
          ) : (
            <>
              <ShieldAlert className="mx-auto h-10 w-10 text-danger-500" aria-hidden />
              <p className="text-sm font-semibold text-danger-600">Importação falhou.</p>
              {status.relatorioErros?.[0] && (
                <p className="text-xs text-ink-500">{status.relatorioErros[0].message}</p>
              )}
            </>
          )}
          <button type="button" className={btnPrimary} onClick={onClose}>Fechar</button>
        </div>
      )}
    </Modal>
  );
}
