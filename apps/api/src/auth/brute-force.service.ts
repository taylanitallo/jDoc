import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const MAX_ATTEMPTS = 5;
const WINDOW_S = 15 * 60; // janela de contagem
const BASE_LOCK_S = 30; // backoff exponencial: 30s, 60s, 120s... cap 1h
const MAX_LOCK_S = 60 * 60;

/**
 * Bloqueio progressivo por forca bruta.
 * Chaves por CONTA e por IP no Redis. 5 falhas -> backoff exponencial.
 */
@Injectable()
export class BruteForceService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private keys(scope: string, id: string): { fails: string; lock: string } {
    return { fails: `bf:${scope}:${id}:fails`, lock: `bf:${scope}:${id}:lock` };
  }

  /** Lanca 429 se conta ou IP estiverem bloqueados. */
  async assertNotLocked(accountKey: string, ip: string): Promise<void> {
    const [acctLock, ipLock] = await Promise.all([
      this.redis.ttl(this.keys('acct', accountKey).lock),
      this.redis.ttl(this.keys('ip', ip).lock),
    ]);
    const ttl = Math.max(acctLock, ipLock);
    if (ttl > 0) {
      throw new HttpException(
        { message: 'Muitas tentativas. Tente novamente mais tarde.', retryAfterSeconds: ttl },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Registra falha; ao exceder o limite, aplica lock exponencial. */
  async registerFailure(accountKey: string, ip: string): Promise<void> {
    await Promise.all([this.bump('acct', accountKey), this.bump('ip', ip)]);
  }

  /** Sucesso zera contadores da conta (IP mantem janela). */
  async registerSuccess(accountKey: string): Promise<void> {
    const k = this.keys('acct', accountKey);
    await this.redis.del(k.fails, k.lock);
  }

  private async bump(scope: string, id: string): Promise<void> {
    const k = this.keys(scope, id);
    const fails = await this.redis.incr(k.fails);
    if (fails === 1) await this.redis.expire(k.fails, WINDOW_S);
    if (fails >= MAX_ATTEMPTS) {
      const over = fails - MAX_ATTEMPTS;
      const lockS = Math.min(BASE_LOCK_S * 2 ** over, MAX_LOCK_S);
      await this.redis.set(k.lock, '1', 'EX', lockS);
    }
  }
}
