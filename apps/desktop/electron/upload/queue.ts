import { uploadDocument, readError } from '../api/client';

/**
 * Fila de upload no processo MAIN (nunca no renderer). Processa arquivos
 * sequencialmente, com AbortController por item, retry 3x (1s/2s/4s) apenas
 * em erro de rede/5xx, e emite snapshots agregados de progresso.
 */

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'canceled';

export interface UploadItemStatus {
  fileId: string;
  name: string;
  size: number;
  module: string;
  status: UploadStatus;
  attempt: number;
  error?: string;
  documentId?: string;
}

export interface UploadSnapshot {
  items: UploadItemStatus[];
  aggregate: {
    total: number;
    queued: number;
    uploading: number;
    done: number;
    failed: number;
    canceled: number;
  };
}

interface QueueItem extends UploadItemStatus {
  slug: string;
  fields: Record<string, string>;
  content: Uint8Array;
  hash: string;
  abort: AbortController;
}

/** Backoff dos 3 retries (rede/5xx). 4 tentativas no total. */
const BACKOFF_MS = [1000, 2000, 4000] as const;
const EMPTY = new Uint8Array(0);

const items: QueueItem[] = [];
let pumping = false;

/** Callback setado pelo main para empurrar o snapshot ao renderer. */
export let onProgress: ((snapshot: UploadSnapshot) => void) | null = null;
export function setProgressSink(fn: (snapshot: UploadSnapshot) => void): void {
  onProgress = fn;
}

function view(i: QueueItem): UploadItemStatus {
  return {
    fileId: i.fileId,
    name: i.name,
    size: i.size,
    module: i.module,
    status: i.status,
    attempt: i.attempt,
    ...(i.error ? { error: i.error } : {}),
    ...(i.documentId ? { documentId: i.documentId } : {}),
  };
}

export function snapshot(): UploadSnapshot {
  const agg = { total: items.length, queued: 0, uploading: 0, done: 0, failed: 0, canceled: 0 };
  for (const i of items) agg[i.status] += 1;
  return { items: items.map(view), aggregate: agg };
}

function emit(): void {
  onProgress?.(snapshot());
}

/** delay que resolve cedo se o sinal for abortado (cancelamento durante backoff). */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function finish(item: QueueItem, status: UploadStatus): void {
  item.status = status;
  item.content = EMPTY; // libera memoria em estado terminal
  emit();
}

/**
 * Processa um item: tenta o upload, retry 3x com backoff em rede/5xx,
 * sem retry em 4xx (inclui 403 de quota). Abort => cancelado.
 */
async function processItem(item: QueueItem): Promise<void> {
  item.status = 'uploading';
  item.error = undefined;
  emit();

  let attempt = 0;
  while (true) {
    if (item.abort.signal.aborted) return finish(item, 'canceled');

    try {
      const res = await uploadDocument(item.slug, item.fields, item.content, item.name, item.abort.signal);
      if (res.ok) {
        try {
          const created = (await res.json()) as { id?: string };
          if (created.id) item.documentId = created.id;
        } catch {
          // corpo ausente/ilegivel nao invalida o sucesso
        }
        return finish(item, 'done');
      }
      if (res.status < 500) {
        // 4xx: erro definitivo (validacao, permissao, quota, payload). Sem retry.
        item.error = await readError(res);
        return finish(item, 'failed');
      }
      // 5xx: retryable
      item.error = await readError(res);
    } catch (err) {
      if (item.abort.signal.aborted) return finish(item, 'canceled');
      // erro de rede: retryable
      item.error = err instanceof Error ? err.message : 'Erro de rede';
    }

    if (attempt >= BACKOFF_MS.length) return finish(item, 'failed');
    item.attempt = attempt + 1;
    emit();
    await delay(BACKOFF_MS[attempt] ?? 0, item.abort.signal);
    if (item.abort.signal.aborted) return finish(item, 'canceled');
    attempt += 1;
  }
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = items.find((i) => i.status === 'queued');
      if (!next) break;
      await processItem(next);
    }
  } finally {
    pumping = false;
  }
}

export interface EnqueueInput {
  fileId: string;
  slug: string;
  name: string;
  size: number;
  module: string;
  fields: Record<string, string>;
  content: Uint8Array;
  hash: string;
}

/** Adiciona um item a fila e dispara o processamento. */
export function enqueue(input: EnqueueInput): UploadItemStatus {
  const item: QueueItem = {
    fileId: input.fileId,
    name: input.name,
    size: input.size,
    module: input.module,
    status: 'queued',
    attempt: 0,
    slug: input.slug,
    fields: input.fields,
    content: input.content,
    hash: input.hash,
    abort: new AbortController(),
  };
  items.push(item);
  emit();
  void pump();
  return view(item);
}

/** Cancela um item especifico (na fila ou em voo). */
export function cancel(fileId: string): { ok: boolean } {
  const item = items.find((i) => i.fileId === fileId);
  if (!item) return { ok: false };
  if (item.status === 'queued') {
    finish(item, 'canceled');
  } else if (item.status === 'uploading') {
    item.abort.abort(); // processItem detecta e finaliza como canceled
  }
  return { ok: true };
}
