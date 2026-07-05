/**
 * Cofre de refresh tokens sobre o keytar (Windows Credential Manager).
 *
 * - O refresh token vive AQUI, nunca em arquivo texto. Se o keytar nao
 *   estiver disponivel, `assertAvailable()` lanca e o login e recusado com
 *   erro claro (nunca ha fallback para disco).
 * - account = `${slug}:${userId}` (slug e uuid nao contem ':').
 * - password = JSON { rt, email } — e-mail guardado junto ao segredo para
 *   restaurar a visao de sessao no boot sem persistir nada em texto plano.
 */

const SERVICE = 'jdoc-desktop';

export interface StoredSession {
  /** Refresh token (valor do cookie jdoc_rt). */
  rt: string;
  /** E-mail do usuario, para exibicao apos restore. */
  email: string;
}

export class KeychainUnavailableError extends Error {
  constructor() {
    super('Cofre de credenciais (keytar) indisponivel — login nao pode ser realizado com seguranca.');
    this.name = 'KeychainUnavailableError';
  }
}

// Carregamento tardio: keytar e nativo e pode falhar ao carregar o .node.
// import() rejeita (nao derruba o processo) e o resultado e memoizado.
//
// keytar e CommonJS (`module.exports = { getPassword, findCredentials, ... }`).
// Dependendo de como o cjs-module-lexer analisa esse objeto em runtime, o
// import() dinamico pode nao promover TODOS os metodos para o topo do
// namespace ESM sintetizado — alguns ficam so em `.default`. Detecta os dois
// formatos em vez de confiar cegamente no namespace.
let cached: typeof import('keytar') | null | undefined;
async function loadKeytar(): Promise<typeof import('keytar') | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = await import('keytar');
    const candidate = typeof mod.findCredentials === 'function' ? mod : (mod as { default?: typeof import('keytar') }).default;
    cached = candidate && typeof candidate.findCredentials === 'function' ? candidate : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function isAvailable(): Promise<boolean> {
  return (await loadKeytar()) !== null;
}

export async function assertAvailable(): Promise<typeof import('keytar')> {
  const kt = await loadKeytar();
  if (!kt) throw new KeychainUnavailableError();
  return kt;
}

function accountKey(slug: string, userId: string): string {
  return `${slug}:${userId}`;
}

/** slug e tudo antes do primeiro ':'; userId (uuid) e o restante. */
function parseAccount(account: string): { slug: string; userId: string } | null {
  const idx = account.indexOf(':');
  if (idx <= 0 || idx >= account.length - 1) return null;
  return { slug: account.slice(0, idx), userId: account.slice(idx + 1) };
}

export async function saveSession(slug: string, userId: string, session: StoredSession): Promise<void> {
  const kt = await assertAvailable();
  await kt.setPassword(SERVICE, accountKey(slug, userId), JSON.stringify(session));
}

export async function loadSession(slug: string, userId: string): Promise<StoredSession | null> {
  const kt = await assertAvailable();
  const raw = await kt.getPassword(SERVICE, accountKey(slug, userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (typeof parsed?.rt === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function deleteSession(slug: string, userId: string): Promise<void> {
  const kt = await loadKeytar();
  if (!kt) return; // nada a apagar se o cofre nem carregou
  await kt.deletePassword(SERVICE, accountKey(slug, userId));
}

/** Boot: encontra uma sessao previamente salva (se houver). */
export async function findAnySession(): Promise<{ slug: string; userId: string; session: StoredSession } | null> {
  const kt = await assertAvailable();
  const creds = await kt.findCredentials(SERVICE);
  for (const cred of creds) {
    const parsed = parseAccount(cred.account);
    if (!parsed) continue;
    try {
      const session = JSON.parse(cred.password) as StoredSession;
      if (typeof session?.rt === 'string') {
        return { slug: parsed.slug, userId: parsed.userId, session };
      }
    } catch {
      // credencial corrompida — ignora
    }
  }
  return null;
}
