import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Precisa de Redis real (o script Lua roda no servidor). Sem REDIS_URL
 * alcancavel, a suite e pulada.
 */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
let redis: Redis;
let disponivel = false;

beforeAll(async () => {
  redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500 });
  try {
    await redis.connect();
    await redis.ping();
    disponivel = true;
  } catch {
    disponivel = false;
  }
});

afterAll(async () => {
  if (disponivel) await redis.quit();
  else redis.disconnect();
});

describe('RefreshTokenService.rotate (Redis real)', () => {
  it('refresh concorrente com o mesmo token: ambos recebem o MESMO token novo, sessao continua valida', async (ctx) => {
    if (!disponivel) return ctx.skip();
    const svc = new RefreshTokenService(redis);
    const t0 = await svc.issue('tenant', { userId: 'u1', tenantId: 't1' });

    const [a, b] = await Promise.all([svc.rotate('tenant', t0), svc.rotate('tenant', t0)]);
    expect(a.newToken).toBe(b.newToken);
    expect(a.payload).toEqual({ userId: 'u1', tenantId: 't1' });

    // O token que o navegador guardou continua rotacionando normalmente.
    const c = await svc.rotate('tenant', a.newToken);
    expect(c.newToken).not.toBe(a.newToken);
  });

  it('token antigo fora da janela = reuso: familia inteira revogada', async (ctx) => {
    if (!disponivel) return ctx.skip();
    const svc = new RefreshTokenService(redis);
    const t0 = await svc.issue('tenant', { userId: 'u2', tenantId: 't1' });
    const t1 = (await svc.rotate('tenant', t0)).newToken;
    const familia = `rt:tenant:${t0.split('.')[0]}`;
    await redis.hset(familia, 'prev_until', '0'); // janela vencida

    await expect(svc.rotate('tenant', t0)).rejects.toThrow(/revogada/);
    // Revogou a familia: nem o token valido funciona mais.
    await expect(svc.rotate('tenant', t1)).rejects.toThrow(/expirada/);
  });

  it('segredo inventado (nunca emitido) = reuso', async (ctx) => {
    if (!disponivel) return ctx.skip();
    const svc = new RefreshTokenService(redis);
    const t0 = await svc.issue('tenant', { userId: 'u3' });
    const falso = `${t0.split('.')[0]}.${'a'.repeat(64)}`;
    await expect(svc.rotate('tenant', falso)).rejects.toThrow(/revogada/);
  });

  it('nao guarda token utilizavel em claro no Redis', async (ctx) => {
    if (!disponivel) return ctx.skip();
    const svc = new RefreshTokenService(redis);
    const t0 = await svc.issue('tenant', { userId: 'u4' });
    const t1 = (await svc.rotate('tenant', t0)).newToken;
    const dump = JSON.stringify(await redis.hgetall(`rt:tenant:${t0.split('.')[0]}`));
    expect(dump).not.toContain(t1.split('.')[1]);
    expect(dump).not.toContain(t0.split('.')[1]);
  });
});
