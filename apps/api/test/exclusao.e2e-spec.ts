/**
 * Testes e2e de EXCLUSAO de orgao e de usuario.
 *
 * Cobre:
 *  (1) superadmin: excluir usuario; nao exclui o unico admin; autor de documento so desativa
 *  (2) superadmin: excluir orgao exige inativo + slug digitado; apaga schema, catalogo e arquivos; log global fica
 *  (3) orgao: admin exclui usuario, mas nao a si mesmo; senha minima de 6 caracteres
 *  (4) login publico mostra o nome do orgao cadastrado
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const T_FICA = 'excl_e2e_fica';
const T_SAI = 'excl_e2e_sai';
const ADMIN = 'admin@excl.gov.br';
const OPER = 'oper@excl.gov.br';
const AUTOR = 'autor@excl.gov.br';
const PASS = 'senha-excl-e2e-123';
const SA_EMAIL = 'sa-excl-e2e@jeossistemas.com';
const SA_PASS = 'senha-sa-excl-123';
const SA_TOTP = 'JDOCE2EEXCLSECRETJDOCE2EEXCL';
const STORAGE = process.env.STORAGE_DIR ?? '.storage';

let app: INestApplication;
let sql: postgres.Sql;
const ids: Record<string, string> = {};

async function cleanup(): Promise<void> {
  for (const slug of [T_FICA, T_SAI]) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
    await sql`DELETE FROM public.tenants WHERE slug = ${slug}`;
    await rm(join(STORAGE, `jdoc-${slug}`), { recursive: true, force: true }).catch(() => undefined);
  }
  await sql`DELETE FROM public.superadmins WHERE email = ${SA_EMAIL}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  await cleanup();
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [slug, status] of [
    [T_FICA, 'ativo'],
    [T_SAI, 'ativo'],
  ] as const) {
    await provisionTenantSchema(sql, slug);
    const [t] = await sql<Array<{ id: string }>>`
      INSERT INTO public.tenants (slug, nome, schema_name, status) VALUES (${slug}, ${'Prefeitura de Itapajé ' + slug}, ${'tenant_' + slug}, ${status}) RETURNING id`;
    ids[slug] = t!.id;
    const us = await sql.unsafe(
      `INSERT INTO "tenant_${slug}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, 'Admin', $4, 'admin', false), ($2, 'Operador', $4, 'operador', false), ($3, 'Autor', $4, 'operador', false) RETURNING id, email`,
      [ADMIN, OPER, AUTOR, hash],
    );
    for (const u of us as unknown as Array<{ id: string; email: string }>) ids[`${slug}:${u.email}`] = u.id;
    await sql.unsafe(`INSERT INTO "tenant_${slug}".user_permissions (user_id, permission_key) VALUES ($1, 'acervo:read')`, [ids[`${slug}:${OPER}`]]);
    // Autor tem documento: a autoria impede a exclusao.
    await sql.unsafe(
      `INSERT INTO "tenant_${slug}".documents (module, descricao, exercicio, original_name, created_by) VALUES ('outros', 'Doc', 2026, 'x.pdf', $1)`,
      [ids[`${slug}:${AUTOR}`]],
    );
  }
  // arquivo do orgao que sera excluido
  await mkdir(join(STORAGE, `jdoc-${T_SAI}`), { recursive: true });
  await writeFile(join(STORAGE, `jdoc-${T_SAI}`, 'x.pdf'), '%PDF-1.4');

  const saHash = await argon2.hash(SA_PASS, { type: argon2.argon2id });
  await sql`INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled, role)
            VALUES (${SA_EMAIL}, 'SA Excl', ${saHash}, false, ${SA_TOTP}, true, 'owner')`;

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  for (const padrao of ['bf:*', 'tenant:slug:*']) {
    const keys = await redis.keys(padrao);
    if (keys.length > 0) await redis.del(...keys);
  }
  await redis.quit();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser(process.env.COOKIE_SECRET ?? 'x'.repeat(32)));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await cleanup();
  await sql`DELETE FROM public.global_audit_logs WHERE target_tenant_id = ANY(${Object.values([ids[T_FICA], ids[T_SAI]]).filter(Boolean) as string[]})`.catch(() => undefined);
  await sql?.end({ timeout: 5 });
});

describe('Exclusao de orgao e usuario', () => {
  let sa: string;
  const saApi = (m: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())[m](`/superadmin${path}`).set('Authorization', `Bearer ${sa}`);

  it('(1) superadmin exclui usuario com as protecoes', async () => {
    const r = await request(app.getHttpServer())
      .post('/superadmin/auth/login')
      .send({ email: SA_EMAIL, senha: SA_PASS, totp: authenticator.generate(SA_TOTP) })
      .expect(200);
    sa = r.body.accessToken;
    const t = ids[T_FICA]!;
    await saApi('delete', `/tenants/${t}/users/${ids[`${T_FICA}:${ADMIN}`]}`).expect(409);
    await saApi('delete', `/tenants/${t}/users/${ids[`${T_FICA}:${AUTOR}`]}`).expect(409);
    await saApi('delete', `/tenants/${t}/users/${ids[`${T_FICA}:${OPER}`]}`).expect(204);
    const lista = (await saApi('get', `/tenants/${t}/users`).expect(200)).body as Array<{ email: string }>;
    expect(lista.map((u) => u.email).sort()).toEqual([ADMIN, AUTOR]);
  });

  it('(2) superadmin exclui orgao inativo com o slug digitado', async () => {
    const t = ids[T_SAI]!;
    // Excluir orgao e acao critica: sem reautenticacao recente, 403.
    const semReauth = await saApi('delete', `/tenants/${t}`).send({ confirmacao: T_SAI }).expect(403);
    expect(semReauth.body.code).toBe('reauth_required');
    await saApi('post', '/auth/reauth').send({ senha: SA_PASS, totp: authenticator.generate(SA_TOTP) }).expect(200);
    await saApi('delete', `/tenants/${t}`).send({ confirmacao: T_SAI }).expect(409);
    await saApi('patch', `/tenants/${t}/status`).send({ status: 'inativo', motivo: 'teste de exclusao' }).expect(204);
    await saApi('delete', `/tenants/${t}`).send({ confirmacao: 'outro' }).expect(400);
    await saApi('delete', `/tenants/${t}`).send({ confirmacao: T_SAI }).expect(204);
    const [schema] = await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${'tenant_' + T_SAI}`;
    expect(schema).toBeUndefined();
    expect(await sql`SELECT 1 FROM public.tenants WHERE id = ${t}`).toHaveLength(0);
    expect(existsSync(join(STORAGE, `jdoc-${T_SAI}`))).toBe(false);
    const log = await sql`SELECT action FROM public.global_audit_logs WHERE target_tenant_id = ${t} AND action = 'tenant_deleted'`;
    expect(log).toHaveLength(1);
    await saApi('get', `/tenants/${t}`).expect(404);
    // o outro orgao segue intacto
    await request(app.getHttpServer()).get(`/t/${T_FICA}/configuracoes/public-branding`).expect(200);
  });

  it('(3) admin do orgao exclui usuario, mas nao a si mesmo; senha minima 6', async () => {
    const login = await request(app.getHttpServer()).post(`/t/${T_FICA}/auth/login`).send({ email: ADMIN, senha: PASS }).expect(200);
    const tok = login.body.accessToken as string;
    const api = (m: 'post' | 'delete', path: string) => request(app.getHttpServer())[m](`/t/${T_FICA}${path}`).set('Authorization', `Bearer ${tok}`);
    await api('delete', `/configuracoes/usuarios/${ids[`${T_FICA}:${ADMIN}`]}`).expect(400);
    await api('delete', `/configuracoes/usuarios/${ids[`${T_FICA}:${AUTOR}`]}`).expect(409);
    // Senha minima 6 no cadastro feito pelo proprio orgao (o superadmin gera a senha provisoria).
    await api('post', '/configuracoes/usuarios').send({ email: 'curta@excl.gov.br', nome: 'Senha Curta', senha: '12345', role: 'consulta' }).expect(400);
    const novo = (await api('post', '/configuracoes/usuarios').send({ email: 'seis@excl.gov.br', nome: 'Senha Seis', senha: '123456', role: 'consulta' }).expect(201)).body.id as string;
    await api('delete', `/configuracoes/usuarios/${novo}`).expect(204);
  });

  it('(4) login publico traz o nome cadastrado do orgao', async () => {
    const b = (await request(app.getHttpServer()).get(`/t/${T_FICA}/configuracoes/public-branding`).expect(200)).body;
    expect(b.nomeOrgao).toBe(`Prefeitura de Itapajé ${T_FICA}`);
  });
});
