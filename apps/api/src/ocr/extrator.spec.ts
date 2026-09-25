import { describe, expect, it } from 'vitest';
import PDFKitDocument from 'pdfkit';
import { detectarFerramentas, extrairTexto, precisaOcr, separarPaginas } from './extrator';

function gerarPdf(paginas: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    paginas.forEach((t, i) => {
      if (i > 0) doc.addPage();
      if (t) doc.fontSize(12).text(t);
    });
    doc.end();
  });
}

describe('separarPaginas / precisaOcr', () => {
  it('separa por form feed e descarta o pedaco vazio final', () => {
    expect(separarPaginas('um\ftwo\f')).toEqual(['um', 'two']);
    expect(separarPaginas('sem ff')).toEqual(['sem ff']);
  });
  it('pagina com pouco texto vai pro OCR', () => {
    expect(precisaOcr('  \n 12 ')).toBe(true);
    expect(precisaOcr('Lei Municipal numero 1234 que dispoe sobre o plano diretor')).toBe(false);
  });
});

describe('extrairTexto (pdftotext real, se instalado)', async () => {
  const f = await detectarFerramentas();
  it.skipIf(!f.pdftotext)('extrai texto por pagina e marca pagina vazia', async () => {
    const pdf = await gerarPdf(['Lei Municipal 1234 institui o Plano Diretor Participativo do municipio.', '', 'Terceira pagina com contrato de reforma escolar.']);
    const paginas = await extrairTexto(pdf, { ...f, ocr: false });
    expect(paginas).toHaveLength(3);
    expect(paginas[0]?.texto).toContain('Plano Diretor');
    expect(paginas[1]?.texto.trim()).toBe('');
    expect(paginas[2]?.origem).toBe('texto');
  });
  it('sem pdftotext falha claro', async () => {
    await expect(extrairTexto(Buffer.from('%PDF'), { pdftotext: false, ocr: false, idiomaOcr: 'por' })).rejects.toThrow(/pdftotext/);
  });
});
