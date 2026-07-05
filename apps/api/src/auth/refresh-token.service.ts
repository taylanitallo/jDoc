import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AuthRealm } from '@jdoc/shared';
import { REDIS } from '../redis/redis.module';

const REFRESH_TTL_S = 7 * 24 * 60 * 60; // 7 dias

export interface RefreshPayload {
  userId: string;
  tenantId?: string; // ausente no realm superadmin
}

export interface RotationResult {
  payload: RefreshPayload;
  newToken: string;
}

/**
 * Refresh tokens rotativos com deteccao de reuso.
 *
 * Formato do token: <familyId>.<segredo 256-bit hex>
 * Redis guarda apenas o SHA-256 do segredo (nunca o token em claro).
 *
 * Reuso de token ja rotacionado = familia inteira revogada + excecao
 * (chamador loga evento de seguranca).
 */
@Injectable()
export class RefreshTokenService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private famKey(realm: AuthRealm, familyId: string): string {
    return `rt:${realm}:${familyId}`;
  }

  private userSetKey(realm: AuthRealm, userId: string): string {
    return `rtu:${realm}:${userId}`;
  }

  private hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** Emite nova familia (login). Retorna o token em claro para o cookie. */
  async issue(realm: AuthRealm, payload: RefreshPayload): Promise<string> {
    const familyId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const key = this.famKey(realm, familyId);
    await this.redis
      .multi()
      .hset(key, {
        hash: this.hash(secret),
        userId: payload.userId,
        tenantId: payload.tenantId ?? '',
      })
      .expire(key, REFRESH_TTL_S)
      .sadd(this.userSetKey(realm, payload.userId), familyId)
      .expire(this.userSetKey(realm, payload.userId), REFRESH_TTL_S)
      .exec();
    return `${familyId}.${secret}`;
  }

  /**
   * Rotaciona: valida token atual, troca o segredo, mantem a familia.
   * Token invalido/reusado -> revoga familia + UnauthorizedException.
   */
  async rotate(realm: AuthRealm, token: string): Promise<RotationResult> {
    const parsed = this.parse(token);
    if (!parsed) throw new UnauthorizedException('Sessao invalida');

    const key = this.famKey(realm, parsed.familyId);
    const data = await this.redis.hgetall(key);
    if (!data || !data.hash) {
      throw new UnauthorizedException('Sessao expirada');
    }

    if (data.hash !== this.hash(parsed.secret)) {
      // REUSO DETECTADO: alguem apresentou um segredo antigo da familia.
      await this.revokeFamily(realm, parsed.familyId, data.userId);
      throw new UnauthorizedException('Sessao revogada por seguranca');
    }

    const newSecret = randomBytes(32).toString('hex');
    await this.redis
      .multi()
      .hset(key, { hash: this.hash(newSecret) })
      .expire(key, REFRESH_TTL_S)
      .exec();

    return {
      payload: {
        userId: data.userId,
        tenantId: data.tenantId === '' ? undefined : data.tenantId,
      },
      newToken: `${parsed.familyId}.${newSecret}`,
    };
  }

  /** Revoga a familia do token apresentado (logout). */
  async revoke(realm: AuthRealm, token: string): Promise<void> {
    const parsed = this.parse(token);
    if (!parsed) return;
    const key = this.famKey(realm, parsed.familyId);
    const userId = await this.redis.hget(key, 'userId');
    await this.revokeFamily(realm, parsed.familyId, userId ?? undefined);
  }

  /** Revoga TODAS as sessoes do usuario (logout geral / troca de senha). */
  async revokeAllForUser(realm: AuthRealm, userId: string): Promise<void> {
    const setKey = this.userSetKey(realm, userId);
    const families = await this.redis.smembers(setKey);
    if (families.length > 0) {
      await this.redis.del(...families.map((f) => this.famKey(realm, f)));
    }
    await this.redis.del(setKey);
  }

  private async revokeFamily(realm: AuthRealm, familyId: string, userId?: string): Promise<void> {
    await this.redis.del(this.famKey(realm, familyId));
    if (userId) await this.redis.srem(this.userSetKey(realm, userId), familyId);
  }

  private parse(token: string): { familyId: string; secret: string } | null {
    const m = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(token);
    if (!m) return null;
    return { familyId: m[1] as string, secret: m[2] as string };
  }
}
