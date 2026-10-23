/**
 * "Esqueci a senha" do orgao. Requer postgres + redis e `pnpm db:migrate`.
 *
 * Cobre:
 *  - resposta igual para conta existente e inexistente (CPF ou e-mail)
 *  - pedido gera um registro com hashes (nada em claro)
 *  - link (token) redefine a senha uma unica vez
 *  - codigo: errado conta tentativa; 5 erros invalidam; certo redefine
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'rec_senha_e2e';
const SCHEMA = `tenant_${SLUG}`;
const EMAIL = 'recupera@e2e.gov.br';
const CPF = '52998224725';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

let app: INestApplication;
let sql: postgres.Sql;
let userId = '';

async function limpar(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  await limpar();
  await provisionTenantSchema(sql, SLUG);
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status) VALUES (${SLUG}, 'Orgao Recuperacao', ${SCHEMA}, 'ativo')`;
  const hash = await argon2.hash('senha-antiga-123', { type: argon2.argon2id });
  const [u] = await sql.unsafe<Array<{ id: string }>>(
    `INSERT INTO "${SCHEMA}".users (email, nome, cpf, senha_hash, role, must_change_password) VALUES ($1, 'Fulana', $2, $3, 'operador', false) RETURNING id`,
    [EMAIL, CPF, hash],
  );
  userId = u!.id;
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

const pedir = (identificador: string) =>
  request(app.getHttpServer()).post(`/t/${SLUG}/auth/esqueci-senha`).send({ identificador }).expect(200);

describe('Esqueci a senha', () => {
  it('responde igual exista ou nao a conta', async () => {
    const nao = await pedir('ninguem@e2e.gov.br');
    const sim = await pedir('529.982.247-25');
    expect(sim.body).toEqual(nao.body);
    // So o hash vai para o banco.
    const [r] = await sql.unsafe<Array<{ token_hash: string; codigo_hash: string }>>(
      `SELECT token_hash, codigo_hash FROM "${SCHEMA}".password_resets WHERE user_id = $1`,
      [userId],
    );
    expect(r?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('link redefine a senha uma unica vez', async () => {
    const token = 'a'.repeat(64);
    await sql.unsafe(`UPDATE "${SCHEMA}".password_resets SET usado_em = now() WHERE user_id = $1`, [userId]);
    await sql.unsafe(
      `INSERT INTO "${SCHEMA}".password_resets (user_id, token_hash, codigo_hash, expira_em, codigo_expira_em)
       VALUES ($1, $2, $3, now() + interval '1 hour', now() + interval '15 minutes')`,
      [userId, sha(token), sha(`${userId}:000000`)],
    );
    const v = await request(app.getHttpServer()).post(`/t/${SLUG}/auth/redefinir-senha/validar`).send({ token }).expect(200);
    expect(v.body.valido).toBe(true);
    await request(app.getHttpServer()).post(`/t/${SLUG}/auth/redefinir-senha`).send({ token, novaSenha: 'senha-nova-123' }).expect(204);
    await request(app.getHttpServer()).post(`/t/${SLUG}/auth/redefinir-senha`).send({ token, novaSenha: 'outra-senha-123' }).expect(400);
    await request(app.getHttpServer()).post(`/t/${SLUG}/auth/login`).send({ email: EMAIL, senha: 'senha-nova-123' }).expect(200);
  });

  it('codigo: 5 erros invalidam o pedido; certo antes disso redefine', async () => {
    const novo = async () => {
      await sql.unsafe(`UPDATE "${SCHEMA}".password_resets SET usado_em = now() WHERE user_id = $1`, [userId]);
      await sql.unsafe(
        `INSERT INTO "${SCHEMA}".password_resets (user_id, token_hash, codigo_hash, expira_em, codigo_expira_em)
         VALUES ($1, $2, $3, now() + interval '1 hour', now() + interval '15 minutes')`,
        [userId, sha(`${Date.now()}${Math.random()}`).slice(0, 64), sha(`${userId}:123456`)],
      );
    };
    await novo();
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post(`/t/${SLUG}/auth/redefinir-senha`)
        .send({ identificador: EMAIL, codigo: '999999', novaSenha: 'qualquer-123' })
        .expect(400);
    }
    // Ja invalidado: nem o codigo certo passa.
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/auth/redefinir-senha`)
      .send({ identificador: EMAIL, codigo: '123456', novaSenha: 'qualquer-123' })
      .expect(400);

    await novo();
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/auth/redefinir-senha`)
      .send({ identificador: CPF, codigo: '123456', novaSenha: 'pelo-codigo-123' })
      .expect(204);
    await request(app.getHttpServer()).post(`/t/${SLUG}/auth/login`).send({ email: EMAIL, senha: 'pelo-codigo-123' }).expect(200);
  });
});
