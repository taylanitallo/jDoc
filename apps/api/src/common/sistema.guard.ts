import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SISTEMA_LABEL, type Sistema } from '@jdoc/shared';
import { requireTenantContext } from '../tenancy/tenant-context';

export const SISTEMA_KEY = 'jdoc:sistema';

/** Rota/controller pertence a um modulo contratavel (Financeiro/Contabil ou Arquivo). */
export const RequerSistema = (sistema: Sistema) => SetMetadata(SISTEMA_KEY, sistema);

/**
 * Bloqueia rota de modulo que o orgao nao contratou — a API barra, o menu so
 * esconde. Sem @RequerSistema a rota e comum aos dois modulos.
 */
@Injectable()
export class SistemaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const sistema = this.reflector.getAllAndOverride<Sistema | undefined>(SISTEMA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!sistema) return true;
    if (!requireTenantContext().modulos.includes(sistema)) {
      throw new ForbiddenException(`Módulo ${SISTEMA_LABEL[sistema]} não contratado por este órgão`);
    }
    return true;
  }
}

/** Mesma regra para checagens dinamicas (ex.: modulo do documento so e conhecido no service). */
export function assertSistema(sistema: Sistema): void {
  if (!requireTenantContext().modulos.includes(sistema)) {
    throw new ForbiddenException(`Módulo ${SISTEMA_LABEL[sistema]} não contratado por este órgão`);
  }
}

export function sistemaAtivo(sistema: Sistema): boolean {
  return requireTenantContext().modulos.includes(sistema);
}
