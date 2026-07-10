import { app } from 'electron';
import electronUpdater from 'electron-updater';

/**
 * Auto-update (electron-updater). servico vem do app-update.yml gerado pelo
 * electron-builder (publish: generic), e pode ser sobreposto em runtime por
 * JDOC_UPDATE_URL. Toda falha (rede, config ausente) e engolida: NUNCA quebra o app.
 *
 * Em desenvolvimento (app nao empacotado) o auto-update fica inativo.
 *
 * Fluxo da UI:
 *   1. `initAutoUpdateOnBoot()` dispara checkForUpdates() silencioso em background.
 *   2. Quando chega `update-available`, guarda `pendingUpdate` e chama
 *      `onUpdateAvailable(version)` (registrado pelo window-manager) — que abre
 *      o modal centralizado se a janela principal ja existe.
 *   3. `download-progress` e empurrado para a modal via `UPDATE_PROGRESS_CHANNEL`.
 *   4. `update-downloaded` empurra `UPDATE_READY_CHANNEL` e, apos 800ms (para o
 *      usuario ver a barra em 100%), chama `quitAndInstall()` para reiniciar o .exe.
 *      `autoInstallOnAppQuit` segue true como rede de seguranca.
 */
/**
 * Acesso PREGUICOSO ao autoUpdater: `electronUpdater.autoUpdater` e um
 * getter que constroi o updater na primeira leitura (`new NsisUpdater()`),
 * e esse construtor chama `app.getVersion()` internamente — se isso
 * acontecer no import de main.ts (antes de `app.whenReady()`), o Electron
 * `app` ainda nao esta pronto e o processo morre com "Cannot read
 * properties of undefined (reading 'getVersion')" no boot, sem log nem
 * dialog. Toda funcao abaixo so roda DEPOIS de app.whenReady() (ver
 * main.ts), entao chamar getAutoUpdater() ali dentro e seguro.
 */
function getAutoUpdater() {
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

/** Estado em memoria — sobrevive ate o app fechar. */
let pendingUpdate: PendingUpdate | null = null;

/** Callback registrado pelo window-manager: disparado quando chega um update novo
 *  e ja existe (ou passou a existir) uma janela principal para hospedar o modal. */
let onUpdateAvailableCb: ((version: string) => void) | null = null;

/** Listener para o callback — apenas o window-manager chama. */
export function setOnUpdateAvailable(cb: ((version: string) => void) | null): void {
  onUpdateAvailableCb = cb;
}

/** Getter usado pelo window-manager para decidir se abre o modal apos a main carregar. */
export function getPendingUpdate(): PendingUpdate | null {
  return pendingUpdate;
}

/** Sinks registrados pelo window-manager: encaminham o push IPC para a
 *  BrowserWindow correta (main ou modal). Mantem o updater desacoplado das
 *  referencias de janela — segue o mesmo padrao de setProgressSink/setPendingSink. */
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
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
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
    // delay curto para o usuario perceber 100% antes do app fechar.
    setTimeout(() => {
      getAutoUpdater().quitAndInstall();
    }, 800);
  });
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
