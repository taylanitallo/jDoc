import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { perguntarSchema, type AssistenteResposta, type TenantAccessClaims } from '@jdoc/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TenantJwtGuard } from '../auth/tenant-jwt.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { CurrentUser, Permissions } from '../auth/decorators';
import { AssistenteService } from './assistente.service';

/**
 * Assistente de busca por IA — permissao por MODULO e dinamica (o service
 * checa assertPermission por modulo dentro do loop de tool-use, ja que uma
 * pergunta pode cruzar varios modulos), por isso so exige autenticacao aqui.
 */
@Controller('t/:slug/assistente')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class AssistenteController {
  constructor(private readonly assistente: AssistenteService) {}

  @Permissions()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('perguntar')
  perguntar(
    @CurrentUser() user: TenantAccessClaims,
    @Body(new ZodValidationPipe(perguntarSchema)) body: { pergunta: string },
  ): Promise<AssistenteResposta> {
    return this.assistente.perguntar(user, body.pergunta);
  }
}
