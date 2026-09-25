import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTenantUserInput,
  ResetUserPasswordInput,
  SetUserActiveInput,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { SuperadminTenantsService } from './superadmin-tenants.service';

export interface TenantUserView {
  id: string;
  email: string;
  nome: string;
  role: string;
  ativo: boolean;
  ultimoAcesso: string | null;
  criadoEm: string;
}

interface UserRow {
  id: string;
  email: string;
  nome: string;
  role: string;
  ativo: boolean;
  ultimo_acesso: Date | null;
  criado_em: Date;
}

/**
 * Gestao de usuarios de QUALQUER tenant pelo superadmin.
 * Toda acao registrada em global_audit_logs.
 */
@Injectable()
export class SuperadminUsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: SuperadminTenantsService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<TenantUserView[]> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);
    const rows = await sql<UserRow[]>`
      SELECT id, email, nome, role, ativo, ultimo_acesso, criado_em
      FROM users ORDER BY nome
    `;
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      nome: r.nome,
      role: r.role,
      ativo: r.ativo,
      ultimoAcesso: r.ultimo_acesso?.toISOString() ?? null,
      criadoEm: r.criado_em.toISOString(),
    }));
  }

  async create(
    tenantId: string,
    input: CreateTenantUserInput,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);

    const existing = await sql`SELECT id FROM users WHERE email = ${input.email} LIMIT 1`;
    if (existing.length > 0) throw new ConflictException('E-mail ja cadastrado neste orgao');

    const hash = await this.passwords.hash(input.senha);
    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO users (email, nome, senha_hash, role, must_change_password)
      VALUES (${input.email}, ${input.nome}, ${hash}, ${input.role}, true)
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    // Admin ja tem acesso total (bypassa checagem de permissao) — so grava
    // permissoes granulares para operador/consulta.
    if (input.role !== 'admin' && input.permissions?.length) {
      for (const p of input.permissions) {
        await sql`
          INSERT INTO user_permissions (user_id, permission_key)
          VALUES (${id}, ${p}) ON CONFLICT DO NOTHING
        `;
      }
    }

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_created',
      targetTenantId: tenantId,
      ip,
      metadata: { email: input.email, role: input.role },
    });
    return { id };
  }

  async resetPassword(
    tenantId: string,
    userId: string,
    input: ResetUserPasswordInput,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);

    const hash = await this.passwords.hash(input.novaSenha);
    const rows = await sql`
      UPDATE users SET senha_hash = ${hash}, must_change_password = true, atualizado_em = now()
      WHERE id = ${userId} RETURNING id
    `;
    if (rows.length === 0) throw new NotFoundException('Usuario nao encontrado');

    // Revoga todas as sessoes: senha trocada = sessoes antigas mortas.
    await this.refreshTokens.revokeAllForUser('tenant', userId);

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_password_reset',
      targetTenantId: tenantId,
      ip,
      metadata: { userId },
    });
  }

  async setActive(
    tenantId: string,
    userId: string,
    input: SetUserActiveInput,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);

    const rows = await sql`
      UPDATE users SET ativo = ${input.ativo}, atualizado_em = now()
      WHERE id = ${userId} RETURNING id
    `;
    if (rows.length === 0) throw new NotFoundException('Usuario nao encontrado');

    if (!input.ativo) {
      await this.refreshTokens.revokeAllForUser('tenant', userId);
    }

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: input.ativo ? 'tenant_user_activated' : 'tenant_user_deactivated',
      targetTenantId: tenantId,
      ip,
      metadata: { userId },
    });
  }

  /**
   * Exclui o usuario. Nao exclui o ultimo administrador ativo nem quem ja registrou
   * documentos/atos (a autoria precisa continuar rastreavel) — para esses, desativar.
   */
  async remove(tenantId: string, userId: string, actorId: string, ip: string): Promise<void> {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);
    const [u] = await sql<Array<{ email: string; role: string; ativo: boolean }>>`SELECT email, role, ativo FROM users WHERE id = ${userId}`;
    if (!u) throw new NotFoundException('Usuario nao encontrado');
    if (u.role === 'admin' && u.ativo) {
      const [n] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND ativo AND id <> ${userId}`;
      if ((n?.n ?? 0) === 0) throw new ConflictException('Não é possível excluir o único administrador ativo do órgão');
    }
    const [docs] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM documents WHERE created_by = ${userId}`;
    if ((docs?.n ?? 0) > 0) throw new ConflictException('Este usuário já registrou documentos ou atos; para manter o histórico, desative-o em vez de excluir');
    try {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM user_permissions WHERE user_id = ${userId}`;
        await tx`DELETE FROM users WHERE id = ${userId}`;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23503') {
        throw new ConflictException('Este usuário já registrou documentos ou atos no sistema; para manter o histórico, desative-o em vez de excluir');
      }
      throw e;
    }
    await this.refreshTokens.revokeAllForUser('tenant', userId).catch(() => undefined);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_deleted',
      targetTenantId: tenantId,
      ip,
      metadata: { email: u.email, role: u.role },
    });
  }
}
