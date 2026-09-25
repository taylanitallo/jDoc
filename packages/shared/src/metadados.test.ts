import { describe, it, expect } from 'vitest';
import { MODELOS_TIPO_ACERVO, camposMetadadosSchema, metadadosInputSchema, metadadosSchemaFor } from './metadados.js';
import { acervoFieldsSchema } from './documents.js';

const lei = MODELOS_TIPO_ACERVO.find((m) => m.nome === 'Lei Municipal')!.campos;

describe('metadadosSchemaFor', () => {
  const schema = metadadosSchemaFor(lei);

  it('aceita metadados validos e omite opcional vazio', () => {
    const r = schema.parse({ numero: '1.234', ementa: 'Dispoe sobre...', data_publicacao: '', especie: 'Ordinária' });
    expect(r).toEqual({ numero: '1.234', ementa: 'Dispoe sobre...', especie: 'Ordinária' });
  });
  it('exige obrigatorio', () => {
    expect(() => schema.parse({ numero: '1' })).toThrow(/Ementa/);
  });
  it('rejeita chave fora da definicao (mass assignment)', () => {
    expect(() => schema.parse({ numero: '1', ementa: 'x', admin: 'true' })).toThrow();
  });
  it('valida data, numero e selecao', () => {
    expect(() => schema.parse({ numero: '1', ementa: 'x', data_publicacao: '10/05/2020' })).toThrow();
    expect(() => schema.parse({ numero: '1', ementa: 'x', especie: 'Outra' })).toThrow();
    const contrato = metadadosSchemaFor(MODELOS_TIPO_ACERVO.find((m) => m.nome === 'Contrato')!.campos);
    expect(() => contrato.parse({ numero: '1', contratado: 'X', valor: 'mil' })).toThrow();
    expect(contrato.parse({ numero: '1', contratado: 'X', valor: '1500,50' }).valor).toBe('1500,50');
  });
});

describe('camposMetadadosSchema', () => {
  it('modelos prontos sao validos', () => {
    for (const m of MODELOS_TIPO_ACERVO) expect(() => camposMetadadosSchema.parse(m.campos)).not.toThrow();
  });
  it('rejeita chave repetida, chave invalida e selecao sem opcoes', () => {
    expect(() => camposMetadadosSchema.parse([
      { chave: 'a', rotulo: 'A', tipo: 'texto' },
      { chave: 'a', rotulo: 'B', tipo: 'texto' },
    ])).toThrow();
    expect(() => camposMetadadosSchema.parse([{ chave: 'Numero Lei', rotulo: 'A', tipo: 'texto' }])).toThrow();
    expect(() => camposMetadadosSchema.parse([{ chave: 'x', rotulo: 'X', tipo: 'selecao' }])).toThrow();
  });
});

describe('acervoFieldsSchema (multipart)', () => {
  it('parseia metadados em JSON string e digitalizado string', () => {
    const r = acervoFieldsSchema.parse({
      module: 'acervo',
      documentTypeId: '00000000-0000-4000-8000-000000000000',
      descricao: 'Lei 1234',
      documentDate: '2020-01-01',
      exercicio: '2020',
      metadados: JSON.stringify({ numero: '1234' }),
      digitalizado: 'true',
    });
    expect(r.metadados).toEqual({ numero: '1234' });
    expect(r.digitalizado).toBe(true);
  });
  it('metadados invalido (nao-JSON) falha', () => {
    expect(metadadosInputSchema.safeParse('{quebrado').success).toBe(false);
  });
});
