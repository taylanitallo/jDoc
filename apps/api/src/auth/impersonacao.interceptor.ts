import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import type { TenantAccessClaims } from '@jdoc/shared';
import { impersonacaoContext } from '../audit/audit.module';

/** Requisicao com token de "entrar como": os logs do orgao registram o admin e o motivo. */
@Injectable()
export class ImpersonacaoInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const user = context.switchToHttp().getRequest<Request & { user?: Partial<TenantAccessClaims> }>().user;
    const imp = user?.realm === 'tenant' ? user.imp : undefined;
    if (!imp) return next.handle();
    return new Observable((sub) => impersonacaoContext.run(imp, () => next.handle().subscribe(sub)));
  }
}
