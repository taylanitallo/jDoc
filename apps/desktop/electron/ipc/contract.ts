/**
 * Contrato IPC compartilhado entre preload (renderer) e main.
 *
 * Mantido SEM dependencias (nada de zod aqui) para o preload sandboxed
 * poder importar apenas a allowlist de kinds, sem inflar o bundle nem
 * expor validacao ao renderer. A validacao real (zod .strict()) vive
 * no processo main — ver ./handlers.ts.
 */

/** Canal unico de invoke (renderer -> main -> resposta), roteado por `kind`. */
export const IPC_INVOKE_CHANNEL = 'jdoc:invoke' as const;

/**
 * Canal de push main -> renderer para expiracao de sessao (idle timeout).
 * Sem payload: o renderer apenas reage voltando ao login.
 */
export const SESSION_EXPIRED_CHANNEL = 'jdoc:session-expired' as const;

/**
 * Canal de push main -> renderer com o snapshot agregado da fila de upload.
 * Emitido a cada mudanca de estado de um arquivo.
 */
export const UPLOAD_PROGRESS_CHANNEL = 'jdoc:upload-progress' as const;

/**
 * Canal de push main -> renderer com a lista de arquivos pendentes da pasta
 * monitorada. Emitido a cada deteccao/consumo/descarte.
 */
export const WATCH_PENDING_CHANGED_CHANNEL = 'jdoc:watch-pending' as const;

/**
 * Allowlist de operacoes permitidas. Qualquer kind fora desta lista e
 * rejeitado tanto no preload quanto no main (deny-by-default).
 * Marco 4: + lookups, listagem e visualizador de documentos.
 * Marco 9: + pasta monitorada.
 */
export const INVOKE_KINDS = [
  'ping',
  'auth:login',
  'auth:resolve',
  'auth:select-tenant',
  'auth:logout',
  'auth:session',
  'auth:me',
  'upload:enqueue',
  'upload:cancel',
  'upload:status',
  'lookup:budget-units',
  'lookup:document-types',
  'documents:list',
  'documents:view',
  'signing:status',
  'signing:certificates',
  'signing:sign',
  'watch:get-config',
  'watch:choose-folder',
  'watch:stop',
  'watch:list-pending',
  'watch:enqueue',
  'watch:dismiss',
  'app:version',
  'app:check-update',
] as const;

export type InvokeKind = (typeof INVOKE_KINDS)[number];

/** Type guard usado pelo preload para barrar kinds fora da allowlist. */
export function isInvokeKind(value: unknown): value is InvokeKind {
  return typeof value === 'string' && (INVOKE_KINDS as readonly string[]).includes(value);
}
