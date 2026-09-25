/**
 * Testes e2e da VERIFICACAO DE INTEGRIDADE (preservacao digital).
 * Requer postgres + redis. Storage local (STORAGE_DIR) — o teste adultera o arquivo em disco.
 *
 * Cobre:
 *  (1) verificacao manual com arquivos integros: tudo ok, nenhuma ocorrencia
 *  (2) arquivo adulterado = divergente; arquivo apagado do storage = ausente
 *  (3) nova verificacao nao duplica a ocorrencia aberta
 *  (4) arquivo restaurado fecha a ocorrencia sozinho; a outra e tratada manualmente
 *  (5) RBAC: sem integridade:create nao verifica; orgao sem o modulo Arquivo = 403
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
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'integridade_e2e';
const SLUG_SEM_ARQUIVO = 'integridade_fin_e2e';
const ADMIN = 'admin@integridade.gov.br';
const CONSULTA = 'consulta@integridade.gov.br';
const PASS = 'senha-integridade-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

function gerarPdf(texto: string): Promise<Buffer> {
  return new Promise((ok, falha) => {
    const doc = new PDFKitDocument({ size: 'A4' });
    const partes: Buffer[] = [];
    doc.on('data', (c: Buffer) => partes.push(c));
    doc.on('end', () => ok(Buffer.concat(partes)));
    doc.on('error', falha);
    doc.fontSize(12).text(texto);
    doc.end();
  });
}

/** Caminho do arquivo no storage local (mesma regra do StorageService). */
const caminhoLocal = (key: string) => join(resolve(process.env.STORAGE_DIR ?? '.storage'), `jdoc-${SLUG}`, key);

async function cleanup(): Promise<void> {
  for (const s of [SLUG, SLUG_SEM_ARQUIVO]) {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${s}" CASCADE`);
    await sql`DELETE FROM public.tenants WHERE slug = ${s}`;
  }
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup();
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [slug, modulos] of [
    [SLUG, '{financeiro,arquivo}'],
    [SLUG_SEM_ARQUIVO, '{financeiro}'],
  ] as const) {
    await provisionTenantSchema(sql, slug);
    await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos)
              VALUES (${slug}, 'Orgao integridade', ${'tenant_' + slug}, 'ativo', ${modulos})`;
    for (const [email, role] of [
      [ADMIN, 'admin'],
      [CONSULTA, 'consulta'],
    ] as const) {
      const r = await sql.unsafe(
        `INSERT INTO "tenant_${slug}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $1, $2, $3, false) RETURNING id`,
        [email, hash, role],
      );
      await sql.unsafe(`INSERT INTO "tenant_${slug}".user_permissions (user_id, permission_key) VALUES ($1, 'integridade:read')`, [
        (r[0] as { id: string }).id,
      ]);
    }
  }
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  for (const padrao of ['bf:*', 'tenant:slug:*']) {
    const keys = await redis.keys(padrao);
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
  await cleanup();
  await sql?.end({ timeout: 5 });
});

async function login(email: string, slug = SLUG): Promise<string> {
  const res = await request(app.getHttpServer()).post(`/t/${slug}/auth/login`).send({ email, senha: PASS }).expect(200);
  return res.body.accessToken as string;
}

describe('Integridade', () => {
  let admin: string;
  const docs: Array<{ id: string; key: string; pdf: Buffer }> = [];

  const api = (method: 'get' | 'post', path: string, tok = admin) =>
    request(app.getHttpServer())[method](`/t/${SLUG}/integridade${path}`).set('Authorization', `Bearer ${tok}`);

  /** Dispara "Verificar agora" e espera o worker terminar. */
  async function verificar() {
    const v = (await api('post', '/verificar').expect(201)).body;
    for (let i = 0; i < 60; i++) {
      const lista = (await api('get', '/verificacoes').expect(200)).body as Array<{ id: string; status: string }>;
      const atual = lista.find((x) => x.id === v.id);
      if (atual && atual.status !== 'processando') return atual as unknown as { status: string; total: number; ok: number; divergentes: number; ausentes: number };
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('verificacao nao terminou');
  }

  it('(1) arquivos integros: tudo ok e nenhuma ocorrencia', async () => {
    admin = await login(ADMIN);
    const tipo = await sql.unsafe(`INSERT INTO "tenant_${SLUG}".document_types (nome, cor) VALUES ('Oficio', 'blue') RETURNING id`);
    for (const texto of ['Oficio A', 'Oficio B', 'Oficio C']) {
      const pdf = await gerarPdf(`${texto} — preservacao digital`);
      const up = await request(app.getHttpServer())
        .post(`/t/${SLUG}/documents`)
        .set('Authorization', `Bearer ${admin}`)
        .field('module', 'outros')
        .field('exercicio', '2024')
        .field('documentTypeId', (tipo[0] as { id: string }).id)
        .field('descricao', texto)
        .field('documentDate', '2024-05-02')
        .attach('file', pdf, { filename: `${texto}.pdf`, contentType: 'application/pdf' })
        .expect(201);
      const [row] = await sql.unsafe(`SELECT file_key FROM "tenant_${SLUG}".documents WHERE id = $1`, [up.body.id]);
      docs.push({ id: up.body.id, key: (row as { file_key: string }).file_key, pdf });
    }

    const v = await verificar();
    expect(v).toMatchObject({ status: 'concluida', total: 3, ok: 3, divergentes: 0, ausentes: 0 });
    const resumo = (await api('get', '/resumo').expect(200)).body;
    expect(resumo).toMatchObject({ totalArquivos: 3, verificadosNoCiclo: 3, nuncaVerificados: 0, ocorrenciasAbertas: 0 });
  });

  it('(2) detecta arquivo adulterado (divergente) e apagado (ausente)', async () => {
    await writeFile(caminhoLocal(docs[0]!.key), Buffer.from('%PDF-1.4 conteudo trocado'));
    await rm(caminhoLocal(docs[1]!.key));

    const v = await verificar();
    expect(v).toMatchObject({ status: 'concluida', total: 3, ok: 1, divergentes: 1, ausentes: 1 });
    const ocs = (await api('get', '/ocorrencias').expect(200)).body as Array<{ documentId: string; tipo: string; hashEncontrado: string | null; documento: string }>;
    expect(ocs).toHaveLength(2);
    expect(ocs.find((o) => o.documentId === docs[0]!.id)).toMatchObject({ tipo: 'divergente', documento: 'Oficio A' });
    expect(ocs.find((o) => o.documentId === docs[0]!.id)!.hashEncontrado).toMatch(/^[0-9a-f]{64}$/);
    expect(ocs.find((o) => o.documentId === docs[1]!.id)).toMatchObject({ tipo: 'ausente', hashEncontrado: null });
  });

  it('(3) nova verificacao nao duplica ocorrencia aberta', async () => {
    await verificar();
    const ocs = (await api('get', '/ocorrencias').expect(200)).body as unknown[];
    expect(ocs).toHaveLength(2);
  });

  it('(4) restaurado fecha sozinho; o outro e tratado com observacao', async () => {
    await writeFile(caminhoLocal(docs[0]!.key), docs[0]!.pdf);
    await verificar();
    const abertas = (await api('get', '/ocorrencias').expect(200)).body as Array<{ id: string; documentId: string }>;
    expect(abertas.map((o) => o.documentId)).toEqual([docs[1]!.id]);

    await api('post', `/ocorrencias/${abertas[0]!.id}/resolver`).send({ observacao: 'ok' }).expect(400);
    await api('post', `/ocorrencias/${abertas[0]!.id}/resolver`).send({ observacao: 'Arquivo restaurado a partir do original em papel (CX-0012).' }).expect(204);
    await api('post', `/ocorrencias/${abertas[0]!.id}/resolver`).send({ observacao: 'De novo, nao deve aceitar' }).expect(404);

    expect((await api('get', '/ocorrencias').expect(200)).body).toEqual([]);
    const resolvidas = (await api('get', '/ocorrencias?situacao=resolvidas').expect(200)).body as Array<{ observacao: string; resolvidaPor: string | null }>;
    expect(resolvidas).toHaveLength(2);
    expect(resolvidas.some((r) => r.observacao.startsWith('Arquivo voltou a conferir') && r.resolvidaPor === null)).toBe(true);
    expect(resolvidas.some((r) => r.resolvidaPor === ADMIN)).toBe(true);
  });

  it('(5) RBAC e modulo contratado', async () => {
    const consulta = await login(CONSULTA);
    await api('get', '/resumo', consulta).expect(200);
    await api('post', '/verificar', consulta).expect(403);

    const adminFin = await login(ADMIN, SLUG_SEM_ARQUIVO);
    await request(app.getHttpServer())
      .get(`/t/${SLUG_SEM_ARQUIVO}/integridade/resumo`)
      .set('Authorization', `Bearer ${adminFin}`)
      .expect(403);
  });
});
