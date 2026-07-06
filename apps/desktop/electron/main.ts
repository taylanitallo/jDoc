import { app, BrowserWindow, Menu } from 'electron';
import { registerIpcHandlers } from './ipc/handlers';
import { restore as restoreSession } from './api/client';
import { readSettings } from './settings';
import { initAutoUpdateOnBoot } from './updater';
import { createLoginWindow, focusLoginOrMain } from './window-manager';
import { start as startFolderWatch } from './watch/folder-watcher';

/**
 * Processo principal blindado do jDoc Desktop.
 * Toda decisao de seguranca de processo + sessao vive aqui.
 *
 * Boot: tenta restaurar a sessao do keychain (api/client.ts::restore). Se
 * houver uma sessao valida, `restore()` ja abre a janela principal sozinho
 * (ver window-manager::openMainWindowForSession). Caso contrario, mostra a
 * janela nativa de login (e-mail/senha -> resolve o(s) orgao(s) vinculado(s)).
 */

// Single-instance lock: uma segunda abertura foca a janela existente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusLoginOrMain();
  });

  // Remove o menu default (File/Edit/View...) — app institucional, sem devtools de menu.
  Menu.setApplicationMenu(null);

  void app.whenReady().then(async () => {
    registerIpcHandlers();

    const restored = await restoreSession().catch(() => null);
    if (!restored) {
      createLoginWindow();
    }

    initAutoUpdateOnBoot(); // checagem silenciosa; rede fora nao quebra o app

    // Retoma a pasta monitorada configurada em sessao anterior, se ainda existir.
    const savedFolder = readSettings().watchedFolder;
    if (savedFolder) {
      try {
        startFolderWatch(savedFolder);
      } catch {
        // pasta removida/inacessivel — usuario reconfigura pela UI.
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createLoginWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
