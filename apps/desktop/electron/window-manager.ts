import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { join } from 'node:path';
import {
  UPLOAD_PROGRESS_CHANNEL,
  WATCH_PENDING_CHANGED_CHANNEL,
  UPDATE_PROGRESS_CHANNEL,
  UPDATE_READY_CHANNEL,
} from './ipc/contract';
import { idleMonitor } from './session/idle';
import { logout as authLogout } from './api/client';
import { setProgressSink } from './upload/queue';
import { setPendingSink } from './watch/folder-watcher';
import {
  getPendingUpdate,
  setOnUpdateAvailable,
  setUpdateProgressSink,
  setUpdateReadySink,
} from './updater';

/**
 * Dono do ciclo de vida das janelas do app.
 * - loginWindow: janela nativa pequena (e-mail/senha + escolha de orgao —
 *   ver src/components/LoginScreen.tsx), carrega o renderer LOCAL.
 * - mainWindow: casca em volta do MESMO site que roda no navegador, so
 *   aberta DEPOIS que uma sessao valida existe (login novo ou restaurado).
 */

const REFRESH_COOKIE = 'jdoc_rt';

/**
 * Confirmacao nativa antes de fechar via ESC (as janelas nao tem frame, entao
 * ESC e o unico "botao de fechar" — sem confirmacao, um toque acidental
 * derruba o app). O flag evita empilhar dialogos se ESC for pressionado de
 * novo enquanto um ja esta aberto.
 */
let exitConfirmOpen = false;
async function confirmExit(win: BrowserWindow): Promise<void> {
  if (exitConfirmOpen || win.isDestroyed()) return;
  exitConfirmOpen = true;
  try {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Sair', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Sair do jDoc',
      message: 'Deseja realmente sair do jDoc?',
    });
    if (response === 0 && !win.isDestroyed()) win.close();
  } finally {
    exitConfirmOpen = false;
  }
}

let loginWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;

/** Origem padrao quando o app esta empacotado (instalado no usuario final) —
 *  so o dev local usa localhost; sem isso o .exe instalado abriria uma pagina
 *  em branco, ja que localhost:3000/3333 nao existem na maquina do usuario. */
const DEFAULT_API_ORIGIN = app.isPackaged ? 'https://docapi.jeossistemas.com' : 'http://localhost:3333';
const DEFAULT_WEB_ORIGIN = app.isPackaged ? 'https://doc.jeossistemas.com' : 'http://localhost:3000';

/** Origem da API (para permitir o iframe do visualizador carregar a signed URL). */
export const API_ORIGIN = process.env['JDOC_API_URL'] ?? DEFAULT_API_ORIGIN;

/**
 * Origem do site jDoc (Next.js) que a janela principal carrega apos o login
 * nativo resolver o orgao. As features nativas (fila de upload, assinatura
 * ICP-Brasil, pasta monitorada) continuam vivendo no processo main e ficam
 * disponiveis ao site via `window.jdoc` (preload) — o site pode detectar
 * essa ponte e oferecer essas acoes so quando presente.
 */
export const WEB_ORIGIN = process.env['JDOC_WEB_URL'] ?? DEFAULT_WEB_ORIGIN;

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
 *   (dashboard, todas as rotas /:slug/...); qualquer outra origem e cancelada.
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

/** Janela nativa pequena de login (e-mail/senha + escolha de orgao). */
export function createLoginWindow(notice?: string): BrowserWindow {
  if (loginWindow) {
    loginWindow.focus();
    return loginWindow;
  }
  loginWindow = new BrowserWindow({
    width: 460,
    height: 640,
    minimizable: true,
    maximizable: true,
    show: false,
    backgroundColor: '#0f1424',
    center: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow.once('ready-to-show', () => loginWindow?.show());
  void loginWindow.loadFile(join(__dirname, '../renderer/index.html'), {
    query: notice ? { notice } : undefined,
  });
  // ESC tambem fecha (com confirmacao), alem do botao X da barra de titulo.
  loginWindow.webContents.on('before-input-event', (_event, input) => {
    const noModifier = !input.control && !input.alt && !input.shift && !input.meta;
    if (input.type === 'keyDown' && input.key === 'Escape' && noModifier && loginWindow) {
      void confirmExit(loginWindow);
    }
  });
  loginWindow.on('closed', () => {
    loginWindow = null;
  });
  return loginWindow;
}

export function focusLoginOrMain(): void {
  const win = mainWindow ?? loginWindow;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * Expiracao por inatividade: faz logout (revoga + limpa keychain) e volta
 * pra janela nativa de login — a janela principal (site) nao saberia
 * reagir a um evento custom, entao a resposta e simplesmente fechar e
 * trocar de janela.
 */
async function handleIdleExpiry(): Promise<void> {
  await authLogout().catch(() => {});
  backToLogin('Sua sessão expirou por inatividade. Entre novamente.');
}

/**
 * Injeta o cookie httpOnly jdoc_rt (mesmo formato que a API define em
 * `cookieOptions(slug)`) na sessao da janela ANTES de navegar — assim o
 * bootstrap de sessao do site (`POST /t/:slug/auth/refresh` no mount do
 * layout autenticado) encontra o cookie e loga sozinho, sem o usuario
 * digitar credenciais de novo dentro do site.
 *
 * O cookie tem que ser gravado pro dominio da API (docapi.jeossistemas.com),
 * NAO do site (doc.jeossistemas.com) — e exatamente o mesmo host que
 * recebe o Set-Cookie quando um navegador normal faz login pela pagina:
 * quem LE o cookie e sempre a chamada fetch pra API, nunca o site em si.
 * Gravar no dominio errado faz o refresh sempre falhar silenciosamente e
 * o site cair de volta pro /slug/login (ou pra lista de orgaos).
 */
async function seedRefreshCookie(slug: string, refreshToken: string): Promise<void> {
  const url = new URL(API_ORIGIN);

  // O jar de cookies do Electron PERSISTE em disco entre execucoes. Um
  // jdoc_rt morto de uma sessao anterior (ex.: o Set-Cookie host-only que a
  // API devolve ao rotacionar) convive com o cookie novo se os atributos nao
  // baterem exatamente — e o header Cookie envia AMBOS, com o mais antigo
  // primeiro (RFC 6265). O cookie-parser da API le o primeiro valor, tenta
  // rotacionar um token ja consumido e devolve 401 "Sessao expirada" — o site
  // cai pro login mesmo com o login nativo tendo funcionado. Remove qualquer
  // residuo antes de gravar o novo.
  const stale = await session.defaultSession.cookies.get({ name: REFRESH_COOKIE });
  for (const c of stale) {
    const scheme = c.secure ? 'https' : 'http';
    const host = c.domain?.startsWith('.') ? c.domain.slice(1) : (c.domain ?? '');
    await session.defaultSession.cookies
      .remove(`${scheme}://${host}${c.path ?? '/'}`, REFRESH_COOKIE)
      .catch(() => {});
  }

  await session.defaultSession.cookies.set({
    url: url.origin,
    // SEM `domain`: cookie host-only, com identidade IGUAL ao Set-Cookie que a
    // API emite ao rotacionar — a rotacao sobrescreve este cookie em vez de
    // criar uma duplicata (domain-cookie vs host-only) que reintroduz o bug.
    path: `/t/${slug}/auth`,
    name: REFRESH_COOKIE,
    value: refreshToken,
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'strict',
    expirationDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  });
}

/**
 * Ponto de entrada no sistema: sessao ja resolvida (login novo ou
 * restaurado do keychain) — injeta o cookie, abre a janela principal
 * carregando o dashboard do orgao e fecha a janela de login, se aberta.
 */
export async function openMainWindowForSession(slug: string, refreshToken: string): Promise<void> {
  await seedRefreshCookie(slug, refreshToken);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    minimizable: true,
    maximizable: true,
    show: false,
    backgroundColor: '#0f1424',
    center: true,
    title: 'jDoc Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
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
  // ESC tambem fecha (com confirmacao), alem do botao X da barra de titulo.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const noModifier = !input.control && !input.alt && !input.shift && !input.meta;
    if (input.type === 'keyDown' && input.key === 'Escape' && noModifier && mainWindow) {
      void confirmExit(mainWindow);
    }
  });
  hardenNavigation(mainWindow);

  idleMonitor.attach(mainWindow);
  idleMonitor.onExpire = () => void handleIdleExpiry();
  setProgressSink((snapshot) => mainWindow?.webContents.send(UPLOAD_PROGRESS_CHANNEL, snapshot));
  setPendingSink((items) => mainWindow?.webContents.send(WATCH_PENDING_CHANGED_CHANNEL, items));
  // Sinks do updater: enviam o push IPC para a janela correta (modal > main).
  setUpdateProgressSink((snapshot) => {
    const target = updateModal ?? mainWindow;
    target?.webContents.send(UPDATE_PROGRESS_CHANNEL, snapshot);
  });
  setUpdateReadySink((payload) => {
    const target = updateModal ?? mainWindow;
    target?.webContents.send(UPDATE_READY_CHANNEL, payload);
  });
  // Quando chega update-available DEPOIS da janela principal existir, abre o modal agora.
  setOnUpdateAvailable(() => {
    if (mainWindow) openUpdateModal(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    updateModal?.close();
    updateModal = null;
  });

  await mainWindow.loadURL(`${WEB_ORIGIN}/${slug}/dashboard`);

  // Se um update ja chegou durante o login (antes da main existir), abrir agora.
  if (getPendingUpdate()) {
    openUpdateModal(mainWindow);
  }

  loginWindow?.close();
}

/** Modal de atualizacao (electron-updater). Janela-filha da main, sem frame e
 *  sem icone na barra de tarefas: o usuario so ve uma janela centralizada com
 *  a barra de progresso ate `quitAndInstall()` ser chamado pelo updater. */
let updateModal: BrowserWindow | null = null;

export function openUpdateModal(parent: BrowserWindow): BrowserWindow {
  if (updateModal) {
    updateModal.focus();
    return updateModal;
  }
  updateModal = new BrowserWindow({
    width: 560,
    height: 420,
    parent,
    modal: true,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: '#0f1424',
    title: 'jdoc-update-modal',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  updateModal.once('ready-to-show', () => updateModal?.show());
  void updateModal.loadFile(join(__dirname, '../renderer/assets/update-modal/index.html'));
  updateModal.on('closed', () => {
    updateModal = null;
  });
  // Se a janela-pai fechar, fecha o modal junto (evita orfa).
  if (!parent.isDestroyed()) {
    parent.once('closed', () => {
      if (updateModal && !updateModal.isDestroyed()) updateModal.close();
    });
  }
  return updateModal;
}

/** Fecha a janela principal e mostra o login de novo (logout / expiracao por inatividade). */
export function backToLogin(notice?: string): void {
  mainWindow?.close();
  mainWindow = null;
  createLoginWindow(notice);
}

