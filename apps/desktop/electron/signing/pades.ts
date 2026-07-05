import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import signpdf from '@signpdf/signpdf';
import { Signer } from '@signpdf/utils';
import { buildCadesCms } from './cms';
import type { TokenSigner } from './pkcs11';

/**
 * Incorpora uma assinatura PAdES (basica) ao PDF: o @signpdf adiciona o
 * placeholder + ByteRange e chama o Signer com os bytes a assinar; devolvemos
 * o CMS/CAdES detached (assinado pelo token) para irem ao /Contents.
 *
 * @pending nao verificado com hardware. O placeholder/ByteRange sao do @signpdf
 * (padrao); o CMS e do nosso cms.ts com o token. Falta validar com token real.
 */
class Pkcs11Signer extends Signer {
  constructor(private readonly token: TokenSigner) {
    super();
  }

  // O @signpdf entrega os bytes do ByteRange; devolvemos o CMS detached.
  async sign(pdfBuffer: Buffer): Promise<Buffer> {
    return buildCadesCms(pdfBuffer, this.token);
  }
}

export async function signPdfWithToken(pdf: Buffer, token: TokenSigner, reason: string): Promise<Buffer> {
  const withPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdf,
    reason,
    contactInfo: '',
    name: '',
    location: '',
    // Espaco reservado para o CMS (bytes). CAdES detached = PAdES basico.
    signatureLength: 16384,
    subFilter: 'ETSI.CAdES.detached',
  });
  const signer = new Pkcs11Signer(token);
  return signpdf.sign(withPlaceholder, signer);
}
