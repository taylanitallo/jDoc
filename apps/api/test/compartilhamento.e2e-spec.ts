/**
 * Compartilhamento de documento entre usuarios do orgao. Requer postgres +
 * redis e `pnpm db:migrate`.
 *
 * Cobre:
 *  - so aparece quem ja pode ler o documento (permissao, nivel restrito, lotacao)
 *  - compartilhar com quem nao tem acesso e recusado
 *  - o documento chega em "recebidos", marca como visto e fica na auditoria
 *  - perder o acesso tira o documento da lista
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
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'compart_e2e';
const S = `"tenant_${SLUG}"`;
const SENHA = 'senha-compart-123';

let app: INestApplication;
let sql: postgres.Sql;
let redis: Redis;
const ids: Record<string, string> = {};
let docPublico = '';
let docRestrito = '';

async function limpar(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
  for (const padrao of ['bf:*', 'tenant:slug:*']) {
    const chaves = await redis.keys(padrao);
    if (chaves.length) await redis.del(...chaves);
  }
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  await limpar();
  await provisionTenantSchema(sql, SLUG);
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos) VALUES (${SLUG}, 'Orgao Compartilhamento', ${'tenant_' + SLUG}, 'ativo', '{arquivo}')`;
  const hash = await argon2.hash(SENHA, { type: argon2.argon2id });
  const [orgaoA] = await sql.unsafe<Array<{ id: string }>>(`INSERT INTO ${S}.orgaos (codigo, descricao, exercicio) VALUES ('01', 'Setor A', 2026) RETURNING id`);
  await sql.unsafe(`INSERT INTO ${S}.orgaos (codigo, descricao, exercicio) VALUES ('02', 'Setor B', 2026)`);
  const usuarios: Array<[string, string[], string[]]> = [
    ['autora', ['acervo:read', 'acervo_restrito:read'], []],
    ['leitor', ['acervo:read'], []],
    ['restrito', ['acervo:read', 'acervo_restrito:read'], []],
    ['sempermissao', [], []],
    ['outrosetor', ['acervo:read', 'acervo_restrito:read'], ['02']],
  ];
  for (const [nome, perms, lotacao] of usuarios) {
    const [u] = await sql.unsafe<Array<{ id: string }>>(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password, orgaos_codigos) VALUES ($1, $2, $3, 'operador', false, $4) RETURNING id`,
      [`${nome}@compart.gov.br`, nome, hash, lotacao as never],
    );
    ids[nome] = u!.id;
    for (const p of perms) await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [u!.id, p]);
  }
  const doc = async (descricao: string, nivel: string) =>
    (
      await sql.unsafe<Array<{ id: string }>>(
        `INSERT INTO ${S}.documents (module, descricao, exercicio, document_date, original_name, nivel_acesso, orgao_id)
         VALUES ('acervo', $1, 2026, '2026-01-10', 'x.pdf', $2, $3) RETURNING id`,
        [descricao, nivel, orgaoA!.id],
      )
    )[0]!.id;
  docPublico = await doc('Ofício público', 'publico');
  docRestrito = await doc('Prontuário', 'restrito');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser(process.env.COOKIE_SECRET ?? 'x'.repeat(32)));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await limpar();
  await redis?.quit();
  await sql?.end({ timeout: 5 });
});

async function entrar(nome: string): Promise<{ Authorization: string }> {
  const res = await request(app.getHttpServer()).post(`/t/${SLUG}/auth/login`).send({ email: `${nome}@compart.gov.br`, senha: SENHA }).expect(200);
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}

const nomes = (lista: Array<{ nome: string }>) => lista.map((u) => u.nome).sort();

describe('Compartilhamento de documento', () => {
  it('lista só quem pode ler, conforme permissão, sigilo e lotação', async () => {
    const http = request(app.getHttpServer());
    const autora = await entrar('autora');
    const pub = await http.get(`/t/${SLUG}/compartilhamentos/documentos/${docPublico}/destinatarios`).set(autora).expect(200);
    expect(nomes(pub.body)).toEqual(['leitor', 'restrito']);
    const res = await http.get(`/t/${SLUG}/compartilhamentos/documentos/${docRestrito}/destinatarios`).set(autora).expect(200);
    expect(nomes(res.body)).toEqual(['restrito']);
  });

  it('recusa destinatário sem acesso e quem não pode ler o documento', async () => {
    const http = request(app.getHttpServer());
    const autora = await entrar('autora');
    await http.post(`/t/${SLUG}/compartilhamentos/documentos/${docRestrito}`).set(autora).send({ destinatarios: [ids.leitor] }).expect(400);
    const leitor = await entrar('leitor');
    await http.post(`/t/${SLUG}/compartilhamentos/documentos/${docRestrito}`).set(leitor).send({ destinatarios: [ids.restrito] }).expect(404);
  });

  it('chega em recebidos, marca como visto e fica na auditoria', async () => {
    const http = request(app.getHttpServer());
    const autora = await entrar('autora');
    await http.post(`/t/${SLUG}/compartilhamentos/documentos/${docPublico}`).set(autora).send({ destinatarios: [ids.leitor], mensagem: 'Veja este ofício' }).expect(204);

    const leitor = await entrar('leitor');
    const antes = await http.get(`/t/${SLUG}/compartilhamentos/recebidos`).set(leitor).expect(200);
    expect(antes.body).toMatchObject({ total: 1, naoVistos: 1 });
    expect(antes.body.items[0]).toMatchObject({ documentId: docPublico, deNome: 'autora', mensagem: 'Veja este ofício', vistoEm: null });

    await http.post(`/t/${SLUG}/compartilhamentos/recebidos/${antes.body.items[0].id as string}/visto`).set(autora).expect(404);
    await http.post(`/t/${SLUG}/compartilhamentos/recebidos/${antes.body.items[0].id as string}/visto`).set(leitor).expect(204);
    const depois = await http.get(`/t/${SLUG}/compartilhamentos/recebidos`).set(leitor).expect(200);
    expect(depois.body.naoVistos).toBe(0);

    const log = await sql.unsafe(`SELECT 1 FROM ${S}.audit_logs WHERE action = 'document_shared' AND resource_id = $1`, [docPublico]);
    expect(log.length).toBe(1);
  });

  it('quem perde o acesso deixa de ver o documento na lista', async () => {
    const http = request(app.getHttpServer());
    await sql.unsafe(`UPDATE ${S}.documents SET nivel_acesso = 'restrito' WHERE id = $1`, [docPublico]);
    const leitor = await entrar('leitor');
    const lista = await http.get(`/t/${SLUG}/compartilhamentos/recebidos`).set(leitor).expect(200);
    expect(lista.body.total).toBe(0);
  });
});
