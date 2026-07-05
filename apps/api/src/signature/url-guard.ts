import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * Guarda anti-SSRF para fetches que partem do worker com URLs extraidas de
 * CERTIFICADOS (AIA/OCSP/CRL) — ou seja, controladas por quem envia o PDF.
 *
 * Regras:
 *  1) somente https;
 *  2) o hostname (ou IP literal) NAO pode resolver para IP privado/loopback/
 *     link-local/reservado (inclui a faixa de metadata 169.254.169.254);
 *  3) redirects sao rejeitados (redirect: 'manual');
 *  4) resposta limitada em tamanho.
 *
 * Reuso: chain.ts (AIA) e, quando implementado, revocation.ts (OCSP/CRL).
 *
 * Nota honesta: a checagem resolve o DNS e a conexao resolve de novo; contra
 * DNS rebinding puro faltaria "pinar" o IP resolvido no dispatcher. As faixas
 * privadas/metadata e o bloqueio de redirect cobrem os vetores principais.
 */

export interface UrlGuardResult {
  safe: boolean;
  reason: string;
}

/** Classificacao PURA de um IPv4: privado/loopback/link-local/reservado. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((o) => Number(o));
  if (parts.length !== 4 || parts.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return true; // malformado -> trata como inseguro
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark)
  if (a >= 224) return true; // multicast (224/4) + reservado (240/4)
  return false;
}

/** Classificacao PURA de um IPv6. */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped && mapped[1]) return isPrivateIpv4(mapped[1]); // IPv4-mapped
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  return false;
}

/** PURA: um IP e privado/loopback/link-local/reservado (ou nem e IP)? */
export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // nao e IP valido -> inseguro
}

/**
 * https obrigatorio + o host (IP literal ou DNS) so pode apontar para IP
 * publico. Async por causa do dns.lookup.
 */
export async function isSafePublicUrl(raw: string): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { safe: false, reason: 'URL invalida' };
  }
  if (url.protocol !== 'https:') {
    return { safe: false, reason: `Protocolo nao permitido: ${url.protocol}` };
  }

  const host = url.hostname;
  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    try {
      ips = (await lookup(host, { all: true })).map((r) => r.address);
    } catch {
      return { safe: false, reason: 'Falha ao resolver o host' };
    }
  }
  if (ips.length === 0) return { safe: false, reason: 'Host sem endereco' };
  for (const ip of ips) {
    if (isPrivateOrReservedIp(ip)) {
      return { safe: false, reason: `IP nao publico: ${ip}` };
    }
  }
  return { safe: true, reason: 'ok' };
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
}

/** Le o corpo com teto de bytes (aborta se exceder). */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  const body = res.body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

/**
 * fetch com TODA a guarda: valida a URL, proibe redirect, aplica timeout e
 * limita o tamanho. Retorna os bytes ou null (bloqueado/erro/timeout).
 */
export async function safeFetch(url: string, opts: SafeFetchOptions): Promise<Buffer | null> {
  const guard = await isSafePublicUrl(url);
  if (!guard.safe) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    // !ok cobre 3xx (redirect manual nao segue) e erros.
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > opts.maxBytes) return null;
    return await readCapped(res, opts.maxBytes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
