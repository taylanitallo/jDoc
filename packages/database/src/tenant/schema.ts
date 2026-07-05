import { pgSchema, uuid, varchar, text, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Template de schema por tenant.
 *
 * O nome do schema e dinamico (tenant_<slug>), entao expomos uma factory
 * que recebe o nome (JA VALIDADO contra SCHEMA_NAME_REGEX pelo chamador)
 * e devolve as tabelas Drizzle ligadas aquele schema. Assim as queries de
 * negocio ficam type-safe e sempre escopadas ao schema do tenant.
 *
 * Fase 1: users, roles, permissions, role_permissions, user_roles, audit_logs.
 * Tabelas de documentos/orcamento entram nas fases seguintes.
 */
export function tenantSchema(schemaName: string) {
  const s = pgSchema(schemaName);

  const users = s.table(
    'users',
    {
      id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
      email: varchar('email', { length: 254 }).notNull().unique(),
      nome: varchar('nome', { length: 200 }).notNull(),
      senhaHash: text('senha_hash').notNull(),
      role: varchar('role', { length: 20 }).notNull().default('consulta'),
      ativo: boolean('ativo').notNull().default(true),
      mustChangePassword: boolean('must_change_password').notNull().default(true),
      totpSecret: text('totp_secret'),
      totpEnabled: boolean('totp_enabled').notNull().default(false),
      ultimoAcesso: timestamp('ultimo_acesso', { withTimezone: true }),
      criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
      atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('idx_users_email').on(t.email), index('idx_users_ativo').on(t.ativo)],
  );

  const permissions = s.table('permissions', {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    // formato modulo:acao (ex.: despesas:create)
    key: varchar('key', { length: 60 }).notNull().unique(),
    descricao: varchar('descricao', { length: 200 }),
  });

  const userPermissions = s.table(
    'user_permissions',
    {
      userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      permissionKey: varchar('permission_key', { length: 60 }).notNull(),
    },
    (t) => [index('idx_user_permissions_user').on(t.userId)],
  );

  const auditLogs = s.table(
    'audit_logs',
    {
      id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
      actorId: uuid('actor_id'),
      action: varchar('action', { length: 80 }).notNull(),
      resourceType: varchar('resource_type', { length: 60 }),
      resourceId: varchar('resource_id', { length: 80 }),
      ip: varchar('ip', { length: 45 }),
      userAgent: text('user_agent'),
      metadata: jsonb('metadata'),
      criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index('idx_audit_actor').on(t.actorId),
      index('idx_audit_action').on(t.action),
      index('idx_audit_created').on(t.criadoEm),
    ],
  );

  return { schema: s, users, permissions, userPermissions, auditLogs };
}

export type TenantTables = ReturnType<typeof tenantSchema>;
