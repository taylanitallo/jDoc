/**
 * Parsing (puro) de assinaturas embutidas em PDF (PAdES/AcroForm).
 * Sem I/O, sem estado — alvo dos unit tests.
 *
 * A assinatura vive num dicionario /Type /Sig com:
 *   /ByteRange [a b c d]  -> os bytes assinados sao pdf[a..a+b] + pdf[c..c+d]
 *   /Contents <hex...>    -> o CMS/PKCS#7 (na lacuna entre a+b e c)
 */

export interface ByteRange {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Detecta se o PDF contem ao menos uma assinatura. */
export function hasSignature(pdf: Buffer): boolean {
  const text = pdf.toString('latin1');
  return /\/ByteRange\s*\[/.test(text) && /\/Type\s*\/Sig\b/.test(text);
}

/** Todos os ByteRange presentes (uma entrada por assinatura). */
export function findByteRanges(pdf: Buffer): ByteRange[] {
  const text = pdf.toString('latin1');
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const out: ByteRange[] = [];
  for (const m of text.matchAll(re)) {
    out.push({ a: Number(m[1]), b: Number(m[2]), c: Number(m[3]), d: Number(m[4]) });
  }
  return out;
}

/** Bytes efetivamente assinados (concatenacao dos dois segmentos do ByteRange). */
export function extractSignedBytes(pdf: Buffer, r: ByteRange): Buffer {
  return Buffer.concat([pdf.subarray(r.a, r.a + r.b), pdf.subarray(r.c, r.c + r.d)]);
}

/** CMS/PKCS#7 (DER) extraido do /Contents na lacuna do ByteRange. */
export function extractCmsDer(pdf: Buffer, r: ByteRange): Buffer {
  const gap = pdf.subarray(r.a + r.b, r.c).toString('latin1');
  const hex = gap.replace(/[^0-9a-fA-F]/g, ''); // remove '<', '>', espacos
  const trimmed = hex.replace(/(00)+$/i, ''); // padding zero do placeholder
  const even = trimmed.length % 2 === 0 ? trimmed : trimmed.slice(0, -1);
  return Buffer.from(even, 'hex');
}
