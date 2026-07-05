import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_INVOKE_CHANNEL,
  SESSION_EXPIRED_CHANNEL,
  UPLOAD_PROGRESS_CHANNEL,
  WATCH_PENDING_CHANGED_CHANNEL,
  isInvokeKind,
  type InvokeKind,
} from './ipc/contract';

/**
 * Ponte blindada. O renderer recebe EXCLUSIVAMENTE esta superficie.
 * - Sem ipcRenderer cru, sem require, sem Node API.
 * - `invoke`: kind validado contra a allowlist antes de qualquer ida ao main.
 * - `onSessionExpired`: assinatura estreita a UM canal, sem repassar o evento
 *   nem nenhum payload ao callback. Retorna funcao de cancelamento.
 */
const api = {
  invoke(kind: InvokeKind, payload?: unknown): Promise<unknown> {
    if (!isInvokeKind(kind)) {
      return Promise.reject(new Error(`Operacao nao permitida: ${String(kind)}`));
    }
    return ipcRenderer.invoke(IPC_INVOKE_CHANNEL, kind, payload);
  },
  onSessionExpired(callback: () => void): () => void {
    const listener = (): void => callback();
    ipcRenderer.on(SESSION_EXPIRED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SESSION_EXPIRED_CHANNEL, listener);
  },
  onUploadProgress(callback: (snapshot: unknown) => void): () => void {
    const listener = (_event: unknown, snapshot: unknown): void => callback(snapshot);
    ipcRenderer.on(UPLOAD_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPLOAD_PROGRESS_CHANNEL, listener);
  },
  onWatchPending(callback: (items: unknown) => void): () => void {
    const listener = (_event: unknown, items: unknown): void => callback(items);
    ipcRenderer.on(WATCH_PENDING_CHANGED_CHANNEL, listener);
    return () => ipcRenderer.removeListener(WATCH_PENDING_CHANGED_CHANNEL, listener);
  },
};

export type JdocBridge = typeof api;

contextBridge.exposeInMainWorld('jdoc', api);
