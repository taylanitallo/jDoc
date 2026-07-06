import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc/handlers';
import { SESSION_EXPIRED_CHANNEL, UPLOAD_PROGRESS_CHANNEL, WATCH_PENDING_CHANGED_CHANNEL } from './ipc/contract';
import { idleMonitor } from './session/idle';
import { logout as authLogout } from './api/client';
import { setProgressSink } from './upload/queue';
import { setPendingSink, start as startFolderWatch } from './watch/folder-watcher';
import { readSettings } from './settings';
import { initAutoUpdateOnBoot } from './updater';

/**
 * Processo principal blindado do jDoc Desktop.
 * Toda decisao de seguranca de processo + sessao vive aqui.
 */

let mainWindow: BrowserWindow | null = null;

/**
 * Expiracao por inatividade: faz logout (revoga + limpa keychain) e avisa
 * o renderer, que volta ao login mostrando "sessao expirada".
 */
async function handleIdleExpiry(): Promise<void> {
  await authLogout().catch(() => {});
  mainWindow?.webContents.send(SESSION_EXPIRED_CHANNEL);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#0f1424',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Sem integracao Node no worker, sem remote, sem eval no renderer.
      nodeIntegrationInWorker: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.log(`[did-fail-load] ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  hardenNavigation(mainWindow);

  // Monitor de inatividade: escuta atividade da janela; ao expirar, faz logout.
  idleMonitor.attach(mainWindow);
  idleMonitor.onExpire = () => void handleIdleExpiry();

  // Progresso da fila de upload -> renderer.
  setProgressSink((snapshot) => mainWindow?.webContents.send(UPLOAD_PROGRESS_CHANNEL, snapshot));

  // Pendentes da pasta monitorada -> renderer.
  setPendingSink((items) => mainWindow?.webContents.send(WATCH_PENDING_CHANGED_CHANNEL, items));

  loadRenderer(mainWindow);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Origem padrao quando o app esta empacotado (instalado no usuario final) —
 *  so o dev local usa localhost; sem isso o .exe instalado abriria uma pagina
 *  em branco, ja que localhost:3000/3333 nao existem na maquina do usuario. */
const DEFAULT_API_ORIGIN = app.isPackaged ? 'https://docapi.jeossistemas.com' : 'http://localhost:3333';
const DEFAULT_WEB_ORIGIN = app.isPackaged ? 'https://jeossistemas.com' : 'http://localhost:3000';

/** Origem da API (para permitir o iframe do visualizador carregar a signed URL). */
const API_ORIGIN = process.env['JDOC_API_URL'] ?? DEFAULT_API_ORIGIN;

/**
 * Origem do site jDoc (Next.js) que a janela carrega. O executavel e agora
 * uma casca nativa em volta do MESMO site que roda no navegador — nao ha
 * mais um renderer proprio duplicando UI. As features nativas (fila de
 * upload, assinatura ICP-Brasil, pasta monitorada) continuam vivendo no
 * processo main e ficam disponiveis ao site via `window.jdoc` (preload) —
 * o site pode detectar essa ponte e oferecer essas acoes so quando presente.
 */
const WEB_ORIGIN = process.env['JDOC_WEB_URL'] ?? DEFAULT_WEB_ORIGIN;

/** O iframe do visualizador so pode navegar para a signed URL (API local ou https). */
function isAllowedFrameUrl(url: string): boolean {
  return url.startsWith(API_ORIGIN) || url.startsWith('https:');
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Bloqueia navegacao e abertura de janela para fora do app.
 * - will-navigate: o frame principal so navega dentro da origem do site
 *   (login, dashboard, todas as rotas /:slug/...); qualquer outra origem e
 *   cancelada.
 * - will-frame-navigate: no iframe do visualizador, permite APENAS a signed
 *   URL do documento (API local ou https); qualquer outro destino (link
 *   dentro do PDF) e barrado.
 * - setWindowOpenHandler: o site abre downloads/relatorios via window.open
 *   (signed URL da API local ou storage https) — abre no navegador padrao do
 *   sistema em vez de uma nova janela Electron; qualquer outro destino nega.
 */
function hardenNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (event, url) => {
    if (!sameOrigin(url, WEB_ORIGIN)) {
      event.preventDefault();
    }
  });

  win.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return; // frame principal ja tratado por will-navigate
    if (!isAllowedFrameUrl(event.url)) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(API_ORIGIN) || url.startsWith('https:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

function loadRenderer(win: BrowserWindow): void {
  void win.loadURL(WEB_ORIGIN);
}

// --- Ciclo de vida -----------------------------------------------------------

// Single-instance lock: uma segunda abertura foca a janela existente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Remove o menu default (File/Edit/View...) — app institucional, sem devtools de menu.
  Menu.setApplicationMenu(null);

  void app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
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
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
