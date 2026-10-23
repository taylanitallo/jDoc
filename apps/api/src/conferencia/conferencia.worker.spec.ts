import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { MAX_PAGINAS_IA, erroLegivel, primeirasPaginas, statusHttp, transitorio } from './conferencia.worker';

// Mensagem real que o Gemini devolveu em producao (IA sobrecarregada).
const GEMINI_503 =
  '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}';

describe('erros da conferencia por IA', () => {
  it('reconhece sobrecarga do Gemini pela mensagem JSON', () => {
    const e = new Error(GEMINI_503);
    expect(statusHttp(e)).toBe(503);
    expect(transitorio(e)).toBe(true);
    expect(erroLegivel(e)).toMatch(/^O serviço de IA está sobrecarregado/);
    expect(erroLegivel(e)).not.toContain('{');
  });

  it('usa o campo status dos SDKs (429 do Gemini, 529 do Claude)', () => {
    expect(transitorio(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(transitorio(Object.assign(new Error('overloaded'), { status: 529 }))).toBe(true);
  });

  it('erros definitivos nao sao repetidos e viram texto claro', () => {
    const auth = Object.assign(new Error('API key not valid'), { status: 403 });
    expect(transitorio(auth)).toBe(false);
    expect(erroLegivel(auth)).toBe('A chave de acesso da IA foi recusada. Avise o suporte.');
    expect(transitorio(new Error('Resposta do Gemini sem texto'))).toBe(false);
    expect(erroLegivel(new Error('Resposta do Gemini sem texto'))).toBe('Resposta do Gemini sem texto');
  });
});

describe('recorte do PDF enviado a IA', () => {
  it('manda so as primeiras paginas e nao mexe em PDF curto', async () => {
    const gerar = async (n: number) => {
      const d = await PDFDocument.create();
      for (let i = 0; i < n; i++) d.addPage([200, 200]);
      return Buffer.from(await d.save());
    };
    const longo = await primeirasPaginas(await gerar(22), MAX_PAGINAS_IA);
    expect((await PDFDocument.load(longo)).getPageCount()).toBe(MAX_PAGINAS_IA);
    const curto = await gerar(3);
    expect(await primeirasPaginas(curto, MAX_PAGINAS_IA)).toBe(curto);
    const lixo = Buffer.from('nao e pdf');
    expect(await primeirasPaginas(lixo, MAX_PAGINAS_IA)).toBe(lixo);
  });
});
