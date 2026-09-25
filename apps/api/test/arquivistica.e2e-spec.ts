/**
 * Testes e2e de GESTAO ARQUIVISTICA (Plano de Classificacao + Temporalidade).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  (1) carregar modelo base + classe padrao dos modulos financeiros
 *  (2) documento criado recebe classe padrao e prazos calculados
 *  (3) classe agrupadora nao pode ser atribuida a documento
 *  (4) listas da TTD + transferencia gera guia numerada e PDF
 *  (5) documento fora da fase corrente nao pode ser excluido pela lixeira
 *  (6) RBAC: consulta nao cria classe nem transfere
 *  (7) cross-tenant: classe do tenant A invisivel no tenant B
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
const SLUG_A = 'arq_e2e_a';
const SLUG_B = 'arq_e2e_b';
const ADMIN_EMAIL = 'admin@arq.gov.br';
const CONSULTA_EMAIL = 'consulta@arq.gov.br';
const PASS = 'senha-arq-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(slug: string): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${slug}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup(SLUG_A);
  await cleanup(SLUG_B);
  await provisionTenantSchema(sql, SLUG_A);
  await provisionTenantSchema(sql, SLUG_B);
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });

  for (const slug of [SLUG_A, SLUG_B]) {
    await sql`
      INSERT INTO public.tenants (slug, nome, schema_name, status)
      VALUES (${slug}, ${'Orgao ' + slug}, ${'tenant_' + slug}, 'ativo')
    `;
    await sql.unsafe(
      `INSERT INTO "tenant_${slug}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, 'Admin', $2, 'admin', false)`,
      [ADMIN_EMAIL, hash],
    );
  }
  await sql.unsafe(
    `INSERT INTO "tenant_${SLUG_A}".users (email, nome, senha_hash, role, must_change_password)
     VALUES ($1, 'Consulta', $2, 'consulta', false)`,
    [CONSULTA_EMAIL, hash],
  );

  // Orgao de teste contrata os dois modulos (Arquivo + Financeiro).
  for (const s of [SLUG_A, SLUG_B]) {
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
  await cleanup(SLUG_A);
  await cleanup(SLUG_B);
  await sql?.end({ timeout: 5 });
});

async function login(slug: string, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/t/${slug}/auth/login`)
    .send({ email, senha: PASS })
    .expect(200);
  return res.body.accessToken as string;
}

describe('Gestao arquivistica', () => {
  let admin: string;
  let classes: Array<{ id: string; codigo: string }>;
  let docAntigo: string;

  it('(1) carrega modelo base e define classe padrao dos modulos financeiros', async () => {
    admin = await login(SLUG_A, ADMIN_EMAIL);
    const r = await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/arquivistica/classificacoes/modelo`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(201);
    expect(r.body.criadas).toBeGreaterThan(10);

    // Segunda carga e recusada (nao sobrescreve plano existente).
    await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/arquivistica/classificacoes/modelo`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(409);

    const list = await request(app.getHttpServer())
      .get(`/t/${SLUG_A}/arquivistica/classificacoes`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    classes = list.body;
    const padroes = await request(app.getHttpServer())
      .get(`/t/${SLUG_A}/arquivistica/padroes`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(padroes.body.despesas).toBe(classes.find((c) => c.codigo === '052.2')?.id);
  });

  it('(2) documento criado recebe classe padrao e prazos da TTD', async () => {
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'despesas')
      .field('exercicio', '2010')
      .field('docCaixa', '0001')
      .field('empenho', '2010NE001')
      .field('credor', 'Fornecedor X')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2010-05-10')
      .expect(201);
    docAntigo = res.body.id;
    expect(res.body.classificacaoCodigo).toBe('052.2');
    expect(res.body.fase).toBe('corrente');
    expect(res.body.dataInicioContagem).toBe('2010-12-31');
    expect(res.body.dataPrevistaTransferencia).toBe('2015-12-31');
    expect(res.body.dataPrevistaDestinacao).toBe('2020-12-31');
  });

  it('(3) classe agrupadora e rejeitada', async () => {
    const grupo = classes.find((c) => c.codigo === '050')!;
    await request(app.getHttpServer())
      .patch(`/t/${SLUG_A}/documents/${docAntigo}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ classificacaoId: grupo.id })
      .expect(400);
  });

  it('(4) TTD lista vencidos; transferencia so aceita aptos e gera guia', async () => {
    // Documento de 2019: prazo corrente (31/12/2024) vencido, destinacao (2029) nao.
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'despesas')
      .field('exercicio', '2019')
      .field('docCaixa', '0002')
      .field('empenho', '2019NE001')
      .field('credor', 'Fornecedor Y')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2019-03-01')
      .expect(201);
    const docTransferir = res.body.id as string;

    const aEliminar = await request(app.getHttpServer())
      .get(`/t/${SLUG_A}/arquivistica/temporalidade?lista=a_eliminar`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(aEliminar.body.items.map((i: { id: string }) => i.id)).toContain(docAntigo);

    // Documento a_eliminar nao e apto para transferencia.
    await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/arquivistica/temporalidade/transferir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ ids: [docAntigo] })
      .expect(400);

    const guia = await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/arquivistica/temporalidade/transferir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ ids: [docTransferir], observacoes: 'Caixa 1' })
      .expect(201);
    expect(guia.body.numero).toBe(1);

    const pdf = await request(app.getHttpServer())
      .get(`/t/${SLUG_A}/arquivistica/guias/${guia.body.guiaId}/pdf`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    // (5) Transferido nao vai pra lixeira.
    await request(app.getHttpServer())
      .delete(`/t/${SLUG_A}/documents/${docTransferir}`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(400);
  });

  it('(6) consulta nao cria classe nem transfere', async () => {
    const consulta = await login(SLUG_A, CONSULTA_EMAIL);
    await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/arquivistica/classificacoes`)
      .set('Authorization', `Bearer ${consulta}`)
      .send({ codigo: '999', descricao: 'Nao pode' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/t/${SLUG_A}/arquivistica/temporalidade/transferir`)
      .set('Authorization', `Bearer ${consulta}`)
      .send({ ids: [docAntigo] })
      .expect(403);
  });

  it('(7) cross-tenant: token de A nao acessa B e B nao ve classes de A', async () => {
    await request(app.getHttpServer())
      .get(`/t/${SLUG_B}/arquivistica/classificacoes`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(401);
    const adminB = await login(SLUG_B, ADMIN_EMAIL);
    const listB = await request(app.getHttpServer())
      .get(`/t/${SLUG_B}/arquivistica/classificacoes`)
      .set('Authorization', `Bearer ${adminB}`)
      .expect(200);
    expect(listB.body).toEqual([]);
  });
});
