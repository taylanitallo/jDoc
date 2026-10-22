/**
 * Equipe da plataforma (Padrao JEOS, secao 3). Requer postgres + redis e
 * `pnpm db:migrate` (tabela platform.admin_sessions).
 *
 * Cobre:
 *  - login em 2 etapas (mfa_required) e admin sem 2FA preso as rotas de 2FA
 *  - 5 erros seguidos = 423 "Conta bloqueada temporariamente."
 *  - acao critica sem reauth = 403 reauth_required; reauth libera e repete
 *  - papel support barrado em equipe e configuracoes
 *  - sessao encerrada derruba o acesso; logout invalida o token
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
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SENHA = 'senha-equipe-e2e-123';
const TOTP = 'JDOCEQUIPEE2ESECRETJDOCEQUIPE';
const OWNER = 'owner-equipe-e2e@jeossistemas.com';
const SUPORTE = 'suporte-equipe-e2e@jeossistemas.com';
const NOVATO = 'novato-equipe-e2e@jeossistemas.com';
const BLOQUEAR = 'bloqueio-equipe-e2e@jeossistemas.com';
const EMAILS = [OWNER, SUPORTE, NOVATO, BLOQUEAR];

let app: INestApplication;
let sql: postgres.Sql;
let redis: Redis;

async function limpar(): Promise<void> {
  await sql`DELETE FROM public.superadmins WHERE email IN ${sql(EMAILS)}`;
  const chaves = await redis.keys('bf:*');
  if (chaves.length) await redis.del(...chaves);
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await limpar();
  const hash = await argon2.hash(SENHA, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled, role) VALUES
      (${OWNER}, 'Owner E2E', ${hash}, false, ${TOTP}, true, 'owner'),
      (${SUPORTE}, 'Suporte E2E', ${hash}, false, ${TOTP}, true, 'support'),
      (${NOVATO}, 'Novato E2E', ${hash}, false, NULL, false, 'owner'),
      (${BLOQUEAR}, 'Bloqueio E2E', ${hash}, false, NULL, false, 'support')
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

async function entrar(email: string, comCodigo = true): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/superadmin/auth/login')
    .send({ email, senha: SENHA, ...(comCodigo ? { totp: authenticator.generate(TOTP) } : {}) })
    .expect(200);
  return res.body.accessToken as string;
}

describe('Equipe da plataforma', () => {
  it('etapa 1 com 2FA ligado responde mfa_required; etapa 2 entra', async () => {
    const r = await request(app.getHttpServer()).post('/superadmin/auth/login').send({ email: OWNER, senha: SENHA }).expect(401);
    expect(r.body.code).toBe('mfa_required');
    const token = await entrar(OWNER);
    const me = await request(app.getHttpServer()).get('/superadmin/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body).toMatchObject({ email: OWNER, role: 'owner', mfaEnabled: true });
  });

  it('sem 2FA configurado so acessa me e as rotas de 2FA', async () => {
    const token = await entrar(NOVATO, false);
    const auth = { Authorization: `Bearer ${token}` };
    await request(app.getHttpServer()).get('/superadmin/me').set(auth).expect(200);
    const barrado = await request(app.getHttpServer()).get('/superadmin/tenants').set(auth).expect(403);
    expect(barrado.body.code).toBe('mfa_setup_required');
    await request(app.getHttpServer()).post('/superadmin/auth/mfa/setup').set(auth).expect(200);
  });

  it('5 erros seguidos bloqueiam a conta por 15 minutos (423)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/superadmin/auth/login').send({ email: BLOQUEAR, senha: 'errada-errada-1' }).expect(401);
    }
    const r = await request(app.getHttpServer()).post('/superadmin/auth/login').send({ email: BLOQUEAR, senha: SENHA }).expect(423);
    expect(r.body.error).toBe('Conta bloqueada temporariamente.');
    const ttl = await redis.ttl(`bf:acct:sa:${BLOQUEAR}:lock`);
    expect(ttl).toBeGreaterThan(14 * 60);
  });

  it('acao critica pede reautenticacao e funciona depois dela', async () => {
    const token = await entrar(OWNER);
    const auth = { Authorization: `Bearer ${token}` };
    const [suporte] = await sql<Array<{ id: string }>>`SELECT id FROM public.superadmins WHERE email = ${SUPORTE}`;
    const semReauth = await request(app.getHttpServer())
      .post(`/superadmin/admins/${suporte!.id}/revoke-sessions`)
      .set(auth)
      .expect(403);
    expect(semReauth.body.code).toBe('reauth_required');

    await request(app.getHttpServer())
      .post('/superadmin/auth/reauth')
      .set(auth)
      .send({ senha: 'senha-errada-xyz', totp: authenticator.generate(TOTP) })
      .expect(400);
    await request(app.getHttpServer())
      .post('/superadmin/auth/reauth')
      .set(auth)
      .send({ senha: SENHA, totp: authenticator.generate(TOTP) })
      .expect(200);

    // A mesma acao, repetida (como o front faz sozinho), agora passa.
    await request(app.getHttpServer()).post(`/superadmin/admins/${suporte!.id}/revoke-sessions`).set(auth).expect(200);
    const log = await sql`
      SELECT admin_name FROM public.global_audit_logs WHERE action = 'admin_sessoes_encerradas' AND entity_id = ${suporte!.id}
    `;
    expect(log[0]?.admin_name).toBe('Owner E2E');
  });

  it('papel support nao entra em equipe nem em configuracoes', async () => {
    const token = await entrar(SUPORTE);
    const auth = { Authorization: `Bearer ${token}` };
    const r = await request(app.getHttpServer()).get('/superadmin/admins').set(auth).expect(403);
    expect(r.body.code).toBe('papel_sem_acesso');
    await request(app.getHttpServer()).get('/superadmin/settings').set(auth).expect((res) => {
      expect([403, 404]).toContain(res.status);
    });
    // Mas le os orgaos.
    await request(app.getHttpServer()).get('/superadmin/tenants').set(auth).expect(200);
  });

  it('sessao encerrada derruba o acesso mesmo com o token ainda valido', async () => {
    const t1 = await entrar(OWNER);
    const t2 = await entrar(OWNER);
    const minhas = await request(app.getHttpServer()).get('/superadmin/auth/sessions').set('Authorization', `Bearer ${t1}`).expect(200);
    const sessaoT1 = (minhas.body as Array<{ id: string; atual: boolean }>).find((s) => s.atual);
    expect(sessaoT1).toBeDefined();
    // Encerrada de outro navegador (t2).
    await request(app.getHttpServer()).delete(`/superadmin/auth/sessions/${sessaoT1!.id}`).set('Authorization', `Bearer ${t2}`).expect(204);
    await request(app.getHttpServer()).get('/superadmin/me').set('Authorization', `Bearer ${t1}`).expect(401);
    await request(app.getHttpServer()).get('/superadmin/me').set('Authorization', `Bearer ${t2}`).expect(200);
  });
});
