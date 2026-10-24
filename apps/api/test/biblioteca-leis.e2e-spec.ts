/**
 * Biblioteca de leis de referencia: cada orgao ve SO o que vale para ele
 * (federal + o estado dele + o municipio dele). Prefeitura do Ceara nunca ve
 * lei da Bahia, nem de outro municipio. A sincronizacao com o GitHub e coberta
 * a parte (usa a rede); aqui o banco recebe as leis direto.
 * Requer postgres + redis e `pnpm db:migrate`.
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
import { normalizarParaBusca } from '@jdoc/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const PASS = 'senha-leis-123';
const CE = { slug: 'leis_ce_e2e', email: 'admin@leisce.gov.br', cidade: 'Prefeitura de Irauçuba', uf: 'CE' };
const BA = { slug: 'leis_ba_e2e', email: 'admin@leisba.gov.br', cidade: 'Prefeitura de Salvador', uf: 'BA' };
const SEM_UF = { slug: 'leis_sem_e2e', email: 'admin@leissem.gov.br', cidade: 'Prefeitura de Lugar Nenhum', uf: '' };

let app: INestApplication;
let sql: postgres.Sql;
const http = () => request(app.getHttpServer());
const sha = (n: number) => String(n).padStart(40, 'a').slice(-40);
let seq = 0;
// O banco de desenvolvimento pode ter leis reais carregadas: as contagens somam o que ja existia para o escopo do Ceara/Irauçuba.
let base = { federal: 0, estadual: 0, municipal: 0, revogadas: 0 };

async function lei(esfera: 'federal' | 'estadual' | 'municipal', uf: string | null, municipio: string | null, titulo: string, ementa: string, extra: { revogada?: boolean; data?: string } = {}) {
  seq++;
  const path = `${esfera}/${uf ?? ''}/${municipio ?? ''}/t/2020/${seq}.md`;
  await sql`
    INSERT INTO platform.leis_ref (path, esfera, uf, municipio, tipo, titulo, numero, data, ano, ementa, revogada, blob_sha, tsv)
    VALUES (${path}, ${esfera}, ${uf}, ${municipio}, 'leis-ordinarias', ${titulo}, ${String(seq)}, ${extra.data ?? '2020-05-10'}, 2020, ${ementa}, ${extra.revogada ?? false}, ${sha(seq)},
            to_tsvector('portuguese', ${normalizarParaBusca(titulo)}) || to_tsvector('portuguese', ${normalizarParaBusca(ementa)}))
  `;
}

async function token(email: string, slug: string): Promise<{ Authorization: string }> {
  const r = await http().post(`/t/${slug}/auth/login`).send({ email, senha: PASS });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.body.accessToken as string}` };
}

async function limpar(): Promise<void> {
  for (const t of [CE, BA, SEM_UF]) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${t.slug}" CASCADE`);
    await sql`DELETE FROM public.tenants WHERE slug = ${t.slug}`;
  }
  await sql`DELETE FROM platform.leis_ref WHERE path LIKE ANY (ARRAY['federal/%', 'estadual/%', 'municipal/%'])`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4, onnotice: () => undefined });
  await limpar();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const chaves = [...(await redis.keys('bf:*')), ...(await redis.keys('tenant:slug:*'))];
  if (chaves.length) await redis.del(...chaves);
  await redis.quit();
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const t of [CE, BA, SEM_UF]) {
    await provisionTenantSchema(sql, t.slug);
    await sql`
      INSERT INTO public.tenants (slug, nome, cidade, uf, schema_name, status, quota_disco_mb, modulos)
      VALUES (${t.slug}, ${t.cidade}, ${t.cidade}, ${t.uf || null}, ${'tenant_' + t.slug}, 'ativo', 100, '{arquivo}')
    `;
    await sql.unsafe(`INSERT INTO "tenant_${t.slug}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Admin', $2, 'admin', false)`, [t.email, hash]);
  }
  const [b] = await sql<Array<{ federal: number; estadual: number; municipal: number; revogadas: number }>>`
    SELECT count(*) FILTER (WHERE esfera = 'federal')::int AS federal,
           count(*) FILTER (WHERE esfera = 'estadual' AND uf = 'CE')::int AS estadual,
           count(*) FILTER (WHERE esfera = 'municipal' AND uf = 'CE' AND municipio = 'iraucuba')::int AS municipal,
           count(*) FILTER (WHERE revogada AND (esfera = 'federal' OR (uf = 'CE' AND (esfera = 'estadual' OR municipio = 'iraucuba'))))::int AS revogadas
    FROM platform.leis_ref`;
  base = b!;
  await lei('federal', null, null, 'Lei federal de licitações', 'Normas gerais de licitação e contratos');
  await lei('estadual', 'CE', null, 'Lei estadual do Ceará sobre arquivos', 'Dispõe sobre arquivos públicos do Ceará');
  await lei('estadual', 'BA', null, 'Lei estadual da Bahia sobre arquivos', 'Dispõe sobre arquivos públicos da Bahia');
  await lei('municipal', 'CE', 'iraucuba', 'Lei municipal de Irauçuba sobre arquivos', 'Cria o arquivo municipal de Irauçuba');
  await lei('municipal', 'CE', 'fortaleza', 'Lei municipal de Fortaleza sobre arquivos', 'Cria o arquivo municipal de Fortaleza');
  await lei('municipal', 'BA', 'salvador', 'Lei municipal de Salvador sobre arquivos', 'Cria o arquivo municipal de Salvador');
  await lei('federal', null, null, 'Lei federal antiga revogada', 'Texto revogado sobre arquivos', { revogada: true, data: '1990-01-01' });

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

describe('Escopo da biblioteca de leis', () => {
  it('Irauçuba/CE vê federal + Ceará + Irauçuba, e nada da Bahia nem de Fortaleza', async () => {
    const auth = await token(CE.email, CE.slug);
    const r = await http().get(`/t/${CE.slug}/leis-referencia?q=arquivos&pageSize=50`).set(auth).expect(200);
    const titulos = (r.body.items as Array<{ titulo: string }>).map((l) => l.titulo);
    expect(titulos).toContain('Lei estadual do Ceará sobre arquivos');
    expect(titulos).toContain('Lei municipal de Irauçuba sobre arquivos');
    expect(titulos).toContain('Lei federal antiga revogada');
    expect(titulos.join('|')).not.toMatch(/Bahia|Salvador|Fortaleza/);
  });

  it('prefeitura da Bahia vê o inverso', async () => {
    const auth = await token(BA.email, BA.slug);
    const r = await http().get(`/t/${BA.slug}/leis-referencia?q=arquivos&pageSize=50`).set(auth).expect(200);
    const titulos = (r.body.items as Array<{ titulo: string }>).map((l) => l.titulo).join('|');
    expect(titulos).toContain('Bahia');
    expect(titulos).toContain('Salvador');
    expect(titulos).not.toMatch(/Ceará|Irauçuba|Fortaleza/);
  });

  it('abrir lei de outro estado ou município é 404 (não revela que existe)', async () => {
    const auth = await token(CE.email, CE.slug);
    const [ba] = await sql<Array<{ id: string }>>`SELECT id::text FROM platform.leis_ref WHERE titulo = 'Lei estadual da Bahia sobre arquivos'`;
    const [fort] = await sql<Array<{ id: string }>>`SELECT id::text FROM platform.leis_ref WHERE titulo = 'Lei municipal de Fortaleza sobre arquivos'`;
    await http().get(`/t/${CE.slug}/leis-referencia/${ba!.id}`).set(auth).expect(404);
    await http().get(`/t/${CE.slug}/leis-referencia/${fort!.id}`).set(auth).expect(404);
  });

  it('o filtro vale mesmo pedindo a esfera de outro estado', async () => {
    const auth = await token(CE.email, CE.slug);
    const r = await http().get(`/t/${CE.slug}/leis-referencia?esfera=municipal&pageSize=50`).set(auth).expect(200);
    const titulos = (r.body.items as Array<{ titulo: string; municipio: string }>).map((l) => l.municipio);
    expect(titulos.every((m) => m === 'iraucuba')).toBe(true);
    expect(r.body.total).toBe(base.municipal + 1);
  });

  it('órgão sem estado cadastrado vê só as leis federais', async () => {
    const auth = await token(SEM_UF.email, SEM_UF.slug);
    const r = await http().get(`/t/${SEM_UF.slug}/leis-referencia?pageSize=50`).set(auth).expect(200);
    expect((r.body.items as Array<{ esfera: string }>).every((l) => l.esfera === 'federal')).toBe(true);
    const e = await http().get(`/t/${SEM_UF.slug}/leis-referencia/escopo`).set(auth).expect(200);
    expect(e.body.uf).toBeNull();
    expect(e.body.esferas).toHaveLength(1);
  });

  it('escopo mostra o município deduzido da cidade e quantas leis há em cada esfera', async () => {
    const auth = await token(CE.email, CE.slug);
    const e = await http().get(`/t/${CE.slug}/leis-referencia/escopo`).set(auth).expect(200);
    expect(e.body).toMatchObject({ uf: 'CE', municipio: 'iraucuba', municipioCoberto: true });
    const por = Object.fromEntries((e.body.esferas as Array<{ esfera: string; total: number }>).map((x) => [x.esfera, x.total]));
    expect(por).toEqual({ federal: base.federal + 2, estadual: base.estadual + 1, municipal: base.municipal + 1 });
  });

  it('busca por texto, filtro de vigentes e ordem pela mais recente', async () => {
    const auth = await token(CE.email, CE.slug);
    const todas = await http().get(`/t/${CE.slug}/leis-referencia?pageSize=50`).set(auth).expect(200);
    expect(todas.body.total).toBe(base.federal + base.estadual + base.municipal + 4);
    const mais = await http().get(`/t/${CE.slug}/leis-referencia?pageSize=1&q=revogada`).set(auth).expect(200);
    expect(mais.body.items.map((l: { titulo: string }) => l.titulo)).toContain('Lei federal antiga revogada');
    const vigentes = await http().get(`/t/${CE.slug}/leis-referencia?vigentes=sim&pageSize=50`).set(auth).expect(200);
    expect(vigentes.body.total).toBe(base.federal + base.estadual + base.municipal + 4 - base.revogadas - 1);
    const licit = await http().get(`/t/${CE.slug}/leis-referencia?q=licitacao&pageSize=50`).set(auth).expect(200);
    expect(licit.body.items.map((l: { titulo: string }) => l.titulo)).toContain('Lei federal de licitações');
  });

  it('sem permissão de legislação, 403', async () => {
    await sql.unsafe(`INSERT INTO "tenant_${CE.slug}".users (email, nome, senha_hash, role, must_change_password) VALUES ('semperm@leisce.gov.br', 'Sem', $1, 'consulta', false)`, [await argon2.hash(PASS, { type: argon2.argon2id })]);
    const auth = await token('semperm@leisce.gov.br', CE.slug);
    await http().get(`/t/${CE.slug}/leis-referencia`).set(auth).expect(403);
  });
});
