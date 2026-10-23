import { Injectable, UnauthorizedException } from '@nestjs/common';
import { descreverDispositivo, type AdminSessao, type PapelAdmin } from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import type { AdminReq } from './decorators';

/** Sessao expira apos 12 h sem uso (deslizante pelo last_seen_at). */
export const SESSAO_OCIOSA_H = 12;
const REAUTH_MIN = 5;
const CACHE_MS = 5_000;
const TOQUE_MS = 60_000;

interface Linha {
  admin_id: string;
  nome: string;
  email: string;
  role: PapelAdmin;
  totp_enabled: boolean;
  ativo: boolean;
  revoked_at: Date | null;
  last_seen_at: Date;
  reauth_until: Date | null;
}

/**
 * Sessoes da equipe: uma linha em platform.admin_sessions por familia de
 * refresh token (o id da linha E o id da familia). O guard valida a sessao a
 * cada requisicao (com cache curto), entao encerrar uma sessao derruba o
 * acesso em segundos, nao so quando o token de 15 min expira.
 */
@Injectable()
export class AdminSessionsService {
  private readonly cache = new Map<string, { linha: Linha; ate: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async criar(sid: string, adminId: string, ip: string, userAgent: string): Promise<void> {
    await this.db.catalog()`
      INSERT INTO platform.admin_sessions (id, admin_id, ip, user_agent, expires_at)
      VALUES (${sid}, ${adminId}, ${ip.slice(0, 45)}, ${userAgent.slice(0, 500)}, now() + interval '7 days')
      ON CONFLICT (id) DO NOTHING
    `;
  }

  /**
   * No refresh: sessao revogada ou ociosa ha mais de 12 h nao renova. Familia
   * sem linha (sessao aberta antes desta tabela existir) ganha a linha agora.
   */
  async renovar(sid: string, adminId: string, ip: string, userAgent: string): Promise<void> {
    const sql = this.db.catalog();
    const [s] = await sql<Array<{ admin_id: string; revoked_at: Date | null; ociosa: boolean }>>`
      SELECT admin_id, revoked_at, last_seen_at < now() - make_interval(hours => ${SESSAO_OCIOSA_H}) AS ociosa
      FROM platform.admin_sessions WHERE id = ${sid}
    `;
    if (!s) return this.criar(sid, adminId, ip, userAgent);
    if (s.admin_id !== adminId || s.revoked_at || s.ociosa) {
      await this.revogar(sid, adminId);
      throw new UnauthorizedException('Sessão expirada');
    }
    await sql`UPDATE platform.admin_sessions SET last_seen_at = now(), ip = ${ip.slice(0, 45)} WHERE id = ${sid}`;
  }

  /** Usado pelo guard em toda requisicao autenticada. */
  async validar(sid: string, adminId: string): Promise<AdminReq> {
    const agora = Date.now();
    const emCache = this.cache.get(sid);
    let linha = emCache && emCache.ate > agora ? emCache.linha : undefined;
    if (!linha) {
      const [l] = await this.db.catalog()<Linha[]>`
        SELECT s.admin_id, a.nome, a.email, a.role, a.totp_enabled, a.ativo, s.revoked_at, s.last_seen_at, s.reauth_until
        FROM platform.admin_sessions s JOIN public.superadmins a ON a.id = s.admin_id
        WHERE s.id = ${sid}
      `;
      linha = l;
      if (linha) this.cache.set(sid, { linha, ate: agora + CACHE_MS });
    }
    const ociosa = !linha || agora - linha.last_seen_at.getTime() > SESSAO_OCIOSA_H * 3_600_000;
    if (!linha || linha.admin_id !== adminId || linha.revoked_at || !linha.ativo || ociosa) {
      this.cache.delete(sid);
      throw new UnauthorizedException('Sessão expirada');
    }
    if (agora - linha.last_seen_at.getTime() > TOQUE_MS) {
      linha.last_seen_at = new Date(agora);
      void this.db
        .catalog()`UPDATE platform.admin_sessions SET last_seen_at = now() WHERE id = ${sid}`
        .catch(() => undefined);
    }
    return {
      id: linha.admin_id,
      nome: linha.nome,
      email: linha.email,
      role: linha.role,
      mfaEnabled: linha.totp_enabled,
      sid,
      reauthUntil: linha.reauth_until,
    };
  }

  async marcarReauth(sid: string): Promise<Date> {
    const [r] = await this.db.catalog()<Array<{ reauth_until: Date }>>`
      UPDATE platform.admin_sessions SET reauth_until = now() + make_interval(mins => ${REAUTH_MIN})
      WHERE id = ${sid} RETURNING reauth_until
    `;
    this.cache.delete(sid);
    if (!r) throw new UnauthorizedException('Sessão expirada');
    return r.reauth_until;
  }

  async listar(adminId: string, sidAtual?: string): Promise<AdminSessao[]> {
    const rows = await this.db.catalog()<
      Array<{ id: string; ip: string | null; user_agent: string | null; criado_em: Date; last_seen_at: Date }>
    >`
      SELECT id, ip, user_agent, criado_em, last_seen_at FROM platform.admin_sessions
      WHERE admin_id = ${adminId} AND revoked_at IS NULL
        AND last_seen_at > now() - make_interval(hours => ${SESSAO_OCIOSA_H})
      ORDER BY last_seen_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      ip: r.ip,
      dispositivo: descreverDispositivo(r.user_agent),
      criadoEm: r.criado_em.toISOString(),
      ultimoUso: r.last_seen_at.toISOString(),
      atual: r.id === sidAtual,
    }));
  }

  async revogar(sid: string, adminId: string): Promise<boolean> {
    const r = await this.db.catalog()`
      UPDATE platform.admin_sessions SET revoked_at = now() WHERE id = ${sid} AND admin_id = ${adminId} AND revoked_at IS NULL
    `;
    this.cache.delete(sid);
    await this.refreshTokens.revokeFamily('superadmin', sid, adminId);
    return r.count > 0;
  }

  /** Encerra todas as sessoes do admin, menos (opcionalmente) a atual. */
  async revogarTodas(adminId: string, exceto?: string): Promise<number> {
    const rows = await this.db.catalog()<Array<{ id: string }>>`
      UPDATE platform.admin_sessions SET revoked_at = now()
      WHERE admin_id = ${adminId} AND revoked_at IS NULL AND id <> ${exceto ?? ''}
      RETURNING id
    `;
    for (const r of rows) {
      this.cache.delete(r.id);
      await this.refreshTokens.revokeFamily('superadmin', r.id, adminId);
    }
    if (!exceto) await this.refreshTokens.revokeAllForUser('superadmin', adminId);
    return rows.length;
  }

  /** Mudou papel/estado do admin: descarta o cache das sessoes dele. */
  esquecerAdmin(adminId: string): void {
    for (const [sid, v] of this.cache) if (v.linha.admin_id === adminId) this.cache.delete(sid);
  }
}
