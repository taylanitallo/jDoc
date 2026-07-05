import { describe, it, expect } from 'vitest';
import { schemaNameForSlug, tenantSlugSchema, SCHEMA_NAME_REGEX } from './tenant.js';

describe('tenant slug / schema name', () => {
  it('deriva schema valido de slug valido', () => {
    expect(schemaNameForSlug('iraucuba')).toBe('tenant_iraucuba');
    expect(schemaNameForSlug('sao_paulo_2')).toBe('tenant_sao_paulo_2');
  });

  it('rejeita slug com injecao SQL', () => {
    expect(() => schemaNameForSlug('a"; DROP SCHEMA public;--')).toThrow();
    expect(() => schemaNameForSlug('public')).not.toThrow(); // vira tenant_public, isolado
    expect(() => schemaNameForSlug('a b')).toThrow();
    expect(() => schemaNameForSlug('MAIUSC')).toThrow();
    expect(() => schemaNameForSlug('a')).toThrow(); // < 2 chars
  });

  it('schema derivado sempre casa com SCHEMA_NAME_REGEX', () => {
    expect(SCHEMA_NAME_REGEX.test(schemaNameForSlug('demo'))).toBe(true);
  });

  it('slug valido aceita apenas [a-z0-9_]', () => {
    expect(tenantSlugSchema.safeParse('valido_123').success).toBe(true);
    expect(tenantSlugSchema.safeParse('Invalido').success).toBe(false);
    expect(tenantSlugSchema.safeParse('com-hifen').success).toBe(false);
  });
});
