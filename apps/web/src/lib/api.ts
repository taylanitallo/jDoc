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
  ) {
    super(message);
  }
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
let refreshInflight: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;

  refreshInflight = (async (): Promise<boolean> => {
    const slug = lastTenantSlug;
    const refreshPath = slug ? `/t/${slug}/auth/refresh` : '/superadmin/auth/refresh';
    try {
      const res = await fetch(`${API_URL}${refreshPath}`, {
        method: 'POST',
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
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
  const target = slug ? `/${slug}/login` : '/superadmin/login';
  if (window.location.pathname !== target) {
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
  const isAuthEntryPoint = path.endsWith('/auth/refresh') || path.endsWith('/auth/login');
  if (res.status === 401 && !options._skipRefresh && !isAuthEntryPoint) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await doFetch();
    } else {
      redirectToLogin();
      throw new ApiError(401, 'Sessao expirada');
    }
  }

  if (!res.ok) {
    let message = 'Erro na requisição';
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      // resposta sem corpo
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}