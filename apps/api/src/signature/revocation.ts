import forge from 'node-forge';

/**
 * Verificacao de REVOGACAO (OCSP com fallback CRL), timeout de 10s.
 *
 * @pending o protocolo OCSP/CRL fim-a-fim nao foi implementado — sem
 * certificado/AC reais nao ha como exercita-lo. Extraimos as URLs (AIA/CRL DP)
 * de verdade e a regra "nunca travar" e respeitada: quando indisponivel/nao
 * verificado, o resultado e 'unknown' (mapeado para 'nao_verificada').
 *
 * IMPORTANTE (seguranca): quando o OCSP/CRL for implementado, TODO fetch das
 * URLs abaixo (que vem do certificado, nao confiavel) DEVE passar por
 * `safeFetch` de ./url-guard (anti-SSRF) — nunca `fetch` cru.
 */

const OID_AIA = '1.3.6.1.5.5.7.1.1';
const OID_CRL_DP = '2.5.29.31';

export type RevocationStatus = 'good' | 'revoked' | 'unknown';

export interface RevocationResult {
  status: RevocationStatus;
  reason: string;
  ocspUrls: string[];
  crlUrls: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function extractUrls(cert: forge.pki.Certificate, oid: string): string[] {
  const ext = (cert.extensions as any[]).find((e) => e.id === oid);
  const raw: string = ext && typeof ext.value === 'string' ? ext.value : '';
  // Caracteres de controle excluidos de proposito: a URL vem de bytes DER do certificado.
  // eslint-disable-next-line no-control-regex
  return [...new Set(raw.match(/https?:\/\/[^\s\x00-\x1f"'<>]+/g) ?? [])];
}

export async function checkRevocation(leafPem: string): Promise<RevocationResult> {
  let ocspUrls: string[] = [];
  let crlUrls: string[] = [];
  try {
    const leaf = forge.pki.certificateFromPem(leafPem);
    // AIA carrega tanto caIssuers quanto OCSP; filtramos o que parece OCSP.
    ocspUrls = extractUrls(leaf, OID_AIA);
    crlUrls = extractUrls(leaf, OID_CRL_DP).filter((u) => /\.crl(\?|$)/i.test(u));
  } catch {
    /* cert ilegivel — segue com listas vazias */
  }

  return {
    status: 'unknown',
    reason:
      'Revogacao nao verificada (@pending: OCSP/CRL fim-a-fim exige certificado e AC reais). Nunca bloqueia o fluxo.',
    ocspUrls,
    crlUrls,
  };
}
