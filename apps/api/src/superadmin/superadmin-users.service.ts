import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Sql, TransactionSql } from 'postgres';
import {
  descreverDispositivo,
  type AcessoView,
  type ResetUserPasswordInput,
  type SenhaProvisoriaResposta,
  type UsuarioGlobalView,
  type UsuarioOrgaoCreateInput,
  type UsuarioOrgaoUpdateInput,
  type UsuarioOrgaoView,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { BruteForceService } from '../auth/brute-force.service';
import { EmailService } from '../email/email.service';
import { gerarSenhaProvisoria } from '../superadmin-auth/equipe.service';
import { SuperadminTenantsService } from './superadmin-tenants.service';
import { PerfisService } from './perfis.service';

interface UserRow {
  id: string;
  email: string;
  nome: string;
  cpf: string | null;
  role: string;
  perfil_id: string | null;
  perfil_nome: string | null;
  ativo: boolean;
  ultimo_acesso: Date | null;
  criado_em: Date;
}

/**
 * Gestao de usuarios de QUALQUER orgao pelo superadmin. Toda consulta usa o
 * schema do orgao informado na rota (isolamento) e toda acao vai para
 * global_audit_logs.
 */
@Injectable()
export class SuperadminUsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: SuperadminTenantsService,
    private readonly perfis: PerfisService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly bruteForce: BruteForceService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private async alvo(tenantId: string) {
    const tenant = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(tenant.schema_name);
    await this.perfis.garantirPerfis(sql);
    return { tenant, sql };
  }

  async list(tenantId: string): Promise<UsuarioOrgaoView[]> {
    const { tenant, sql } = await this.alvo(tenantId);
    const rows = await sql<UserRow[]>`
      SELECT u.id, u.email, u.nome, u.cpf, u.role, u.perfil_id, p.nome AS perfil_nome, u.ativo, u.ultimo_acesso, u.criado_em
      FROM users u LEFT JOIN perfis p ON p.id = u.perfil_id ORDER BY u.nome
    `;
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        email: r.email,
        nome: r.nome,
        cpf: r.cpf,
        role: r.role,
        perfilId: r.perfil_id,
        perfilNome: r.perfil_nome,
        ativo: r.ativo,
        bloqueadoPor: await this.bruteForce.bloqueioRestante(`${tenant.id}:${r.email}`),
        ultimoAcesso: r.ultimo_acesso?.toISOString() ?? null,
        criadoEm: r.criado_em.toISOString(),
      })),
    );
  }

  private async usuario(sql: Sql, userId: string): Promise<UserRow> {
    const [u] = await sql<UserRow[]>`
      SELECT u.id, u.email, u.nome, u.cpf, u.role, u.perfil_id, p.nome AS perfil_nome, u.ativo, u.ultimo_acesso, u.criado_em
      FROM users u LEFT JOIN perfis p ON p.id = u.perfil_id WHERE u.id = ${userId}
    `;
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return u;
  }

  /** Convite: senha provisoria por e-mail (SMTP do orgao ou da plataforma); sem SMTP, volta na resposta. */
  private async convidar(
    tenant: { id: string; nome: string; slug: string },
    u: { nome: string; email: string },
    senha: string,
    novo: boolean,
  ): Promise<SenhaProvisoriaResposta> {
    const r = await this.email.enviar({
      tenantId: tenant.id,
      para: u.email,
      remetente: tenant.nome,
      assunto: novo ? `Seu acesso ao jDoc — ${tenant.nome}` : `Nova senha do jDoc — ${tenant.nome}`,
      paragrafos: [
        `Olá, ${u.nome}.`,
        novo
          ? `Seu usuário no jDoc de ${tenant.nome} foi criado. Entre com o seu e-mail e a senha provisória abaixo; no primeiro acesso o sistema pede uma senha pessoal.`
          : 'Sua senha foi redefinida pela equipe de suporte. Entre com a senha provisória abaixo e troque-a no primeiro acesso.',
        `Senha provisória: ${senha}`,
      ],
      botao: { texto: 'Acessar o jDoc', url: this.email.urlApp(`/${tenant.slug}/login`) },
    });
    return r.enviado ? { emailEnviado: true } : { emailEnviado: false, senhaProvisoria: senha };
  }

  async create(
    tenantId: string,
    input: UsuarioOrgaoCreateInput,
    actorId: string,
    ip: string,
  ): Promise<{ id: string } & SenhaProvisoriaResposta> {
    const { tenant, sql } = await this.alvo(tenantId);
    if ((await sql`SELECT 1 FROM users WHERE email = ${input.email}`).length) throw new ConflictException('E-mail já cadastrado neste órgão');
    if (input.cpf && (await sql`SELECT 1 FROM users WHERE cpf = ${input.cpf}`).length) throw new ConflictException('CPF já cadastrado neste órgão');

    const senha = gerarSenhaProvisoria();
    const hash = await this.passwords.hash(senha);
    const id = await sql.begin(async (tx) => {
      const [u] = await tx<Array<{ id: string }>>`
        INSERT INTO users (email, nome, cpf, senha_hash, role, must_change_password)
        VALUES (${input.email}, ${input.nome}, ${input.cpf ?? null}, ${hash}, 'consulta', true)
        RETURNING id
      `;
      await this.perfis.aplicarAoUsuario(tx, u!.id, input.perfilId);
      return u!.id;
    });
    const usuario = await this.usuario(sql, id);

    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_created',
      targetTenantId: tenantId,
      entity: 'usuario',
      entityId: id,
      ip,
      changes: { depois: { nome: input.nome, email: input.email, perfil: usuario.perfil_nome } },
    });
    return { id, ...(await this.convidar(tenant, input, senha, true)) };
  }

  async update(tenantId: string, userId: string, input: UsuarioOrgaoUpdateInput, actorId: string, ip: string): Promise<UsuarioOrgaoView> {
    const { sql } = await this.alvo(tenantId);
    const antes = await this.usuario(sql, userId);
    if (input.email && input.email !== antes.email && (await sql`SELECT 1 FROM users WHERE email = ${input.email} AND id <> ${userId}`).length) {
      throw new ConflictException('E-mail já cadastrado neste órgão');
    }
    if (input.cpf && (await sql`SELECT 1 FROM users WHERE cpf = ${input.cpf} AND id <> ${userId}`).length) {
      throw new ConflictException('CPF já cadastrado neste órgão');
    }
    if (input.ativo === false && antes.role === 'admin' && antes.ativo) await this.garantirOutroAdmin(sql, userId);

    await sql.begin(async (tx) => {
      await tx`
        UPDATE users SET
          nome = ${input.nome ?? antes.nome},
          email = ${input.email ?? antes.email},
          cpf = ${input.cpf === undefined ? antes.cpf : input.cpf},
          ativo = ${input.ativo ?? antes.ativo},
          atualizado_em = now()
        WHERE id = ${userId}
      `;
      if (input.perfilId && input.perfilId !== antes.perfil_id) {
        if (antes.role === 'admin') {
          const [p] = await tx<Array<{ papel: string }>>`SELECT papel FROM perfis WHERE id = ${input.perfilId}`;
          if (p?.papel !== 'admin') await this.garantirOutroAdmin(tx, userId);
        }
        await this.perfis.aplicarAoUsuario(tx, userId, input.perfilId);
      }
    });
    if (input.ativo === false || (input.perfilId && input.perfilId !== antes.perfil_id)) {
      await this.refreshTokens.revokeAllForUser('tenant', userId);
    }
    const depois = await this.usuario(sql, userId);
    const resumo = (u: UserRow) => ({ nome: u.nome, email: u.email, cpf: u.cpf, perfil: u.perfil_nome, ativo: u.ativo });
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_updated',
      targetTenantId: tenantId,
      entity: 'usuario',
      entityId: userId,
      ip,
      changes: { antes: resumo(antes), depois: resumo(depois) },
    });
    return (await this.list(tenantId)).find((u) => u.id === userId)!;
  }

  private async garantirOutroAdmin(sql: Sql | TransactionSql, userId: string): Promise<void> {
    const [n] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND ativo AND id <> ${userId}`;
    if ((n?.n ?? 0) === 0) throw new ConflictException('O órgão precisa de pelo menos um administrador ativo');
  }

  /** Senha definida pelo superadmin (rota antiga, mantida para compatibilidade). */
  async resetPassword(tenantId: string, userId: string, input: ResetUserPasswordInput, actorId: string, ip: string): Promise<void> {
    const { sql } = await this.alvo(tenantId);
    const hash = await this.passwords.hash(input.novaSenha);
    const rows = await sql`
      UPDATE users SET senha_hash = ${hash}, must_change_password = true, atualizado_em = now()
      WHERE id = ${userId} RETURNING id
    `;
    if (rows.length === 0) throw new NotFoundException('Usuário não encontrado');
    await this.refreshTokens.revokeAllForUser('tenant', userId);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_password_reset',
      targetTenantId: tenantId,
      entity: 'usuario',
      entityId: userId,
      ip,
    });
  }

  /** "Redefinir senha": nova senha provisoria enviada por e-mail. */
  async redefinirSenhaPorEmail(tenantId: string, userId: string, actorId: string, ip: string): Promise<SenhaProvisoriaResposta> {
    const { tenant, sql } = await this.alvo(tenantId);
    const u = await this.usuario(sql, userId);
    const senha = gerarSenhaProvisoria();
    await sql`
      UPDATE users SET senha_hash = ${await this.passwords.hash(senha)}, must_change_password = true, atualizado_em = now()
      WHERE id = ${userId}
    `;
    await this.refreshTokens.revokeAllForUser('tenant', userId);
    await this.bruteForce.desbloquear(`${tenant.id}:${u.email}`);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_password_reset',
      targetTenantId: tenantId,
      entity: 'usuario',
      entityId: userId,
      ip,
      metadata: { porEmail: true },
    });
    return this.convidar(tenant, u, senha, false);
  }

  async desbloquear(tenantId: string, userId: string, actorId: string, ip: string): Promise<void> {
    const { tenant, sql } = await this.alvo(tenantId);
    const u = await this.usuario(sql, userId);
    await this.bruteForce.desbloquear(`${tenant.id}:${u.email}`);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_unlocked',
      targetTenantId: tenantId,
      entity: 'usuario',
      entityId: userId,
      ip,
    });
  }

  async encerrarSessoes(tenantId: string, userId: string, actorId: string, ip: string): Promise<void> {
    const { sql } = await this.alvo(tenantId);
    await this.usuario(sql, userId);
    await this.refreshTokens.revokeAllForUser('tenant', userId);
    await this.audit.logGlobal({
      actorType: 'superadmin',
      actorId,
      action: 'tenant_user_sessions_revoked',
      targetTenantId: tenantId,
      entity: 'usuario',
      entityId: userId,
      ip,
    });
  }

  async setActive(tenantId: string, userId: string, ativo: boolean, actorId: string, ip: string): Promise<void> {
    await this.update(tenantId, userId, { ativo }, actorId, ip);
  }

  /**
   * Exclui o usuario. Nao exclui o ultimo administrador ativo nem quem ja registrou
   * documentos/atos (a autoria precisa continuar rastreavel) — para esses, desativar.
   */
  async remove(tenantId: string, userId: string, actorId: string, ip: string): Promise<void> {
    const { sql } = await this.alvo(tenantId);
    const u = await this.usuario(sql, userId);
    if (u.role === 'admin' && u.ativo) await this.garantirOutroAdmin(sql, userId);
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
      entity: 'usuario',
      entityId: userId,
      ip,
      changes: { antes: { nome: u.nome, email: u.email, perfil: u.perfil_nome } },
    });
  }

  /** Logins e falhas do orgao (aba Acessos), do audit_logs do proprio schema. */
  async acessos(tenantId: string, de?: Date, ate?: Date, page = 1, pageSize = 50): Promise<{ items: AcessoView[]; total: number }> {
    const { sql } = await this.alvo(tenantId);
    const inicio = de ?? new Date(Date.now() - 30 * 86_400_000);
    const fim = ate ?? new Date();
    const filtro = sql`
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.action IN ('login', 'login_failed', 'logout') AND a.criado_em BETWEEN ${inicio} AND ${fim}
    `;
    const [t] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n ${filtro}`;
    const rows = await sql<
      Array<{ id: string; criado_em: Date; action: string; nome: string | null; email: string | null; ip: string | null; user_agent: string | null; metadata: Record<string, unknown> | null }>
    >`
      SELECT a.id::text, a.criado_em, a.action, u.nome, u.email, a.ip, a.user_agent, a.metadata ${filtro}
      ORDER BY a.criado_em DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
    return {
      total: t?.n ?? 0,
      items: rows.map((r) => {
        const meta = typeof r.metadata === 'string' ? (JSON.parse(r.metadata) as Record<string, unknown>) : (r.metadata ?? {});
        const imp = meta.impersonacao as { adminNome?: string } | undefined;
        return {
          id: r.id,
          quando: r.criado_em.toISOString(),
          tipo: r.action === 'login' ? 'login' : r.action === 'logout' ? 'logout' : 'falha',
          usuario: r.nome,
          email: r.email ?? (typeof meta.email === 'string' ? meta.email : null),
          ip: r.ip,
          navegador: descreverDispositivo(r.user_agent),
          impersonacao: imp?.adminNome ?? null,
        };
      }),
    };
  }

  /** Busca global por nome, e-mail ou CPF em todos os orgaos (limite por orgao). */
  async buscarGlobal(q: string): Promise<UsuarioGlobalView[]> {
    const termo = q.trim();
    if (termo.length < 3) throw new BadRequestException('Digite pelo menos 3 caracteres');
    const digitos = termo.replace(/\D/g, '');
    const tenants = await this.db.catalog()<Array<{ id: string; nome: string; slug: string; schema_name: string }>>`
      SELECT id, nome, slug, schema_name FROM public.tenants ORDER BY nome
    `;
    const like = `%${termo.toLowerCase()}%`;
    const porOrgao = await Promise.all(
      tenants.map(async (t) => {
        try {
          const sql = this.db.tenant(t.schema_name);
          const rows = await sql<
            Array<{ id: string; nome: string; email: string; cpf: string | null; ativo: boolean; perfil: string | null; ultimo_acesso: Date | null }>
          >`
            SELECT u.id, u.nome, u.email, u.cpf, u.ativo, p.nome AS perfil, u.ultimo_acesso
            FROM users u LEFT JOIN perfis p ON p.id = u.perfil_id
            WHERE lower(u.nome) LIKE ${like} OR lower(u.email) LIKE ${like}
              ${digitos.length >= 3 ? sql`OR u.cpf LIKE ${`%${digitos}%`}` : sql``}
            ORDER BY u.nome LIMIT 20
          `;
          return rows.map((r) => ({
            tenantId: t.id,
            orgao: t.nome,
            slug: t.slug,
            userId: r.id,
            nome: r.nome,
            email: r.email,
            cpf: r.cpf,
            ativo: r.ativo,
            perfilNome: r.perfil,
            ultimoAcesso: r.ultimo_acesso?.toISOString() ?? null,
          }));
        } catch {
          return [];
        }
      }),
    );
    return porOrgao.flat().slice(0, 200);
  }
}
