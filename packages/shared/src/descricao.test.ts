import { describe, expect, it } from 'vitest';
import { codigoReferencia, datasLimite, faltantesNobrade, nivelFilhoPermitido, ELEMENTOS_NOBRADE, unidadeDescricaoCreateSchema } from './descricao.js';

const base = { codigo: 'SAU', titulo: 'Secretaria de Saúde', datas: '1950-2020', nivel: 'fundo' as const, dimensaoSuporte: '40 caixas', produtor: 'Secretaria Municipal de Saúde', condicoesAcesso: 'Livre' };

describe('NOBRADE', () => {
  it('tem 28 elementos em 8 areas', () => {
    expect(ELEMENTOS_NOBRADE).toHaveLength(28);
    expect(new Set(ELEMENTOS_NOBRADE.map((e) => e.area)).size).toBe(8);
  });

  it('aponta obrigatorios ausentes', () => {
    expect(faltantesNobrade(base)).toEqual([]);
    expect(faltantesNobrade({ ...base, datas: '', dimensaoSuporte: null })).toEqual(['1.3', '1.5']);
  });

  it('condicoes de acesso so obrigatorias nos niveis 0 e 1', () => {
    expect(faltantesNobrade({ ...base, condicoesAcesso: null })).toEqual(['4.1']);
    expect(faltantesNobrade({ ...base, nivel: 'serie', condicoesAcesso: null })).toEqual([]);
  });

  it('produtor pode ser herdado do nivel superior', () => {
    expect(faltantesNobrade({ ...base, nivel: 'serie', produtor: null })).toEqual(['2.1']);
    expect(faltantesNobrade({ ...base, nivel: 'serie', produtor: null }, true)).toEqual([]);
  });

  it('monta o codigo de referencia', () => {
    expect(codigoReferencia([{ nivel: 'acervo', codigo: 'BR SPPMX' }, { nivel: 'fundo', codigo: 'SAU' }, { nivel: 'serie', codigo: '01' }])).toBe('BR SPPMX SAU.01');
    expect(codigoReferencia([{ nivel: 'acervo', codigo: 'BR SPPMX' }])).toBe('BR SPPMX');
    expect(codigoReferencia([{ nivel: 'fundo', codigo: 'SAU' }, { nivel: 'serie', codigo: '01' }])).toBe('SAU.01');
  });

  it('respeita a hierarquia dos niveis', () => {
    expect(nivelFilhoPermitido(null, 'fundo')).toBe(true);
    expect(nivelFilhoPermitido(null, 'serie')).toBe(false);
    expect(nivelFilhoPermitido('fundo', 'serie')).toBe(true);
    expect(nivelFilhoPermitido('serie', 'fundo')).toBe(false);
    expect(nivelFilhoPermitido('subserie', 'subserie')).toBe(true);
    expect(nivelFilhoPermitido('item', 'item')).toBe(false);
  });

  it('datas-limite', () => {
    expect(datasLimite(1950, 1990)).toBe('1950-1990');
    expect(datasLimite(2001, 2001)).toBe('2001');
    expect(datasLimite(null, null)).toBeNull();
  });

  it('valida codigo e elementos desconhecidos', () => {
    expect(unidadeDescricaoCreateSchema.safeParse({ nivel: 'fundo', codigo: 'SAU', titulo: 'Saúde' }).success).toBe(true);
    expect(unidadeDescricaoCreateSchema.safeParse({ nivel: 'fundo', codigo: 'SAU;DROP', titulo: 'Saúde' }).success).toBe(false);
    expect(unidadeDescricaoCreateSchema.safeParse({ nivel: 'fundo', codigo: 'SAU', titulo: 'Saúde', elementos: { foo: 'x' } }).success).toBe(false);
  });
});
