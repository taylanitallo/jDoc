'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FolderSync, FileUp, Trash2 } from 'lucide-react';
import { documentFieldsSchema, DOC_SUBTYPES, type DocModule } from '@jdoc/shared';
import { api } from '@/lib/api';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/empty-state';
import { cardCls, inputCls, labelCls, btnPrimary, btnGhost, formatBytes } from '@/components/ui';
import { isDesktopApp, desktopInvoke } from '@/lib/desktop-bridge';

/**
 * Pasta Monitorada (Marco 9 do jDoc Desktop): so existe dentro do
 * executavel — o processo main do Electron detecta PDFs soltos numa pasta
 * local e os disponibiliza aqui para o usuario escolher modulo/campos e
 * enviar, sem precisar abrir o seletor de arquivo a cada anexo.
 */

const MODULE_LABELS: Record<DocModule, string> = {
  receitas: 'Receita',
  despesas: 'Despesa',
  balancete: 'Balancete',
  extrato: 'Extrato',
  outros: 'Outros',
};
const MODULES = Object.keys(MODULE_LABELS) as DocModule[];

const SUBTYPE_LABEL: Record<string, string> = {
  orcamentaria: 'Orçamentária',
  extraorcamentaria: 'Extraorçamentária',
  resto_a_pagar: 'Resto a Pagar',
};

function subtypesFor(module: DocModule): readonly string[] {
  return module === 'despesas' ? DOC_SUBTYPES : DOC_SUBTYPES.filter((s) => s !== 'resto_a_pagar');
}

type FieldType = 'text' | 'date' | 'competencia' | 'subtype' | 'documentType';
interface FieldDesc {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
}

const MODULE_FIELDS: Record<DocModule, FieldDesc[]> = {
  despesas: [
    { name: 'docCaixa', label: 'Doc. Caixa', type: 'text', required: true },
    { name: 'empenho', label: 'Empenho', type: 'text', required: true },
    { name: 'credor', label: 'Credor', type: 'text', required: true },
    { name: 'subtype', label: 'Tipo', type: 'subtype', required: true },
    { name: 'documentDate', label: 'Data do documento', type: 'date', required: true },
  ],
  receitas: [
    { name: 'subtype', label: 'Tipo', type: 'subtype', required: true },
    { name: 'documentDate', label: 'Data do documento', type: 'date', required: true },
  ],
  balancete: [
    { name: 'competencia', label: 'Competência', type: 'competencia', required: true },
    { name: 'documentDate', label: 'Data do documento', type: 'date', required: true },
  ],
  extrato: [
    { name: 'banco', label: 'Banco', type: 'text', required: true },
    { name: 'agencia', label: 'Agência', type: 'text', required: true },
    { name: 'conta', label: 'Conta', type: 'text', required: true },
    { name: 'competencia', label: 'Competência', type: 'competencia', required: true },
    { name: 'documentDate', label: 'Data do documento', type: 'date', required: true },
  ],
  outros: [
    { name: 'documentTypeId', label: 'Tipo de documento', type: 'documentType', required: true },
    { name: 'descricao', label: 'Descrição', type: 'text', required: true },
    { name: 'documentDate', label: 'Data do documento', type: 'date', required: true },
  ],
};

interface PendingFile {
  fileId: string;
  name: string;
  size: number;
  detectedAt: string;
}

interface PendingRow extends PendingFile {
  module: DocModule;
  fields: Record<string, string>;
  error: string | null;
  sending: boolean;
}

export default function PastaMonitoradaPage() {
  const { slug } = useParams<{ slug: string }>();
  const toast = useToast();

  // Exercicio proprio (nao depende do ExercicioProvider do topbar) — aplicado
  // como padrao aos arquivos detectados; o usuario pode ajustar por arquivo
  // se precisar (nao ha campo de exercicio na lista, mas o valor aqui e o
  // enviado para todos os arquivos ainda nao configurados individualmente).
  const [exercicio, setExercicio] = useState(new Date().getFullYear());
  const [checked, setChecked] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [rows, setRows] = useState<PendingRow[]>([]);

  const { data: docTypes } = useQuery({
    queryKey: ['document-types', slug],
    queryFn: () => api<Array<{ id: string; nome: string }>>(`/t/${slug}/document-types`),
    enabled: desktop,
  });

  function mergePending(items: PendingFile[]) {
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.fileId));
      const additions: PendingRow[] = items
        .filter((f) => !known.has(f.fileId))
        .map((f) => ({
          ...f,
          module: 'despesas',
          fields: { exercicio: String(exercicio) },
          error: null,
          sending: false,
        }));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }

  // Checagem client-only (evita mismatch de hidratacao — servidor nunca sabe se e desktop).
  useEffect(() => {
    const isDesktop = isDesktopApp();
    setDesktop(isDesktop);
    setChecked(true);
    if (!isDesktop) return;

    void (async () => {
      const cfg = await desktopInvoke<{ folder: string | null }>('watch:get-config');
      setFolder(cfg?.folder ?? null);
      const res = await desktopInvoke<{ items: PendingFile[] }>('watch:list-pending');
      mergePending(res?.items ?? []);
    })();
    const off = window.jdoc!.onWatchPending((items) => mergePending(items as PendingFile[]));
    return off;
  }, []);

  async function chooseFolder() {
    setFolderBusy(true);
    try {
      const res = await desktopInvoke<{ folder: string | null }>('watch:choose-folder');
      setFolder(res?.folder ?? null);
    } finally {
      setFolderBusy(false);
    }
  }

  async function stopWatching() {
    setFolderBusy(true);
    try {
      await desktopInvoke('watch:stop');
      setFolder(null);
      setRows([]);
    } finally {
      setFolderBusy(false);
    }
  }

  function patch(fileId: string, patchFn: (r: PendingRow) => PendingRow) {
    setRows((prev) => prev.map((r) => (r.fileId === fileId ? patchFn(r) : r)));
  }

  function changeModule(fileId: string, module: DocModule) {
    patch(fileId, (r) => ({ ...r, module, fields: { exercicio: String(exercicio) }, error: null }));
  }

  function changeField(fileId: string, name: string, value: string) {
    patch(fileId, (r) => ({ ...r, fields: { ...r.fields, [name]: value } }));
  }

  async function sendRow(row: PendingRow) {
    const parsed = documentFieldsSchema.safeParse({ module: row.module, ...row.fields });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      patch(row.fileId, (r) => ({
        ...r,
        error: issue ? `Campo ${issue.path.join('.') || '?'}: ${issue.message}` : 'Campos inválidos',
      }));
      return;
    }
    patch(row.fileId, (r) => ({ ...r, sending: true, error: null }));
    try {
      await window.jdoc!.invoke('watch:enqueue', { fileId: row.fileId, fields: { module: row.module, ...row.fields } });
      setRows((prev) => prev.filter((r) => r.fileId !== row.fileId));
      toast.success(`${row.name} enviado para a fila de upload.`);
    } catch (e) {
      patch(row.fileId, (r) => ({ ...r, sending: false, error: e instanceof Error ? e.message : 'Falha ao enviar' }));
    }
  }

  async function dismissRow(fileId: string) {
    await desktopInvoke('watch:dismiss', { fileId });
    setRows((prev) => prev.filter((r) => r.fileId !== fileId));
  }

  if (!checked) return null;

  if (!desktop) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FolderSync}
          title="Disponível apenas no jDoc Desktop"
          description="Instale o aplicativo desktop para monitorar uma pasta local e anexar PDFs automaticamente."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-app">
          <FolderSync className="h-6 w-6 text-accent" aria-hidden />
          Pasta Monitorada
        </h1>
        <p className="mt-1 text-app-muted">
          PDFs soltos na pasta escolhida entram automaticamente na lista abaixo, prontos para você
          revisar os campos e enviar.
        </p>
      </div>

      <div className={`${cardCls} flex items-center gap-4 p-4`}>
        <label className="flex shrink-0 items-center gap-2">
          <span className={labelCls}>Exercício</span>
          <input
            type="number"
            min={2000}
            max={2100}
            className={`${inputCls} w-24`}
            value={exercicio}
            onChange={(e) => setExercicio(Number(e.target.value))}
          />
        </label>
        {folder ? (
          <>
            <span className="flex-1 truncate text-sm text-app" title={folder}>
              <b className="text-app-muted">Pasta monitorada:</b> {folder}
            </span>
            <button type="button" className={btnGhost} onClick={() => void stopWatching()} disabled={folderBusy}>
              parar monitoramento
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-sm text-app-muted">Nenhuma pasta monitorada.</span>
            <button type="button" className={btnPrimary} onClick={() => void chooseFolder()} disabled={folderBusy}>
              escolher pasta
            </button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileUp}
          title="Nenhum arquivo pendente"
          description="Solte um PDF na pasta monitorada para ele aparecer aqui."
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const fields = MODULE_FIELDS[row.module];
            return (
              <li key={row.fileId} className={`${cardCls} space-y-3 p-4`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app" title={row.name}>
                    {row.name}
                  </span>
                  <span className="text-xs text-app-muted">{formatBytes(row.size)}</span>
                  <select
                    className={inputCls}
                    value={row.module}
                    onChange={(e) => changeModule(row.fileId, e.target.value as DocModule)}
                  >
                    {MODULES.map((m) => (
                      <option key={m} value={m}>
                        {MODULE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => void sendRow(row)}
                    disabled={row.sending}
                  >
                    {row.sending ? 'Enviando…' : 'Enviar'}
                  </button>
                  <button type="button" className={btnGhost} onClick={() => void dismissRow(row.fileId)}>
                    <Trash2 className="h-4 w-4" aria-hidden /> descartar
                  </button>
                </div>

                {row.error && (
                  <p role="alert" className="text-xs text-app-error-text">
                    {row.error}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {fields.map((desc) => (
                    <label key={desc.name} className="block">
                      <span className={labelCls}>
                        {desc.label}
                        {desc.required ? ' *' : ''}
                      </span>
                      {desc.type === 'subtype' ? (
                        <select
                          className={inputCls}
                          value={row.fields[desc.name] ?? ''}
                          onChange={(e) => changeField(row.fileId, desc.name, e.target.value)}
                        >
                          <option value="">— selecione —</option>
                          {subtypesFor(row.module).map((s) => (
                            <option key={s} value={s}>
                              {SUBTYPE_LABEL[s] ?? s}
                            </option>
                          ))}
                        </select>
                      ) : desc.type === 'documentType' ? (
                        <select
                          className={inputCls}
                          value={row.fields[desc.name] ?? ''}
                          onChange={(e) => changeField(row.fileId, desc.name, e.target.value)}
                        >
                          <option value="">— selecione —</option>
                          {(docTypes ?? []).map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nome}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={desc.type === 'date' ? 'date' : desc.type === 'competencia' ? 'month' : 'text'}
                          className={inputCls}
                          value={row.fields[desc.name] ?? ''}
                          onChange={(e) => changeField(row.fileId, desc.name, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
