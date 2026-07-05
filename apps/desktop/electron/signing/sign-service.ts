import { getStatus, listCertificates, openSigner, type CertificateInfo, type Pkcs11Status } from './pkcs11';
import { signPdfWithToken } from './pades';

/**
 * Orquestra a assinatura para os handlers IPC. Detecta o token, lista certs
 * e assina. O PIN vive SO durante a chamada de sign(): nao e persistido nem
 * logado. (JS nao permite zerar strings imutaveis na memoria; mitigamos
 * confinando o PIN a esta funcao e nao guardando referencia.)
 *
 * @pending assinatura real nao validada com hardware.
 */
export function status(): Promise<Pkcs11Status> {
  return getStatus();
}

export function certificates(): Promise<CertificateInfo[]> {
  return listCertificates();
}

export interface SignResult {
  fileId: string;
  /** PDF assinado (substitui o conteudo enfileirado no renderer). */
  content: Uint8Array;
  /** Assinatura montada, porem nao verificada com token real. */
  pending: true;
}

export async function sign(
  fileId: string,
  certId: string,
  pin: string,
  content: Uint8Array,
): Promise<SignResult> {
  const token = await openSigner(certId, pin);
  try {
    const signed = await signPdfWithToken(
      Buffer.from(content),
      token,
      'Assinatura ICP-Brasil (jDoc Desktop)',
    );
    return { fileId, content: new Uint8Array(signed), pending: true };
  } finally {
    token.close();
  }
}
