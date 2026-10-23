/**
 * TR (GED) — fase 4: exportacao integral (plano de saida), copia segregada,
 * teste de restauracao, disponibilidade, relatorio mensal e bloqueio de
 * exclusao sem aceite da migracao. Requer postgres + redis e `pnpm db:migrate`.
 * O teste de restauracao usa o pg_dump do container jdoc-pg-dev (pulado sem docker).
 */
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import PDFKitDocument from 'pdfkit';
import { provisionTenantSchema } from '@jdoc/database';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ContinuidadeService } from '../src/continuidade/continuidade.service';

// Destino segregado local para o teste (lido quando o app sobe).
const COPIA = mkdtempSync(join(tmpdir(), 'jdoc-copia-'));
process.env.COPIA_DIR = COPIA;

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const STORAGE = process.env.STORAGE_DIR ?? '.storage';
const SLUG = 'tr_cont_e2e';
const S = `"tenant_${SLUG}"`;
const PASS = 'senha-tr-cont-123';
const ADMIN = 'admin@trcont.gov.br';
const OPER = 'oper@trcont.gov.br';

let dockerPgDump = false;
try {
  execSync('docker exec jdoc-pg-dev pg_dump --version', { stdio: 'ignore' });
  dockerPgDump = true;
} catch {
  dockerPgDump = false;
}

let app: INestApplication;
let sql: postgres.Sql;
let tenantId = '';
const hashes: string[] = [];

const http = () => request(app.getHttpServer());

function pdf(texto: string): Promise<Buffer> {
  return new Promise((ok, falha) => {
    const doc = new PDFKitDocument({ size: 'A4' });
    const c: Buffer[] = [];
    doc.on('data', (x: Buffer) => c.push(x));
    doc.on('end', () => ok(Buffer.concat(c)));
    doc.on('error', falha);
    doc.text(texto);
    doc.end();
  });
}

async function token(email: string): Promise<{ Authorization: string }> {
  const r = await http().post(`/t/${SLUG}/auth/login`).send({ email, senha: PASS });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.body.accessToken as string}` };
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await sql.unsafe(`DROP SCHEMA IF EXISTS "rtest_${SLUG}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4, onnotice: () => undefined });
  await cleanup();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const chaves = [...(await redis.keys('bf:*')), ...(await redis.keys('tenant:slug:*'))];
  if (chaves.length) await redis.del(...chaves);
  await redis.quit();
  await provisionTenantSchema(sql, SLUG);
  const [t] = await sql<Array<{ id: string }>>`
    INSERT INTO public.tenants (slug, nome, schema_name, status, quota_disco_mb, modulos)
    VALUES (${SLUG}, 'Prefeitura Continuidade', ${'tenant_' + SLUG}, 'ativo', 100, '{financeiro,arquivo}') RETURNING id
  `;
  tenantId = t!.id;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql.unsafe(`INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Admin', $2, 'admin', false)`, [ADMIN, hash]);
  await sql.unsafe(`INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Oper', $2, 'operador', false)`, [OPER, hash]);
  await sql.unsafe(`INSERT INTO ${S}.orgaos (codigo, descricao, exercicio) VALUES ('06', 'Secretaria de Educação', 2026)`);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser(process.env.COOKIE_SECRET ?? 'x'.repeat(32)));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const auth = await token(ADMIN);
  const [tipo] = await sql.unsafe<Array<{ id: string }>>(`INSERT INTO ${S}.document_types (nome, cor) VALUES ('Decreto', 'blue') RETURNING id`);
  const [orgao] = await sql.unsafe<Array<{ id: string }>>(`SELECT id FROM ${S}.orgaos LIMIT 1`);
  for (const n of [1, 2]) {
    const arquivo = await pdf(`Decreto ${n}/2026 - teste de exportacao`);
    hashes.push(createHash('sha256').update(arquivo).digest('hex'));
    await http()
      .post(`/t/${SLUG}/documents`)
      .set(auth)
      .field('module', 'outros')
      .field('exercicio', '2026')
      .field('documentTypeId', tipo!.id)
      .field('orgaoId', orgao!.id)
      .field('descricao', `Decreto ${n}`)
      .field('numero', `${n}/2026`)
      .field('documentDate', '2026-02-0' + n)
      .attach('file', arquivo, { filename: `decreto-${n}.pdf`, contentType: 'application/pdf' })
      .expect(201);
  }
});

afterAll(async () => {
  await app?.close();
  await cleanup();
  await sql?.end({ timeout: 5 });
});

describe('Exportação integral', () => {
  it('só administrador exporta; gera partes com PDFs no padrão de nomes e metadados', async () => {
    await http().post(`/t/${SLUG}/exportacoes`).set(await token(OPER)).send({}).expect(403);
    const auth = await token(ADMIN);
    const r = await http().post(`/t/${SLUG}/exportacoes`).set(auth).send({}).expect(201);
    const id = r.body.id as string;
    await http().post(`/t/${SLUG}/exportacoes`).set(auth).send({}).expect(409);

    let e: { status: string; partes: Array<{ numero: number; sha256: string }>; documentos: number; arquivos: number } | undefined;
    for (let i = 0; i < 60; i++) {
      const l = await http().get(`/t/${SLUG}/exportacoes`).set(auth).expect(200);
      e = (l.body as Array<typeof e & { id: string }>).find((x) => x!.id === id);
      if (e?.status === 'concluido' || e?.status === 'erro') break;
      await new Promise((ok) => setTimeout(ok, 500));
    }
    expect(e?.status).toBe('concluido');
    expect(e).toMatchObject({ documentos: 2, arquivos: 2 });

    const u = await http().get(`/t/${SLUG}/exportacoes/${id}/partes/1/url`).set(auth).expect(200);
    const caminho = new URL(u.body.url as string);
    const zip = await http().get(`${caminho.pathname}${caminho.search}`).buffer(true).parse((res, cb) => {
      const c: Buffer[] = [];
      res.on('data', (x: Buffer) => c.push(x));
      res.on('end', () => cb(null, Buffer.concat(c)));
    });
    const bin = zip.body as Buffer;
    expect(createHash('sha256').update(bin).digest('hex')).toBe(e!.partes[0]!.sha256);
    const texto = bin.toString('latin1');
    for (const nome of ['LEIA-ME.txt', 'metadados.csv', 'metadados.json', 'auditoria.csv', 'classificacao.csv', 'dicionario-metadados.csv', 'hashes.sha256']) {
      expect(texto).toContain(nome);
    }
    expect(texto).toContain('documentos/06-Secretaria-de-Educacao/2026/outros/Decreto/2026-02-01_1-2026.pdf');
  });
});

describe('Continuidade', () => {
  it('cópia segregada leva os PDFs para o destino separado, só uma vez', async () => {
    const svc = app.get(ContinuidadeService);
    const r1 = await svc.copiaSegregada();
    expect((r1 as { copiados: number }).copiados).toBeGreaterThanOrEqual(2);
    const arquivos = await readdir(join(COPIA, `copia-jdoc-${SLUG}`));
    expect(arquivos.length).toBeGreaterThanOrEqual(2);
    const [n] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM platform.arquivos_copia WHERE tenant_id = ${tenantId}`;
    const r2 = await svc.copiaSegregada();
    const [n2] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM platform.arquivos_copia WHERE tenant_id = ${tenantId}`;
    expect(n2!.n).toBe(n!.n);
    expect(r2).toBeTruthy();
  });

  it.skipIf(!dockerPgDump)('teste de restauração restaura o backup, confere auditoria e arquivos e não deixa schema', async () => {
    const dump = execSync(`docker exec jdoc-pg-dev pg_dump -U jdoc -d jdoc --no-owner --no-acl --format=plain --schema=tenant_${SLUG}`, {
      maxBuffer: 256 * 1024 * 1024,
    });
    const backupId = randomUUID();
    const key = `backup-${backupId}.dump.gz`;
    await mkdir(join(STORAGE, `jdoc-${SLUG}`), { recursive: true });
    await writeFile(join(STORAGE, `jdoc-${SLUG}`, key), gzipSync(dump));
    await sql`
      INSERT INTO public.backups (id, tenant_id, status, kind, file_key, size_bytes, concluido_em)
      VALUES (${backupId}, ${tenantId}, 'concluido', 'manual', ${key}, ${dump.length}, now())
    `;
    const r = await app.get(ContinuidadeService).testarTenant(tenantId);
    expect(r.erro).toBeNull();
    expect(r).toMatchObject({ status: 'sucesso', documentos: 2, auditoriaIntegra: true, arquivosConferidos: 2, arquivosOk: 2 });
    const [schema] = await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${'rtest_' + SLUG}`;
    expect(schema).toBeUndefined();
  });

  it('disponibilidade conta cada minuto uma vez e o painel mostra tudo', async () => {
    const svc = app.get(ContinuidadeService);
    await svc.marcarMinuto();
    const [a] = await sql<Array<{ minutos: number }>>`SELECT minutos FROM platform.disponibilidade_dias ORDER BY dia DESC LIMIT 1`;
    await svc.marcarMinuto();
    const [b] = await sql<Array<{ minutos: number }>>`SELECT minutos FROM platform.disponibilidade_dias ORDER BY dia DESC LIMIT 1`;
    expect(b!.minutos).toBe(a!.minutos);

    const auth = await token(ADMIN);
    const p = await http().get(`/t/${SLUG}/continuidade`).set(auth).expect(200);
    expect(p.body).toMatchObject({ rpoHoras: 24, rtoHoras: 8 });
    expect(p.body.copiaSegregada.configurada).toBe(true);
    expect(p.body.copiaSegregada.arquivosCopiados).toBeGreaterThanOrEqual(2);
    expect(p.body.disponibilidade.length).toBeGreaterThan(0);
    if (dockerPgDump) expect(p.body.ultimoTesteRestauracao.status).toBe('sucesso');
    await http().get(`/t/${SLUG}/continuidade`).set(await token(OPER)).expect(403);

    const mes = new Date().toISOString().slice(0, 7);
    const rel = await http().get(`/t/${SLUG}/continuidade/relatorio-mensal?mes=${mes}`).set(auth).expect(200);
    expect(rel.headers['content-type']).toMatch(/pdf/);
    expect(existsSync(COPIA)).toBe(true);
  });
});
