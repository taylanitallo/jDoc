import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Catalogo global — schema `public`.
 * Contem apenas o catalogo de tenants, superadmins e logs globais.
 * NENHUM dado de negocio de tenant vive aqui.
 */

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar('slug', { length: 30 }).notNull().unique(),
    nome: varchar('nome', { length: 200 }).notNull(),
    brasaoUrl: text('brasao_url'),
    status: varchar('status', { length: 10 }).notNull().default('ativo'),
    quotaDiscoMb: integer('quota_disco_mb').notNull().default(1024),
    schemaName: varchar('schema_name', { length: 40 }).notNull().unique(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_tenants_status').on(t.status)],
);

export const superadmins = pgTable('superadmins', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 254 }).notNull().unique(),
  nome: varchar('nome', { length: 200 }).notNull(),
  senhaHash: text('senha_hash').notNull(),
  // 2FA TOTP obrigatorio para superadmin.
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  ultimoAcesso: timestamp('ultimo_acesso', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const globalAuditLogs = pgTable(
  'global_audit_logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorId: uuid('actor_id'),
    actorType: varchar('actor_type', { length: 20 }).notNull(), // superadmin | system
    action: varchar('action', { length: 80 }).notNull(),
    targetTenantId: uuid('target_tenant_id'),
    ip: varchar('ip', { length: 45 }),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_global_audit_actor').on(t.actorId),
    index('idx_global_audit_action').on(t.action),
    index('idx_global_audit_created').on(t.criadoEm),
  ],
);

export const backups = pgTable('backups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tenantId: uuid('tenant_id').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pendente'),
  fileKey: text('file_key'),
  sizeBytes: integer('size_bytes'),
  erroMensagem: text('erro_mensagem'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
  concluidoEm: timestamp('concluido_em', { withTimezone: true }),
});

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenantRow = typeof tenants.$inferInsert;
export type SuperadminRow = typeof superadmins.$inferSelect;
