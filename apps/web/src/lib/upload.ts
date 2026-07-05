'use client';

import { getAccessToken } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

/**
 * Upload multipart com barra de progresso (XHR — fetch nao expoe progresso).
 * Campos + arquivo PDF. Token em memoria, cookie de refresh nao e necessario aqui.
 */
export function uploadDocument(
  slug: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  return new Promise((resolvePromise) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== '') form.append(k, v);
    }
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/t/${slug}/documents`);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        // sem corpo
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolvePromise({ ok: true, body });
      } else {
        const message =
          (body as { message?: string } | null)?.message ?? 'Falha no upload do documento';
        resolvePromise({ ok: false, status: xhr.status, message });
      }
    };
    xhr.onerror = () =>
      resolvePromise({ ok: false, status: 0, message: 'Erro de rede durante o upload' });

    xhr.send(form);
  });
}

/** Envia (substitui) o brasao do tenant — PNG ou JPEG. */
export function uploadBrasao(
  slug: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  return new Promise((resolvePromise) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/t/${slug}/configuracoes/brasao`);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        // sem corpo
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolvePromise({ ok: true, body });
      } else {
        const message =
          (body as { message?: string } | null)?.message ?? 'Falha no upload do brasão';
        resolvePromise({ ok: false, status: xhr.status, message });
      }
    };
    xhr.onerror = () =>
      resolvePromise({ ok: false, status: 0, message: 'Erro de rede durante o upload' });

    xhr.send(form);
  });
}

/** Anexa o PDF a um documento existente (etiqueta aguardando arquivo). */
export function attachDocumentFile(
  slug: string,
  documentId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  return new Promise((resolvePromise) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/t/${slug}/documents/${documentId}/file`);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText) as unknown;
      } catch {
        // sem corpo
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolvePromise({ ok: true, body });
      } else {
        const message =
          (body as { message?: string } | null)?.message ?? 'Falha no upload do documento';
        resolvePromise({ ok: false, status: xhr.status, message });
      }
    };
    xhr.onerror = () =>
      resolvePromise({ ok: false, status: 0, message: 'Erro de rede durante o upload' });

    xhr.send(form);
  });
}
