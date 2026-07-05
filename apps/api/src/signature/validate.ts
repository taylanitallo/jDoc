import { hasSignature, findByteRanges, extractSignedBytes, extractCmsDer } from './pdf-signature';
import { verifyIntegrity } from './cms-verify';
import { verifyChain } from './chain';
import { checkRevocation } from './revocation';

/**
 * Orquestra a validacao de uma ou mais assinaturas de um PDF e agrega o
 * status. Regra de agregacao (pior vence):
 *   invalida > nao_verificada > valida.
 * Integridade falha OU cadeia invalida => 'invalida'.
 * Cadeia valida + revogacao desconhecida => 'nao_verificada'.
 * Cadeia valida + revogacao 'good' => 'valida'.
 */
export type AssinaturaStatus = 'nao_assinado' | 'valida' | 'invalida' | 'nao_verificada';

export interface SignatureCheckDetail {
  index: number;
  integrity: boolean;
  chainValid: boolean;
  revocation: 'good' | 'revoked' | 'unknown';
  signerCN: string | null;
  notes: string[];
}

export interface ValidationResult {
  status: AssinaturaStatus;
  signerCN: string | null;
  signatures: SignatureCheckDetail[];
  pending: string[];
}

const RANK: Record<AssinaturaStatus, number> = {
  valida: 0,
  nao_verificada: 1,
  invalida: 2,
  nao_assinado: -1,
};

function worse(a: AssinaturaStatus, b: AssinaturaStatus): AssinaturaStatus {
  return RANK[b] > RANK[a] ? b : a;
}

export async function validatePdfSignature(pdf: Buffer): Promise<ValidationResult> {
  const pending = [
    'Cadeia ICP-Brasil: requer bundle oficial em certs/icp-brasil (nao baixado automaticamente).',
    'Revogacao OCSP/CRL: nao implementada fim-a-fim; resultado sempre nao_verificada.',
  ];

  if (!hasSignature(pdf)) {
    return { status: 'nao_assinado', signerCN: null, signatures: [], pending };
  }

  const ranges = findByteRanges(pdf);
  if (ranges.length === 0) {
    return { status: 'nao_assinado', signerCN: null, signatures: [], pending };
  }

  const signatures: SignatureCheckDetail[] = [];
  let worst: AssinaturaStatus = 'valida';
  let signerCN: string | null = null;

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    const notes: string[] = [];
    const integ = verifyIntegrity(extractSignedBytes(pdf, range), extractCmsDer(pdf, range));
    signerCN = signerCN ?? integ.signerCN;

    if (!integ.integrity) {
      notes.push(integ.reason ?? 'Integridade falhou.');
      signatures.push({ index: i, integrity: false, chainValid: false, revocation: 'unknown', signerCN: integ.signerCN, notes });
      worst = worse(worst, 'invalida');
      continue;
    }

    const leafPem = integ.certificatesPem[0] ?? '';
    const chain = await verifyChain(leafPem, integ.certificatesPem.slice(1));
    notes.push(chain.reason);
    if (!chain.chainValid) {
      signatures.push({ index: i, integrity: true, chainValid: false, revocation: 'unknown', signerCN: integ.signerCN, notes });
      worst = worse(worst, 'invalida');
      continue;
    }

    const rev = await checkRevocation(leafPem);
    notes.push(rev.reason);
    const sigStatus: AssinaturaStatus =
      rev.status === 'revoked' ? 'invalida' : rev.status === 'unknown' ? 'nao_verificada' : 'valida';
    signatures.push({ index: i, integrity: true, chainValid: true, revocation: rev.status, signerCN: integ.signerCN, notes });
    worst = worse(worst, sigStatus);
  }

  return { status: worst, signerCN, signatures, pending };
}
