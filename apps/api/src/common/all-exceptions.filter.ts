import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Filtro global de excecoes.
 * - Nao vaza stack trace nem detalhes internos ao cliente.
 * - Loga o erro completo no servidor.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Erro interno' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      body = typeof resp === 'string' ? { message: resp } : (resp as Record<string, unknown>);
    } else {
      // Erro nao tratado: loga completo, devolve generico.
      this.logger.error(
        `Erro nao tratado em ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      statusCode: status,
      ...body,
      timestamp: new Date().toISOString(),
    });
  }
}
