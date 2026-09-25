import { describe, it, expect } from 'vitest';
import { caminhoLocal, emprestimoCreateSchema, localFisicoSchema, podeConter } from './arquivo-fisico.js';

describe('arquivo fisico', () => {
  it('hierarquia: caixa cabe em prateleira, predio nao cabe em caixa', () => {
    expect(podeConter('prateleira', 'caixa')).toBe(true);
    expect(podeConter('sala', 'caixa')).toBe(true);
    expect(podeConter('caixa', 'predio')).toBe(false);
    expect(podeConter('caixa', 'caixa')).toBe(false);
    expect(podeConter(null, 'caixa')).toBe(true);
  });
  it('caminho legivel e resistente a ciclo', () => {
    const locais = [
      { id: 'p', parentId: null, tipo: 'predio' as const, codigo: 'Sede' },
      { id: 's', parentId: 'p', tipo: 'sala' as const, codigo: '2' },
      { id: 'c', parentId: 's', tipo: 'caixa' as const, codigo: 'CX-12' },
      { id: 'x', parentId: 'y', tipo: 'caixa' as const, codigo: 'X' },
      { id: 'y', parentId: 'x', tipo: 'caixa' as const, codigo: 'Y' },
    ];
    expect(caminhoLocal('c', locais)).toBe('Prédio Sede › Sala 2 › Caixa CX-12');
    expect(caminhoLocal('x', locais)).toBe('Caixa Y › Caixa X');
  });
  it('codigo do local recusa caracteres estranhos', () => {
    expect(localFisicoSchema.safeParse({ tipo: 'caixa', codigo: 'CX-001/2024' }).success).toBe(true);
    expect(localFisicoSchema.safeParse({ tipo: 'caixa', codigo: '<script>' }).success).toBe(false);
  });
  it('emprestimo exige documento OU caixa', () => {
    const base = { solicitanteNome: 'Maria', solicitanteSetor: 'Contabilidade', prazoDevolucao: '2026-10-01' };
    expect(emprestimoCreateSchema.safeParse(base).success).toBe(false);
    expect(emprestimoCreateSchema.safeParse({ ...base, documentId: '00000000-0000-4000-8000-000000000000' }).success).toBe(true);
    expect(
      emprestimoCreateSchema.safeParse({
        ...base,
        documentId: '00000000-0000-4000-8000-000000000000',
        localFisicoId: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});
