import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AuthRealm } from '@jdoc/shared';
import { REDIS } from '../redis/redis.module';

const REFRESH_TTL_S = 7 * 24 * 60 * 60; // 7 dias
/** Janela em que o token recem-rotacionado ainda e aceito (refresh concorrente / outra aba). */
const GRACE_S = 20;

/**
 * Rotacao atomica. KEYS[1]=familia. ARGV: 1 hash apresentado, 2 hash novo,
 * 3 token novo cifrado, 4 agora(ms), 5 grace(ms), 6 ttl(s), 7 ip, 8 navegador.
 * Retorno: {ok|grace, tokenCifrado?, userId, tenantId} | {reuse, userId} | {expired}.
 */
const ROTATE_LUA = `
local d = redis.call('HMGET', KEYS[1], 'hash', 'prev_hash', 'prev_enc', 'prev_until', 'userId', 'tenantId')
if not d[1] then return {'expired'} end
local agora = tonumber(ARGV[4])
if d[1] == ARGV[1] then
  redis.call('HSET', KEYS[1], 'hash', ARGV[2], 'prev_hash', ARGV[1], 'prev_enc', ARGV[3], 'prev_until', tostring(agora + tonumber(ARGV[5])), 'ip', ARGV[7], 'ua', ARGV[8])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[6]))
  return {'ok', '', d[5] or '', d[6] or ''}
end
if d[2] and d[2] == ARGV[1] and d[4] and agora < tonumber(d[4]) then
  return {'grace', d[3], d[5] or '', d[6] or ''}
end
return {'reuse', d[5] or ''}
`;

export interface RefreshPayload {
  userId: string;
  tenantId?: string; // ausente no realm superadmin
}

export interface RotationResult {
  payload: RefreshPayload;
  newToken: string;
}

/** De onde veio o login/refresh: aparece em "Aparelhos conectados". */
export interface OrigemSessao {
  ip: string;
  userAgent: string;
}

export interface SessaoRefresh {
  id: string;
  ip: string | null;
  userAgent: string | null;
  criadoEm: Date;
  ultimoUso: Date;
}

const limitarIp = (ip: string | undefined): string => (ip ?? '').slice(0, 45);
const limitarNavegador = (ua: string | undefined): string => (ua ?? '').slice(0, 500);

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
  async issue(realm: AuthRealm, payload: RefreshPayload, origem?: OrigemSessao): Promise<string> {
    const familyId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const key = this.famKey(realm, familyId);
    await this.redis
      .multi()
      .hset(key, {
        hash: this.hash(secret),
        userId: payload.userId,
        tenantId: payload.tenantId ?? '',
        criadoEm: String(Date.now()),
        ip: limitarIp(origem?.ip),
        ua: limitarNavegador(origem?.userAgent),
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
   *
   * Atomico (script Lua): sem isso, dois refresh simultaneos (duas abas, F5
   * no meio de uma requisicao, StrictMode) liam o mesmo hash e ambos
   * rotacionavam — o navegador guardava um cookie e o Redis outro, e o
   * proximo refresh virava "reuso" e derrubava a sessao.
   *
   * Janela de tolerancia (GRACE_S): o token recem-substituido, se
   * reapresentado logo em seguida, recebe o MESMO token novo (idempotente),
   * sem revogar. O token novo fica guardado cifrado (AES-256-GCM) com chave
   * derivada do segredo ANTIGO — so quem tem o token anterior decifra; o
   * Redis continua sem nenhum token utilizavel em claro. Fora da janela,
   * segredo antigo = reuso = familia revogada (comportamento original).
   */
  async rotate(realm: AuthRealm, token: string, origem?: OrigemSessao): Promise<RotationResult> {
    const parsed = this.parse(token);
    if (!parsed) throw new UnauthorizedException('Sessao invalida');

    const key = this.famKey(realm, parsed.familyId);
    const newSecret = randomBytes(32).toString('hex');
    const newToken = `${parsed.familyId}.${newSecret}`;
    const presentedHash = this.hash(parsed.secret);
    const cifrado = this.cifrarParaGrace(parsed.secret, newToken);

    const r = (await this.redis.eval(
      ROTATE_LUA,
      1,
      key,
      presentedHash,
      this.hash(newSecret),
      cifrado,
      String(Date.now()),
      String(GRACE_S * 1000),
      String(REFRESH_TTL_S),
      limitarIp(origem?.ip),
      limitarNavegador(origem?.userAgent),
    )) as [string, string?, string?, string?];

    const [status, a, userId, tenantId] = r;
    // A lista de sessoes do usuario vive tanto quanto a sessao mais recente dele.
    if (status === 'ok' && userId) await this.redis.expire(this.userSetKey(realm, userId), REFRESH_TTL_S);
    if (status === 'expired') throw new UnauthorizedException('Sessao expirada');
    if (status === 'reuse') {
      // REUSO DETECTADO: alguem apresentou um segredo antigo da familia fora da janela.
      await this.revokeFamily(realm, parsed.familyId, a || undefined);
      throw new UnauthorizedException('Sessao revogada por seguranca');
    }
    const tokenEntregue = status === 'grace' ? this.decifrarGrace(parsed.secret, a ?? '') : newToken;
    if (!tokenEntregue) {
      await this.revokeFamily(realm, parsed.familyId, userId || undefined);
      throw new UnauthorizedException('Sessao revogada por seguranca');
    }
    return {
      payload: { userId: userId ?? '', tenantId: tenantId ? tenantId : undefined },
      newToken: tokenEntregue,
    };
  }

  private chaveGrace(oldSecret: string): Buffer {
    return createHash('sha256').update(`rt-grace:${oldSecret}`).digest();
  }

  private cifrarParaGrace(oldSecret: string, novoToken: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chaveGrace(oldSecret), iv);
    const enc = Buffer.concat([c.update(novoToken, 'utf8'), c.final()]);
    return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
  }

  private decifrarGrace(oldSecret: string, blob: string): string | null {
    try {
      const [iv, tag, enc] = blob.split('.') as [string, string, string];
      const d = createDecipheriv('aes-256-gcm', this.chaveGrace(oldSecret), Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
    } catch {
      return null;
    }
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

  /** Id da familia (sessao) de um token, sem validar o segredo. */
  familia(token: string): string | null {
    return this.parse(token)?.familyId ?? null;
  }

  /** Revoga uma sessao especifica (encerrar sessao na tela de sessoes ativas). */
  async revokeFamily(realm: AuthRealm, familyId: string, userId?: string): Promise<void> {
    await this.redis.del(this.famKey(realm, familyId));
    if (userId) await this.redis.srem(this.userSetKey(realm, userId), familyId);
  }

  /**
   * A sessao ainda existe? O guard consulta a cada requisicao para que encerrar
   * derrube o acesso na hora. Redis fora do ar nao bloqueia: o token continua
   * assinado e dura poucos minutos.
   */
  async familiaAtiva(realm: AuthRealm, familyId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.famKey(realm, familyId))) === 1;
    } catch {
      return true;
    }
  }

  /** Sessoes ativas do usuario, da usada mais recentemente para a mais antiga. */
  async sessoes(realm: AuthRealm, userId: string): Promise<SessaoRefresh[]> {
    const setKey = this.userSetKey(realm, userId);
    const familias = await this.redis.smembers(setKey);
    if (familias.length === 0) return [];

    const consulta = this.redis.pipeline();
    for (const f of familias) {
      consulta.hmget(this.famKey(realm, f), 'hash', 'ip', 'ua', 'criadoEm');
      consulta.ttl(this.famKey(realm, f));
    }
    const r = ((await consulta.exec()) ?? []).map(([, valor]) => valor);

    const agora = Date.now();
    const vencidas: string[] = [];
    const lista: SessaoRefresh[] = [];
    familias.forEach((id, i) => {
      const [hash, ip, ua, criadoEm] = r[i * 2] as Array<string | null>;
      if (!hash) return void vencidas.push(id);
      // O TTL renasce a cada renovacao: o que ja passou dele e o tempo desde o ultimo uso.
      const ultimoUso = new Date(agora - (REFRESH_TTL_S - Math.max(r[i * 2 + 1] as number, 0)) * 1000);
      lista.push({ id, ip: ip || null, userAgent: ua || null, criadoEm: criadoEm ? new Date(Number(criadoEm)) : ultimoUso, ultimoUso });
    });
    if (vencidas.length > 0) await this.redis.srem(setKey, ...vencidas);
    return lista.sort((a, b) => b.ultimoUso.getTime() - a.ultimoUso.getTime());
  }

  /** Encerra todas as sessoes do usuario menos a informada (troca de senha). */
  async revokeOutrasFamilias(realm: AuthRealm, userId: string, exceto: string): Promise<void> {
    const setKey = this.userSetKey(realm, userId);
    const outras = (await this.redis.smembers(setKey)).filter((f) => f !== exceto);
    if (outras.length === 0) return;
    await this.redis.del(...outras.map((f) => this.famKey(realm, f)));
    await this.redis.srem(setKey, ...outras);
  }

  /** Encerra uma sessao somente se ela for do proprio usuario. */
  async revokeFamilyDoUsuario(realm: AuthRealm, familyId: string, userId: string): Promise<boolean> {
    if (!(await this.redis.sismember(this.userSetKey(realm, userId), familyId))) return false;
    await this.revokeFamily(realm, familyId, userId);
    return true;
  }

  private parse(token: string): { familyId: string; secret: string } | null {
    const m = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(token);
    if (!m) return null;
    return { familyId: m[1] as string, secret: m[2] as string };
  }
}
