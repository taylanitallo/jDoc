import { app } from 'electron';
import electronUpdater from 'electron-updater';

/**
 * Auto-update (electron-updater). O feed vem do app-update.yml gerado pelo
 * electron-builder (publish: generic -> bucket do Supabase), e pode ser
 * sobreposto por JDOC_UPDATE_URL. Toda falha (rede, config) e engolida:
 * NUNCA quebra o app. Em desenvolvimento (app nao empacotado) fica inativo.
 *
 * Fluxo da UI (janela "Atualizador" — ver src/assets/update-modal):
 *   1. `initAutoUpdateOnBoot()` checa em silencio. Se ha versao nova, guarda
 *      `pendingUpdate` (NAO baixa ainda — autoDownload=false).
 *   2. Apos o login, o window-manager abre a janela do Atualizador (via
 *      getPendingUpdate/onUpdateAvailable). Ela mostra a versao e um botao
 *      "Executar atualizacao".
 *   3. O usuario clica -> `startDownload()` baixa; `download-progress` alimenta
 *      a barra via `progressSink`.
 *   4. `update-downloaded` -> `readySink` (a janela mostra "concluida") e, apos
 *      um instante, `quitAndInstall()` reinicia o app ja na versao nova.
 */
function getAutoUpdater() {
  // Acesso PREGUICOSO: o getter constroi o updater na 1a leitura chamando
  // app.getVersion() — so seguro DEPOIS de app.whenReady() (ver main.ts).
  return electronUpdater.autoUpdater;
}

export interface UpdateStatus {
  packaged: boolean;
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  downloaded: boolean;
  error: string | null;
}

export interface PendingUpdate {
  version: string;
  downloaded: boolean;
}

let configured = false;
let pendingUpdate: PendingUpdate | null = null;
let onUpdateAvailableCb: ((version: string) => void) | null = null;

export function setOnUpdateAvailable(cb: ((version: string) => void) | null): void {
  onUpdateAvailableCb = cb;
}

export function getPendingUpdate(): PendingUpdate | null {
  return pendingUpdate;
}

let progressSink: ((snapshot: { percent: number; transferred: number; total: number }) => void) | null = null;
let readySink: ((payload: { version: string }) => void) | null = null;

export function setUpdateProgressSink(
  sink: ((snapshot: { percent: number; transferred: number; total: number }) => void) | null,
): void {
  progressSink = sink;
}

export function setUpdateReadySink(sink: ((payload: { version: string }) => void) | null): void {
  readySink = sink;
}

function configure(): void {
  if (configured) return;
  configured = true;
  const autoUpdater = getAutoUpdater();
  // NAO baixa sozinho: a janela do Atualizador (mostrada ANTES do login)
  // controla o download quando o usuario clica "Executar atualizacao".
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const url = process.env['JDOC_UPDATE_URL'];
  if (url) {
    autoUpdater.setFeedURL({ provider: 'generic', url });
  }
  autoUpdater.on('error', () => {
    /* falha de update nao pode derrubar o app */
  });

  autoUpdater.on('update-available', (info) => {
    pendingUpdate = { version: info.version, downloaded: false };
    onUpdateAvailableCb?.(info.version);
  });

  autoUpdater.on('update-not-available', () => {
    pendingUpdate = null;
  });

  autoUpdater.on('download-progress', (progress) => {
    progressSink?.({
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (pendingUpdate) pendingUpdate.downloaded = true;
    readySink?.({ version: info.version });
    // Como o Atualizador aparece ANTES do login, ninguem esta usando o sistema:
    // aplica na hora, em silencio (sem wizard) e reabre ja na versao nova, que
    // entao mostra a tela de login. (isSilent=true, isForceRunAfter=true)
    setTimeout(() => {
      getAutoUpdater().quitAndInstall(true, true);
    }, 1200);
  });
}

/** Inicia o download da versao ja detectada (chamado quando o usuario clica). */
export async function startDownload(): Promise<{ ok: boolean; error?: string }> {
  if (!app.isPackaged) return { ok: false, error: 'Auto-update indisponivel em desenvolvimento.' };
  try {
    configure();
    await getAutoUpdater().downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function status(extra?: Partial<UpdateStatus>): UpdateStatus {
  return {
    packaged: app.isPackaged,
    currentVersion: app.getVersion(),
    updateAvailable: pendingUpdate !== null,
    latestVersion: pendingUpdate?.version ?? null,
    downloaded: pendingUpdate?.downloaded ?? false,
    error: null,
    ...extra,
  };
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return status({ error: 'Auto-update indisponivel em desenvolvimento (app nao empacotado).' });
  }
  try {
    configure();
    const result = await getAutoUpdater().checkForUpdates();
    const latest = result?.updateInfo?.version ?? null;
    return status({ latestVersion: latest, updateAvailable: latest !== null && latest !== app.getVersion() });
  } catch (e) {
    return status({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** Checagem silenciosa no boot: rede fora / config ausente nao quebram o app. */
export function initAutoUpdateOnBoot(): void {
  if (!app.isPackaged) return;
  configure();
  getAutoUpdater()
    .checkForUpdates()
    .catch(() => {
      /* silencioso */
    });
}
