import type { Metadata } from 'next';
import { FormCodigo, MolduraPublica } from './verificacao';

export const metadata: Metadata = { title: 'Verificar autenticidade — jDoc' };

/** Pagina publica: digitar o codigo impresso no rodape da copia autenticada. */
export default function VerificarPage() {
  return (
    <MolduraPublica>
      <FormCodigo />
    </MolduraPublica>
  );
}
