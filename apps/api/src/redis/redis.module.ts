import { Global, Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, loadEnv } from '../config/env';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: () => loadEnv(),
    },
    {
      provide: REDIS,
      useFactory: () => {
        const env = loadEnv();
        return new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });
      },
    },
  ],
  exports: [REDIS, ENV],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
