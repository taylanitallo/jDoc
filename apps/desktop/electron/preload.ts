import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_INVOKE_CHANNEL,
  SESSION_EXPIRED_CHANNEL,
  UPLOAD_PROGRESS_CHANNEL,
  WATCH_PENDING_CHANGED_CHANNEL,
  UPDATE_PROGRESS_CHANNEL,
  UPDATE_READY_CHANNEL,
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
/**
 * O ipcRenderer.invoke embrulha o erro do main com um prefixo tecnico
 * ("Error invoking remote method 'jdoc:invoke': Error: <msg>") — feio para o
 * usuario final. Remove esse prefixo e devolve apenas a mensagem limpa (que o
 * main ja escreve em portugues, ex.: "E-mail ou senha invalidos").
 */
function cleanIpcError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
  return new Error(msg || 'Falha ao executar a operacao.');
}

const api = {
  async invoke(kind: InvokeKind, payload?: unknown): Promise<unknown> {
    if (!isInvokeKind(kind)) {
      throw new Error(`Operacao nao permitida: ${String(kind)}`);
    }
    try {
      return await ipcRenderer.invoke(IPC_INVOKE_CHANNEL, kind, payload);
    } catch (err) {
      throw cleanIpcError(err);
    }
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
  onUpdateProgress(
    callback: (snapshot: { percent: number; transferred: number; total: number }) => void,
  ): () => void {
    const listener = (_event: unknown, snapshot: unknown): void =>
      callback(snapshot as { percent: number; transferred: number; total: number });
    ipcRenderer.on(UPDATE_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPDATE_PROGRESS_CHANNEL, listener);
  },
  onUpdateReady(callback: (payload: { version: string }) => void): () => void {
    const listener = (_event: unknown, payload: unknown): void => callback(payload as { version: string });
    ipcRenderer.on(UPDATE_READY_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPDATE_READY_CHANNEL, listener);
  },
};

export type JdocBridge = typeof api;

contextBridge.exposeInMainWorld('jdoc', api);
