import { app } from 'electron';
import electronUpdater from 'electron-updater';

/**
 * Auto-update (electron-updater). Provider vem do app-update.yml gerado pelo
 * electron-builder (publish: generic), e pode ser sobreposto em runtime por
 * JDOC_UPDATE_URL. Toda falha (rede, config ausente) e engolida: NUNCA quebra o app.
 *
 * Em desenvolvimento (app nao empacotado) o auto-update fica inativo.
 */
const { autoUpdater } = electronUpdater;

export interface UpdateStatus {
  packaged: boolean;
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  error: string | null;
}

let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const url = process.env['JDOC_UPDATE_URL'];
  if (url) {
    autoUpdater.setFeedURL({ provider: 'generic', url });
  }
  autoUpdater.on('error', () => {
    /* falha de update nao pode derrubar o app */
  });
}

function status(extra?: Partial<UpdateStatus>): UpdateStatus {
  return {
    packaged: app.isPackaged,
    currentVersion: app.getVersion(),
    updateAvailable: false,
    latestVersion: null,
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
    const result = await autoUpdater.checkForUpdates();
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
  autoUpdater.checkForUpdates().catch(() => {
    /* silencioso */
  });
}
