import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';

export interface DadosCarimbo {
  orgao: string;
  codigoFormatado: string;
  urlVerificacao: string;
  arquivadoEm: Date;
  hashOriginal: string;
  emitidaEm: Date;
}

/** Faixa do carimbo no rodape de cada pagina (pt). */
const ALTURA_FAIXA = 38;
const QR_TAM = 32;

/** Standard fonts usam WinAnsi: troca o que nao e codificavel (nome de orgao exotico nao derruba a emissao). */
function textoSeguro(font: PDFFont, s: string): string {
  const suportados = new Set(font.getCharacterSet());
  let out = '';
  for (const ch of s) out += suportados.has(ch.codePointAt(0) ?? 0) ? ch : '?';
  return out;
}

export class PdfNaoCarimbavelError extends Error {}

/**
 * Gera a copia autenticada: o PDF original com uma faixa no rodape de cada
 * pagina (orgao, data de arquivamento, codigo de verificacao, trecho do
 * SHA-256 do original e QR para a pagina publica). O original no storage NAO
 * e tocado — a copia e gerada em memoria a cada emissao.
 */
export async function carimbarPdf(original: Buffer, d: DadosCarimbo): Promise<Buffer> {
  // pdf-lib as vezes aceita arquivo corrompido no load e so falha adiante: qualquer
  // erro no processamento vira PdfNaoCarimbavelError (422 para o usuario, nao 500).
  try {
    return await carimbar(await PDFDocument.load(original, { updateMetadata: false }), d);
  } catch (e) {
    throw new PdfNaoCarimbavelError(
      /encrypt/i.test((e as Error).message)
        ? 'PDF protegido por senha/criptografia nao pode ser carimbado'
        : 'PDF ilegivel: nao foi possivel gerar a copia autenticada',
    );
  }
}

async function carimbar(pdf: PDFDocument, d: DadosCarimbo): Promise<Buffer> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qrPng = await QRCode.toBuffer(d.urlVerificacao, { errorCorrectionLevel: 'M', margin: 1, width: 256 });
  const qr = await pdf.embedPng(qrPng);

  const dataBr = (dt: Date) => dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const linha1 = textoSeguro(
    bold,
    `Cópia autenticada — ${d.orgao} — documento arquivado em ${dataBr(d.arquivadoEm)} — emitida em ${dataBr(d.emitidaEm)}`,
  );
  const linha2 = textoSeguro(
    font,
    `Código de verificação: ${d.codigoFormatado} · Confira em ${d.urlVerificacao} · SHA-256 do original: ${d.hashOriginal.slice(0, 16)}…${d.hashOriginal.slice(-8)}`,
  );

  for (const page of pdf.getPages()) {
    const { width } = page.getSize();
    const { x: x0, y: y0 } = page.getMediaBox();
    const tam = width < 400 ? 5 : 6.5;
    page.drawRectangle({
      x: x0,
      y: y0,
      width,
      height: ALTURA_FAIXA,
      color: rgb(1, 1, 1),
      opacity: 0.92,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 0.4,
    });
    page.drawImage(qr, { x: x0 + width - QR_TAM - 4, y: y0 + 3, width: QR_TAM, height: QR_TAM });
    const maxLargura = width - QR_TAM - 16;
    // Encolhe a fonte ate caber numa linha (pagina estreita/texto longo nunca quebra por cima da outra linha).
    const caber = (f: PDFFont, t: string) => Math.min(tam, maxLargura / Math.max(1, f.widthOfTextAtSize(t, 1)));
    page.drawText(linha1, { x: x0 + 6, y: y0 + 22, size: caber(bold, linha1), font: bold, color: rgb(0.1, 0.1, 0.3) });
    page.drawText(linha2, { x: x0 + 6, y: y0 + 10, size: caber(font, linha2), font, color: rgb(0.2, 0.2, 0.2) });
  }
  pdf.setSubject(`Cópia autenticada ${d.codigoFormatado}`);
  pdf.setProducer('jDoc — JEOS Sistemas');
  return Buffer.from(await pdf.save());
}
