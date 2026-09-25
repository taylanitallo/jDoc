import { describe, it, expect } from 'vitest';
import { montarTrecho, normalizarParaBusca, semAcento, termosDaConsulta } from './busca.js';

describe('semAcento', () => {
  it('remove acentos preservando o comprimento', () => {
    const s = 'Licitação nº 12 — Câmara Municipal de Iraucuba 😀';
    expect(semAcento(s)).toBe('Licitacao nº 12 — Camara Municipal de Iraucuba 😀');
    expect(semAcento(s).length).toBe(s.length);
  });
});

describe('termosDaConsulta', () => {
  it('normaliza, tira operadores e palavras curtas', () => {
    expect(termosDaConsulta('"Plano Diretor" -revogado or de Educação')).toEqual(['plano', 'diretor', 'revogado', 'educacao']);
  });
});

describe('montarTrecho', () => {
  const texto = 'A Câmara Municipal aprovou em sessão ordinária a contratação de empresa para a reforma da escola. Os contratos seguem anexos.';

  it('destaca termos por prefixo, sem acento', () => {
    const segs = montarTrecho(texto, termosDaConsulta('contrato'));
    const destacados = segs.filter((s) => s.destaque).map((s) => s.texto);
    expect(destacados).toEqual(['contratação', 'contratos']);
    expect(segs.map((s) => s.texto).join('')).toContain('reforma da escola');
  });

  it('janela com reticencias quando o texto e longo', () => {
    const longo = `${'x '.repeat(300)}palavra alvo aqui ${'y '.repeat(300)}`;
    const segs = montarTrecho(longo, ['alvo']);
    expect(segs[0]).toEqual({ texto: '…', destaque: false });
    expect(segs.at(-1)).toEqual({ texto: '…', destaque: false });
    expect(segs.some((s) => s.destaque && s.texto === 'alvo')).toBe(true);
  });

  it('sem ocorrencia devolve o comeco do texto', () => {
    const segs = montarTrecho('texto qualquer', ['inexistente']);
    expect(segs).toEqual([{ texto: 'texto qualquer', destaque: false }]);
  });

  it('normalizarParaBusca remove caracteres de controle', () => {
    expect(normalizarParaBusca('A\u0001B\fC')).toBe('a b c');
  });
});
