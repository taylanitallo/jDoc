import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '../config/env';

/**
 * Cifra de segredos guardados no banco (chaves de API, senha do SMTP, segredo
 * do 2FA). AES-256-GCM com a ENCRYPTION_KEY (32 bytes em base64).
 *
 * Sem ENCRYPTION_KEY definida, a chave e derivada do COOKIE_SECRET — assim o
 * deploy nao quebra antes de a variavel ser criada no Railway. Ao definir a
 * ENCRYPTION_KEY depois, o que foi cifrado com a chave derivada continua
 * legivel: a decifragem tenta as duas.
 *
 * Formato: `v1.<iv>.<tag>.<cifrado>` (base64). O segredo nunca volta ao front:
 * a tela recebe so `mascarar()`.
 */
function chaves(): Buffer[] {
  const env = loadEnv();
  const derivada = createHash('sha256').update(`jdoc-enc:${env.COOKIE_SECRET}`).digest();
  if (!env.ENCRYPTION_KEY) return [derivada];
  const principal = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (principal.length !== 32) {
    throw new Error('ENCRYPTION_KEY deve ter 32 bytes em base64');
  }
  return [principal, derivada];
}

export function cifrar(texto: string): string {
  const [chave] = chaves() as [Buffer];
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const enc = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decifrar(blob: string): string {
  const partes = blob.split('.');
  if (partes.length !== 4 || partes[0] !== 'v1') throw new Error('Segredo cifrado em formato invalido');
  const [, iv, tag, enc] = partes as [string, string, string, string];
  for (const chave of chaves()) {
    try {
      const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
    } catch {
      // tenta a proxima chave
    }
  }
  throw new Error('Nao foi possivel decifrar o segredo (ENCRYPTION_KEY trocada?)');
}

/** True quando o valor ja esta no formato cifrado (migracao de dados antigos). */
export function estaCifrado(valor: string | null | undefined): boolean {
  return !!valor && valor.startsWith('v1.') && valor.split('.').length === 4;
}

/** O que a tela pode ver de um segredo: so os 4 ultimos caracteres. */
export function mascarar(segredo: string | null | undefined): string | null {
  if (!segredo) return null;
  return `••••${segredo.slice(-4)}`;
}
