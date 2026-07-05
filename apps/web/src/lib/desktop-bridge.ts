'use client';

/**
 * Ponte com o jDoc Desktop (Electron). Quando o site roda dentro do
 * executavel, o preload do Electron expoe `window.jdoc` — as mesmas
 * operacoes nativas usadas pela fila de upload/assinatura/pasta monitorada
 * do app ficam disponiveis aqui. Em um navegador comum, `window.jdoc` nao
 * existe e todas as funcoes deste modulo viram no-ops seguros.
 *
 * Nao importamos o tipo do contrato de apps/desktop (pacotes separados) —
 * a allowlist real e validada no preload/main do Electron; aqui so
 * precisamos de uma superficie minima e tipada o suficiente para uso local.
 */

interface JdocBridge {
  invoke(kind: string, payload?: unknown): Promise<unknown>;
  onSessionExpired(callback: () => void): () => void;
  onUploadProgress(callback: (snapshot: unknown) => void): () => void;
  onWatchPending(callback: (items: unknown) => void): () => void;
}

declare global {
  interface Window {
    jdoc?: JdocBridge;
  }
}

/** true quando o site esta rodando dentro da janela do jDoc Desktop. */
export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && typeof window.jdoc?.invoke === 'function';
}

/** invoke seguro: resolve `null` (em vez de lançar) se a ponte nao existir. */
export async function desktopInvoke<T = unknown>(kind: string, payload?: unknown): Promise<T | null> {
  if (!isDesktopApp()) return null;
  return (await window.jdoc!.invoke(kind, payload)) as T;
}

/**
 * Login nativo em paralelo (best-effort): estabelece a sessao usada pela
 * fila de upload/assinatura/pasta monitorada do processo main, guardando o
 * refresh token no keychain do SO. Falha em silencio — o login do site em
 * si ja teve sucesso antes desta chamada; recursos nativos so ficam
 * indisponiveis se isso falhar (ex.: keytar sem rebuild).
 */
export function desktopLoginBestEffort(slug: string, email: string, senha: string): void {
  if (!isDesktopApp()) return;
  void window.jdoc!.invoke('auth:login', { slug, email, senha }).catch(() => {
    // Best-effort: recursos nativos (assinatura/pasta monitorada) ficam
    // indisponiveis nesta sessao, mas o login do site nao e afetado.
  });
}
