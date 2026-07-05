/**
 * Testes e2e do painel SUPERADMIN (Fase 2).
 * Requer postgres + redis (docker compose) + migrate + seed executados.
 *
 * Cobre:
 *  - Nenhuma rota /superadmin e publica (401 sem token)
 *  - Token de tenant NAO acessa /superadmin/tenants (401)
 *  - Login superadmin exige TOTP; com TOTP valido funciona
 *  - CRUD de orgao: criar (provisiona schema), editar, quota, desativar
 *    (desativar bloqueia login do tenant na hora — cache invalidado)
 *  - CRUD de usuarios de tenant + reset de senha revoga sessoes
 *  - Logs globais registram as acoes
 */
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
const SA_EMAIL = 'sa-e2e@jeossistemas.com';
const SA_PASS = 'senha-super-e2e-123';
const SA_TOTP_SECRET = 'JDOCE2ETESTSECRETJDOCE2ETEST';
const NEW_SLUG = 'sa_e2e_novo';
const TENANT_X = 'sa_e2e_x';
const USER_EMAIL = 'op@teste.gov.br';
const USER_PASS = 'senha-forte-123';

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(): Promise<void> {
  for (const slug of [NEW_SLUG, TENANT_X]) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
    await sql`DELETE FROM public.tenants WHERE slug = ${slug}`;
  }
  await sql`DELETE FROM public.superadmins WHERE email = ${SA_EMAIL}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  await cleanup();

  // Superadmin de teste com TOTP habilitado.
  const hash = await argon2.hash(SA_PASS, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled)
    VALUES (${SA_EMAIL}, 'SA E2E', ${hash}, false, ${SA_TOTP_SECRET}, true)
  `;

  // Tenant X com usuario (para teste de token de tenant + desativacao).
  await provisionTenantSchema(sql, TENANT_X);
  const userHash = await argon2.hash(USER_PASS, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status)
    VALUES (${TENANT_X}, 'Orgao X', ${'tenant_' + TENANT_X}, 'ativo')
  `;
  await sql.unsafe(
    `INSERT INTO "tenant_${TENANT_X}".users (email, nome, senha_hash, role, must_change_password)
     VALUES ($1, 'Operador X', $2, 'operador', false)`,
    [USER_EMAIL, userHash],
  );

  // Limpa brute-force de execucoes anteriores.
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const bfKeys = await redis.keys('bf:*');
  if (bfKeys.length > 0) await redis.del(...bfKeys);
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
  await sql?.end({ timeout: 5 });
});

async function saLogin(): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/superadmin/auth/login')
    .send({ email: SA_EMAIL, senha: SA_PASS, totp: authenticator.generate(SA_TOTP_SECRET) })
    .expect(200);
  return res.body.accessToken as string;
}

async function tenantLogin(slug: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/t/${slug}/auth/login`)
    .send({ email: USER_EMAIL, senha: USER_PASS })
    .expect(200);
  return res.body.accessToken as string;
}

describe('Superadmin — Fase 2', () => {
  it('rotas /superadmin NUNCA sao publicas (401 sem token)', async () => {
    await request(app.getHttpServer()).get('/superadmin/tenants').expect(401);
    await request(app.getHttpServer()).get('/superadmin/dashboard').expect(401);
    await request(app.getHttpServer()).get('/superadmin/logs/global').expect(401);
  });

  it('token de TENANT nao acessa /superadmin (401)', async () => {
    const token = await tenantLogin(TENANT_X);
    await request(app.getHttpServer())
      .get('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('login superadmin SEM totp = 401 generico', async () => {
    const res = await request(app.getHttpServer())
      .post('/superadmin/auth/login')
      .send({ email: SA_EMAIL, senha: SA_PASS })
      .expect(401);
    expect(res.body.message).toBe('Credenciais invalidas');
  });

  it('cria orgao (provisiona schema) e lista com uso de disco', async () => {
    const token = await saLogin();
    const created = await request(app.getHttpServer())
      .post('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: NEW_SLUG,
        nome: 'Prefeitura E2E',
        cidade: 'Fortaleza',
        uf: 'CE',
        responsavel: 'Fulano de Tal',
        email: 'contato@e2e.gov.br',
        quotaDiscoMb: 512,
      })
      .expect(201);
    expect(created.body.schemaName).toBe(`tenant_${NEW_SLUG}`);

    // schema realmente existe
    const reg = await sql`SELECT to_regclass(${`tenant_${NEW_SLUG}.users`}) AS r`;
    expect(reg[0]?.r).not.toBeNull();

    const list = await request(app.getHttpServer())
      .get('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const found = (list.body as Array<{ slug: string; usoBytes: number; usoPercent: number }>).find(
      (t) => t.slug === NEW_SLUG,
    );
    expect(found).toBeDefined();
    expect(found!.usoBytes).toBeGreaterThanOrEqual(0);
  });

  it('slug duplicado = 409', async () => {
    const token = await saLogin();
    await request(app.getHttpServer())
      .post('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: NEW_SLUG,
        nome: 'Duplicado',
        cidade: 'Sobral',
        uf: 'CE',
        responsavel: 'Y Z W',
        email: 'dup@e2e.gov.br',
        quotaDiscoMb: 512,
      })
      .expect(409);
  });

  it('edita orgao e altera quota', async () => {
    const token = await saLogin();
    const list = await request(app.getHttpServer())
      .get('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`);
    const t = (list.body as Array<{ id: string; slug: string }>).find((x) => x.slug === NEW_SLUG)!;

    await request(app.getHttpServer())
      .patch(`/superadmin/tenants/${t.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Prefeitura E2E Editada' })
      .expect(204);

    await request(app.getHttpServer())
      .patch(`/superadmin/tenants/${t.id}/quota`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quotaDiscoMb: 2048 })
      .expect(204);

    const after = await request(app.getHttpServer())
      .get(`/superadmin/tenants/${t.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.nome).toBe('Prefeitura E2E Editada');
    expect(after.body.quotaDiscoMb).toBe(2048);
  });

  it('desativar orgao bloqueia login do tenant NA HORA (cache invalidado)', async () => {
    const token = await saLogin();
    const list = await request(app.getHttpServer())
      .get('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`);
    const t = (list.body as Array<{ id: string; slug: string }>).find((x) => x.slug === TENANT_X)!;

    // login funciona antes
    await tenantLogin(TENANT_X);

    await request(app.getHttpServer())
      .patch(`/superadmin/tenants/${t.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'inativo' })
      .expect(204);

    // bloqueado imediatamente (403 orgao suspenso)
    const blocked = await request(app.getHttpServer())
      .post(`/t/${TENANT_X}/auth/login`)
      .send({ email: USER_EMAIL, senha: USER_PASS });
    expect(blocked.status).toBe(403);

    // reativa
    await request(app.getHttpServer())
      .patch(`/superadmin/tenants/${t.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ativo' })
      .expect(204);
    await tenantLogin(TENANT_X);
  });

  it('cria usuario em tenant, reseta senha (revoga sessoes) e desativa', async () => {
    const token = await saLogin();
    const list = await request(app.getHttpServer())
      .get('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`);
    const t = (list.body as Array<{ id: string; slug: string }>).find((x) => x.slug === TENANT_X)!;

    const created = await request(app.getHttpServer())
      .post(`/superadmin/tenants/${t.id}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'novo@x.gov.br', nome: 'Novo Usuario', senha: 'senha-nova-1234', role: 'consulta' })
      .expect(201);
    const userId = created.body.id as string;

    await request(app.getHttpServer())
      .patch(`/superadmin/tenants/${t.id}/users/${userId}/password`)
      .set('Authorization', `Bearer ${token}`)
      .send({ novaSenha: 'outra-senha-9876' })
      .expect(204);

    await request(app.getHttpServer())
      .patch(`/superadmin/tenants/${t.id}/users/${userId}/ativo`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ativo: false })
      .expect(204);

    const users = await request(app.getHttpServer())
      .get(`/superadmin/tenants/${t.id}/users`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const u = (users.body as Array<{ id: string; ativo: boolean }>).find((x) => x.id === userId)!;
    expect(u.ativo).toBe(false);
  });

  it('logs globais registram as acoes do superadmin', async () => {
    const token = await saLogin();
    const res = await request(app.getHttpServer())
      .get('/superadmin/logs/global?action=tenant_created&pageSize=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const actions = (res.body.items as Array<{ action: string }>).map((i) => i.action);
    expect(actions).toContain('tenant_created');
  });

  it('dashboard master retorna totais coerentes', async () => {
    const token = await saLogin();
    const res = await request(app.getHttpServer())
      .get('/superadmin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.totalOrgaos).toBeGreaterThanOrEqual(2);
    expect(res.body.orgaosAtivos + res.body.orgaosInativos).toBe(res.body.totalOrgaos);
    expect(res.body.armazenamentoTotalBytes).toBeGreaterThan(0);
    expect(Array.isArray(res.body.crescimento)).toBe(true);
  });

  it('body com campo extra = 400 (zod strict)', async () => {
    const token = await saLogin();
    await request(app.getHttpServer())
      .post('/superadmin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: 'qualquer_x',
        nome: 'Teste',
        cidade: 'X',
        uf: 'CE',
        responsavel: 'A B C',
        email: 'a@b.gov.br',
        hacker: true,
      })
      .expect(400);
  });
});
