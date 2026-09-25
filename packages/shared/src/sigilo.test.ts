import { describe, expect, it } from 'vitest';
import { classificarSigiloSchema, fundamentoSigilo, prazoFimSigilo } from './sigilo';

describe('prazoFimSigilo', () => {
  it('soma o prazo do grau a data de producao', () => {
    expect(prazoFimSigilo('2020-03-10', 'reservado')).toBe('2025-03-10');
    expect(prazoFimSigilo('2020-03-10', 'secreto')).toBe('2035-03-10');
    expect(prazoFimSigilo('2020-03-10', 'ultrassecreto')).toBe('2045-03-10');
    expect(prazoFimSigilo('1950-01-01', 'pessoal')).toBe('2050-01-01');
  });
  it('29 de fevereiro vai para 28/02 em ano nao bissexto', () => {
    expect(prazoFimSigilo('2020-02-29', 'reservado')).toBe('2025-02-28');
  });
  it('recusa data invalida', () => {
    expect(() => prazoFimSigilo('10/03/2020', 'reservado')).toThrow();
  });
});

describe('classificarSigiloSchema', () => {
  const base = {
    grau: 'reservado' as const,
    hipotese: 'art23_VIII' as const,
    razoes: 'Fiscalização tributária em andamento sobre o contribuinte citado',
    autoridadeNome: 'João Prefeito',
    autoridadeCargo: 'Prefeito Municipal',
  };
  it('aceita classificacao completa', () => {
    expect(classificarSigiloSchema.safeParse(base).success).toBe(true);
  });
  it('informacao pessoal exige art. 31 e vice-versa', () => {
    expect(classificarSigiloSchema.safeParse({ ...base, grau: 'pessoal' }).success).toBe(false);
    expect(classificarSigiloSchema.safeParse({ ...base, hipotese: 'art31' }).success).toBe(false);
    expect(classificarSigiloSchema.safeParse({ ...base, grau: 'pessoal', hipotese: 'art31' }).success).toBe(true);
  });
  it('razoes genericas demais sao recusadas', () => {
    expect(classificarSigiloSchema.safeParse({ ...base, razoes: 'sigiloso' }).success).toBe(false);
  });
  it('monta o fundamento legal', () => {
    expect(fundamentoSigilo('art31', 'Dados médicos')).toMatch(/^Art\. 31 — informação pessoal.*\. Dados médicos$/);
  });
});
