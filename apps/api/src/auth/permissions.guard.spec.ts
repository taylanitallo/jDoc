import { describe, expect, it } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TenantAccessClaims } from '@jdoc/shared';
import { PermissionsGuard } from './permissions.guard';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from './decorators';

function makeContext(opts: {
  isPublic?: boolean;
  required?: string[];
  user?: Partial<TenantAccessClaims>;
}): { guard: PermissionsGuard; ctx: ExecutionContext } {
  const metadata = new Map<string, unknown>();
  if (opts.isPublic !== undefined) metadata.set(IS_PUBLIC_KEY, opts.isPublic);
  if (opts.required !== undefined) metadata.set(PERMISSIONS_KEY, opts.required);

  const reflector = {
    getAllAndOverride: (key: string) => metadata.get(key),
  } as unknown as Reflector;

  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: opts.user }),
    }),
  } as unknown as ExecutionContext;

  return { guard: new PermissionsGuard(reflector), ctx };
}

const baseUser: TenantAccessClaims = {
  sub: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  tenantSlug: 'demo',
  role: 'operador',
  permissions: ['despesas:read'],
  realm: 'tenant',
};

describe('PermissionsGuard (deny by default)', () => {
  it('nega rota autenticada SEM @Permissions declarado', () => {
    const { guard, ctx } = makeContext({ user: baseUser });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('permite rota @Public', () => {
    const { guard, ctx } = makeContext({ isPublic: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('permite @Permissions() vazio (so autenticacao)', () => {
    const { guard, ctx } = makeContext({ required: [], user: baseUser });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('nega usuario sem a permissao exigida', () => {
    const { guard, ctx } = makeContext({ required: ['despesas:create'], user: baseUser });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('permite usuario com a permissao exigida', () => {
    const { guard, ctx } = makeContext({ required: ['despesas:read'], user: baseUser });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('exige TODAS as permissoes declaradas', () => {
    const { guard, ctx } = makeContext({
      required: ['despesas:read', 'despesas:export'],
      user: baseUser,
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('admin passa em qualquer permissao', () => {
    const { guard, ctx } = makeContext({
      required: ['configuracoes:delete'],
      user: { ...baseUser, role: 'admin', permissions: [] },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('nega request sem usuario', () => {
    const { guard, ctx } = makeContext({ required: ['despesas:read'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
