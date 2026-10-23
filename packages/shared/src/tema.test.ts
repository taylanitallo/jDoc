import { describe, expect, it } from 'vitest';
import { COR_PADRAO, corEfetiva, cssTemaMarca, gerarEscalaMarca, HEX_COR, PRESETS_TEMA } from './tema.js';

describe('tema de cor', () => {
  it('mantem a cor escolhida no tom 600 do modo claro', () => {
    for (const p of PRESETS_TEMA) {
      expect(gerarEscalaMarca(p.cor)[600]).toBe(p.cor.toLowerCase());
    }
  });

  it('gera todos os tons como hex valido, do mais claro ao mais escuro', () => {
    const esc = gerarEscalaMarca('#b91c1c');
    for (const v of Object.values(esc)) expect(v).toMatch(HEX_COR);
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(esc[50])).toBeGreaterThan(lum(esc[600]));
    expect(lum(esc[600])).toBeGreaterThan(lum(esc[950]));
  });

  it('no escuro clareia cores muito escuras para o botao continuar visivel', () => {
    const noite = gerarEscalaMarca('#111827', true);
    expect(noite[600]).not.toBe('#111827');
  });

  it('prioridade: usuario, depois orgao, depois padrao', () => {
    expect(corEfetiva('#16a34a', '#b91c1c')).toBe('#16a34a');
    expect(corEfetiva(null, '#b91c1c')).toBe('#b91c1c');
    expect(corEfetiva(null, 'azul')).toBe(COR_PADRAO);
  });

  it('css cobre claro, escuro e a sidebar', () => {
    const css = cssTemaMarca('#0369a1');
    expect(css).toContain(':root{--color-brand-50:');
    expect(css).toContain('html.dark{');
    expect(css).toContain('--sidebar-bg:');
  });
});
