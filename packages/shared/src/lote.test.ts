import { describe, expect, it } from 'vitest';
import { dataParaIso, lerCsv, modeloCsvLote, montarLote, normalizarCabecalho, validarItemLote } from './lote';
import type { CampoMetadado } from './metadados';

const CAMPOS: CampoMetadado[] = [
  { chave: 'numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true },
  { chave: 'data_publicacao', rotulo: 'Data de publicação', tipo: 'data', obrigatorio: false },
  { chave: 'especie', rotulo: 'Espécie', tipo: 'selecao', obrigatorio: false, opcoes: ['Ordinária', 'Complementar'] },
];

describe('lerCsv', () => {
  it('detecta ; e , e TAB, trata aspas, aspas escapadas, quebra dentro de aspas, BOM e CRLF', () => {
    expect(lerCsv('\uFEFFa;b\r\n1;"x;y"\r\n')).toEqual([['a', 'b'], ['1', 'x;y']]);
    expect(lerCsv('a,b\n"diz ""oi""",2')).toEqual([['a', 'b'], ['diz "oi"', '2']]);
    expect(lerCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(lerCsv('a;b\n"linha1\nlinha2";z\n\n;\n')).toEqual([['a', 'b'], ['linha1\nlinha2', 'z']]);
  });
});

describe('datas e cabecalhos', () => {
  it('converte formatos brasileiros e rejeita datas impossiveis', () => {
    expect(dataParaIso('15/04/2019')).toBe('2019-04-15');
    expect(dataParaIso('5/4/1962')).toBe('1962-04-05');
    expect(dataParaIso('2019-04-15')).toBe('2019-04-15');
    expect(dataParaIso('31/02/2020')).toBeNull();
    expect(dataParaIso('abril')).toBeNull();
    expect(normalizarCabecalho(' Data de Publicação ')).toBe('data_de_publicacao');
  });
});

describe('montarLote', () => {
  const csv = [
    'Arquivo;Descrição;Data;Número;Data de publicação;especie;Observação',
    'LEI-1234.PDF;Plano Diretor;15/04/2019;1.234;20/04/2019;Complementar;x',
    'lei 999.pdf;Sem PDF;01/01/2020;999;;;',
  ].join('\n');

  it('casa linha e PDF pelo nome (sem extensao, acento ou maiuscula) e converte datas', () => {
    const r = montarLote(['lei-1234.pdf', 'decreto_45.pdf'], csv, CAMPOS, { dataDocumento: '2020-01-01' });
    expect(r.itens[0]).toEqual({
      arquivo: 'lei-1234.pdf',
      descricao: 'Plano Diretor',
      dataDocumento: '2019-04-15',
      metadados: { numero: '1.234', data_publicacao: '2019-04-20', especie: 'Complementar' },
    });
    // PDF sem linha: descricao do nome do arquivo e data padrao
    expect(r.itens[1]).toMatchObject({ descricao: 'decreto 45', dataDocumento: '2020-01-01', metadados: {} });
    expect(r.avisos).toContain('Coluna "Observação" não pertence a este tipo documental e foi ignorada.');
    expect(r.avisos).toContain('Linha 3: nenhum PDF selecionado com esse nome.');
  });

  it('sem coluna arquivo avisa; sem planilha usa so os padroes', () => {
    expect(montarLote(['a.pdf'], 'descricao;data\nx;01/01/2020', CAMPOS).avisos[0]).toMatch(/coluna "arquivo"/);
    expect(montarLote(['a.pdf'], null, CAMPOS).itens[0]).toMatchObject({ descricao: 'a', dataDocumento: '' });
  });
});

describe('validarItemLote', () => {
  const ok = { arquivo: 'a.pdf', descricao: 'Lei', dataDocumento: '1962-08-20', metadados: { numero: '12' } };
  it('aceita item valido (inclusive ano historico)', () => {
    expect(validarItemLote(ok, CAMPOS)).toEqual([]);
  });
  it('aponta cada problema', () => {
    expect(validarItemLote({ ...ok, arquivo: 'a.docx' }, CAMPOS)).toContain('Somente arquivos PDF');
    expect(validarItemLote({ ...ok, dataDocumento: '' }, CAMPOS)).toContain('Data do documento inválida ou ausente');
    expect(validarItemLote({ ...ok, dataDocumento: '1700-01-01' }, CAMPOS)).toContain('Ano fora do intervalo aceito (1800 a 2100)');
    expect(validarItemLote({ ...ok, metadados: {} }, CAMPOS).join()).toMatch(/Número é obrigatório/);
    expect(validarItemLote({ ...ok, metadados: { numero: '1', especie: 'Inventada' } }, CAMPOS).join()).toMatch(/opção inválida/);
  });
});

describe('modeloCsvLote', () => {
  it('gera cabecalho com os campos do tipo e abre no Excel (BOM + ;)', () => {
    const m = modeloCsvLote(CAMPOS);
    expect(m.charCodeAt(0)).toBe(0xfeff);
    expect(m.slice(1).split('\r\n')[0]).toBe('arquivo;descricao;data_documento;numero;data_publicacao;especie');
    // o proprio modelo e lido de volta sem avisos
    expect(montarLote(['lei-1234.pdf'], m, CAMPOS).avisos).toEqual([]);
  });
});
