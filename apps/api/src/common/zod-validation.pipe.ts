import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * Pipe de validacao zod. Aplica .parse no valor recebido.
 * Schemas devem usar .strict() para rejeitar campos extras.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (err) {
      // instanceof pode falhar com instancias duplicadas de zod no monorepo —
      // checa tambem pelo nome do erro.
      if (err instanceof ZodError || (err as Error)?.name === 'ZodError') {
        const zerr = err as ZodError;
        throw new BadRequestException({
          message: 'Dados invalidos',
          issues: zerr.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      throw err;
    }
  }
}

/**
 * Helper para validar payloads fora de pipes (ex.: dentro de services).
 */
export function parseOrThrow<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}
