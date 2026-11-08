/**
 * "Aparelhos conectados" do orgao. Requer postgres + redis e `pnpm db:migrate`.
 *
 * Cobre:
 *  - lista as sessoes do proprio usuario com aparelho, IP e qual e a atual
 *  - encerrar derruba o access token na hora e impede o refresh
 *  - ninguem encerra a sessao de outra pessoa
 *  - trocar a senha encerra os outros aparelhos
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { provisionTenantSchema } from '@jdoc/database';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'sessoes_e2e';
const SCHEMA = `tenant_${SLUG}`;
const SENHA = 'senha-sessoes-123';
const MARIA = 'maria@sessoes.gov.br';
const JOAO = 'joao@sessoes.gov.br';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';

let app: INestApplication;
let sql: postgres.Sql;
let redis: Redis;

async function limpar(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
  const chaves = await redis.keys('bf:*');
  if (chaves.length) await redis.del(...chaves);
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await limpar();
  await provisionTenantSchema(sql, SLUG);
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status) VALUES (${SLUG}, 'Orgao Sessoes', ${SCHEMA}, 'ativo')`;
  const hash = await argon2.hash(SENHA, { type: argon2.argon2id });
  await sql.unsafe(
    `INSERT INTO "${SCHEMA}".users (email, nome, senha_hash, role, must_change_password)
     VALUES ($1, 'Maria', $3, 'admin', false), ($2, 'Joao', $3, 'admin', false)`,
    [MARIA, JOAO, hash],
  );
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

async function entrar(email: string, navegador: string) {
  const res = await request(app.getHttpServer())
    .post(`/t/${SLUG}/auth/login`)
    .set('User-Agent', navegador)
    .send({ email, senha: SENHA })
    .expect(200);
  return {
    auth: { Authorization: `Bearer ${res.body.accessToken as string}` },
    cookie: res.headers['set-cookie'] as unknown as string[],
  };
}

describe('Aparelhos conectados do orgao', () => {
  it('lista, encerra na hora e nao mexe na sessao de outra pessoa', async () => {
    const http = request(app.getHttpServer());
    const notebook = await entrar(MARIA, CHROME);
    const celular = await entrar(MARIA, FIREFOX);
    const joao = await entrar(JOAO, CHROME);

    const lista = await http.get(`/t/${SLUG}/auth/sessions`).set(notebook.auth).expect(200);
    expect(lista.body).toHaveLength(2);
    const atual = lista.body.find((s: { atual: boolean }) => s.atual);
    const outra = lista.body.find((s: { atual: boolean }) => !s.atual);
    expect(atual.dispositivo).toContain('Chrome');
    expect(outra.dispositivo).toContain('Firefox');
    expect(outra.ip).toBeTruthy();

    await http.delete(`/t/${SLUG}/auth/sessions/${outra.id}`).set(joao.auth).expect(404);
    await http.get(`/t/${SLUG}/auth/me`).set(celular.auth).expect(200);

    await http.delete(`/t/${SLUG}/auth/sessions/${outra.id}`).set(notebook.auth).expect(204);
    await http.get(`/t/${SLUG}/auth/me`).set(celular.auth).expect(401);
    await http.post(`/t/${SLUG}/auth/refresh`).set('Cookie', celular.cookie).expect(401);

    await http.get(`/t/${SLUG}/auth/me`).set(notebook.auth).expect(200);
    const depois = await http.get(`/t/${SLUG}/auth/sessions`).set(notebook.auth).expect(200);
    expect(depois.body).toHaveLength(1);
  });

  it('trocar a senha encerra os outros aparelhos e mantem este', async () => {
    const http = request(app.getHttpServer());
    const este = await entrar(JOAO, CHROME);
    const outro = await entrar(JOAO, FIREFOX);

    await http.post(`/t/${SLUG}/auth/password`).set(este.auth).send({ senhaAtual: SENHA, novaSenha: 'senha-nova-sessoes-456' }).expect(204);

    await http.get(`/t/${SLUG}/auth/me`).set(outro.auth).expect(401);
    await http.post(`/t/${SLUG}/auth/refresh`).set('Cookie', outro.cookie).expect(401);
    await http.get(`/t/${SLUG}/auth/me`).set(este.auth).expect(200);
  });
});
