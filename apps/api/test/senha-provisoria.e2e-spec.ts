/**
 * Senha provisoria (padrao JEOS): trocar antes de entrar. Requer postgres +
 * redis e `pnpm db:migrate`.
 *
 * Cobre, no orgao e no superadmin:
 *  - com senha provisoria, so ver a conta, trocar a senha e sair
 *  - a troca obrigatoria nao pede a senha atual, mas recusa repetir a provisoria
 *  - depois da troca o sistema libera e a senha atual volta a ser exigida
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
const SLUG = 'senha_prov_e2e';
const SCHEMA = `tenant_${SLUG}`;
const EMAIL = 'provisoria@e2e.gov.br';
const ADMIN = 'provisoria-e2e@jeossistemas.com';
const PROVISORIA = 'provisoria-e2e-123';
const NOVA = 'escolhida-e2e-456';
const TOTP = 'JDOCPROVISORIAE2ESECRETJDOCPROV';

let app: INestApplication;
let sql: postgres.Sql;
let redis: Redis;

async function limpar(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
  await sql`DELETE FROM public.superadmins WHERE email = ${ADMIN}`;
  const chaves = await redis.keys('bf:*');
  if (chaves.length) await redis.del(...chaves);
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await limpar();
  await provisionTenantSchema(sql, SLUG);
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status) VALUES (${SLUG}, 'Orgao Provisoria', ${SCHEMA}, 'ativo')`;
  const hash = await argon2.hash(PROVISORIA, { type: argon2.argon2id });
  await sql.unsafe(
    `INSERT INTO "${SCHEMA}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Fulana', $2, 'admin', true)`,
    [EMAIL, hash],
  );
  await sql`
    INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled, role)
    VALUES (${ADMIN}, 'Admin Provisorio', ${hash}, true, ${TOTP}, true, 'owner')
  `;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser(process.env.COOKIE_SECRET ?? 'x'.repeat(32)));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await limpar();
  await redis?.quit();
  await sql?.end({ timeout: 5 });
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Senha provisoria no orgao', () => {
  it('bloqueia o sistema ate a troca e libera depois', async () => {
    const http = request(app.getHttpServer());
    const login = await http.post(`/t/${SLUG}/auth/login`).send({ email: EMAIL, senha: PROVISORIA }).expect(200);
    expect(login.body.mustChangePassword).toBe(true);
    const auth = bearer(login.body.accessToken as string);
    const cookie = login.headers['set-cookie'] as unknown as string[];

    const barrado = await http.post(`/t/${SLUG}/auth/mfa/setup`).set(auth).expect(403);
    expect(barrado.body.code).toBe('trocar_senha');
    const me = await http.get(`/t/${SLUG}/auth/me`).set(auth).expect(200);
    expect(me.body.mustChangePassword).toBe(true);

    await http.post(`/t/${SLUG}/auth/password`).set(auth).send({ novaSenha: PROVISORIA }).expect(400);
    await http.post(`/t/${SLUG}/auth/password`).set(auth).send({ novaSenha: NOVA }).expect(204);

    const renovado = await http.post(`/t/${SLUG}/auth/refresh`).set('Cookie', cookie).expect(200);
    expect(renovado.body.mustChangePassword).toBe(false);
    const novoAuth = bearer(renovado.body.accessToken as string);
    await http.post(`/t/${SLUG}/auth/mfa/setup`).set(novoAuth).expect(200);

    await http.post(`/t/${SLUG}/auth/password`).set(novoAuth).send({ novaSenha: 'outra-e2e-789' }).expect(400);
  });
});

describe('Senha provisoria no superadmin', () => {
  it('bloqueia o painel ate a troca e libera na requisicao seguinte', async () => {
    const http = request(app.getHttpServer());
    const login = await http.post('/superadmin/auth/login').send({ email: ADMIN, senha: PROVISORIA, totp: authenticator.generate(TOTP) }).expect(200);
    expect(login.body.mustChangePassword).toBe(true);
    const auth = bearer(login.body.accessToken as string);

    const barrado = await http.get('/superadmin/tenants').set(auth).expect(403);
    expect(barrado.body.code).toBe('trocar_senha');
    await http.get('/superadmin/me').set(auth).expect(200);

    await http.post('/superadmin/auth/password').set(auth).send({ novaSenha: PROVISORIA }).expect(400);
    await http.post('/superadmin/auth/password').set(auth).send({ novaSenha: NOVA }).expect(204);

    await http.get('/superadmin/tenants').set(auth).expect(200);
    await http.post('/superadmin/auth/password').set(auth).send({ novaSenha: 'outra-e2e-7890' }).expect(400);
  });
});
