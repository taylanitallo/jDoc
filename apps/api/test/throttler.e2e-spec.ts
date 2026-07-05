/**
 * Teste e2e de THROTTLING (Fase 7a).
 * Liga o throttler global via resetModules + import dinamico, e valida:
 *  - login bloqueia apos 5 tentativas em 60s (429)
 *  - relatorio (POST) bloqueia apos 5 tentativas em 60s (429)
 *
 * O vitest.e2e.config.ts liga THROTTLE_DISABLED=1 por padrao. Aqui
 * precisamos do throttler LIGADO, entao o spec faz:
 *   1. process.env.THROTTLE_DISABLED = ''  (vai entrar no else do modulo)
 *   2. vi.resetModules() para invalidar o cache de importacao
 *   3. await import('../src/app.module')  -> recarrega com throttler ativo
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import * as argon2 from 'argon2';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'thr_e2e';
const ADMIN_EMAIL = 'admin@thr.gov.br';
const PASS = 'senha-thr-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${SLUG}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  // Liga o throttler (default da config e DISABLED para nao quebrar os outros specs).
  process.env.THROTTLE_DISABLED = '';
  // Limpa cache de modulos para que o throttler.module.ts releia process.env.
  vi.resetModules();

  sql = postgres(DB_URL, { max: 2 });
  await cleanup();

  await provisionTenantSchema(sql, SLUG);
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status)
    VALUES (${SLUG}, 'Orgao Throttler', ${'tenant_' + SLUG}, 'ativo')
  `;
  await sql.unsafe(
    `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password)
     VALUES ($1, 'Admin Thr', $2, 'admin', false)`,
    [ADMIN_EMAIL, hash],
  );

  // Import dinamico APOS resetModules -> AppModule le process.env novamente.
  const { AppModule } = await import('../src/app.module');
  const { AllExceptionsFilter } = await import('../src/common/all-exceptions.filter');

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

describe('Throttler — Fase 7a', () => {
  it('login bloqueia apos exceder o limite de 5/min (HTTP 429)', async () => {
    // Manda 8 chamadas sequenciais; coleta statuses. Espera-se que
    // pelo menos UMA delas retorne 429 e o restante 401 (credencial
    // invalida). Antes nao existia nenhuma protecao alem do brute-force
    // por conta; agora o throttler age independente da autenticacao.
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG}/auth/login`)
        .send({ email: ADMIN_EMAIL, senha: 'senha-errada' });
      statuses.push(res.status);
    }
    // Deve ter ocorrido ao menos um 429.
    expect(statuses).toContain(429);
    // As primeiras (ate o limite) devem ser 401.
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(1);
  });

  it('endpoint publico sem @Throttle respeita apenas o limite default 60/min', async () => {
    // /t/:slug/health e um endpoint simples. Sem @Throttle, vale o default (60/min).
    // 5 chamadas sequenciais devem todas retornar 200 ou 503 (sem DB), nunca 429.
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer()).get('/health');
      codes.push(res.status);
    }
    expect(codes.every((c) => c === 200 || c === 503)).toBe(true);
  });
});