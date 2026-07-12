import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { documentFieldsSchema } from '@jdoc/shared';
import type { UploadSnapshot, UploadStatus, WatchedPendingFile } from '../types';
import { MODULE_FIELDS, MODULE_LABELS, MODULES, SUBTYPE_OPTIONS, type FieldDesc } from '../upload-fields';
import { useLookups } from '../use-lookups';
import { WatchedFolderPanel } from './WatchedFolderPanel';

/** Limite client-side (espelha MAX_UPLOAD_MB do backend; o main revalida). */
const MAX_UPLOAD_MB = 25;
const DEFAULT_MODULE = MODULES[0];

interface LocalFile {
  fileId: string;
  /** null quando a origem e a pasta monitorada (main le do disco, sem File no renderer). */
  file: File | null;
  /** true quando detectado pela pasta monitorada. */
  watched: boolean;
  name: string;
  size: number;
  module: string;
  fields: Record<string, string>;
  clientError: string | null;
  enqueued: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultFields(module: string): Record<string, string> {
  return { module, exercicio: String(new Date().getFullYear()) };
}

/** Le os 4 primeiros bytes e confere a assinatura %PDF. */
async function hasPdfMagic(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

async function validateFile(lf: LocalFile): Promise<string | null> {
  if (!lf.name.toLowerCase().endsWith('.pdf')) return 'Extensão inválida: apenas .pdf';
  if (lf.size > MAX_UPLOAD_MB * 1024 * 1024) return `Excede ${MAX_UPLOAD_MB} MB`;
  // Arquivos da pasta monitorada ja tiveram os magic bytes validados pelo main na deteccao.
  if (lf.file && !(await hasPdfMagic(lf.file))) return 'Assinatura %PDF ausente';
  const parsed = documentFieldsSchema.safeParse({ ...lf.fields });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return issue ? `Campo ${issue.path.join('.') || '?'}: ${issue.message}` : 'Campos inválidos';
  }
  return null;
}

/** Remove campos vazios; mantem module e os preenchidos (strings p/ multipart). */
function buildFields(lf: LocalFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(lf.fields)) {
    if (value !== '') out[key] = value;
  }
  return out;
}

export function UploadView() {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [snapshot, setSnapshot] = useState<UploadSnapshot | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const lookups = useLookups();

  useEffect(() => {
    void (async () => {
      const snap = (await window.jdoc.invoke('upload:status')) as UploadSnapshot;
      setSnapshot(snap);
    })();
    const off = window.jdoc.onUploadProgress((snap) => setSnapshot(snap as UploadSnapshot));
    return off;
  }, []);

  // Pasta monitorada: carrega pendentes ja detectados e escuta novas deteccoes.
  useEffect(() => {
    void (async () => {
      const res = (await window.jdoc.invoke('watch:list-pending')) as { items: WatchedPendingFile[] };
      mergeWatchedPending(res.items);
    })();
    const off = window.jdoc.onWatchPending((items) => mergeWatchedPending(items as WatchedPendingFile[]));
    return off;
  }, []);

  function mergeWatchedPending(items: WatchedPendingFile[]) {
    setFiles((prev) => {
      const known = new Set(prev.map((lf) => lf.fileId));
      const additions: LocalFile[] = items
        .filter((pf) => !known.has(pf.fileId))
        .map((pf) => ({
          fileId: pf.fileId,
          file: null,
          watched: true,
          name: pf.name,
          size: pf.size,
          module: DEFAULT_MODULE,
          fields: defaultFields(DEFAULT_MODULE),
          clientError: null,
          enqueued: false,
        }));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
  }

  function dismissWatched(fileId: string) {
    void window.jdoc.invoke('watch:dismiss', { fileId });
    setFiles((prev) => prev.filter((lf) => lf.fileId !== fileId));
  }

  const statusById = useMemo(() => {
    const map = new Map<string, { status: UploadStatus; error?: string; attempt: number }>();
    for (const it of snapshot?.items ?? []) map.set(it.fileId, it);
    return map;
  }, [snapshot]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: LocalFile[] = [];
    for (const file of Array.from(list)) {
      next.push({
        fileId: crypto.randomUUID(),
        file,
        watched: false,
        name: file.name,
        size: file.size,
        module: DEFAULT_MODULE,
        fields: defaultFields(DEFAULT_MODULE),
        clientError: null,
        enqueued: false,
      });
    }
    setFiles((prev) => [...prev, ...next]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  function patch(fileId: string, patchFn: (lf: LocalFile) => LocalFile) {
    setFiles((prev) => prev.map((lf) => (lf.fileId === fileId ? patchFn(lf) : lf)));
  }

  function changeModule(fileId: string, module: string) {
    patch(fileId, (lf) => ({ ...lf, module, fields: defaultFields(module), clientError: null }));
  }

  function changeField(fileId: string, name: string, value: string) {
    patch(fileId, (lf) => ({ ...lf, fields: { ...lf.fields, [name]: value } }));
  }

  async function sendAll() {
    for (const lf of files) {
      if (lf.enqueued) continue;
      const err = await validateFile(lf);
      if (err) {
        patch(lf.fileId, (x) => ({ ...x, clientError: err }));
        continue;
      }
      try {
        if (lf.watched) {
          // Origem: pasta monitorada — o main le os bytes direto do disco.
          await window.jdoc.invoke('watch:enqueue', { fileId: lf.fileId, fields: buildFields(lf) });
        } else {
          const content = new Uint8Array(await lf.file!.arrayBuffer());
          await window.jdoc.invoke('upload:enqueue', {
            fileId: lf.fileId,
            name: lf.name,
            size: content.byteLength,
            fields: buildFields(lf),
            content,
          });
        }
        patch(lf.fileId, (x) => ({ ...x, enqueued: true, clientError: null }));
      } catch (e) {
        patch(lf.fileId, (x) => ({ ...x, clientError: e instanceof Error ? e.message : 'Falha ao enfileirar' }));
      }
    }
  }

  function cancel(fileId: string) {
    void window.jdoc.invoke('upload:cancel', { fileId });
  }

  const agg = snapshot?.aggregate;

  return (
    <div className="up">
      <WatchedFolderPanel />

      <div
        className={`up-drop ${dragOver ? 'up-drop-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p>Arraste PDFs aqui ou</p>
        <label className="up-pick">
          selecionar arquivos
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
        </label>
      </div>

      {agg && agg.total > 0 && (
        <p className="up-agg">
          {agg.done}/{agg.total} concluídos · {agg.uploading} enviando · {agg.queued} na fila ·{' '}
          {agg.failed} falhas · {agg.canceled} cancelados
        </p>
      )}

      <ul className="up-list">
        {files.map((lf) => {
          const remote = statusById.get(lf.fileId);
          const status: string = lf.clientError ? 'inválido' : (remote?.status ?? (lf.enqueued ? 'queued' : 'pendente'));
          const canCancel = remote?.status === 'queued' || remote?.status === 'uploading';
          const fields = MODULE_FIELDS[lf.module] ?? [];
          return (
            <li key={lf.fileId} className="up-row">
              <div className="up-row-main">
                <span className="up-name" title={lf.name}>
                  {lf.name}
                </span>
                <span className="up-size">{formatSize(lf.size)}</span>
                <select
                  className="up-module"
                  value={lf.module}
                  disabled={lf.enqueued}
                  onChange={(e) => changeModule(lf.fileId, e.target.value)}
                >
                  {MODULES.map((m) => (
                    <option key={m} value={m}>
                      {MODULE_LABELS[m] ?? m}
                    </option>
                  ))}
                </select>
                <span className={`up-status up-status-${status}`}>{status}</span>
                {lf.watched && <span className="up-watched" title="Detectado na pasta monitorada">📁 pasta</span>}
                {!lf.enqueued && (
                  <button type="button" className="up-btn" onClick={() => setEditing(editing === lf.fileId ? null : lf.fileId)}>
                    campos
                  </button>
                )}
                {!lf.enqueued && lf.watched && (
                  <button type="button" className="up-btn" onClick={() => dismissWatched(lf.fileId)}>
                    descartar
                  </button>
                )}
                {canCancel && (
                  <button type="button" className="up-btn" onClick={() => cancel(lf.fileId)}>
                    cancelar
                  </button>
                )}
              </div>
              {(lf.clientError || remote?.error) && (
                <p className="up-row-error">{lf.clientError ?? remote?.error}</p>
              )}
              {editing === lf.fileId && !lf.enqueued && (
                <div className="up-fields">
                  {lookups.loading && <p className="up-lookup-note">Carregando listas…</p>}
                  {lookups.error && <p className="up-row-error">{lookups.error}</p>}
                  {fields.map((desc: FieldDesc) => (
                    <label key={desc.name} className="up-field">
                      <span>
                        {desc.label}
                        {desc.required ? ' *' : ''}
                      </span>
                      {desc.type === 'subtype' ? (
                        <select value={lf.fields[desc.name] ?? ''} onChange={(e) => changeField(lf.fileId, desc.name, e.target.value)}>
                          <option value="">—</option>
                          {SUBTYPE_OPTIONS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : desc.type === 'lookup' ? (
                        <select value={lf.fields[desc.name] ?? ''} onChange={(e) => changeField(lf.fileId, desc.name, e.target.value)}>
                          <option value="">{desc.required ? '— selecione —' : '— nenhuma —'}</option>
                          {(desc.lookup ? lookups.optionsFor(desc.lookup) : []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={
                            desc.type === 'date' ? 'date' : desc.type === 'number' ? 'number' : desc.type === 'competencia' ? 'month' : 'text'
                          }
                          value={lf.fields[desc.name] ?? ''}
                          onChange={(e) => changeField(lf.fileId, desc.name, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {files.some((f) => !f.enqueued) && (
        <button type="button" className="up-send" onClick={() => void sendAll()}>
          Enviar {files.filter((f) => !f.enqueued).length} arquivo(s)
        </button>
      )}
    </div>
  );
}
