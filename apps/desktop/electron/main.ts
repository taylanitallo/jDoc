import { app, BrowserWindow, Menu } from 'electron';
import { registerIpcHandlers } from './ipc/handlers';
import { readSettings } from './settings';
import { checkForUpdate } from './updater';
import { createLoginWindow, focusLoginOrMain, initUpdateSinks, openUpdateModal } from './window-manager';
import { start as startFolderWatch, probeWritable } from './watch/folder-watcher';

/**
 * Processo principal blindado do jDoc Desktop.
 * Toda decisao de seguranca de processo + sessao vive aqui.
 *
 * Boot: ATUALIZA ANTES DO LOGIN. Ao abrir, o app checa se ha versao nova; se
 * houver, mostra a janela "Atualizador" primeiro (baixa, aplica em silencio e
 * reinicia ja na versao nova). So depois — ou se nao houver update — aparece a
 * tela de login. Assim o usuario sempre entra na versao mais recente, sem o
 * app fechar no meio do uso.
 *
 * SEMPRE pede login (nao restaura sessao do keychain). Apos e-mail/senha, o
 * backend resolve o(s) orgao(s) vinculados — com 1 vinculo, entra direto no
 * dashboard (ver api/client.ts::resolveLogin).
 */

/** Checa update no boot com timeout curto — feed lento nao trava a abertura. */
async function updateAvailableAtBoot(): Promise<boolean> {
  try {
    const status = await Promise.race([
      checkForUpdate(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    return status?.updateAvailable === true;
  } catch {
    return false;
  }
}

// User-agent "limpo": o default do Electron inclui "@jdoc/desktop/1.0.0" e
// "Electron/33.x", e o WAF do Cloudflare (que protege doc/docapi.jeossistemas.com)
// trata esse UA como bot — dispara desafio JavaScript interativo. A pagina do
// site ate resolve o desafio, mas o fetch de bootstrap de sessao do dashboard
// (POST /t/:slug/auth/refresh) nao tem como resolver challenge e falha sempre,
// derrubando o usuario logado de volta pra tela de login do site. Removendo os
// dois tokens, o UA vira um Chrome comum e o Cloudflare deixa passar.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?\S*jdoc\S*\/[\d.]+/gi, '')
  .replace(/\s?Electron\/[\d.]+/gi, '');

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
    initUpdateSinks(); // liga os sinks antes de abrir o Atualizador

    // Atualizar ANTES do login: se ha versao nova, mostra o Atualizador; ele
    // baixa, aplica e reinicia ja na versao nova (que entao cai no `else` e
    // mostra o login). Sem update, vai direto pro login.
    if (await updateAvailableAtBoot()) {
      openUpdateModal();
    } else {
      createLoginWindow();
    }

    // Retoma a pasta monitorada configurada em sessao anterior, se ainda for
    // gravavel. A sonda e assincrona e NUNCA congela: se a pasta virou
    // protegida/inacessivel desde o ultimo uso, apenas nao reinicia o watch
    // (o usuario reconfigura pela UI, que explica o motivo).
    const savedFolder = readSettings().watchedFolder;
    if (savedFolder) {
      void probeWritable(savedFolder).then((ok) => {
        if (!ok) return;
        try {
          startFolderWatch(savedFolder);
        } catch {
          // pasta removida/inacessivel — usuario reconfigura pela UI.
        }
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createLoginWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
