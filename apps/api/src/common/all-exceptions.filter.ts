import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const CODIGOS: Record<number, string> = {
  400: 'dados_invalidos',
  401: 'nao_autenticado',
  403: 'acesso_negado',
  404: 'nao_encontrado',
  409: 'conflito',
  413: 'arquivo_grande',
  423: 'conta_bloqueada',
  429: 'muitas_tentativas',
  503: 'indisponivel',
};

/** Mensagens padrao do Nest/Express (em ingles) traduzidas: nada em ingles chega a tela. */
const TRADUCAO: Record<string, string> = {
  'Bad Request': 'Requisição inválida',
  Unauthorized: 'Não autenticado',
  Forbidden: 'Acesso negado',
  'Forbidden resource': 'Acesso negado',
  'Not Found': 'Não encontrado',
  'Method Not Allowed': 'Operação não permitida',
  Conflict: 'Conflito com dados existentes',
  'Payload Too Large': 'Arquivo grande demais',
  'File too large': 'Arquivo grande demais',
  'Unsupported Media Type': 'Tipo de arquivo não suportado',
  'Too Many Requests': 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  'ThrottlerException: Too Many Requests': 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  'Internal Server Error': 'Erro interno',
  'Service Unavailable': 'Serviço indisponível no momento',
  'Validation failed (uuid is expected)': 'Identificador inválido',
};

function traduzir(m: string): string {
  if (TRADUCAO[m]) return TRADUCAO[m]!;
  if (/^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(m)) return 'Não encontrado';
  if (/^Unexpected field/.test(m)) return 'Campo de arquivo inesperado';
  return m;
}

function codigoPadrao(status: number): string {
  return CODIGOS[status] ?? (status >= 500 ? 'erro_interno' : 'erro');
}

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

    // Formato do padrao: `{ error, code }` em pt-BR. `message` continua para
    // nao quebrar quem ja le esse campo.
    const bruta = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    const message = typeof bruta === 'string' ? traduzir(bruta) : bruta;
    res.status(status).json({
      statusCode: status,
      ...body,
      message,
      error: typeof message === 'string' ? message : 'Erro interno',
      code: typeof body.code === 'string' ? body.code : codigoPadrao(status),
      timestamp: new Date().toISOString(),
    });
  }
}
