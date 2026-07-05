import forge from 'node-forge';
import type { TokenSigner } from './pkcs11';

/**
 * Monta o CMS/CAdES-BES (SignedData) detached de um conteudo, reaproveitando
 * a montagem testada do node-forge, mas com a assinatura RSA vinda do TOKEN:
 * o forge chama `key.sign(md)`, e a nossa "chave" delega o RSA ao C_Sign do
 * PKCS#11 sobre o DigestInfo. A chave privada nunca sai do dispositivo.
 *
 * @pending nao verificado com hardware. O layout segue CAdES-BES; a validacao
 * final (assinatura aceita por um validador ICP-Brasil) exige token real.
 */

// Prefixo DigestInfo do SHA-256 (RFC 8017, EMSA-PKCS1-v1_5). O token assina
// PKCS#1 v1.5 sobre DigestInfo || hash.
const SHA256_DIGESTINFO_PREFIX = Buffer.from('3031300d060960864801650304020105000420', 'hex');

export function buildCadesCms(content: Buffer, signer: TokenSigner): Buffer {
  const certAsn1 = forge.asn1.fromDer(forge.util.createBuffer(signer.certDer.toString('binary')));
  const cert = forge.pki.certificateFromAsn1(certAsn1);

  // "Chave externa": forge chama sign(md) esperando a assinatura RSA crua.
  const tokenKey = {
    sign(md: forge.md.MessageDigest): string {
      const digest = Buffer.from(md.digest().getBytes(), 'binary');
      const digestInfo = Buffer.concat([SHA256_DIGESTINFO_PREFIX, digest]);
      const signature = signer.sign(digestInfo); // token: CKM_RSA_PKCS
      return signature.toString('binary');
    },
  };

  // @types/node-forge nao cobre todo o pkcs7 com chave externa — boundary
  // tipado (Buffer -> Buffer), manipulacao interna solta e proposital.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p7: any = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(content.toString('binary'));
  p7.addCertificate(cert);
  p7.addSigner({
    key: tokenKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids['sha256'],
    authenticatedAttributes: [
      { type: forge.pki.oids['contentType'], value: forge.pki.oids['data'] },
      { type: forge.pki.oids['messageDigest'] }, // forge calcula o digest do conteudo
      { type: forge.pki.oids['signingTime'], value: new Date() },
    ],
  });
  p7.sign({ detached: true });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary');
}
