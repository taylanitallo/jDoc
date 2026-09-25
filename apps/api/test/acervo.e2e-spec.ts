/**
 * Testes e2e do ACERVO (Arquivo Municipal).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  (1) tipos prontos do Acervo (com classe do plano) + lookup por modulo
 *  (2) inclusao com metadados validos herda classe e acesso do tipo
 *  (3) metadados invalidos / chave desconhecida = 400
 *  (4) busca livre encontra texto dos metadados
 *  (5) documento restrito: invisivel (busca e 404) sem acervo_restrito:read; visivel com a permissao
 *  (6) edicao de metadados revalida contra o tipo
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
const SLUG = 'acervo_e2e';
const ADMIN = 'admin@acervo.gov.br';
const OPERADOR = 'operador@acervo.gov.br';
const RH = 'rh@acervo.gov.br';
const PASS = 'senha-acervo-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${SLUG}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup();
  await provisionTenantSchema(sql, SLUG);
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status)
    VALUES (${SLUG}, 'Arquivo Municipal', ${'tenant_' + SLUG}, 'ativo')
  `;
  const ids: Record<string, string> = {};
  for (const [email, role] of [
    [ADMIN, 'admin'],
    [OPERADOR, 'operador'],
    [RH, 'operador'],
  ] as const) {
    const r = await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, $1, $2, $3, false) RETURNING id`,
      [email, hash, role],
    );
    ids[email] = (r[0] as { id: string }).id;
  }
  for (const [email, perms] of [
    [OPERADOR, ['acervo:read', 'acervo:create', 'acervo:update']],
    [RH, ['acervo:read', 'acervo_restrito:read']],
  ] as const) {
    for (const p of perms) {
      await sql.unsafe(
        `INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key) VALUES ($1, $2)`,
        [ids[email], p],
      );
    }
  }

  // Orgao de teste contrata os dois modulos (Arquivo + Financeiro).
  for (const s of [SLUG]) {
    await sql`UPDATE public.tenants SET modulos = '{financeiro,arquivo}' WHERE slug = ${s}`;
  }
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const bfKeys = await redis.keys('bf:*');
  if (bfKeys.length > 0) await redis.del(...bfKeys);
  // Tenant recriado com o mesmo slug: o cache de 60s ainda teria o tenant_id anterior.
  const tenantKeys = await redis.keys('tenant:slug:*');
  if (tenantKeys.length > 0) await redis.del(...tenantKeys);
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

async function login(email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post(`/t/${SLUG}/auth/login`).send({ email, senha: PASS }).expect(200);
  return res.body.accessToken as string;
}

describe('Acervo', () => {
  let admin: string;
  let operador: string;
  let tipos: Array<{ id: string; nome: string; classificacaoId: string | null; nivelAcessoPadrao: string }>;
  let leiId: string;
  let fichaId: string;

  it('(1) cria tipos prontos ligados ao plano de classificacao', async () => {
    admin = await login(ADMIN);
    operador = await login(OPERADOR);
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/arquivistica/classificacoes/modelo`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(201);
    const r = await request(app.getHttpServer())
      .post(`/t/${SLUG}/configuracoes/tipos-documento/modelos-acervo`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(201);
    expect(r.body.criados).toBe(6);

    const lookup = await request(app.getHttpServer())
      .get(`/t/${SLUG}/document-types?modulo=acervo`)
      .set('Authorization', `Bearer ${operador}`)
      .expect(200);
    tipos = lookup.body;
    expect(tipos.find((t) => t.nome === 'Lei Municipal')?.classificacaoId).toBeTruthy();
    // Acervo nasce restrito: todos os tipos prontos vem com acesso restrito por padrao.
    expect(tipos.every((t) => t.nivelAcessoPadrao === 'restrito')).toBe(true);
    // Lookup sem filtro continua so com 'outros' (compat. jDoc Desktop).
    const outros = await request(app.getHttpServer())
      .get(`/t/${SLUG}/document-types`)
      .set('Authorization', `Bearer ${operador}`)
      .expect(200);
    expect(outros.body).toEqual([]);
  });

  it('(2) inclui lei com metadados e herda classe do tipo', async () => {
    const lei = tipos.find((t) => t.nome === 'Lei Municipal')!;
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents`)
      .set('Authorization', `Bearer ${operador}`)
      .field('module', 'acervo')
      .field('exercicio', '2021')
      .field('documentTypeId', lei.id)
      .field('descricao', 'Plano Diretor')
      .field('documentDate', '2021-04-15')
      // lei e publica: o operador publica explicitamente (o padrao seria restrito)
      .field('nivelAcesso', 'publico')
      .field('metadados', JSON.stringify({ numero: '1.234', ementa: 'Institui o Plano Diretor Participativo', especie: 'Complementar' }))
      .field('digitalizado', 'true')
      .field('responsavelDigitalizacao', 'Maria Arquivista')
      .expect(201);
    leiId = res.body.id;
    expect(res.body.metadados).toEqual({ numero: '1.234', ementa: 'Institui o Plano Diretor Participativo', especie: 'Complementar' });
    expect(res.body.classificacaoCodigo).toBe('100.1');
    expect(res.body.digitalizado).toBe(true);
    expect(res.body.responsavelDigitalizacao).toBe('Maria Arquivista');
    expect(res.body.nivelAcesso).toBe('publico');
  });

  it('(3) metadados invalidos sao rejeitados', async () => {
    const lei = tipos.find((t) => t.nome === 'Lei Municipal')!;
    const base = () =>
      request(app.getHttpServer())
        .post(`/t/${SLUG}/documents`)
        .set('Authorization', `Bearer ${operador}`)
        .field('module', 'acervo')
        .field('exercicio', '2021')
        .field('documentTypeId', lei.id)
        .field('descricao', 'x')
        .field('documentDate', '2021-04-15');
    const semEmenta = await base().field('metadados', JSON.stringify({ numero: '1' })).expect(400);
    expect(semEmenta.body.message).toMatch(/Ementa/);
    await base().field('metadados', JSON.stringify({ numero: '1', ementa: 'x', hack: 'y' })).expect(400);
    await base().field('metadados', JSON.stringify({ numero: '1', ementa: 'x', especie: 'Inventada' })).expect(400);
  });

  it('(4) busca livre encontra texto dos metadados', async () => {
    const r = await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents?module=acervo&q=participativo`)
      .set('Authorization', `Bearer ${operador}`)
      .expect(200);
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([leiId]);
  });

  it('(5) ficha funcional (restrito pelo tipo) so aparece para quem tem acervo_restrito:read', async () => {
    const ficha = tipos.find((t) => t.nome === 'Ficha Funcional')!;
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'acervo')
      .field('exercicio', '2020')
      .field('documentTypeId', ficha.id)
      .field('descricao', 'Dossie do servidor')
      .field('documentDate', '2020-01-10')
      .field('metadados', JSON.stringify({ servidor: 'Joao da Silva', matricula: '777' }))
      .expect(201);
    fichaId = res.body.id;
    expect(res.body.nivelAcesso).toBe('restrito');

    const buscaOp = await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents?module=acervo`)
      .set('Authorization', `Bearer ${operador}`)
      .expect(200);
    expect(buscaOp.body.items.map((i: { id: string }) => i.id)).not.toContain(fichaId);
    await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents/${fichaId}`)
      .set('Authorization', `Bearer ${operador}`)
      .expect(404);

    const rh = await login(RH);
    const buscaRh = await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents?module=acervo&q=777`)
      .set('Authorization', `Bearer ${rh}`)
      .expect(200);
    expect(buscaRh.body.items.map((i: { id: string }) => i.id)).toContain(fichaId);
    await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents/${fichaId}`)
      .set('Authorization', `Bearer ${rh}`)
      .expect(200);
  });

  it('(6) edicao de metadados revalida contra o tipo', async () => {
    await request(app.getHttpServer())
      .patch(`/t/${SLUG}/documents/${leiId}`)
      .set('Authorization', `Bearer ${operador}`)
      .send({ metadados: { numero: '1.234' } })
      .expect(400);
    const ok = await request(app.getHttpServer())
      .patch(`/t/${SLUG}/documents/${leiId}`)
      .set('Authorization', `Bearer ${operador}`)
      .send({ metadados: { numero: '1.234', ementa: 'Nova ementa' } })
      .expect(200);
    expect(ok.body.metadados).toEqual({ numero: '1.234', ementa: 'Nova ementa' });
  });

  it('(6b) acervo historico: lei de 1962 entra e aparece sem filtro de exercicio', async () => {
    const lei = tipos.find((t) => t.nome === 'Lei Municipal')!;
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'acervo')
      .field('exercicio', '1962')
      .field('documentTypeId', lei.id)
      .field('descricao', 'Cria o Mercado Municipal')
      .field('documentDate', '1962-08-20')
      .field('metadados', JSON.stringify({ numero: '12', ementa: 'Cria o Mercado Municipal' }))
      .expect(201);
    const todos = await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents?module=acervo&pageSize=50`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(todos.body.items.map((i: { id: string }) => i.id)).toContain(res.body.id);
    const so1962 = await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents?module=acervo&exercicio=1962`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(so1962.body.items.map((i: { id: string }) => i.id)).toEqual([res.body.id]);
  });

  it('(7) tipo com documento vinculado nao pode ser excluido; sem documento, exclui de vez', async () => {
    const lei = tipos.find((t) => t.nome === 'Lei Municipal')!;
    const bloqueado = await request(app.getHttpServer())
      .delete(`/t/${SLUG}/configuracoes/tipos-documento/${lei.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(409);
    expect(bloqueado.body.message).toMatch(/2 documento/);

    const portaria = tipos.find((t) => t.nome === 'Portaria')!;
    await request(app.getHttpServer())
      .delete(`/t/${SLUG}/configuracoes/tipos-documento/${portaria.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(204);
    const depois = await request(app.getHttpServer())
      .get(`/t/${SLUG}/document-types?modulo=acervo`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(depois.body.map((t: { id: string }) => t.id)).not.toContain(portaria.id);
    // o tipo inexistente responde 404
    await request(app.getHttpServer())
      .delete(`/t/${SLUG}/configuracoes/tipos-documento/${portaria.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(404);
  });
});
