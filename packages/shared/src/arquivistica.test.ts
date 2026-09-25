import { describe, it, expect } from 'vitest';
import {
  calcularPrazos,
  classificacaoSchema,
  nivelDoCodigo,
  situacaoTemporalidade,
  somarAnos,
} from './arquivistica.js';

const classe = {
  prazoCorrenteAnos: 5,
  prazoIntermediarioAnos: 5,
  destinacao: 'eliminacao' as const,
  eventoContagem: 'data_documento' as const,
};

describe('somarAnos', () => {
  it('soma anos simples', () => {
    expect(somarAnos('2020-03-15', 5)).toBe('2025-03-15');
  });
  it('29/02 em ano nao bissexto vira 28/02', () => {
    expect(somarAnos('2024-02-29', 1)).toBe('2025-02-28');
    expect(somarAnos('2024-02-29', 4)).toBe('2028-02-29');
  });
  it('rejeita data invalida', () => {
    expect(() => somarAnos('15/03/2020', 1)).toThrow();
  });
});

describe('calcularPrazos', () => {
  it('conta a partir da data do documento', () => {
    expect(calcularPrazos(classe, { documentDate: '2020-06-10', exercicio: 2020 })).toEqual({
      dataInicioContagem: '2020-06-10',
      dataPrevistaTransferencia: '2025-06-10',
      dataPrevistaDestinacao: '2030-06-10',
    });
  });

  it('fim_exercicio usa 31/12 do exercicio', () => {
    const r = calcularPrazos(
      { ...classe, eventoContagem: 'fim_exercicio' },
      { documentDate: '2020-06-10', exercicio: 2020 },
    );
    expect(r.dataInicioContagem).toBe('2020-12-31');
    expect(r.dataPrevistaDestinacao).toBe('2030-12-31');
  });

  it('data_documento sem data cai para fim do exercicio', () => {
    expect(calcularPrazos(classe, { documentDate: null, exercicio: 2021 }).dataInicioContagem).toBe(
      '2021-12-31',
    );
  });

  it('manual sem data de inicio deixa prazos pendentes', () => {
    const r = calcularPrazos({ ...classe, eventoContagem: 'manual' }, { documentDate: '2020-01-01', exercicio: 2020 });
    expect(r.dataPrevistaDestinacao).toBeNull();
  });

  it('manual com data de inicio calcula', () => {
    const r = calcularPrazos(
      { ...classe, eventoContagem: 'manual' },
      { documentDate: '2020-01-01', exercicio: 2020, dataInicioManual: '2022-08-01' },
    );
    expect(r.dataPrevistaTransferencia).toBe('2027-08-01');
  });

  it('classe agrupadora (sem TTD) nao calcula', () => {
    const r = calcularPrazos(
      { ...classe, prazoCorrenteAnos: null },
      { documentDate: '2020-01-01', exercicio: 2020 },
    );
    expect(r).toEqual({ dataInicioContagem: null, dataPrevistaTransferencia: null, dataPrevistaDestinacao: null });
  });

  it('prazo corrente zero transfere no mesmo dia', () => {
    const r = calcularPrazos({ ...classe, prazoCorrenteAnos: 0 }, { documentDate: '2020-01-01', exercicio: 2020 });
    expect(r.dataPrevistaTransferencia).toBe('2020-01-01');
  });
});

describe('situacaoTemporalidade', () => {
  const base = {
    fase: 'corrente' as const,
    classificacaoId: '00000000-0000-4000-8000-000000000000',
    destinacao: 'eliminacao' as const,
    dataPrevistaTransferencia: '2025-01-01',
    dataPrevistaDestinacao: '2030-01-01',
  };

  it('em prazo', () => {
    expect(situacaoTemporalidade(base, '2024-12-31')).toBe('em_prazo');
  });
  it('a transferir no dia do vencimento', () => {
    expect(situacaoTemporalidade(base, '2025-01-01')).toBe('a_transferir');
  });
  it('intermediaria nao volta pra a_transferir', () => {
    expect(situacaoTemporalidade({ ...base, fase: 'intermediaria' }, '2026-01-01')).toBe('em_prazo');
  });
  it('a eliminar / a recolher conforme destinacao', () => {
    expect(situacaoTemporalidade(base, '2030-01-01')).toBe('a_eliminar');
    expect(situacaoTemporalidade({ ...base, destinacao: 'guarda_permanente' }, '2030-01-01')).toBe('a_recolher');
  });
  it('sem classificacao e permanente', () => {
    expect(situacaoTemporalidade({ ...base, classificacaoId: null }, '2030-01-01')).toBe('sem_classificacao');
    expect(situacaoTemporalidade({ ...base, fase: 'permanente' }, '2090-01-01')).toBe('permanente');
  });
});

describe('classificacaoSchema', () => {
  it('aceita codigo CONARQ', () => {
    expect(classificacaoSchema.parse({ codigo: '052.21', descricao: 'Despesa' }).codigo).toBe('052.21');
  });
  it('rejeita codigo com letras/injecao', () => {
    expect(() => classificacaoSchema.parse({ codigo: "052'; --", descricao: 'x' })).toThrow();
    expect(() => classificacaoSchema.parse({ codigo: '052..1', descricao: 'x' })).toThrow();
  });
  it('nivel pelo codigo', () => {
    expect(nivelDoCodigo('050')).toBe(1);
    expect(nivelDoCodigo('052.21')).toBe(2);
    expect(nivelDoCodigo('052.2.1')).toBe(3);
  });
});

describe('modelo de classificacao', () => {
  it('codigos do modelo sao validos e unicos, e todo nao-raiz tem pai', async () => {
    const { MODELO_CLASSIFICACAO, codigoPai } = await import('./arquivistica-modelo.js');
    const codigos = new Set(MODELO_CLASSIFICACAO.map((c) => c.codigo));
    expect(codigos.size).toBe(MODELO_CLASSIFICACAO.length);
    for (const c of MODELO_CLASSIFICACAO) {
      expect(classificacaoSchema.parse(c).codigo).toBe(c.codigo);
      if (c.codigo !== '000' && c.codigo !== '100') expect(codigoPai(c.codigo, codigos)).not.toBeNull();
    }
  });
  it('codigoPai sobe digito, depois dezena/centena', async () => {
    const { codigoPai } = await import('./arquivistica-modelo.js');
    const ex = new Set(['000', '050', '052', '052.2']);
    expect(codigoPai('052.21', ex)).toBe('052.2');
    expect(codigoPai('052.1', ex)).toBe('052');
    expect(codigoPai('052', ex)).toBe('050');
    expect(codigoPai('050', ex)).toBe('000');
    expect(codigoPai('000', ex)).toBeNull();
  });
});
