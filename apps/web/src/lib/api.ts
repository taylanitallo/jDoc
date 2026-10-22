'use client';

/**
 * Cliente HTTP minimal para a API jDoc.
 * - Access token mantido apenas em memoria (nunca localStorage).
 * - Refresh via cookie httpOnly (credentials: include).
 * - Single-flight refresh on 401: se qualquer requisicao retorna 401 e ha slug
 *   de tenant inferido pelo path, tenta renovar uma vez e repete a requisicao
 *   original. Falha do refresh = limpa token + redireciona para o login do tenant
 *   (ou /superadmin/login quando nao houver slug).
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';

let accessToken: string | null = null;

// Cache do slug do tenant inferido a partir do path. Necessario porque
// `fetch` nao tem acesso ao contexto de URL da aplicacao.
let lastTenantSlug: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setLastTenantSlug(slug: string | null): void {
  lastTenantSlug = slug;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Codigo estavel da API (`reauth_required`, `mfa_required`, ...). */
    public readonly code?: string,
  ) {
    super(message);
  }
}

/** Le `{ error | message, code }` do corpo de erro da API. */
async function erroDaResposta(res: Response): Promise<ApiError> {
  let message = 'Erro na requisição';
  let code: string | undefined;
  try {
    const data = (await res.json()) as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof data.error === 'string' && data.error) message = data.error;
    else if (typeof data.message === 'string' && data.message) message = data.message;
    if (typeof data.code === 'string') code = data.code;
  } catch {
    // resposta sem corpo
  }
  return new ApiError(res.status, message, code);
}

/**
 * Reautenticacao para acoes criticas do superadmin: quando a API responde
 * `403 reauth_required`, o client chama este handler (o modal "Confirme sua
 * identidade") e, se ele confirmar, repete a mesma requisicao uma vez.
 */
let reauthHandler: (() => Promise<boolean>) | null = null;
export function setReauthHandler(fn: (() => Promise<boolean>) | null): void {
  reauthHandler = fn;
}

/** Infere o slug do tenant a partir do path `/t/<slug>/...`. */
function inferTenantSlug(path: string): string | null {
  const match = path.match(/^\/t\/([^/]+)\//);
  return match && match[1] ? match[1] : null;
}

/**
 * Refresh single-flight: garante apenas uma chamada de refresh em voo.
 * Retorna true se renovou o token com sucesso, false caso contrario.
 */
export type RefreshStatus = 'ok' | 'expirada' | 'indisponivel';

/** Sem resposta da API nesse tempo, a tela avisa em vez de ficar em "Carregando…" para sempre. */
const REFRESH_TIMEOUT_MS = 15_000;

let refreshInflight: Promise<RefreshStatus> | null = null;
async function tryRefresh(): Promise<boolean> {
  return (await refreshStatus()) === 'ok';
}

/** Renova o access token (single-flight). Para envios longos que usam XHR direto (ex.: lote). */
export function renovarSessao(): Promise<boolean> {
  return tryRefresh();
}

function refreshStatus(): Promise<RefreshStatus> {
  if (refreshInflight) return refreshInflight;

  refreshInflight = (async (): Promise<RefreshStatus> => {
    const slug = lastTenantSlug;
    const refreshPath = slug ? `/t/${slug}/auth/refresh` : '/superadmin/auth/refresh';
    try {
      const res = await fetch(`${API_URL}${refreshPath}`, {
        method: 'POST',
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (res.status === 401 || res.status === 403) return 'expirada';
      if (!res.ok) return 'indisponivel';
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return 'ok';
    } catch {
      // Rede fora, API parada ou timeout: a sessao pode estar valida, so nao deu para confirmar.
      return 'indisponivel';
    } finally {
      refreshInflight = null;
    }
  })();

  return refreshInflight;
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const slug = lastTenantSlug;
  accessToken = null;
  const atual = window.location.pathname;
  // Superadmin volta para onde estava depois de entrar de novo (?next=).
  const target = slug
    ? `/${slug}/login`
    : `/superadmin/login${atual.startsWith('/superadmin') && atual !== '/superadmin/login' ? `?next=${encodeURIComponent(atual)}` : ''}`;
  if (atual !== target.split('?')[0]) {
    window.location.replace(target);
  }
}

type ApiOptions = {
  method?: string;
  body?: unknown;
  /** Quando true, desabilita o retry automatico apos refresh (usado pelo proprio refresh). */
  _skipRefresh?: boolean;
};

export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  // Atualiza cache de slug para o single-flight.
  const inferred = inferTenantSlug(path);
  if (inferred) lastTenantSlug = inferred;

  const doFetch = (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  let res = await doFetch();

  // Tenta refresh automatico em 401 (mas nao na propria requisicao de login/refresh —
  // um 401 de login e credencial/2FA invalidos, nao sessao expirada, e nao ha
  // sessao nenhuma ainda pra tentar renovar).
  const isAuthEntryPoint =
    path.endsWith('/auth/refresh') || path.endsWith('/auth/login') || path.endsWith('/auth/reauth');
  if (res.status === 401 && !options._skipRefresh && !isAuthEntryPoint) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await doFetch();
    } else {
      redirectToLogin();
      throw new ApiError(401, 'Sessao expirada');
    }
  }

  if (res.status === 403 && reauthHandler && !options._skipRefresh) {
    const erro = await erroDaResposta(res.clone());
    if (erro.code === 'reauth_required') {
      if (!(await reauthHandler())) throw erro;
      res = await doFetch();
    }
  }

  if (!res.ok) throw await erroDaResposta(res);

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
/**
 * Baixa uma resposta binaria (PDF/CSV) autenticada e devolve um object URL.
 * Mesmo refresh automatico do `api()` em 401. Quem chama revoga a URL quando
 * nao precisar mais (ou deixa pro unload da aba aberta).
 */
/** URL absoluta de uma rota PUBLICA da API (links diretos, ex.: PDF do portal da legislacao). */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export async function apiBlobUrl(path: string, options: Omit<ApiOptions, '_skipRefresh'> = {}): Promise<string> {
  const inferred = inferTenantSlug(path);
  if (inferred) lastTenantSlug = inferred;
  const doFetch = (): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  let res = await doFetch();
  if (res.status === 401) {
    if (await tryRefresh()) res = await doFetch();
    else {
      redirectToLogin();
      throw new ApiError(401, 'Sessao expirada');
    }
  }
  if (!res.ok) throw await erroDaResposta(res);
  return URL.createObjectURL(await res.blob());
}

/**
 * Bootstrap de sessao (F5 / nova aba): renova via cookie httpOnly usando o MESMO
 * single-flight do refresh automatico. Efeito duplicado (React StrictMode) ou
 * chamadas simultaneas viram UMA requisicao — dois refresh concorrentes com o
 * mesmo token eram a origem das quedas de sessao por "reuso".
 */
export function bootstrapSession(slug: string | null): Promise<RefreshStatus> {
  lastTenantSlug = slug;
  return refreshStatus();
}
