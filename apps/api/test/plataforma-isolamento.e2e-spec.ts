/**
 * Isolamento entre orgaos no superadmin e "entrar como". Requer postgres +
 * redis e `pnpm db:migrate`.
 *
 * Cobre:
 *  - usuario de orgao nao acessa nenhuma rota do superadmin
 *  - admin nao le/altera o usuario do orgao B pela rota do orgao A
 *  - "entrar como" pede reauth; o token vale so no orgao dele e marca a sessao
 *  - status "manutencao" bloqueia o orgao com 503
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { provisionTenantSchema } from '@jdoc/database';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const OWNER = 'owner-iso-e2e@jeossistemas.com';
const SENHA = 'senha-isolamento-123';
const TOTP = 'JDOCISOLAMENTOE2ESECRETJDOCISO';
const A = 'iso_e2e_a';
const B = 'iso_e2e_b';
const USER_PASS = 'senha-usuario-123';

let app: INestApplication;
let sql: postgres.Sql;
const ids: Record<string, { tenant: string; user: string }> = {};

async function limpar(): Promise<void> {
  for (const s of [A, B]) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${s}" CASCADE`);
    await sql`DELETE FROM public.tenants WHERE slug = ${s}`;
  }
  await sql`DELETE FROM public.superadmins WHERE email = ${OWNER}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  await limpar();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const chaves = await redis.keys('bf:*');
  if (chaves.length) await redis.del(...chaves);
  await redis.quit();

  const hash = await argon2.hash(SENHA, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled, role)
    VALUES (${OWNER}, 'Owner Isolamento', ${hash}, false, ${TOTP}, true, 'owner')
  `;
  const uh = await argon2.hash(USER_PASS, { type: argon2.argon2id });
  for (const s of [A, B]) {
    await provisionTenantSchema(sql, s);
    const [t] = await sql<Array<{ id: string }>>`
      INSERT INTO public.tenants (slug, nome, schema_name, status) VALUES (${s}, ${`Orgao ${s}`}, ${`tenant_${s}`}, 'ativo') RETURNING id
    `;
    const [u] = await sql.unsafe<Array<{ id: string }>>(
      `INSERT INTO "tenant_${s}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Usuario', $2, 'operador', false) RETURNING id`,
      [`user-${s.slice(-1)}@iso.gov.br`, uh],
    );
    ids[s] = { tenant: t!.id, user: u!.id };
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser(process.env.COOKIE_SECRET ?? 'x'.repeat(32)));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await limpar();
  await sql?.end({ timeout: 5 });
});

async function owner(): Promise<string> {
  const r = await request(app.getHttpServer())
    .post('/superadmin/auth/login')
    .send({ email: OWNER, senha: SENHA, totp: authenticator.generate(TOTP) })
    .expect(200);
  return r.body.accessToken as string;
}

describe('Isolamento e "entrar como"', () => {
  it('usuario de orgao nao entra em nenhuma rota do superadmin', async () => {
    const r = await request(app.getHttpServer()).post(`/t/${A}/auth/login`).send({ email: 'user-a@iso.gov.br', senha: USER_PASS }).expect(200);
    const auth = { Authorization: `Bearer ${r.body.accessToken as string}` };
    for (const rota of ['/superadmin/me', '/superadmin/tenants', '/superadmin/overview', '/superadmin/performance']) {
      await request(app.getHttpServer()).get(rota).set(auth).expect(401);
    }
  });

  it('admin nao altera nem le o usuario do orgao B pela rota do A', async () => {
    const auth = { Authorization: `Bearer ${await owner()}` };
    await request(app.getHttpServer())
      .patch(`/superadmin/tenants/${ids[A]!.tenant}/users/${ids[B]!.user}`)
      .set(auth)
      .send({ nome: 'Invasor' })
      .expect(404);
    const lista = await request(app.getHttpServer()).get(`/superadmin/tenants/${ids[A]!.tenant}/users`).set(auth).expect(200);
    expect((lista.body as Array<{ id: string }>).map((u) => u.id)).not.toContain(ids[B]!.user);
  });

  it('"entrar como" pede reauth, vale so no orgao dele e marca a sessao', async () => {
    const auth = { Authorization: `Bearer ${await owner()}` };
    const corpo = { userId: ids[A]!.user, motivo: 'teste automatizado de isolamento' };
    const sem = await request(app.getHttpServer()).post(`/superadmin/tenants/${ids[A]!.tenant}/impersonate`).set(auth).send(corpo).expect(403);
    expect(sem.body.code).toBe('reauth_required');
    await request(app.getHttpServer())
      .post('/superadmin/auth/reauth')
      .set(auth)
      .send({ senha: SENHA, totp: authenticator.generate(TOTP) })
      .expect(200);
    // Usuario de outro orgao pela rota do A: nao encontrado.
    await request(app.getHttpServer())
      .post(`/superadmin/tenants/${ids[A]!.tenant}/impersonate`)
      .set(auth)
      .send({ ...corpo, userId: ids[B]!.user })
      .expect(404);
    const r = await request(app.getHttpServer()).post(`/superadmin/tenants/${ids[A]!.tenant}/impersonate`).set(auth).send(corpo).expect(200);
    const imp = { Authorization: `Bearer ${r.body.accessToken as string}` };
    const me = await request(app.getHttpServer()).get(`/t/${A}/auth/me`).set(imp).expect(200);
    expect(me.body.impersonacao).toMatchObject({ adminNome: 'Owner Isolamento' });
    await request(app.getHttpServer()).get(`/t/${B}/auth/me`).set(imp).expect(401);
    const [log] = await sql`SELECT admin_name FROM public.global_audit_logs WHERE action = 'impersonacao_iniciada' AND target_tenant_id = ${ids[A]!.tenant}`;
    expect(log?.admin_name).toBe('Owner Isolamento');
  });

  it('orgao em manutencao responde 503', async () => {
    await sql`UPDATE public.tenants SET status = 'manutencao' WHERE slug = ${B}`;
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await redis.del(`tenant:slug:${B}`);
    await redis.quit();
    const r = await request(app.getHttpServer()).post(`/t/${B}/auth/login`).send({ email: 'user-b@iso.gov.br', senha: USER_PASS }).expect(503);
    expect(r.body.code).toBe('manutencao');
  });
});
