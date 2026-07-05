import { describe, expect, it } from 'vitest';
import { detectFormat, parseASPEC, parseJBS, parseLabels, parseSS } from './index.js';
import { parseValorBR, parseDataBR } from './types.js';

const SS_VALID = [
  'DOC_CAIXA;EMPENHO;CREDOR;VALOR;DATA;HISTORICO',
  '000123;2026NE00045;Fornecedor Alfa LTDA;1.234,56;10/05/2026;Compra de material',
  '000124;2026NE00046;Beta Servicos ME;89,90;11/05/2026;',
].join('\n');

const JBS_VALID = [
  'EMPENHO|DATA|CREDOR|VALOR|DOC_CAIXA|HISTORICO',
  '2026NE00045|2026-05-10|Fornecedor Alfa LTDA|1234.56|000123|Compra de material',
  '2026NE00046|2026-05-11|Beta Servicos ME||000124|Sem valor',
].join('\n');

const ASPEC_VALID = [
  'Gov. Munic. de Irauçuba ─ Exerc 2026 ─ CMI',
  'CLASSIFICAÇÃO: 01 01. 01 031 0001 2.001 3.3.90.30.00',
  'DOCUM. CAIXA.: 05050005   EMPENHO: 15040018',
  'CREDOR.......: POSTO DE COMBUSTÍVEIS IRAUÇUBA LTDA',
  '    Fonte....: CÂMARA       Ch: 023564    Vl............2.842,37',
  'DATA PAGTO...: 05/05/2026    VALOR PAGTO.............R$ 2.842,37',
  '',
  '',
  'Gov. Munic. de Irauçuba ─ Exerc 2026 ─ CMI',
  'CLASSIFICAÇÃO: 01 01. 01 031 0001 2.001 3.3.90.39.00',
  'DOCUM. CAIXA.: 05050006   EMPENHO: 11020071 SUBEMPENHO: 05050004',
  'CREDOR.......: V B CONSULTORIA LTDA',
  '    Fonte....: CÂMARA       Ch: 044365    Vl............5.073,00',
  'DATA PAGTO...: 05/05/2026    VALOR PAGTO.............R$ 5.073,00',
].join('\n');

describe('helpers', () => {
  it('parseValorBR: brasileiro, americano, vazio, lixo', () => {
    expect(parseValorBR('1.234,56')).toBe(1234.56);
    expect(parseValorBR('89,90')).toBe(89.9);
    expect(parseValorBR('1234.56')).toBe(1234.56);
    expect(parseValorBR('')).toBeNull();
    expect(parseValorBR('abc')).toBeNaN();
    expect(parseValorBR('-5,00')).toBeNaN(); // negativo invalido
  });

  it('parseDataBR valida datas reais', () => {
    expect(parseDataBR('10/05/2026')).toBe('2026-05-10');
    expect(parseDataBR('31/02/2026')).toBeNull();
    expect(parseDataBR('2026-05-10')).toBeNull();
  });
});

describe('parser SS (csv ;)', () => {
  it('linhas validas com cabecalho ignorado', () => {
    const r = parseSS(SS_VALID, 'despesas');
    expect(r.records).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
    expect(r.records[0]).toMatchObject({
      module: 'despesas',
      docCaixa: '000123',
      empenho: '2026NE00045',
      credor: 'Fornecedor Alfa LTDA',
      valor: 1234.56,
      data: '2026-05-10',
      historico: 'Compra de material',
    });
    expect(r.records[1]?.historico).toBeNull();
  });

  it('linhas com erro reportadas com numero da linha', () => {
    const content = [
      '000123;2026NE00045;Fornecedor;10,00;10/05/2026;ok',
      ';2026NE00046;Sem Doc;5,00;11/05/2026;',
      '000125;2026NE00047;Data Ruim;5,00;99/99/2026;',
      'colunas;demenos',
    ].join('\n');
    const r = parseSS(content, 'despesas');
    expect(r.records).toHaveLength(1);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toMatchObject({ line: 2 });
    expect(r.errors[0]?.message).toContain('DOC_CAIXA vazio');
    expect(r.errors[1]?.message).toContain('DATA invalida');
    expect(r.errors[2]?.message).toContain('colunas');
  });

  it('arquivo vazio = zero registros, zero erros', () => {
    const r = parseSS('', 'despesas');
    expect(r.records).toHaveLength(0);
    expect(r.errors).toHaveLength(0);
    expect(r.totalLines).toBe(0);
  });
});

describe('parser ASPEC (etiquetas em bloco)', () => {
  it('blocos validos', () => {
    const r = parseASPEC(ASPEC_VALID, 'despesas');
    expect(r.records).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
    expect(r.totalLines).toBe(2);
    expect(r.records[0]).toMatchObject({
      docCaixa: '05050005',
      empenho: '15040018',
      credor: 'POSTO DE COMBUSTÍVEIS IRAUÇUBA LTDA',
      valor: 2842.37,
      data: '2026-05-05',
    });
    // classificacao e unidade vao para o historico
    expect(r.records[0]?.historico).toContain('Unid: CMI');
    // subempenho do segundo bloco preservado no historico
    expect(r.records[1]?.empenho).toBe('11020071');
    expect(r.records[1]?.historico).toContain('Subempenho: 05050004');
  });

  it('um cabecalho "Gov. Munic." cobrindo varios documentos de caixa', () => {
    // O cabecalho e a classificacao sao impressos por pagina; cada DOCUM. CAIXA
    // deve virar um registro proprio (mesmo sem repetir o cabecalho).
    const conteudo = [
      'Gov. Munic. de Irauçuba ─ Exerc 2026 ─ FME',
      'CLASSIFICAÇÃO: 06 04. 12 364 0005 2.042 3.3.90.46.00',
      'DOCUM. CAIXA.: 08050009   EMPENHO: 09020021',
      'CREDOR.......: FRANCISCO JACKSON GOMES MATOS',
      '    Fonte....: F.M.E                      Vl..............165,00',
      'DATA PAGTO...: 08/05/2026    VALOR PAGTO...............R$ 165,00',
      'CLASSIFICAÇÃO: 06 04. 12 364 0005 2.042 3.3.90.46.00',
      'DOCUM. CAIXA.: 08050010   EMPENHO: 09020025',
      'CREDOR.......: FRANCISCO RILDO BASTOS',
      '    Fonte....: F.M.E                      Vl..............187,00',
      'DATA PAGTO...: 08/05/2026    VALOR PAGTO...............R$ 187,00',
    ].join('\n');
    const r = parseASPEC(conteudo, 'despesas');
    expect(r.totalLines).toBe(2);
    expect(r.records).toHaveLength(2);
    expect(r.records[0]?.docCaixa).toBe('08050009');
    expect(r.records[0]?.valor).toBe(165);
    expect(r.records[1]?.docCaixa).toBe('08050010');
    expect(r.records[1]?.valor).toBe(187);
    expect(r.records[1]?.historico).toContain('Unid: FME');
  });

  it('bloco incompleto rejeitado com motivo', () => {
    const bloco = [
      'Gov. Munic. de Irauçuba ─ Exerc 2026 ─ CMI',
      'CLASSIFICAÇÃO: 01 01. 01 031 0001 2.001 3.3.90.30.00',
      'DOCUM. CAIXA.: 05050005   EMPENHO: 15040018',
      'CREDOR.......: FORNECEDOR SEM PAGAMENTO',
    ].join('\n');
    const r = parseASPEC(bloco, 'despesas');
    expect(r.records).toHaveLength(0);
    expect(r.errors[0]?.message).toContain('VALOR PAGTO ausente');
    expect(r.errors[0]?.message).toContain('DATA PAGTO invalida');
  });
});

describe('parser JBS (csv |)', () => {
  it('linhas validas; valor vazio vira null', () => {
    const r = parseJBS(JBS_VALID, 'receitas');
    expect(r.records).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
    expect(r.records[0]?.module).toBe('receitas');
    expect(r.records[1]?.valor).toBeNull();
  });

  it('data em formato errado reportada', () => {
    const r = parseJBS('2026NE1|10/05/2026|Credor X|5.00|0001|', 'despesas');
    expect(r.errors[0]?.message).toContain('DATA invalida');
  });
});

describe('detectFormat + parseLabels', () => {
  it('detecta JBS, SS e ASPEC', () => {
    expect(detectFormat(JBS_VALID)).toBe('JBS');
    expect(detectFormat(SS_VALID)).toBe('SS');
    expect(detectFormat(ASPEC_VALID)).toBe('ASPEC');
  });

  it('formato irreconhecivel = null (sem crash)', () => {
    expect(detectFormat('so texto curto')).toBeNull();
    expect(parseLabels('so texto curto', 'despesas')).toBeNull();
  });

  it('arquivo vazio = null', () => {
    expect(detectFormat('')).toBeNull();
  });

  it('parseLabels com formato explicito ignora deteccao', () => {
    const r = parseLabels(SS_VALID, 'despesas', 'SS');
    expect(r?.format).toBe('SS');
    expect(r?.records).toHaveLength(2);
  });
});
