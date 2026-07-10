import { app, BrowserWindow, Menu } from 'electron';
import { registerIpcHandlers } from './ipc/handlers';
import { readSettings } from './settings';
import { initAutoUpdateOnBoot } from './updater';
import { createLoginWindow, focusLoginOrMain } from './window-manager';
import { start as startFolderWatch, probeWritable } from './watch/folder-watcher';

/**
 * Processo principal blindado do jDoc Desktop.
 * Toda decisao de seguranca de processo + sessao vive aqui.
 *
 * Boot: SEMPRE mostra a janela nativa de login (e-mail/senha), mesmo que
 * exista uma sessao salva no keychain de uma execucao anterior — o usuario
 * decidiu que fechar o executavel deve exigir login de novo a cada abertura,
 * em vez de restaurar a sessao silenciosamente (api/client.ts::restore nao
 * e mais chamado aqui). Apos digitar e-mail/senha, o backend resolve sozinho
 * o(s) orgao(s) vinculados aquele e-mail — com 1 vinculo so, entra direto no
 * dashboard da prefeitura (ver api/client.ts::resolveLogin).
 */

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

    createLoginWindow();

    initAutoUpdateOnBoot(); // checagem silenciosa; rede fora nao quebra o app

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
