import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  normalizarCodigo,
  type ConferenciaHashPublica,
  type TenantAccessClaims,
  type VerificacaoPublica,
} from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SistemaGuard } from '../common/sistema.guard';
import { CurrentUser, Permissions, Public } from '../auth/decorators';
import { AutenticidadeService } from './autenticidade.service';

const uuidSchema = z.string().uuid();
const copiaQuerySchema = z.object({ arquivo: z.string().uuid().optional() }).strict();
const codigoParamSchema = z.string().max(40).transform(normalizarCodigo);
const conferirBodySchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** Emissao da copia autenticada (autenticada, RBAC de leitura checado no DocumentsService). */
@Controller('t/:slug/documents')
@UseGuards(TenantJwtGuard, PermissionsGuard, SistemaGuard)
export class CopiaAutenticadaController {
  constructor(private readonly service: AutenticidadeService) {}

  @Permissions()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':id/copia-autenticada')
  async copia(
    @CurrentUser() user: TenantAccessClaims,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Query(new ZodValidationPipe(copiaQuerySchema)) q: z.infer<typeof copiaQuerySchema>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf, nome, codigo } = await this.service.emitirCopia(user, id, q.arquivo, req.ip ?? '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.setHeader('X-Codigo-Verificacao', codigo);
    res.send(pdf);
  }
}

/**
 * Verificacao PUBLICA de autenticidade (cidadao, TCE, cartorio). Sem login,
 * fora do realm de tenant. Devolve so metadados minimos — nunca o arquivo,
 * titulo ou conteudo. Throttle por IP contra enumeracao de codigos.
 */
@Controller('public/verificar')
export class VerificacaoPublicaController {
  constructor(private readonly service: AutenticidadeService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':codigo')
  verificar(@Param('codigo', new ZodValidationPipe(codigoParamSchema)) codigo: string): Promise<VerificacaoPublica> {
    return this.service.verificar(codigo);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':codigo/conferir')
  @HttpCode(200)
  conferir(
    @Param('codigo', new ZodValidationPipe(codigoParamSchema)) codigo: string,
    @Body(new ZodValidationPipe(conferirBodySchema)) body: z.infer<typeof conferirBodySchema>,
  ): Promise<ConferenciaHashPublica> {
    return this.service.conferirHash(codigo, body.sha256);
  }
}
