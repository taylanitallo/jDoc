import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

/**
 * Rate limiting global (Fase 7a).
 *
 * - Limite default generoso (60/min) para toda a API.
 * - Endpoints criticos sobrescrevem com @Throttle nos controllers:
 *     login    -> 5/min
 *     upload   -> 20/min
 *     reports  -> 5/min
 * - THROTTLE_DISABLED=1 desliga o guard (usado pela maioria dos testes
 *   e2e, exceto o spec dedicado de throttling, que liga de novo no
 *   proprio beforeAll). Leitura de process.env acontece uma vez na
 *   carga do modulo.
 * - Storage in-memory: suficiente para instancia unica (Railway).
 *   Se escalar horizontalmente, trocar por storage Redis.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 60,
        },
      ],
    }),
  ],
  providers: process.env.THROTTLE_DISABLED === '1'
    ? []
    : [
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
      ],
})
export class ThrottlerConfigModule {}