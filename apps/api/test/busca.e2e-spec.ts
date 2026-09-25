/**
 * Testes e2e da BUSCA NO CONTEUDO (indexacao de PDF).
 * Requer postgres + redis (docker compose) e pdftotext (poppler-utils) no PATH.
 * Sem pdftotext a feature fica desligada e a suite e pulada.
 *
 * Cobre:
 *  (1) upload de PDF -> worker indexa -> ocrStatus concluido
 *  (2) busca sem acento acha texto com acento, com trecho destacado e pagina
 *  (3) usuario sem read do modulo nao ve o documento na busca
 *  (4) documento restrito so aparece com acento_restrito:read
 *  (5) remover o PDF tira o texto da busca
 */
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
import { detectarFerramentas } from '../src/ocr/extrator';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'busca_e2e';
const ADMIN = 'admin@busca.gov.br';
const SO_DESPESAS = 'despesas@busca.gov.br';
const PASS = 'senha-busca-e2e-123';

const ferramentas = await detectarFerramentas();

let app: INestApplication;
let sql: postgres.Sql;

function gerarPdf(paginas: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    paginas.forEach((t, i) => {
      if (i > 0) doc.addPage();
      doc.fontSize(12).text(t);
    });
    doc.end();
  });
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${SLUG}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

describe.skipIf(!ferramentas.pdftotext)('Busca no conteudo', () => {
  let admin: string;
  let docId: string;

  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 4 });
    await cleanup();
    await provisionTenantSchema(sql, SLUG);
    const hash = await argon2.hash(PASS, { type: argon2.argon2id });
    await sql`
      INSERT INTO public.tenants (slug, nome, schema_name, status, quota_disco_mb)
      VALUES (${SLUG}, 'Orgao Busca', ${'tenant_' + SLUG}, 'ativo', 100)
    `;
    await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, 'Admin', $2, 'admin', false)`,
      [ADMIN, hash],
    );
    const r = await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, 'Despesas', $2, 'operador', false) RETURNING id`,
      [SO_DESPESAS, hash],
    );
    await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key) VALUES ($1, 'despesas:read')`,
      [(r[0] as { id: string }).id],
    );
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

  async function esperarIndexacao(id: string): Promise<string> {
    for (let i = 0; i < 60; i++) {
      const r = await request(app.getHttpServer()).get(`/t/${SLUG}/documents/${id}`).set('Authorization', `Bearer ${admin}`);
      if (r.body.ocrStatus === 'concluido' || r.body.ocrStatus === 'erro' || r.body.ocrStatus === 'sem_texto') {
        return r.body.ocrStatus as string;
      }
      await new Promise((ok) => setTimeout(ok, 500));
    }
    return 'timeout';
  }

  it('(1) upload indexa o conteudo do PDF', async () => {
    admin = await login(ADMIN);
    const pdf = await gerarPdf([
      'Capa do processo administrativo.',
      'Termo de contratação de empresa para reforma da Escola Municipal José de Alencar, conforme licitação.',
    ]);
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'outros')
      .field('exercicio', '2024')
      .field('documentTypeId', (await sql.unsafe(
        `INSERT INTO "tenant_${SLUG}".document_types (nome, cor) VALUES ('Processo', 'blue') RETURNING id`,
      ))[0]!.id as string)
      .field('descricao', 'Processo de reforma')
      .field('documentDate', '2024-03-01')
      .attach('file', pdf, { filename: 'processo.pdf', contentType: 'application/pdf' })
      .expect(201);
    docId = res.body.id;
    expect(await esperarIndexacao(docId)).toBe('concluido');
  });

  it('(2) busca sem acento acha texto com acento, com pagina e destaque', async () => {
    const r = await request(app.getHttpServer())
      .get(`/t/${SLUG}/busca?q=${encodeURIComponent('jose alencar contratacao')}`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(r.body.total).toBe(1);
    const item = r.body.items[0];
    expect(item.documentId).toBe(docId);
    expect(item.pagina).toBe(2);
    const destacados = item.trecho.filter((s: { destaque: boolean }) => s.destaque).map((s: { texto: string }) => s.texto);
    expect(destacados).toEqual(expect.arrayContaining(['contratação', 'José', 'Alencar']));

    const indexacao = await request(app.getHttpServer())
      .get(`/t/${SLUG}/busca/indexacao`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    expect(indexacao.body).toMatchObject({ habilitado: true, concluidos: 1 });
  });

  it('(3) usuario sem outros:read nao ve o documento', async () => {
    const tok = await login(SO_DESPESAS);
    const r = await request(app.getHttpServer())
      .get(`/t/${SLUG}/busca?q=alencar`)
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);
    expect(r.body.total).toBe(0);
  });

  it('(4) documento restrito some da busca de quem nao tem acervo_restrito:read', async () => {
    await sql.unsafe(`UPDATE "tenant_${SLUG}".documents SET nivel_acesso = 'restrito' WHERE id = $1`, [docId]);
    await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key)
       SELECT id, 'outros:read' FROM "tenant_${SLUG}".users WHERE email = $1`,
      [SO_DESPESAS],
    );
    const tok = await login(SO_DESPESAS);
    const r = await request(app.getHttpServer()).get(`/t/${SLUG}/busca?q=alencar`).set('Authorization', `Bearer ${tok}`).expect(200);
    expect(r.body.total).toBe(0);
    const a = await request(app.getHttpServer()).get(`/t/${SLUG}/busca?q=alencar`).set('Authorization', `Bearer ${admin}`).expect(200);
    expect(a.body.total).toBe(1);
    await sql.unsafe(`UPDATE "tenant_${SLUG}".documents SET nivel_acesso = 'publico' WHERE id = $1`, [docId]);
  });

  it('(5) remover o PDF tira o texto da busca', async () => {
    await request(app.getHttpServer())
      .delete(`/t/${SLUG}/documents/${docId}/file`)
      .set('Authorization', `Bearer ${admin}`)
      .expect((res) => expect([200, 204]).toContain(res.status));
    const r = await request(app.getHttpServer()).get(`/t/${SLUG}/busca?q=alencar`).set('Authorization', `Bearer ${admin}`).expect(200);
    expect(r.body.total).toBe(0);
  });
});
