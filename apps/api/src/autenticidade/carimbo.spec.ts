import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import PDFKitDocument from 'pdfkit';
import { PDFDocument } from 'pdf-lib';
import { CODIGO_REGEX } from '@jdoc/shared';
import { carimbarPdf, PdfNaoCarimbavelError } from './carimbo';
import { gerarCodigo } from './autenticidade.service';
import { detectarFerramentas, extrairTexto } from '../ocr/extrator';

function gerarPdf(paginas: number, size: 'A4' | 'A5' = 'A4'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (let i = 0; i < paginas; i++) {
      if (i > 0) doc.addPage();
      doc.fontSize(14).text(`Conteudo original pagina ${i + 1}`);
    }
    doc.end();
  });
}

const dados = {
  orgao: 'Prefeitura Municipal de Irauçuba',
  codigoFormatado: '7K3M-9XQ2-HV8R-4N6T',
  urlVerificacao: 'https://jdoc.jeossistemas.com/verificar/7K3M9XQ2HV8R4N6T',
  arquivadoEm: new Date('2024-03-01T12:00:00Z'),
  hashOriginal: 'a'.repeat(64),
  emitidaEm: new Date('2026-09-24T12:00:00Z'),
};

describe('gerarCodigo', () => {
  it('16 caracteres Crockford, sem repeticao em 2000 geracoes', () => {
    const set = new Set(Array.from({ length: 2000 }, gerarCodigo));
    expect(set.size).toBe(2000);
    for (const c of set) expect(CODIGO_REGEX.test(c)).toBe(true);
  });
});

describe('carimbarPdf', () => {
  it('carimba todas as paginas sem alterar o original', async () => {
    const original = await gerarPdf(3);
    const hashAntes = createHash('sha256').update(original).digest('hex');
    const copia = await carimbarPdf(original, dados);
    expect(createHash('sha256').update(original).digest('hex')).toBe(hashAntes);
    const lido = await PDFDocument.load(copia);
    expect(lido.getPageCount()).toBe(3);
    expect(lido.getSubject()).toContain('7K3M-9XQ2-HV8R-4N6T');
  });

  it('texto do carimbo fica legivel (com acento) em pagina pequena', async () => {
    const f = await detectarFerramentas();
    if (!f.pdftotext) return;
    const copia = await carimbarPdf(await gerarPdf(1, 'A5'), dados);
    const [p1] = await extrairTexto(copia, { ...f, ocr: false });
    expect(p1?.texto).toContain('Conteudo original pagina 1');
    expect(p1?.texto).toContain('7K3M-9XQ2-HV8R-4N6T');
    expect(p1?.texto).toContain('Irauçuba');
  });

  it('PDF invalido vira erro tratavel', async () => {
    await expect(carimbarPdf(Buffer.from('%PDF-1.4 lixo'), dados)).rejects.toBeInstanceOf(PdfNaoCarimbavelError);
  });
});
