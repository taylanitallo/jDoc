import { app, dialog, ipcMain } from 'electron';
import type { ZodType } from 'zod';
import { IPC_INVOKE_CHANNEL, INVOKE_KINDS, isInvokeKind, type InvokeKind } from './contract';
import { checkForUpdate, startDownload } from '../updater';
import {
  loginPayloadSchema,
  resolveLoginPayloadSchema,
  selectTenantPayloadSchema,
  emptyPayloadSchema,
  enqueuePayloadSchema,
  cancelPayloadSchema,
  listPayloadSchema,
  viewPayloadSchema,
  watchEnqueuePayloadSchema,
  watchAttachPayloadSchema,
  watchDismissPayloadSchema,
} from './schemas';
import * as auth from '../api/client';
import * as queue from '../upload/queue';
import * as lookups from '../api/lookups';
import { prepareEnqueue, prepareWatchedEnqueue } from '../upload/prepare';
import { sessionStore } from '../session/session-store';
import * as folderWatcher from '../watch/folder-watcher';
import { writeSettings } from '../settings';

/**
 * Pastas de sistema protegidas por padrao pelo "Acesso Controlado a Pastas"
 * (Seguranca do Windows). Escrever nelas com o app nao autorizado TRAVA o
 * processo (o CFA nao devolve erro, ele congela a chamada nativa). Detectamos
 * ANTES de tentar qualquer escrita para nunca cair nesse travamento.
 */
function protectedSystemRoots(): string[] {
  const names = ['documents', 'desktop', 'pictures', 'videos', 'music'] as const;
  const roots: string[] = [];
  for (const n of names) {
    try {
      roots.push(app.getPath(n));
    } catch {
      // path indisponivel neste SO — ignora.
    }
  }
  return roots;
}

/** true se `folder` e (ou esta dentro de) uma pasta de sistema protegida. */
function isUnderProtectedRoot(folder: string): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase();
  const f = norm(folder);
  return protectedSystemRoots().some((root) => {
    const r = norm(root);
    return f === r || f.startsWith(`${r}\\`) || f.startsWith(`${r}/`);
  });
}

/** Aviso padrao quando a pasta nao pode ser monitorada (protegida/sem escrita). */
async function warnProtectedFolder(folder: string): Promise<void> {
  await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Entendi'],
    noLink: true,
    title: 'Pasta protegida pelo Windows',
    message: 'Nao foi possivel monitorar esta pasta.',
    detail:
      `O jDoc precisa criar subpastas de controle (_enviados, _erros, _ignorados) e mover os PDFs, ` +
      `mas a Seguranca do Windows (Acesso Controlado a Pastas) bloqueia isso em:\n\n${folder}\n\n` +
      `A Area de Trabalho, Documentos, Imagens, Videos e Musicas sao protegidas por padrao. ` +
      `Escolha uma pasta fora dessas (por exemplo, crie uma pasta em C:\\ ou no seu perfil), ou ` +
      `libere o jDoc em: Seguranca do Windows > Protecao contra virus e ameacas > Acesso controlado ` +
      `a pastas > Permitir um aplicativo pelo Acesso controlado a pastas.`,
  });
}

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
  // Login nativo sem slug: tenta as credenciais em todos os orgaos e entra
  // direto (1 orgao) ou devolve a lista pra escolher (2+ orgaos).
  'auth:resolve': defineHandler(resolveLoginPayloadSchema, (p) => auth.resolveLogin(p.email, p.senha)),
  'auth:select-tenant': defineHandler(selectTenantPayloadSchema, (p) => auth.selectTenant(p.slug)),
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
  // Pasta monitorada (Marco 9): deteccao automatica de PDFs a anexar.
  'watch:get-config': defineHandler(emptyPayloadSchema, async () => folderWatcher.currentConfig()),
  'watch:choose-folder': defineHandler(emptyPayloadSchema, async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return folderWatcher.currentConfig();
    const folder = res.filePaths[0];

    // 1) Pasta de sistema protegida por padrao (Documentos, Area de Trabalho...):
    //    recusa na hora, sem tentar escrever (evita o travamento do CFA).
    if (isUnderProtectedRoot(folder)) {
      await warnProtectedFolder(folder);
      return folderWatcher.currentConfig();
    }

    // 2) Catch-all para CFA customizado / permissao negada: sonda a escrita de
    //    forma assincrona (nao congela a UI mesmo se o CFA travar a chamada).
    if (!(await folderWatcher.probeWritable(folder))) {
      await warnProtectedFolder(folder);
      return folderWatcher.currentConfig();
    }

    // 3) Escrita confirmada — seguro iniciar o monitoramento.
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
  // Anexa o PDF pendente a uma etiqueta (documento aguardando_arquivo). So move
  // o arquivo pra _enviados DEPOIS que a API confirma — se falhar, fica pendente.
  'watch:attach': defineHandler(watchAttachPayloadSchema, async (p) => {
    const { name, content } = folderWatcher.readPending(p.fileId);
    await auth.attachDocument(requireSlug(), p.documentId, content, name);
    folderWatcher.markSent(p.fileId);
    return { ok: true };
  }),
  'watch:dismiss': defineHandler(watchDismissPayloadSchema, async (p) => {
    folderWatcher.dismiss(p.fileId);
    return { ok: true };
  }),
  // App / auto-update.
  'app:version': defineHandler(emptyPayloadSchema, async () => ({ version: app.getVersion() })),
  'app:check-update': defineHandler(emptyPayloadSchema, () => checkForUpdate()),
  // Inicia o download da versao nova (a janela do Atualizador acompanha o
  // progresso via UPDATE_PROGRESS_CHANNEL e o app reinicia sozinho ao concluir).
  'update:download': defineHandler(emptyPayloadSchema, () => startDownload()),
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
