import { app, dialog, ipcMain } from 'electron';
import type { ZodType } from 'zod';
import { IPC_INVOKE_CHANNEL, INVOKE_KINDS, isInvokeKind, type InvokeKind } from './contract';
import { checkForUpdate } from '../updater';
import {
  loginPayloadSchema,
  emptyPayloadSchema,
  enqueuePayloadSchema,
  cancelPayloadSchema,
  listPayloadSchema,
  viewPayloadSchema,
  signPayloadSchema,
  watchEnqueuePayloadSchema,
  watchDismissPayloadSchema,
} from './schemas';
import * as auth from '../api/client';
import * as queue from '../upload/queue';
import * as lookups from '../api/lookups';
import * as signing from '../signing/sign-service';
import { prepareEnqueue, prepareWatchedEnqueue } from '../upload/prepare';
import { sessionStore } from '../session/session-store';
import * as folderWatcher from '../watch/folder-watcher';
import { writeSettings } from '../settings';

/** Slug do tenant da sessao ativa, ou erro claro se nao autenticado. */
function requireSlug(): string {
  const slug = sessionStore.current?.slug;
  if (!slug) throw new Error('Sessao ausente — faca login.');
  return slug;
}

/**
 * Registry de handlers IPC. Um handler por kind, cada um com seu schema
 * zod `.strict()`. Deny-by-default: kind fora da allowlist ou payload com
 * campo extra sao rejeitados antes de qualquer efeito.
 *
 * Toda ida ao backend e uso de token acontece no MAIN (../api/client).
 * O renderer recebe apenas a visao de sessao { user, tenant }.
 */
interface Handler {
  schema: ZodType<unknown>;
  handle: (payload: unknown) => Promise<unknown>;
}

/**
 * Amarra schema + handler num unico generico: o payload do handle e o TIPO
 * inferido do schema. A erasure para `Handler` (unknown) e segura porque o
 * mesmo schema valida o payload antes de chamar handle.
 */
function defineHandler<T>(schema: ZodType<T>, handle: (payload: T) => Promise<unknown>): Handler {
  return {
    schema: schema as ZodType<unknown>,
    handle: (payload: unknown) => handle(payload as T),
  };
}

const registry: { [K in InvokeKind]: Handler } = {
  ping: defineHandler(emptyPayloadSchema, async () => ({ ok: true, marco: 2 })),
  'auth:login': defineHandler(loginPayloadSchema, (p) => auth.login(p.slug, p.email, p.senha)),
  'auth:logout': defineHandler(emptyPayloadSchema, async () => {
    await auth.logout();
    return { ok: true };
  }),
  // Restaura a sessao a partir do keychain no boot.
  'auth:session': defineHandler(emptyPayloadSchema, () => auth.restore()),
  'auth:me': defineHandler(emptyPayloadSchema, async () => auth.currentView()),
  // Upload em lote: prepara (revalida + hash) e enfileira no main.
  'upload:enqueue': defineHandler(enqueuePayloadSchema, async (p) => queue.enqueue(prepareEnqueue(p))),
  'upload:cancel': defineHandler(cancelPayloadSchema, async (p) => queue.cancel(p.fileId)),
  'upload:status': defineHandler(emptyPayloadSchema, async () => queue.snapshot()),
  // Lookups do upload (cache de 60s no main).
  'lookup:budget-units': defineHandler(emptyPayloadSchema, () => lookups.budgetUnits(requireSlug())),
  'lookup:document-types': defineHandler(emptyPayloadSchema, () => lookups.documentTypes(requireSlug())),
  // Listagem de documentos (filtros minimos + paginacao).
  'documents:list': defineHandler(listPayloadSchema, (p) => {
    const query: Record<string, string> = { module: p.module };
    if (p.q) query['q'] = p.q;
    if (p.competencia) query['competencia'] = p.competencia;
    if (p.page) query['page'] = String(p.page);
    return auth.searchDocuments(requireSlug(), query);
  }),
  // Signed URL de 60s para o visualizador (sem baixar para disco).
  'documents:view': defineHandler(viewPayloadSchema, (p) => auth.documentSignedUrl(requireSlug(), p.id)),
  // Assinatura digital local (ICP-Brasil via PKCS#11). @pending teste com hardware.
  'signing:status': defineHandler(emptyPayloadSchema, () => signing.status()),
  'signing:certificates': defineHandler(emptyPayloadSchema, async () => ({ certificates: await signing.certificates() })),
  'signing:sign': defineHandler(signPayloadSchema, (p) => signing.sign(p.fileId, p.certId, p.pin, p.content)),
  // Pasta monitorada (Marco 9): deteccao automatica de PDFs a anexar.
  'watch:get-config': defineHandler(emptyPayloadSchema, async () => folderWatcher.currentConfig()),
  'watch:choose-folder': defineHandler(emptyPayloadSchema, async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return folderWatcher.currentConfig();
    const folder = res.filePaths[0];
    folderWatcher.start(folder);
    writeSettings({ watchedFolder: folder });
    return folderWatcher.currentConfig();
  }),
  'watch:stop': defineHandler(emptyPayloadSchema, async () => {
    folderWatcher.stop();
    writeSettings({ watchedFolder: undefined });
    return { ok: true };
  }),
  'watch:list-pending': defineHandler(emptyPayloadSchema, async () => ({ items: folderWatcher.list() })),
  'watch:enqueue': defineHandler(watchEnqueuePayloadSchema, async (p) => {
    const { name, content } = folderWatcher.consume(p.fileId);
    return queue.enqueue(prepareWatchedEnqueue(p.fileId, name, content, p.fields));
  }),
  'watch:dismiss': defineHandler(watchDismissPayloadSchema, async (p) => {
    folderWatcher.dismiss(p.fileId);
    return { ok: true };
  }),
  // App / auto-update.
  'app:version': defineHandler(emptyPayloadSchema, async () => ({ version: app.getVersion() })),
  'app:check-update': defineHandler(emptyPayloadSchema, () => checkForUpdate()),
};

/**
 * Registra o unico canal de invoke. Roteia por kind, valida o payload e
 * delega ao handler. Idempotente (seguro em HMR).
 */
export function registerIpcHandlers(): void {
  ipcMain.removeHandler(IPC_INVOKE_CHANNEL);
  ipcMain.handle(IPC_INVOKE_CHANNEL, async (_event, rawKind: unknown, payload: unknown) => {
    if (!isInvokeKind(rawKind)) {
      throw new Error(`Operacao nao permitida: ${String(rawKind)}`);
    }
    const handler = registry[rawKind];
    const parsed = handler.schema.parse(payload ?? {});
    return handler.handle(parsed);
  });
}

export const REGISTERED_KINDS: readonly InvokeKind[] = INVOKE_KINDS;
