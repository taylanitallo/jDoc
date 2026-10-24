import { describe, expect, it } from 'vitest';
import { corpoSemCabecalho, lerCabecalho, localizarLei, municipioSlug } from './biblioteca-leis';

describe('municipioSlug', () => {
  it('tira o prefixo do orgao, acentos e espacos', () => {
    expect(municipioSlug('Prefeitura de Iraucuba')).toBe('iraucuba');
    expect(municipioSlug('Irauçuba')).toBe('iraucuba');
    expect(municipioSlug('Prefeitura Municipal de Nova Russas')).toBe('nova-russas');
    expect(municipioSlug('Município de Penaforte')).toBe('penaforte');
    expect(municipioSlug('')).toBeNull();
    expect(municipioSlug(null)).toBeNull();
  });
});

describe('localizarLei', () => {
  it('le esfera, uf, municipio, tipo e ano do caminho', () => {
    expect(localizarLei('constituicao.md')).toMatchObject({ esfera: 'federal', tipo: 'constituicao' });
    expect(localizarLei('federal/leis-ordinarias/2002/lei-10406.md')).toEqual({ esfera: 'federal', uf: null, municipio: null, tipo: 'leis-ordinarias', ano: 2002 });
    expect(localizarLei('estaduais/CE/leis-complementares/2010/x.md')).toEqual({ esfera: 'estadual', uf: 'CE', municipio: null, tipo: 'leis-complementares', ano: 2010 });
    expect(localizarLei('municipais/CE/iraucuba/emendas-lei-organica/2023/x.md')).toEqual({ esfera: 'municipal', uf: 'CE', municipio: 'iraucuba', tipo: 'emendas-lei-organica', ano: 2023 });
  });
  it('ignora o que nao e lei', () => {
    expect(localizarLei('federal/leis-ordinarias/_falhas.jsonl')).toBeNull();
    expect(localizarLei('README.md')).toBeNull();
    expect(localizarLei('estaduais/ce/x/2000/a.md')).toBeNull();
  });
});

describe('lerCabecalho', () => {
  const arq = '---\ntitulo: "Lei nº 10.406 de 10/01/2002"\nuf: "SP"                 # ausente nas federais\nrevogada: false\ndata: 2002-01-10\nementa: "Diz \\"oi\\": ok."\n---\n# Lei\n\nTexto.';
  it('le strings com escape, datas, booleanos e comentarios', () => {
    expect(lerCabecalho(arq)).toEqual({ titulo: 'Lei nº 10.406 de 10/01/2002', uf: 'SP', revogada: false, data: '2002-01-10', ementa: 'Diz "oi": ok.' });
  });
  it('sem cabecalho = null; corpo vem sem ele', () => {
    expect(lerCabecalho('# so texto')).toBeNull();
    expect(corpoSemCabecalho(arq)).toBe('# Lei\n\nTexto.');
  });
});
