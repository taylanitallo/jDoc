/**
 * Testes e2e de DOCUMENTOS (Fase 3).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  - upload valido (PDF) cria documento com hash sha-256 e file_key uuid
 *  - upload nao-PDF rejeitado (magic bytes, nao MIME do cliente)
 *  - upload acima da QUOTA bloqueado
 *  - busca server-side com filtros
 *  - soft delete -> lixeira -> restore
 *  - signed URL valida funciona; EXPIRADA rejeitada (403)
 *  - cross-tenant: doc do tenant A inacessivel pelo tenant B (404)
 *  - usuario 'consulta' sem permissao nao cria documento (403)
 *  - dashboard master do superadmin passa a contar documentos (to_regclass)
 */
import { createHmac } from 'node:crypto';
import { rm } from 'node:fs/promises';
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
const T_A = 'doc_e2e_a';
const T_B = 'doc_e2e_b';
const ADMIN_EMAIL = 'admin@doc.gov.br';
const CONSULTA_EMAIL = 'consulta@doc.gov.br';
const PASS = 'senha-doc-e2e-123';
const SA_EMAIL = 'sa-doc-e2e@jeossistemas.com';
const SA_PASS = 'senha-sa-doc-123';
const SA_TOTP = 'JDOCE2EDOCSSECRETJDOCE2EDOCS';

let app: INestApplication;
let sql: postgres.Sql;

function fakePdf(sizeBytes: number): Buffer {
  const head = Buffer.from('%PDF-1.4\n');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, sizeBytes - head.length), 0x20)]);
}

async function cleanup(): Promise<void> {
  for (const slug of [T_A, T_B]) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
    await sql`DELETE FROM public.tenants WHERE slug = ${slug}`;
    await rm(`.storage/jdoc-${slug}`, { recursive: true, force: true }).catch(() => undefined);
  }
  await sql`DELETE FROM public.superadmins WHERE email = ${SA_EMAIL}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  await cleanup();

  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [slug, quotaMb] of [
    [T_A, 1], // quota minuscula: 1 MB — facilita teste de bloqueio
    [T_B, 100],
  ] as const) {
    await provisionTenantSchema(sql, slug);
    await sql`
      INSERT INTO public.tenants (slug, nome, schema_name, status, quota_disco_mb)
      VALUES (${slug}, ${'Orgao ' + slug}, ${'tenant_' + slug}, 'ativo', ${quotaMb})
    `;
    await sql.unsafe(
      `INSERT INTO "tenant_${slug}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, 'Admin Doc', $2, 'admin', false), ($3, 'Consulta Doc', $2, 'consulta', false)`,
      [ADMIN_EMAIL, hash, CONSULTA_EMAIL],
    );
  }

  const saHash = await argon2.hash(SA_PASS, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled)
    VALUES (${SA_EMAIL}, 'SA Doc E2E', ${saHash}, false, ${SA_TOTP}, true)
  `;

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

async function login(slug: string, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/t/${slug}/auth/login`)
    .send({ email, senha: PASS })
    .expect(200);
  return res.body.accessToken as string;
}

let docId = '';

describe('Documentos — Fase 3', () => {
  it('upload valido cria documento (hash sha-256, file_key uuid)', async () => {
    const token = await login(T_A, ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .post(`/t/${T_A}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .field('docCaixa', '000123')
      .field('empenho', '2026NE00045')
      .field('credor', 'Fornecedor Teste LTDA')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2026-05-10')
      .field('value', '1500.50')
      .field('exercicio', '2026')
      .attach('file', fakePdf(10_000), 'nota-fiscal.pdf')
      .expect(201);

    docId = res.body.id as string;
    expect(res.body.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.originalName).toBe('nota-fiscal.pdf');

    const row = await sql.unsafe(
      `SELECT file_key FROM "tenant_${T_A}".documents WHERE id = $1`,
      [docId],
    );
    expect(String((row[0] as { file_key: string }).file_key)).toMatch(
      /^[0-9a-f-]{36}\.pdf$/,
    );
  });

  it('upload NAO-PDF rejeitado por magic bytes (mesmo com nome .pdf)', async () => {
    const token = await login(T_A, ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .post(`/t/${T_A}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .field('docCaixa', '1')
      .field('empenho', '1')
      .field('credor', 'X Y')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2026-05-10')
      .field('exercicio', '2026')
      .attach('file', Buffer.from('MZ executavel disfarcado'), 'virus.pdf')
      .expect(400);
    expect(res.body.message).toContain('apenas PDF');
  });

  it('upload acima da QUOTA bloqueado (quota 1 MB)', async () => {
    const token = await login(T_A, ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .post(`/t/${T_A}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .field('docCaixa', '2')
      .field('empenho', '2')
      .field('credor', 'Grande Arquivo SA')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2026-05-10')
      .field('exercicio', '2026')
      .attach('file', fakePdf(2 * 1024 * 1024), 'grande.pdf')
      .expect(403);
    expect(res.body.message).toContain('Quota');
  });

  it('busca server-side filtra por credor e exercicio', async () => {
    const token = await login(T_A, ADMIN_EMAIL);
    const found = await request(app.getHttpServer())
      .get(`/t/${T_A}/documents?module=despesas&q=Fornecedor&exercicio=2026`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(found.body.total).toBe(1);

    const notFound = await request(app.getHttpServer())
      .get(`/t/${T_A}/documents?module=despesas&q=Inexistente`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(notFound.body.total).toBe(0);
  });

  it('signed URL valida serve o PDF; URL EXPIRADA = 403', async () => {
    const token = await login(T_A, ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .get(`/t/${T_A}/documents/${docId}/url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const url = new URL(res.body.url as string);

    // URL valida funciona
    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);

    // URL com exp no passado (assinada corretamente) = 403 'URL expirada'
    const key = url.pathname.split('/').pop() as string;
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    const secret = process.env.COOKIE_SECRET ?? 'x'.repeat(32);
    const sig = createHmac('sha256', secret).update(`${T_A}|${key}|${pastExp}`).digest('hex');
    const expired = await request(app.getHttpServer())
      .get(`/files/${T_A}/${key}?exp=${pastExp}&sig=${sig}`)
      .expect(403);
    expect(expired.body.message).toBe('URL expirada');
  });

  it('cross-tenant: doc do tenant A e 404 no tenant B', async () => {
    const tokenB = await login(T_B, ADMIN_EMAIL);
    await request(app.getHttpServer())
      .get(`/t/${T_B}/documents/${docId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/t/${T_B}/documents/${docId}/url`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it("usuario 'consulta' le mas NAO cria (RBAC por modulo)", async () => {
    const token = await login(T_A, CONSULTA_EMAIL);
    // sem permissao de leitura concedida -> 403 tambem na listagem
    await request(app.getHttpServer())
      .get(`/t/${T_A}/documents?module=despesas`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/t/${T_A}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .field('docCaixa', '3')
      .field('empenho', '3')
      .field('credor', 'A B')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2026-05-10')
      .field('exercicio', '2026')
      .attach('file', fakePdf(1000), 'x.pdf')
      .expect(403);
  });

  it('soft delete -> some da lista, aparece na lixeira; restore volta', async () => {
    const token = await login(T_A, ADMIN_EMAIL);

    await request(app.getHttpServer())
      .delete(`/t/${T_A}/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // fora da lista
    const list = await request(app.getHttpServer())
      .get(`/t/${T_A}/documents?module=despesas`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((list.body.items as Array<{ id: string }>).some((d) => d.id === docId)).toBe(false);

    // na lixeira — e a linha NAO sumiu do banco (soft delete)
    const trash = await request(app.getHttpServer())
      .get(`/t/${T_A}/documents/trash?module=despesas`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((trash.body.items as Array<{ id: string }>).some((d) => d.id === docId)).toBe(true);
    const row = await sql.unsafe(
      `SELECT deleted_at FROM "tenant_${T_A}".documents WHERE id = $1`,
      [docId],
    );
    expect((row[0] as { deleted_at: Date | null }).deleted_at).not.toBeNull();

    // restore
    await request(app.getHttpServer())
      .post(`/t/${T_A}/documents/${docId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    const after = await request(app.getHttpServer())
      .get(`/t/${T_A}/documents?module=despesas`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((after.body.items as Array<{ id: string }>).some((d) => d.id === docId)).toBe(true);
  });

  it('dashboard master do superadmin CONTA documentos (pos-Fase 3)', async () => {
    const saRes = await request(app.getHttpServer())
      .post('/superadmin/auth/login')
      .send({ email: SA_EMAIL, senha: SA_PASS, totp: authenticator.generate(SA_TOTP) })
      .expect(200);
    const dash = await request(app.getHttpServer())
      .get('/superadmin/dashboard')
      .set('Authorization', `Bearer ${saRes.body.accessToken}`)
      .expect(200);
    expect(dash.body.documentosIndexados).toBeGreaterThanOrEqual(1);
    expect(dash.body.uploadsNoMes).toBeGreaterThanOrEqual(1);
  });
});
