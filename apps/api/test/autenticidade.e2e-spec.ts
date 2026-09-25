/**
 * Testes e2e de AUTENTICIDADE PUBLICA (copia autenticada + /public/verificar).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  (1) emissao da copia autenticada: PDF carimbado, mesmo codigo em reemissao
 *  (2) verificacao publica sem login: metadados minimos, sem titulo/arquivo
 *  (3) conferencia por hash: original, copia emitida, arquivo adulterado
 *  (4) PDF substituido: codigo antigo responde "substituido"
 *  (5) RBAC: sem leitura do modulo / documento restrito = sem copia
 *  (6) codigo inexistente ou malformado = 404 generico
 */
import { createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import PDFKitDocument from 'pdfkit';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'autent_e2e';
const ADMIN = 'admin@autent.gov.br';
const SO_DESPESAS = 'despesas@autent.gov.br';
const PASS = 'senha-autent-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

function gerarPdf(texto: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(12).text(texto);
    doc.end();
  });
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** supertest: resposta binaria como Buffer. */
function binario(res: NodeJS.ReadableStream & { setEncoding: (e: string) => void; on: (ev: string, cb: (c?: unknown) => void) => void }, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(Buffer.from(c as Buffer)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

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
    INSERT INTO public.tenants (slug, nome, schema_name, status, cidade, uf)
    VALUES (${SLUG}, 'Prefeitura de Teste', ${'tenant_' + SLUG}, 'ativo', 'Iraucuba', 'CE')
  `;
  await sql.unsafe(
    `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Admin', $2, 'admin', false)`,
    [ADMIN, hash],
  );
  const r = await sql.unsafe(
    `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password)
     VALUES ($1, 'Despesas', $2, 'operador', false) RETURNING id`,
    [SO_DESPESAS, hash],
  );
  await sql.unsafe(`INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key) VALUES ($1, 'despesas:read')`, [
    (r[0] as { id: string }).id,
  ]);
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

describe('Autenticidade publica', () => {
  let admin: string;
  let docId: string;
  let original: Buffer;
  let copia: Buffer;
  let codigo: string;

  it('(1) emite copia autenticada carimbada; reemissao reusa o codigo', async () => {
    admin = await login(ADMIN);
    const tipo = await sql.unsafe(`INSERT INTO "tenant_${SLUG}".document_types (nome, cor) VALUES ('Oficio', 'blue') RETURNING id`);
    original = await gerarPdf('Oficio 12/2024 - Solicitacao de reforma da escola municipal.');
    const up = await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'outros')
      .field('exercicio', '2024')
      .field('documentTypeId', (tipo[0] as { id: string }).id)
      .field('descricao', 'Oficio de teste com titulo sigiloso')
      .field('documentDate', '2024-05-02')
      .attach('file', original, { filename: 'oficio.pdf', contentType: 'application/pdf' })
      .expect(201);
    docId = up.body.id;

    const res = await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents/${docId}/copia-autenticada`)
      .set('Authorization', `Bearer ${admin}`)
      .buffer(true)
      .parse(binario)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    codigo = res.headers['x-codigo-verificacao'] as string;
    expect(codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    copia = res.body as Buffer;
    expect(copia.subarray(0, 4).toString()).toBe('%PDF');
    expect(sha(copia)).not.toBe(sha(original));

    const de_novo = await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents/${docId}/copia-autenticada`)
      .set('Authorization', `Bearer ${admin}`)
      .buffer(true)
      .parse(binario)
      .expect(200);
    expect(de_novo.headers['x-codigo-verificacao']).toBe(codigo);
  });

  it('(2) verificacao publica sem login devolve so metadados minimos', async () => {
    const r = await request(app.getHttpServer()).get(`/public/verificar/${codigo.toLowerCase().replace(/(.{4})/g, '$1-')}`).expect(200);
    expect(r.body).toMatchObject({
      codigo,
      orgao: { nome: 'Prefeitura de Teste', cidade: 'Iraucuba', uf: 'CE' },
      tipoDocumental: 'Oficio',
      dataDocumento: '2024-05-02',
      hashOriginal: sha(original),
      situacao: 'vigente',
      copiasEmitidas: 2,
    });
    expect(JSON.stringify(r.body)).not.toContain('sigiloso');
    expect(JSON.stringify(r.body)).not.toContain(docId);
  });

  it('(3) conferencia por hash: original, copia e adulterado', async () => {
    const conferir = (h: string) =>
      request(app.getHttpServer()).post(`/public/verificar/${codigo}/conferir`).send({ sha256: h }).expect(200);
    expect((await conferir(sha(original))).body.resultado).toBe('original');
    const c = await conferir(sha(copia));
    expect(c.body.resultado).toBe('copia');
    expect(c.body.emitidaEm).toBeTruthy();
    const adulterado = Buffer.concat([copia, Buffer.from('\n% alterado')]);
    expect((await conferir(sha(adulterado))).body.resultado).toBe('nao_confere');
    await request(app.getHttpServer()).post(`/public/verificar/${codigo}/conferir`).send({ sha256: 'xyz' }).expect(400);
  });

  it('(4) PDF substituido: codigo antigo vira "substituido"', async () => {
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents/${docId}/file`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', await gerarPdf('Versao corrigida do oficio.'), { filename: 'v2.pdf', contentType: 'application/pdf' })
      .expect((res) => expect([200, 201]).toContain(res.status));
    const r = await request(app.getHttpServer()).get(`/public/verificar/${codigo}`).expect(200);
    expect(r.body.situacao).toBe('substituido');
  });

  it('(5) sem leitura do modulo ou documento restrito = sem copia', async () => {
    const op = await login(SO_DESPESAS);
    await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents/${docId}/copia-autenticada`)
      .set('Authorization', `Bearer ${op}`)
      .expect(403);
    await sql.unsafe(`UPDATE "tenant_${SLUG}".documents SET nivel_acesso = 'restrito' WHERE id = $1`, [docId]);
    await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key)
       SELECT id, 'outros:read' FROM "tenant_${SLUG}".users WHERE email = $1`,
      [SO_DESPESAS],
    );
    const op2 = await login(SO_DESPESAS);
    await request(app.getHttpServer())
      .get(`/t/${SLUG}/documents/${docId}/copia-autenticada`)
      .set('Authorization', `Bearer ${op2}`)
      .expect(404);
  });

  it('(6) codigo inexistente ou malformado = 404 generico', async () => {
    const a = await request(app.getHttpServer()).get('/public/verificar/7K3M9XQ2HV8R4N6T').expect(404);
    const b = await request(app.getHttpServer()).get(`/public/verificar/${encodeURIComponent("' OR 1=1 --")}`).expect(404);
    expect(a.body.message).toBe(b.body.message);
  });
});
