import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import forge from 'node-forge';
import { safeFetch } from './url-guard';

/**
 * Validacao de CADEIA ate uma raiz ICP-Brasil.
 *
 * @pending sem o bundle oficial (certs/icp-brasil) e sem um certificado ICP
 * real, esta etapa nao pode ser exercitada fim-a-fim. Comportamento seguro:
 * sem ancoras carregadas, NENHUMA cadeia e considerada valida.
 */

const ROOTS_DIR = process.env['ICP_ROOTS_DIR'] ?? join(process.cwd(), 'certs', 'icp-brasil');
const AIA_TIMEOUT_MS = 10_000;
const MAX_AIA_BYTES = 128 * 1024; // AIA legitimo tem poucos KB
const OID_AIA = '1.3.6.1.5.5.7.1.1';

let anchorsCache: forge.pki.Certificate[] | null = null;

function parseCerts(raw: Buffer): forge.pki.Certificate[] {
  const text = raw.toString('latin1');
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    const out: forge.pki.Certificate[] = [];
    for (const m of text.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)) {
      try {
        out.push(forge.pki.certificateFromPem(m[0]));
      } catch {
        /* pem invalido */
      }
    }
    return out;
  }
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(text));
  return [forge.pki.certificateFromAsn1(asn1)];
}

/** Carrega (e cacheia) as ancoras de confianca do diretorio do bundle. */
export function loadAnchors(): forge.pki.Certificate[] {
  if (anchorsCache) return anchorsCache;
  const anchors: forge.pki.Certificate[] = [];
  try {
    for (const file of readdirSync(ROOTS_DIR)) {
      if (!/\.(pem|crt|cer)$/i.test(file)) continue;
      try {
        anchors.push(...parseCerts(readFileSync(join(ROOTS_DIR, file))));
      } catch {
        /* arquivo invalido — ignora */
      }
    }
  } catch {
    /* diretorio ausente */
  }
  anchorsCache = anchors;
  return anchors;
}

export interface ChainResult {
  chainValid: boolean;
  reachedIcpRoot: boolean;
  anchorsLoaded: number;
  reason: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function extractUrls(cert: forge.pki.Certificate, oid: string): string[] {
  const ext = (cert.extensions as any[]).find((e) => e.id === oid);
  const raw: string = ext && typeof ext.value === 'string' ? ext.value : '';
  // Caracteres de controle excluidos de proposito: a URL vem de bytes DER do certificado.
  // eslint-disable-next-line no-control-regex
  return [...new Set(raw.match(/https?:\/\/[^\s\x00-\x1f"'<>]+/g) ?? [])];
}

/**
 * Busca intermediarias ausentes via AIA (caIssuers). Cada URL vem do
 * certificado (nao confiavel) — passa pela guarda anti-SSRF (safeFetch: https,
 * IP publico, sem redirect, tamanho limitado, timeout). @pending.
 */
async function tryFetchAia(leaf: forge.pki.Certificate, intermediates: forge.pki.Certificate[]): Promise<void> {
  const urls = extractUrls(leaf, OID_AIA).filter((u) => /\.(cer|crt|p7c|der)(\?|$)/i.test(u));
  for (const url of urls) {
    const body = await safeFetch(url, { maxBytes: MAX_AIA_BYTES, timeoutMs: AIA_TIMEOUT_MS });
    if (!body) continue; // bloqueado pela guarda / erro / timeout
    try {
      intermediates.push(...parseCerts(body));
    } catch {
      /* DER/PEM invalido — ignora */
    }
  }
}

function describeChainError(e: unknown): string {
  const err = e as { message?: string; error?: string };
  return err?.message ?? err?.error ?? String(e);
}

export async function verifyChain(leafPem: string, extraPems: string[]): Promise<ChainResult> {
  const anchors = loadAnchors();
  if (anchors.length === 0) {
    return {
      chainValid: false,
      reachedIcpRoot: false,
      anchorsLoaded: 0,
      reason: 'Bundle ICP-Brasil ausente em certs/icp-brasil (@pending: adicionar raizes oficiais).',
    };
  }

  const leaf = forge.pki.certificateFromPem(leafPem);
  const intermediates = extraPems
    .map((p) => forge.pki.certificateFromPem(p))
    .filter((c) => forge.pki.certificateToPem(c) !== leafPem);

  await tryFetchAia(leaf, intermediates);

  const caStore = forge.pki.createCaStore(anchors);
  try {
    forge.pki.verifyCertificateChain(caStore, [leaf, ...intermediates]);
    return { chainValid: true, reachedIcpRoot: true, anchorsLoaded: anchors.length, reason: 'Cadeia validada ate uma raiz ICP-Brasil.' };
  } catch (e) {
    return {
      chainValid: false,
      reachedIcpRoot: false,
      anchorsLoaded: anchors.length,
      reason: `Cadeia nao alcancou raiz confiavel: ${describeChainError(e)}`,
    };
  }
}
