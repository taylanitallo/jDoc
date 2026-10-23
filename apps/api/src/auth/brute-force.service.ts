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

  /**
   * Lanca 429 se conta ou IP estiverem bloqueados. Com `contaBloqueada423`, a
   * conta bloqueada responde 423 "Conta bloqueada temporariamente." (equipe da
   * plataforma, Padrao JEOS); IP bloqueado continua 429.
   */
  async assertNotLocked(accountKey: string, ip: string, opts: { contaBloqueada423?: boolean } = {}): Promise<void> {
    const [acctLock, ipLock] = await Promise.all([
      this.redis.ttl(this.keys('acct', accountKey).lock),
      this.redis.ttl(this.keys('ip', ip).lock),
    ]);
    if (opts.contaBloqueada423 && acctLock > 0) {
      throw new HttpException(
        { message: 'Conta bloqueada temporariamente.', code: 'conta_bloqueada', retryAfterSeconds: acctLock },
        423, // Locked (o enum do Nest nao tem)
      );
    }
    const ttl = Math.max(acctLock, ipLock);
    if (ttl > 0) {
      throw new HttpException(
        { message: 'Muitas tentativas. Tente novamente mais tarde.', retryAfterSeconds: ttl },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Registra falha; ao exceder o limite, aplica lock exponencial. `lockFixoS`
   * troca o backoff da conta por um bloqueio fixo (equipe: 15 min).
   */
  async registerFailure(accountKey: string, ip: string, opts: { lockFixoS?: number } = {}): Promise<void> {
    await Promise.all([this.bump('acct', accountKey, opts.lockFixoS), this.bump('ip', ip)]);
  }

  /** Segundos restantes de bloqueio da conta (0 = livre). */
  async bloqueioRestante(accountKey: string): Promise<number> {
    return Math.max(0, await this.redis.ttl(this.keys('acct', accountKey).lock));
  }

  /** Desbloqueio manual (superadmin). */
  async desbloquear(accountKey: string): Promise<void> {
    const k = this.keys('acct', accountKey);
    await this.redis.del(k.fails, k.lock);
  }

  /** Sucesso zera contadores da conta (IP mantem janela). */
  async registerSuccess(accountKey: string): Promise<void> {
    const k = this.keys('acct', accountKey);
    await this.redis.del(k.fails, k.lock);
  }

  private async bump(scope: string, id: string, lockFixoS?: number): Promise<void> {
    const k = this.keys(scope, id);
    const fails = await this.redis.incr(k.fails);
    if (fails === 1) await this.redis.expire(k.fails, WINDOW_S);
    if (fails >= MAX_ATTEMPTS) {
      const over = fails - MAX_ATTEMPTS;
      const lockS = lockFixoS ?? Math.min(BASE_LOCK_S * 2 ** over, MAX_LOCK_S);
      await this.redis.set(k.lock, '1', 'EX', lockS);
    }
  }
}
