import type { Metadata } from 'next';
import { normalizarCodigo } from '@jdoc/shared';
import { MolduraPublica, ResultadoVerificacao } from '../verificacao';

export const metadata: Metadata = { title: 'Verificar autenticidade — jDoc', robots: { index: false } };

/** Destino do QR code impresso na copia autenticada. */
export default async function VerificarCodigoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  return (
    <MolduraPublica>
      <ResultadoVerificacao codigo={normalizarCodigo(decodeURIComponent(codigo))} />
    </MolduraPublica>
  );
}
