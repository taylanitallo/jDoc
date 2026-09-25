import { describe, it, expect } from 'vitest';
import { CODIGO_REGEX, formatarCodigo, normalizarCodigo } from './autenticidade.js';
import { createTenantSchema } from './superadmin.js';
import { novoTenantSlugSchema, schemaNameForSlug } from './tenant.js';

describe('codigo de verificacao', () => {
  it('normaliza digitacao (espaco, hifen, minuscula, O/I/L)', () => {
    expect(normalizarCodigo('ab12-cdo4 ef56 ghil')).toBe('AB12CD04EF56GH11');
    expect(CODIGO_REGEX.test(normalizarCodigo('7k3m-9xq2-hv8r-4n6t'))).toBe(true);
  });
  it('formata em grupos de 4', () => {
    expect(formatarCodigo('7K3M9XQ2HV8R4N6T')).toBe('7K3M-9XQ2-HV8R-4N6T');
  });
  it('regex rejeita letras ambiguas e tamanho errado', () => {
    expect(CODIGO_REGEX.test('7K3M9XQ2HV8R4N6U')).toBe(false);
    expect(CODIGO_REGEX.test('7K3M9XQ2HV8R4N6')).toBe(false);
  });
});

describe('slugs reservados', () => {
  it('bloqueia criar orgao com slug de rota publica', () => {
    expect(novoTenantSlugSchema.safeParse('verificar').success).toBe(false);
    expect(novoTenantSlugSchema.safeParse('iraucuba').success).toBe(true);
    expect(createTenantSchema.shape.slug.safeParse('superadmin').success).toBe(false);
  });
  it('slug existente continua gerando schema (nao quebra orgaos antigos)', () => {
    expect(schemaNameForSlug('public')).toBe('tenant_public');
  });
});
