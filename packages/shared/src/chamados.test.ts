import { describe, expect, it } from 'vitest';
import { feriadosNacionais, horasUteisEntre, somarHorasUteis } from './chamados.js';

// Instantes em Fortaleza (UTC-3).
const f = (s: string) => new Date(`${s}-03:00`);

describe('SLA em horas uteis', () => {
  it('sexta 16h30 + 2 h termina segunda 09h30', () => {
    // 23/10/2026 e uma sexta-feira.
    expect(somarHorasUteis(f('2026-10-23T16:30:00'), 2).toISOString()).toBe(f('2026-10-26T09:30:00').toISOString());
  });

  it('pula o almoco e comeca no expediente', () => {
    expect(somarHorasUteis(f('2026-10-21T11:00:00'), 2).toISOString()).toBe(f('2026-10-21T14:00:00').toISOString());
    expect(somarHorasUteis(f('2026-10-21T06:00:00'), 1).toISOString()).toBe(f('2026-10-21T09:00:00').toISOString());
  });

  it('pula feriado nacional e feriado cadastrado', () => {
    // 02/11/2026 (segunda) e Finados.
    expect(somarHorasUteis(f('2026-10-30T16:00:00'), 2).toISOString()).toBe(f('2026-11-03T09:00:00').toISOString());
    expect(somarHorasUteis(f('2026-10-21T16:00:00'), 2, new Set(['2026-10-22'])).toISOString()).toBe(f('2026-10-23T09:00:00').toISOString());
  });

  it('calcula a Pascoa para os feriados moveis', () => {
    expect(feriadosNacionais(2026).get('2026-04-03')).toBe('Sexta-feira Santa');
  });

  it('mede horas uteis entre dois instantes', () => {
    expect(horasUteisEntre(f('2026-10-23T16:30:00'), f('2026-10-26T09:30:00'))).toBeCloseTo(2);
  });
});
