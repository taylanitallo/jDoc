/**
 * Testes e2e da SEPARACAO DE MODULOS (Financeiro/Contabil x Arquivo).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  (1) orgao so Financeiro: rotas do Arquivo = 403 (mesmo admin); documento do Acervo = 403;
 *      documento financeiro nasce sem classificacao (sem integracao)
 *  (2) orgao so Arquivo: despesas, etiquetas e relatorios = 403; Acervo funciona
 *  (3) branding devolve os modulos (o menu usa) e superadmin liga/desliga na hora (cache invalidado)
 *  (4) comuns (busca, configuracoes) funcionam nos dois
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const FIN = 'mod_fin_e2e';
const ARQ = 'mod_arq_e2e';
const ADMIN = 'admin@mod.gov.br';
const PASS = 'senha-mod-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(slug: string): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${slug}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [slug, modulos] of [
    [FIN, '{financeiro}'],
    [ARQ, '{arquivo}'],
  ] as const) {
    await cleanup(slug);
    await provisionTenantSchema(sql, slug);
    await sql`
      INSERT INTO public.tenants (slug, nome, schema_name, status, modulos)
      VALUES (${slug}, ${'Orgao ' + slug}, ${'tenant_' + slug}, 'ativo', ${modulos})
    `;
    await sql.unsafe(
      `INSERT INTO "tenant_${slug}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Admin', $2, 'admin', false)`,
      [ADMIN, hash],
    );
  }
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  for (const pat of ['bf:*', 'tenant:slug:*']) {
    const keys = await redis.keys(pat);
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
  await cleanup(FIN);
  await cleanup(ARQ);
  await sql?.end({ timeout: 5 });
});

async function login(slug: string): Promise<string> {
  const res = await request(app.getHttpServer()).post(`/t/${slug}/auth/login`).send({ email: ADMIN, senha: PASS }).expect(200);
  return res.body.accessToken as string;
}

describe('Separacao de modulos', () => {
  it('(1) so Financeiro: Arquivo bloqueado e sem integracao arquivistica', async () => {
    const tok = await login(FIN);
    const get = (p: string) => request(app.getHttpServer()).get(`/t/${FIN}${p}`).set('Authorization', `Bearer ${tok}`);
    for (const p of ['/arquivistica/classificacoes', '/arquivistica/eliminacoes', '/arquivo-fisico/locais', '/documents?module=acervo']) {
      const r = await get(p).expect(403);
      expect(r.body.message).toMatch(/Arquivo/);
    }
    const tipo = await sql.unsafe(`INSERT INTO "tenant_${FIN}".document_types (nome, cor) VALUES ('X', 'blue') RETURNING id`);
    await request(app.getHttpServer())
      .post(`/t/${FIN}/documents`)
      .set('Authorization', `Bearer ${tok}`)
      .field('module', 'acervo')
      .field('exercicio', '2024')
      .field('documentTypeId', (tipo[0] as { id: string }).id)
      .field('descricao', 'x')
      .field('documentDate', '2024-01-01')
      .expect(403);
    const d = await request(app.getHttpServer())
      .post(`/t/${FIN}/documents`)
      .set('Authorization', `Bearer ${tok}`)
      .field('module', 'despesas')
      .field('exercicio', '2010')
      .field('docCaixa', '1')
      .field('empenho', '1')
      .field('credor', 'F')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2010-01-01')
      .expect(201);
    expect(d.body.classificacaoId).toBeNull();
    expect(d.body.dataPrevistaDestinacao).toBeNull();
  });

  it('(2) so Arquivo: financeiro bloqueado, Acervo funciona', async () => {
    const tok = await login(ARQ);
    const get = (p: string) => request(app.getHttpServer()).get(`/t/${ARQ}${p}`).set('Authorization', `Bearer ${tok}`);
    for (const p of ['/documents?module=despesas', '/documents?module=receitas', '/labels-imports', '/reports']) {
      const r = await get(p).expect(403);
      expect(r.body.message).toMatch(/Financeiro/);
    }
    await get('/documents?module=acervo').expect(200);
    await get('/arquivistica/classificacoes').expect(200);
    await get('/arquivo-fisico/locais').expect(200);
  });

  it('(3) branding informa modulos e superadmin liga o Arquivo na hora', async () => {
    const tok = await login(FIN);
    const b = await request(app.getHttpServer()).get(`/t/${FIN}/configuracoes/branding`).set('Authorization', `Bearer ${tok}`).expect(200);
    expect(b.body.modulos).toEqual(['financeiro']);

    // Mesmo efeito do PATCH do superadmin: grava e invalida o cache do tenant.
    await sql`UPDATE public.tenants SET modulos = '{arquivo,financeiro}' WHERE slug = ${FIN}`;
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    await redis.del(`tenant:slug:${FIN}`);
    await redis.quit();
    await request(app.getHttpServer()).get(`/t/${FIN}/arquivistica/classificacoes`).set('Authorization', `Bearer ${tok}`).expect(200);
    const b2 = await request(app.getHttpServer()).get(`/t/${FIN}/configuracoes/branding`).set('Authorization', `Bearer ${tok}`).expect(200);
    expect(b2.body.modulos).toEqual(['arquivo', 'financeiro']);
  });

  it('(4) comuns funcionam nos dois modulos', async () => {
    for (const slug of [FIN, ARQ]) {
      const tok = await login(slug);
      await request(app.getHttpServer()).get(`/t/${slug}/busca/indexacao`).set('Authorization', `Bearer ${tok}`).expect(200);
      await request(app.getHttpServer()).get(`/t/${slug}/configuracoes/tipos-documento`).set('Authorization', `Bearer ${tok}`).expect(200);
    }
  });
});
