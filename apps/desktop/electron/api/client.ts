import { app } from 'electron';
import { emailSchema, type ResolveLoginResponse, type ResolvedTenantSession } from '@jdoc/shared';
import { decodeAccessClaims, toSessionView, type SessionView } from '../session/types';
import { sessionStore } from '../session/session-store';
import { idleMonitor } from '../session/idle';
import * as keychain from '../session/keychain';
import { openMainWindowForSession } from '../window-manager';

/**
 * Cliente HTTP do processo MAIN. Toda ida ao backend passa por aqui.
 * O renderer nunca faz fetch nem toca em tokens.
 *
 * - Access token: injetado do session-store (memoria).
 * - Refresh token: cookie httpOnly jdoc_rt, capturado do set-cookie e
 *   guardado no keychain; reenviado manualmente no refresh/logout.
 * - Single-flight refresh on 401: um unico refresh em voo por vez.
 */
// So o dev local usa localhost; empacotado (instalado no usuario final) aponta
// pra producao por padrao — sem isso o .exe instalado nao conseguiria logar.
const API_URL = process.env['JDOC_API_URL'] ?? (app.isPackaged ? 'https://docapi.jeossistemas.com' : 'http://localhost:3333');
const REFRESH_COOKIE = 'jdoc_rt';

interface AuthBody {
  accessToken: string;
  mustChangePassword: boolean;
}

/** fetch cru contra a API, sem injecao de auth nem retry. */
function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, init);
}

/** Extrai o valor do cookie jdoc_rt de um set-cookie da resposta. */
function extractRefreshCookie(res: Response): string | null {
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const raw of cookies) {
    const first = raw.split(';', 1)[0] ?? '';
    const eq = first.indexOf('=');
    if (eq === -1) continue;
    if (first.slice(0, eq).trim() === REFRESH_COOKIE) {
      return first.slice(eq + 1).trim();
    }
  }
  return null;
}

/** Mensagem de erro amigavel a partir do corpo (ou status). */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    if (data?.message) return data.message;
  } catch {
    // sem corpo JSON
  }
  return fallback;
}

// --- Refresh single-flight ---------------------------------------------------

let refreshInflight: Promise<boolean> | null = null;

/**
 * Renova o access token. Garante UM refresh em voo: chamadas concorrentes
 * que tomarem 401 juntas aguardam a mesma promessa. Le o refresh do keychain,
 * envia como cookie manual, atualiza access (memoria) e o refresh rotacionado.
 */
function refreshAccessToken(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;

  refreshInflight = (async (): Promise<boolean> => {
    const cur = sessionStore.current;
    if (!cur) return false;
    const stored = await keychain.loadSession(cur.slug, cur.userId);
    if (!stored) return false;

    const res = await rawFetch(`/t/${cur.slug}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `${REFRESH_COOKIE}=${stored.rt}` },
    });
    if (!res.ok) return false;

    const body = (await res.json()) as AuthBody;
    sessionStore.setAccessToken(body.accessToken);
    const rotated = extractRefreshCookie(res) ?? stored.rt;
    await keychain.saveSession(cur.slug, cur.userId, { rt: rotated, email: stored.email });
    return true;
  })();

  refreshInflight.finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

/**
 * fetch autenticado: injeta o access token e, em 401, refaz UMA vez apos refresh.
 * Recebe uma FACTORY de init (nao um init pronto) — assim o corpo (ex.: FormData,
 * cujo stream se consome ao enviar) e reconstruido a cada tentativa.
 */
async function authorizedFetch(path: string, buildInit: () => RequestInit): Promise<Response> {
  const withAuth = (): RequestInit => {
    const base = buildInit();
    const token = sessionStore.current?.accessToken;
    return {
      ...base,
      headers: {
        ...(base.headers as Record<string, string> | undefined),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  };

  let res = await rawFetch(path, withAuth());
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await rawFetch(path, withAuth());
  }
  return res;
}

// --- Operacoes publicas (usadas pelos handlers IPC) --------------------------

/** Login real contra POST /t/:slug/auth/login. Recusa cedo se o cofre faltar. */
export async function login(slug: string, email: string, senha: string): Promise<SessionView> {
  await keychain.assertAvailable();
  const normEmail = emailSchema.parse(email);

  const res = await rawFetch(`/t/${slug}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normEmail, senha }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'Falha ao entrar.'));

  const body = (await res.json()) as AuthBody;
  const rt = extractRefreshCookie(res);
  if (!rt) throw new Error('Servidor nao estabeleceu a sessao (cookie de refresh ausente).');

  const claims = decodeAccessClaims(body.accessToken);
  const view = toSessionView(claims, normEmail, body.mustChangePassword);
  await keychain.saveSession(slug, claims.sub, { rt, email: normEmail });
  sessionStore.set({ accessToken: body.accessToken, slug, userId: claims.sub, view });
  idleMonitor.start();
  return view;
}

/** Boot: tenta restaurar a sessao a partir do refresh guardado no keychain. */
export async function restore(): Promise<SessionView | null> {
  if (!(await keychain.isAvailable())) return null;
  const found = await keychain.findAnySession();
  if (!found) return null;

  const res = await rawFetch(`/t/${found.slug}/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `${REFRESH_COOKIE}=${found.session.rt}` },
  });
  if (!res.ok) {
    // Refresh invalido/expirado/revogado — descarta a credencial morta.
    await keychain.deleteSession(found.slug, found.userId);
    return null;
  }

  const body = (await res.json()) as AuthBody;
  const rotated = extractRefreshCookie(res) ?? found.session.rt;
  const claims = decodeAccessClaims(body.accessToken);
  const view = toSessionView(claims, found.session.email, body.mustChangePassword);
  await keychain.saveSession(found.slug, claims.sub, { rt: rotated, email: found.session.email });
  sessionStore.set({ accessToken: body.accessToken, slug: found.slug, userId: claims.sub, view });
  idleMonitor.start();
  await openMainWindowForSession(found.slug, rotated);
  return view;
}

// --- Login por e-mail (sem slug) ---------------------------------------------

export type TenantChoice = ResolvedTenantSession['tenant'];

export type ResolveLoginResult =
  | { status: 'entered'; session: SessionView }
  | { status: 'choose'; tenants: TenantChoice[] };

/** Sessoes resolvidas (com token) aguardando o usuario escolher o orgao, e
 *  o e-mail digitado (pra exibir apos restore) — vive so no processo main,
 *  nunca e exposto ao renderer inteiro. */
let pendingSessions: ResolvedTenantSession[] | null = null;
let pendingEmail: string | null = null;

async function enterTenantSession(s: ResolvedTenantSession): Promise<SessionView> {
  const claims = decodeAccessClaims(s.accessToken);
  const view = toSessionView(claims, pendingEmail, s.mustChangePassword);
  await keychain.saveSession(s.tenant.slug, claims.sub, { rt: s.refreshToken, email: pendingEmail ?? '' });
  sessionStore.set({ accessToken: s.accessToken, slug: s.tenant.slug, userId: claims.sub, view });
  idleMonitor.start();
  await openMainWindowForSession(s.tenant.slug, s.refreshToken);
  pendingSessions = null;
  pendingEmail = null;
  return view;
}

/**
 * Login pela tela nativa: so e-mail + senha, sem o usuario saber/digitar o
 * slug. Tenta as credenciais em todos os orgaos ativos (backend) e entra
 * direto se so um bateu, ou devolve a lista pra escolher (auth:select-tenant).
 */
export async function resolveLogin(email: string, senha: string): Promise<ResolveLoginResult> {
  await keychain.assertAvailable();
  const normEmail = emailSchema.parse(email);

  const res = await rawFetch('/auth/resolve-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normEmail, senha }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'E-mail ou senha invalidos.'));

  const body = (await res.json()) as ResolveLoginResponse;
  if (body.sessions.length === 0) throw new Error('E-mail ou senha invalidos.');

  pendingEmail = normEmail;
  if (body.sessions.length === 1) {
    const view = await enterTenantSession(body.sessions[0]!);
    return { status: 'entered', session: view };
  }

  pendingSessions = body.sessions;
  return { status: 'choose', tenants: body.sessions.map((s) => s.tenant) };
}

/** Segundo passo: usuario escolheu o orgao dentre os resolvidos acima. */
export async function selectTenant(slug: string): Promise<SessionView> {
  const chosen = pendingSessions?.find((s) => s.tenant.slug === slug);
  if (!chosen) throw new Error('Selecao invalida — faca login novamente.');
  return enterTenantSession(chosen);
}

/** Logout: revoga no backend (best-effort) E apaga a credencial do keychain. */
export async function logout(): Promise<void> {
  const cur = sessionStore.current;
  if (cur) {
    const stored = await keychain.loadSession(cur.slug, cur.userId).catch(() => null);
    try {
      await authorizedFetch(`/t/${cur.slug}/auth/logout`, () => ({
        method: 'POST',
        headers: stored ? { Cookie: `${REFRESH_COOKIE}=${stored.rt}` } : undefined,
      }));
    } catch {
      // Rede indisponivel: prossegue apagando o estado local.
    }
    await keychain.deleteSession(cur.slug, cur.userId);
  }
  sessionStore.clear();
  idleMonitor.stop();
}

/** Visao atual da sessao para o renderer (sem token). */
export function currentView(): SessionView | null {
  return sessionStore.current?.view ?? null;
}

/**
 * Upload de um documento (multipart) para POST /t/:slug/documents.
 * Usa authorizedFetch (herda o refresh single-flight). O FormData e
 * reconstruido a cada tentativa via a factory de init. Devolve a Response
 * crua — a fila interpreta o status (retry/erro/quota).
 */
export function uploadDocument(
  slug: string,
  fields: Record<string, string>,
  content: Uint8Array,
  filename: string,
  signal: AbortSignal,
): Promise<Response> {
  const buildInit = (): RequestInit => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    // Cast: Uint8Array<ArrayBufferLike> e BlobPart valido em runtime; o cast so
    // contorna a estreiteza do lib.dom no TS 5.7 (quer ArrayBuffer, nao SharedArrayBuffer).
    form.append('file', new Blob([content as unknown as BlobPart], { type: 'application/pdf' }), filename);
    return { method: 'POST', body: form, signal };
  };
  return authorizedFetch(`/t/${slug}/documents`, buildInit);
}

/** Mensagem de erro do backend (ex.: quota) para refletir no status do arquivo. */
export function readError(res: Response): Promise<string> {
  return errorMessage(res, `Falha no envio (HTTP ${res.status}).`);
}

/** GET autenticado que devolve JSON tipado (herda refresh single-flight). */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await authorizedFetch(path, () => ({ method: 'GET' }));
  if (!res.ok) throw new Error(await errorMessage(res, `Falha na requisição (HTTP ${res.status}).`));
  return (await res.json()) as T;
}

/** GET /t/:slug/documents com filtros minimos + paginacao. */
export function searchDocuments<T>(slug: string, query: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  return apiGet<T>(`/t/${slug}/documents?${qs}`);
}

/** GET /t/:slug/documents/:id/url — signed URL de 60s (nao baixa para disco). */
export function documentSignedUrl(slug: string, id: string): Promise<{ url: string }> {
  return apiGet<{ url: string }>(`/t/${slug}/documents/${id}/url`);
}
