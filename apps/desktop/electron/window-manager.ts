import { app, BrowserWindow, session, shell } from 'electron';
import { join } from 'node:path';
import { UPLOAD_PROGRESS_CHANNEL, WATCH_PENDING_CHANGED_CHANNEL } from './ipc/contract';
import { idleMonitor } from './session/idle';
import { logout as authLogout } from './api/client';
import { setProgressSink } from './upload/queue';
import { setPendingSink } from './watch/folder-watcher';

/**
 * Dono do ciclo de vida das janelas do app.
 * - loginWindow: janela nativa pequena (e-mail/senha + escolha de orgao —
 *   ver src/components/LoginScreen.tsx), carrega o renderer LOCAL.
 * - mainWindow: casca em volta do MESMO site que roda no navegador, so
 *   aberta DEPOIS que uma sessao valida existe (login novo ou restaurado).
 */

const REFRESH_COOKIE = 'jdoc_rt';

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
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    backgroundColor: '#0f1424',
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
  await session.defaultSession.cookies.set({
    url: url.origin,
    domain: url.hostname,
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
    show: false,
    backgroundColor: '#0f1424',
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
  hardenNavigation(mainWindow);

  idleMonitor.attach(mainWindow);
  idleMonitor.onExpire = () => void handleIdleExpiry();
  setProgressSink((snapshot) => mainWindow?.webContents.send(UPLOAD_PROGRESS_CHANNEL, snapshot));
  setPendingSink((items) => mainWindow?.webContents.send(WATCH_PENDING_CHANGED_CHANNEL, items));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`${WEB_ORIGIN}/${slug}/dashboard`);

  loginWindow?.close();
}

/** Fecha a janela principal e mostra o login de novo (logout / expiracao por inatividade). */
export function backToLogin(notice?: string): void {
  mainWindow?.close();
  mainWindow = null;
  createLoginWindow(notice);
}

