import { describe, it, expect } from 'vitest';
import { dataLiberacaoEliminacao, eliminacaoAprovarSchema, fraseConfirmacaoEliminacao } from './eliminacao.js';

describe('eliminacao', () => {
  it('libera apos publicacao + prazo (virada de mes/ano)', () => {
    expect(dataLiberacaoEliminacao('2026-01-10', 45)).toBe('2026-02-24');
    expect(dataLiberacaoEliminacao('2026-12-01', 45)).toBe('2027-01-15');
    expect(dataLiberacaoEliminacao(null, 45)).toBeNull();
  });
  it('frase de confirmacao com numero de 3 digitos', () => {
    expect(fraseConfirmacaoEliminacao(3, 2026)).toBe('ELIMINAR 003/2026');
  });
  it('CPAD precisa de ao menos 2 membros e ata', () => {
    const m = { nome: 'Ana Souza', cargo: 'Arquivista' };
    expect(eliminacaoAprovarSchema.safeParse({ ataAprovacao: '12/2026', dataAprovacao: '2026-09-01', comissao: [m] }).success).toBe(false);
    expect(eliminacaoAprovarSchema.safeParse({ ataAprovacao: '12/2026', dataAprovacao: '2026-09-01', comissao: [m, m] }).success).toBe(true);
  });
});
