import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Pagina com menos que isso de texto util e tratada como imagem (escaneada) e vai pro OCR. */
export const MIN_CHARS_TEXTO = 25;
/** Teto de paginas OCR por arquivo — protege CPU do worker contra PDFs gigantes. */
export const MAX_PAGINAS_OCR = 300;
const TIMEOUT_TEXTO_MS = 120_000;
const TIMEOUT_PAGINA_MS = 90_000;
const MAX_BUFFER = 64 * 1024 * 1024;

export interface PaginaExtraida {
  pagina: number;
  texto: string;
  origem: 'texto' | 'ocr';
}

export interface Ferramentas {
  pdftotext: boolean;
  ocr: boolean;
  idiomaOcr: string;
}

async function existe(cmd: string, args: string[]): Promise<string | null> {
  try {
    const r = await run(cmd, args, { timeout: 10_000 });
    return `${r.stdout}\n${r.stderr}`;
  } catch (e) {
    // -v de algumas ferramentas sai com codigo != 0 mas imprime a versao.
    const err = e as { code?: string; stdout?: string; stderr?: string };
    if (err.code === 'ENOENT') return null;
    return `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
  }
}

/** Descobre o que o ambiente tem instalado (poppler-utils / tesseract-ocr). */
export async function detectarFerramentas(): Promise<Ferramentas> {
  const [pdftotext, pdftoppm, tesseract] = await Promise.all([
    existe('pdftotext', ['-v']),
    existe('pdftoppm', ['-v']),
    existe('tesseract', ['--list-langs']),
  ]);
  const langs = tesseract ?? '';
  const idiomaOcr = /\bpor\b/.test(langs) ? 'por' : 'eng';
  return { pdftotext: pdftotext !== null, ocr: pdftoppm !== null && tesseract !== null, idiomaOcr };
}

/** pdftotext separa paginas com \f; o ultimo pedaco (apos o \f final) e vazio. */
export function separarPaginas(saida: string): string[] {
  const partes = saida.split('\f');
  if (partes.length > 1 && partes.at(-1)!.trim() === '') partes.pop();
  return partes;
}

export function precisaOcr(texto: string): boolean {
  return texto.replace(/\s+/g, '').length < MIN_CHARS_TEXTO;
}

/**
 * Extrai o texto de cada pagina. Usa a camada de texto do PDF; paginas sem
 * texto (escaneadas) passam por OCR (pdftoppm -> tesseract) se disponivel.
 * Tudo roda em diretorio temporario proprio, removido ao final. Nomes de
 * arquivo sao fixos (nunca vem do usuario) e os binarios sao chamados via
 * execFile (sem shell).
 */
export async function extrairTexto(pdf: Buffer, f: Ferramentas): Promise<PaginaExtraida[]> {
  if (!f.pdftotext) throw new Error('pdftotext indisponivel');
  const dir = await mkdtemp(join(tmpdir(), 'jdoc-ocr-'));
  try {
    const entrada = join(dir, 'in.pdf');
    await writeFile(entrada, pdf);
    const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', entrada, '-'], {
      timeout: TIMEOUT_TEXTO_MS,
      maxBuffer: MAX_BUFFER,
    });
    const paginas = separarPaginas(stdout);
    const out: PaginaExtraida[] = [];
    let ocrFeitas = 0;
    for (let i = 0; i < paginas.length; i++) {
      const numero = i + 1;
      const texto = paginas[i] ?? '';
      if (!precisaOcr(texto) || !f.ocr || ocrFeitas >= MAX_PAGINAS_OCR) {
        out.push({ pagina: numero, texto, origem: 'texto' });
        continue;
      }
      ocrFeitas++;
      const prefixo = join(dir, `p${numero}`);
      await run('pdftoppm', ['-r', '200', '-gray', '-png', '-singlefile', '-f', String(numero), '-l', String(numero), entrada, prefixo], {
        timeout: TIMEOUT_PAGINA_MS,
      });
      const r = await run('tesseract', [`${prefixo}.png`, 'stdout', '-l', f.idiomaOcr], {
        timeout: TIMEOUT_PAGINA_MS,
        maxBuffer: MAX_BUFFER,
      });
      await rm(`${prefixo}.png`, { force: true });
      out.push({ pagina: numero, texto: r.stdout, origem: 'ocr' });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
