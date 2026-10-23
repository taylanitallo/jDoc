import { describe, expect, it } from 'vitest';
import { hojeIso } from './constants.js';

describe('hojeIso', () => {
  it('usa o fuso de Fortaleza, nao UTC', () => {
    // 24/09 22:30 em Fortaleza = 25/09 01:30 UTC
    expect(hojeIso(new Date('2026-09-25T01:30:00Z'))).toBe('2026-09-24');
    expect(hojeIso(new Date('2026-09-25T03:00:00Z'))).toBe('2026-09-25');
  });

  it('registro das 22h00 de Fortaleza fica no mesmo dia (filtros "hoje")', () => {
    // 22/10/2026 22:00 em Fortaleza = 23/10 01:00 UTC.
    expect(hojeIso(new Date('2026-10-23T01:00:00Z'))).toBe('2026-10-22');
  });
});
