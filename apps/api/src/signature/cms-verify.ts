import { createHash } from 'node:crypto';
import forge from 'node-forge';

/**
 * Verificacao de INTEGRIDADE (pura) de um CMS/PKCS#7 SignedData detached:
 *  (a) o messageDigest dos authenticated attributes bate com SHA-256 do conteudo;
 *  (b) a assinatura RSA sobre os authenticated attributes confere com a chave
 *      publica do certificado do signatario.
 *
 * NAO valida cadeia nem revogacao — isso e chain.ts / revocation.ts.
 */

const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';

export interface IntegrityResult {
  integrity: boolean;
  rsaValid: boolean;
  messageDigestMatch: boolean;
  signerCN: string | null;
  /** Certificados embarcados no CMS (leaf + cadeia, se houver). */
  certificatesPem: string[];
  reason?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Valor (bytes) de um attribute pelo OID, ou null. */
function findAttrValueBytes(attrs: any[], oid: string): string | null {
  for (const attr of attrs) {
    try {
      const attrOid = forge.asn1.derToOid(attr.value[0].value);
      if (attrOid === oid) {
        return attr.value[1].value[0].value as string;
      }
    } catch {
      // atributo malformado — ignora
    }
  }
  return null;
}

function cn(cert: forge.pki.Certificate): string | null {
  const field = cert.subject.getField('CN') as { value?: string } | null;
  return field?.value ?? null;
}

export function verifyIntegrity(signedContent: Buffer, cmsDer: Buffer): IntegrityResult {
  const fail = (reason: string): IntegrityResult => ({
    integrity: false,
    rsaValid: false,
    messageDigestMatch: false,
    signerCN: null,
    certificatesPem: [],
    reason,
  });

  let p7: any;
  let certs: forge.pki.Certificate[];
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(cmsDer.toString('binary')));
    p7 = (forge.pkcs7 as any).messageFromAsn1(asn1);
    certs = (p7.certificates ?? []) as forge.pki.Certificate[];
  } catch (e) {
    return fail(`CMS ilegivel: ${e instanceof Error ? e.message : String(e)}`);
  }

  const capture = p7.rawCapture;
  const attrs: any[] = capture?.authenticatedAttributes ?? [];
  const signerCert = certs[0] ?? null; // leaf; CMS de token traz o cert do signatario
  if (!signerCert || attrs.length === 0 || !capture?.signature) {
    return fail('SignedData sem atributos autenticados ou sem certificado.');
  }

  // (a) messageDigest vs SHA-256 do conteudo assinado.
  const mdAttr = findAttrValueBytes(attrs, OID_MESSAGE_DIGEST);
  const contentDigest = createHash('sha256').update(signedContent).digest();
  const messageDigestMatch = mdAttr !== null && contentDigest.equals(Buffer.from(mdAttr, 'binary'));

  // (b) RSA sobre o DER dos authenticated attributes (re-tagueados como SET OF).
  let rsaValid = false;
  try {
    const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
    const md = forge.md.sha256.create();
    md.update(forge.asn1.toDer(set).getBytes());
    rsaValid = (signerCert.publicKey as forge.pki.rsa.PublicKey).verify(
      md.digest().getBytes(),
      capture.signature,
    );
  } catch {
    rsaValid = false;
  }

  return {
    integrity: rsaValid && messageDigestMatch,
    rsaValid,
    messageDigestMatch,
    signerCN: cn(signerCert),
    certificatesPem: certs.map((c) => forge.pki.certificateToPem(c)),
    reason: rsaValid && messageDigestMatch ? undefined : 'Integridade falhou (digest ou RSA).',
  };
}
