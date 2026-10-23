import { describe, expect, it } from 'vitest';
import { MANUAL, buscarNoManual } from './manual.js';
import { calcularLinha } from './medicao.js';

describe('manual', () => {
  it('ids unicos e todo topico com passos', () => {
    expect(new Set(MANUAL.map((t) => t.id)).size).toBe(MANUAL.length);
    for (const t of MANUAL) expect(t.passos.length).toBeGreaterThan(0);
  });
  it('busca sem acento nem maiuscula', () => {
    expect(buscarNoManual('AUDITORIA').map((t) => t.id)).toContain('auditoria');
    expect(buscarNoManual('nao conformidade').map((t) => t.id)).toContain('digit-qc');
    expect(buscarNoManual('')).toHaveLength(MANUAL.length);
  });
});

describe('calcularLinha (medicao)', () => {
  const item = { valorMensalGed: 1000, valorPagina: 0.5, paginasContratadas: 100 };
  it('paga as paginas do mes dentro do saldo', () => {
    expect(calcularLinha(item, 40, 0, true)).toEqual({ valorMensalGed: 1000, paginasMedidas: 40, paginasExcedentes: 0, valorServico: 20, valorTotal: 1020 });
  });
  it('limita ao saldo e separa o excedente', () => {
    expect(calcularLinha(item, 50, 80, true)).toMatchObject({ paginasMedidas: 20, paginasExcedentes: 30, valorServico: 10 });
  });
  it('fora da vigencia nao cobra o GED', () => {
    expect(calcularLinha(item, 0, 0, false)).toMatchObject({ valorMensalGed: 0, valorTotal: 0 });
  });
});
