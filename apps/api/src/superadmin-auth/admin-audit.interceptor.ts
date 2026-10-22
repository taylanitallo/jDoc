import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { adminAuditContext } from '../audit/audit.module';
import type { AdminReq } from './decorators';

/**
 * Roda o handler dentro do contexto do admin autenticado (o guard ja validou
 * e pos em `req.admin`), para a auditoria registrar o nome dele sozinha.
 * Interceptor, e nao o guard, porque so ele envolve a execucao do handler.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const admin = context.switchToHttp().getRequest<Request & { admin?: AdminReq }>().admin;
    if (!admin) return next.handle();
    return new Observable((sub) =>
      adminAuditContext.run({ id: admin.id, nome: admin.nome }, () => next.handle().subscribe(sub)),
    );
  }
}
