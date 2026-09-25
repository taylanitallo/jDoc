/**
 * Testes e2e do ARQUIVO FISICO (locais, caixas, emprestimos).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  (1) arvore predio > sala > caixa; hierarquia invalida e codigo duplicado recusados
 *  (2) vincular documento a caixa + conteudo + etiqueta/espelho em PDF
 *  (3) emprestimo: numero sequencial, item ja emprestado = 409, termo PDF, devolucao
 *  (4) documento restrito: oculto no conteudo da caixa para quem nao pode ver
 *  (5) local em uso so e inativado; RBAC: consulta nao cria local
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
const SLUG = 'fisico_e2e';
const ADMIN = 'admin@fisico.gov.br';
const ARQUIVISTA = 'arquivista@fisico.gov.br';
const CONSULTA = 'consulta@fisico.gov.br';
const PASS = 'senha-fisico-e2e-123';

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
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status) VALUES (${SLUG}, 'Arquivo Municipal', ${'tenant_' + SLUG}, 'ativo')`;
  const ids: Record<string, string> = {};
  for (const [email, role] of [
    [ADMIN, 'admin'],
    [ARQUIVISTA, 'operador'],
    [CONSULTA, 'consulta'],
  ] as const) {
    const r = await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $1, $2, $3, false) RETURNING id`,
      [email, hash, role],
    );
    ids[email] = (r[0] as { id: string }).id;
  }
  for (const p of ['arquivo_fisico:read', 'arquivo_fisico:create', 'arquivo_fisico:update', 'outros:read']) {
    await sql.unsafe(`INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key) VALUES ($1, $2)`, [ids[ARQUIVISTA], p]);
  }
  await sql.unsafe(`INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key) VALUES ($1, 'arquivo_fisico:read')`, [ids[CONSULTA]]);

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

describe('Arquivo fisico', () => {
  let arq: string;
  let predio: string;
  let caixa: string;
  let docPublico: string;
  let docRestrito: string;
  let emprestimoId: string;

  const post = (path: string, body: object, tok = arq) =>
    request(app.getHttpServer()).post(`/t/${SLUG}/arquivo-fisico${path}`).set('Authorization', `Bearer ${tok}`).send(body);

  it('(1) monta a arvore e recusa hierarquia invalida / codigo duplicado', async () => {
    arq = await login(ARQUIVISTA);
    predio = (await post('/locais', { tipo: 'predio', codigo: 'Sede' }).expect(201)).body.id;
    const sala = (await post('/locais', { tipo: 'sala', codigo: '2', parentId: predio }).expect(201)).body.id;
    caixa = (await post('/locais', { tipo: 'caixa', codigo: 'CX-0012', parentId: sala, descricao: 'Contratos 2019-2020' }).expect(201)).body.id;
    await post('/locais', { tipo: 'predio', codigo: 'Anexo', parentId: caixa }).expect(400);
    await post('/locais', { tipo: 'caixa', codigo: 'CX-0012', parentId: sala }).expect(409);
    // Mover o predio para dentro da propria caixa = ciclo/hierarquia invalida.
    await request(app.getHttpServer())
      .patch(`/t/${SLUG}/arquivo-fisico/locais/${predio}`)
      .set('Authorization', `Bearer ${arq}`)
      .send({ parentId: caixa })
      .expect(400);
  });

  it('(2) vincula documentos, lista conteudo e gera etiqueta/espelho', async () => {
    const ins = async (descricao: string, nivel: string) =>
      (
        await sql.unsafe(
          `INSERT INTO "tenant_${SLUG}".documents (module, descricao, exercicio, document_date, original_name, nivel_acesso)
           VALUES ('outros', $1, 2019, '2019-06-01', 'x.pdf', $2) RETURNING id`,
          [descricao, nivel],
        )
      )[0]!.id as string;
    docPublico = await ins('Contrato de limpeza urbana', 'publico');
    docRestrito = await ins('Ficha do servidor Fulano', 'restrito');

    // Arquivista nao ve restrito: vincula so o publico.
    const v = await post(`/locais/${caixa}/documentos`, { ids: [docPublico, docRestrito] }).expect(201);
    expect(v.body.vinculados).toBe(1);
    const admin = await login(ADMIN);
    await post(`/locais/${caixa}/documentos`, { ids: [docRestrito] }, admin).expect(201);

    const c = await request(app.getHttpServer()).get(`/t/${SLUG}/arquivo-fisico/locais/${caixa}/conteudo`).set('Authorization', `Bearer ${arq}`).expect(200);
    expect(c.body.itens.map((i: { id: string }) => i.id)).toEqual([docPublico]);
    expect(c.body.ocultos).toBe(1);

    for (const pdf of ['etiqueta', 'espelho']) {
      const r = await request(app.getHttpServer()).get(`/t/${SLUG}/arquivo-fisico/locais/${caixa}/${pdf}`).set('Authorization', `Bearer ${arq}`).expect(200);
      expect(r.headers['content-type']).toContain('application/pdf');
    }
    const doc = await sql.unsafe(`SELECT possui_original_fisico, local_fisico_id FROM "tenant_${SLUG}".documents WHERE id = $1`, [docPublico]);
    expect(doc[0]).toMatchObject({ possui_original_fisico: true, local_fisico_id: caixa });
  });

  it('(3) emprestimo numerado, bloqueio de duplicidade, termo e devolucao', async () => {
    const base = { solicitanteNome: 'Maria Souza', solicitanteSetor: 'Procuradoria', prazoDevolucao: '2099-01-10', finalidade: 'Instruir processo' };
    const e1 = await post('/emprestimos', { ...base, documentId: docPublico }).expect(201);
    emprestimoId = e1.body.id;
    expect(e1.body).toMatchObject({ numero: 1, status: 'aberto', atrasado: false });
    await post('/emprestimos', { ...base, documentId: docPublico }).expect(409);
    await post('/emprestimos', { ...base, documentId: docPublico, prazoDevolucao: '2000-01-01' }).expect(400);
    const e2 = await post('/emprestimos', { ...base, localFisicoId: caixa }).expect(201);
    expect(e2.body.numero).toBe(2);

    // Atraso calculado pelo banco.
    await sql.unsafe(`UPDATE "tenant_${SLUG}".emprestimos SET prazo_devolucao = '2020-01-01' WHERE id = $1`, [e2.body.id]);
    const atrasados = await request(app.getHttpServer()).get(`/t/${SLUG}/arquivo-fisico/emprestimos?status=atrasados`).set('Authorization', `Bearer ${arq}`).expect(200);
    expect(atrasados.body.map((e: { id: string }) => e.id)).toEqual([e2.body.id]);

    const termo = await request(app.getHttpServer()).get(`/t/${SLUG}/arquivo-fisico/emprestimos/${emprestimoId}/termo`).set('Authorization', `Bearer ${arq}`).expect(200);
    expect(termo.headers['content-type']).toContain('application/pdf');

    const dev = await post(`/emprestimos/${emprestimoId}/devolucao`, { observacao: 'Devolvido completo' }).expect(200);
    expect(dev.body.status).toBe('devolvido');
    await post(`/emprestimos/${emprestimoId}/devolucao`, {}).expect(400);
    // Depois de devolvido, pode emprestar de novo.
    await post('/emprestimos', { ...base, documentId: docPublico }).expect(201);

    const resumo = await request(app.getHttpServer()).get(`/t/${SLUG}/arquivo-fisico/resumo`).set('Authorization', `Bearer ${arq}`).expect(200);
    expect(resumo.body).toMatchObject({ caixas: 1, documentosComOriginal: 2, emprestimosAbertos: 2, emprestimosAtrasados: 1 });
  });

  it('(4) emprestimo de documento restrito invisivel para quem nao pode ver', async () => {
    await post('/emprestimos', { solicitanteNome: 'Joao', solicitanteSetor: 'RH', prazoDevolucao: '2099-01-10', documentId: docRestrito }).expect(404);
  });

  it('(5) local em uso so e inativado; consulta nao cria local', async () => {
    const admin = await login(ADMIN);
    const del = await request(app.getHttpServer()).delete(`/t/${SLUG}/arquivo-fisico/locais/${caixa}`).set('Authorization', `Bearer ${admin}`).expect(200);
    expect(del.body.inativado).toBe(true);
    const consulta = await login(CONSULTA);
    await post('/locais', { tipo: 'caixa', codigo: 'CX-9' }, consulta).expect(403);
  });
});
