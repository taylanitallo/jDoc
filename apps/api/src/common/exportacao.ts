import PDFKitDocument from 'pdfkit';

/** Coluna de uma tabela exportada (PDF e CSV usam a mesma definicao). */
export interface ColunaExport<T> {
  titulo: string;
  /** Largura relativa no PDF (as colunas dividem a largura util da pagina). */
  peso: number;
  valor: (linha: T) => string | number | null | undefined;
  alinhar?: 'left' | 'right' | 'center';
}

const texto = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('pt-BR') : v;

/**
 * CSV no formato que o Excel brasileiro abre direto: BOM UTF-8, separador ';',
 * aspas duplas com escape "". Celulas que comecam com = + - @ ganham apostrofo
 * (evita injecao de formula ao abrir a planilha).
 */
export function gerarCsv<T>(colunas: ReadonlyArray<ColunaExport<T>>, linhas: readonly T[]): Buffer {
  const celula = (v: string | number | null | undefined): string => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = [colunas.map((c) => celula(c.titulo)).join(';'), ...linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(';'))];
  return Buffer.from(`\uFEFF${corpo.join('\r\n')}\r\n`, 'utf8');
}

export interface CabecalhoRelatorio {
  orgao: string;
  titulo: string;
  /** Linhas curtas abaixo do titulo: filtros aplicados, periodo etc. */
  detalhes?: string[];
  emitidoPor?: string | null;
}

/**
 * Relatorio em tabela (A4 paisagem): cabecalho do orgao, filtros aplicados,
 * cabecalho da tabela repetido a cada pagina, zebra e "Pagina X de Y".
 * `secoes` permite varias tabelas no mesmo documento (ex.: quantitativos).
 */
export function gerarPdfTabela<T>(
  cab: CabecalhoRelatorio,
  secoes: ReadonlyArray<{ subtitulo?: string; colunas: ReadonlyArray<ColunaExport<T>>; linhas: readonly T[]; rodape?: string }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    try {
      const esq = doc.page.margins.left;
      const util = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const fundo = () => doc.page.height - doc.page.margins.bottom - 18;

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(cab.orgao.toUpperCase(), { align: 'center' });
      doc.moveDown(0.2).fontSize(14).text(cab.titulo, { align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor('#475569');
      for (const d of cab.detalhes ?? []) doc.text(d, { align: 'center' });
      doc.text(
        `Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}${cab.emitidoPor ? ` por ${cab.emitidoPor}` : ''}`,
        { align: 'center' },
      );
      doc.moveDown(0.8);

      for (const secao of secoes) {
        const somaPesos = secao.colunas.reduce((s, c) => s + c.peso, 0);
        const larguras = secao.colunas.map((c) => (c.peso / somaPesos) * util);
        const xs = larguras.map((_, i) => esq + larguras.slice(0, i).reduce((s, w) => s + w, 0));

        const cabecalhoTabela = () => {
          const y = doc.y;
          doc.font('Helvetica-Bold').fontSize(7.5);
          // Titulo longo quebra em mais linhas: a faixa cresce junto (nao invade a 1a linha).
          const altura = Math.max(...secao.colunas.map((c, i) => doc.heightOfString(c.titulo.toUpperCase(), { width: larguras[i]! - 6 }))) + 6;
          doc.rect(esq, y - 2, util, altura).fill('#e2e8f0');
          doc.fillColor('#0f172a');
          secao.colunas.forEach((c, i) => doc.text(c.titulo.toUpperCase(), xs[i]! + 3, y + 1, { width: larguras[i]! - 6, align: c.alinhar ?? 'left' }));
          doc.y = y + altura + 1;
          doc.font('Helvetica').fontSize(8).fillColor('#1e293b');
        };

        if (secao.subtitulo) {
          if (doc.y > fundo() - 60) doc.addPage();
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(secao.subtitulo, esq, doc.y);
          doc.moveDown(0.3);
        }
        if (doc.y > fundo() - 40) doc.addPage();
        cabecalhoTabela();

        secao.linhas.forEach((linha, n) => {
          const valores = secao.colunas.map((c) => texto(c.valor(linha)));
          const altura = Math.max(10, ...valores.map((v, i) => doc.heightOfString(v, { width: larguras[i]! - 6 }))) + 5;
          if (doc.y + altura > fundo()) {
            doc.addPage();
            cabecalhoTabela();
          }
          const y = doc.y;
          if (n % 2 === 1) doc.rect(esq, y - 1, util, altura).fill('#f8fafc').fillColor('#1e293b');
          valores.forEach((v, i) => doc.text(v, xs[i]! + 3, y + 1, { width: larguras[i]! - 6, align: secao.colunas[i]!.alinhar ?? 'left' }));
          doc.y = y + altura;
        });
        if (secao.linhas.length === 0) {
          doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b').text('Nenhum registro.', esq, doc.y + 2);
          doc.moveDown(0.5);
        }
        if (secao.rodape) {
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a').text(secao.rodape, esq, doc.y + 4);
        }
        doc.moveDown(1.2);
      }

      // Numeracao "Pagina X de Y" em todas as paginas.
      const faixa = doc.bufferedPageRange();
      for (let i = 0; i < faixa.count; i++) {
        doc.switchToPage(faixa.start + i);
        // Abaixo da margem: sem zerar a margem o pdfkit abriria uma pagina nova.
        const margemInferior = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const yRodape = doc.page.height - margemInferior + 6;
        doc.font('Helvetica').fontSize(7).fillColor('#64748b');
        doc.text(`${cab.titulo} — Página ${i + 1} de ${faixa.count}`, esq, yRodape, { width: util, align: 'right', lineBreak: false });
        doc.page.margins.bottom = margemInferior;
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
