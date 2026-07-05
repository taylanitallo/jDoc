import { describe, expect, it, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import type Redis from 'ioredis';
import { BruteForceService } from './brute-force.service';

/** Redis fake em memoria (somente comandos usados pelo servico). */
class FakeRedis {
  store = new Map<string, { value: number; expiresAt: number | null }>();

  async incr(key: string): Promise<number> {
    const cur = this.get(key);
    const next = (cur ?? 0) + 1;
    this.store.set(key, { value: next, expiresAt: this.store.get(key)?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async set(key: string, value: string, _ex: string, seconds: number): Promise<'OK'> {
    this.store.set(key, { value: Number(value), expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const ttl = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return ttl > 0 ? ttl : -2;
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }

  private get(key: string): number | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }
}

describe('BruteForceService', () => {
  let redis: FakeRedis;
  let svc: BruteForceService;

  beforeEach(() => {
    redis = new FakeRedis();
    svc = new BruteForceService(redis as unknown as Redis);
  });

  it('nao bloqueia antes de 5 falhas', async () => {
    for (let i = 0; i < 4; i++) await svc.registerFailure('t1:a@b.c', '1.2.3.4');
    await expect(svc.assertNotLocked('t1:a@b.c', '1.2.3.4')).resolves.toBeUndefined();
  });

  it('bloqueia a conta na 5a falha (429)', async () => {
    for (let i = 0; i < 5; i++) await svc.registerFailure('t1:a@b.c', '1.2.3.4');
    await expect(svc.assertNotLocked('t1:a@b.c', '1.2.3.4')).rejects.toThrow(HttpException);
  });

  it('bloqueio por IP vale mesmo para outra conta', async () => {
    for (let i = 0; i < 5; i++) await svc.registerFailure('t1:a@b.c', '9.9.9.9');
    await expect(svc.assertNotLocked('t1:OUTRA@b.c', '9.9.9.9')).rejects.toThrow(HttpException);
  });

  it('sucesso zera contadores da conta', async () => {
    for (let i = 0; i < 5; i++) await svc.registerFailure('t1:a@b.c', '1.1.1.1');
    await svc.registerSuccess('t1:a@b.c');
    // conta liberada; IP com 5 falhas continua travado — usa outro IP
    await expect(svc.assertNotLocked('t1:a@b.c', '2.2.2.2')).resolves.toBeUndefined();
  });

  it('backoff cresce exponencialmente', async () => {
    for (let i = 0; i < 5; i++) await svc.registerFailure('t1:x@y.z', '3.3.3.3');
    const ttl1 = await redis.ttl('bf:acct:t1:x@y.z:lock');
    await svc.registerFailure('t1:x@y.z', '3.3.3.3');
    const ttl2 = await redis.ttl('bf:acct:t1:x@y.z:lock');
    expect(ttl2).toBeGreaterThan(ttl1);
  });
});
