import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { findByteRanges, extractSignedBytes, extractCmsDer, hasSignature } from './pdf-signature';
import { verifyIntegrity } from './cms-verify';
import { validatePdfSignature } from './validate';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface KeyPair {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
}

function makeSelfSigned(): KeyPair {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3_600_000);
  const attrs = [{ name: 'commonName', value: 'Teste Self-Signed' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

/** CMS/PKCS#7 detached (self-signed) sobre `content`. */
function signCms(content: Buffer, kp: KeyPair): Buffer {
  const p7: any = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content.toString('binary'));
  p7.addCertificate(kp.cert);
  p7.addSigner({
    key: kp.key,
    certificate: kp.cert,
    digestAlgorithm: forge.pki.oids['sha256'],
    authenticatedAttributes: [
      { type: forge.pki.oids['contentType'], value: forge.pki.oids['data'] },
      { type: forge.pki.oids['messageDigest'] },
      { type: forge.pki.oids['signingTime'], value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

const pad10 = (n: number): string => String(n).padStart(10, '0');

/** Monta um PDF minimo com um dicionario /Sig e ByteRange coerente. */
function buildSignedPdf(kp: KeyPair): Buffer {
  const CONTENTS_HEX_LEN = 12000;
  const brPlaceholder = '[0000000000 0000000000 0000000000 0000000000]';
  const body =
    '%PDF-1.4\n1 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite ' +
    '/SubFilter /ETSI.CAdES.detached ' +
    `/ByteRange ${brPlaceholder} /Contents <${'0'.repeat(CONTENTS_HEX_LEN)}> >>\nendobj\n%%EOF\n`;
  const buf = Buffer.from(body, 'latin1');

  const ltPos = buf.indexOf(0x3c, buf.indexOf('/Contents')); // '<'
  const gtPos = buf.indexOf(0x3e, ltPos); // '>'
  const a = 0;
  const b = ltPos + 1; // segmento 1 inclui o '<'
  const c = gtPos; // segmento 2 comeca no '>'
  const d = buf.length - gtPos;

  // Patch do ByteRange (mesma largura -> offsets preservados) ANTES de assinar.
  const brReal = `[${pad10(a)} ${pad10(b)} ${pad10(c)} ${pad10(d)}]`;
  buf.write(brReal, buf.indexOf(brPlaceholder), 'latin1');

  const signedBytes = Buffer.concat([buf.subarray(0, b), buf.subarray(c, c + d)]);
  const cmsHex = signCms(signedBytes, kp).toString('hex');
  buf.write(cmsHex + '0'.repeat(CONTENTS_HEX_LEN - cmsHex.length), ltPos + 1, 'latin1');
  return buf;
}

describe('signature — parsing puro', () => {
  it('detecta e extrai ByteRange', () => {
    const pdf = Buffer.from('%PDF x /Type /Sig /ByteRange [0 10 25 5] /Contents <ab> junk', 'latin1');
    expect(hasSignature(pdf)).toBe(true);
    const ranges = findByteRanges(pdf);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ a: 0, b: 10, c: 25, d: 5 });
  });

  it('hasSignature falso sem dicionario /Sig', () => {
    expect(hasSignature(Buffer.from('%PDF sem assinatura', 'latin1'))).toBe(false);
  });
});

describe('signature — integridade e validacao', () => {
  let kp: KeyPair;
  beforeAll(() => {
    kp = makeSelfSigned();
  }, 20_000);

  it('verifyIntegrity: OK para conteudo assinado, falha se adulterado', () => {
    const content = Buffer.from('conteudo assinado de teste', 'utf8');
    const cms = signCms(content, kp);
    expect(verifyIntegrity(content, cms).integrity).toBe(true);
    expect(verifyIntegrity(Buffer.from('adulterado', 'utf8'), cms).integrity).toBe(false);
  });

  it('PDF self-signed: mecanica valida, mas cadeia ICP invalida', async () => {
    const pdf = buildSignedPdf(kp);
    const range = findByteRanges(pdf)[0]!;
    // Mecanica (funcoes puras) confere:
    expect(verifyIntegrity(extractSignedBytes(pdf, range), extractCmsDer(pdf, range)).integrity).toBe(true);

    // Validacao completa: integridade OK, cadeia falha (sem raiz ICP) => 'invalida'.
    const result = await validatePdfSignature(pdf);
    expect(result.signatures[0]?.integrity).toBe(true);
    expect(result.signatures[0]?.chainValid).toBe(false);
    expect(result.status).toBe('invalida');
    expect(result.signerCN).toBe('Teste Self-Signed');
  });
});
