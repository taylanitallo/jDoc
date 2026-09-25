/**
 * Testes e2e do ATENDIMENTO E CONSULTAS (LAI).
 *
 * Cobre:
 *  (1) registro: protocolo sequencial por ano, prazo de 20 dias
 *  (2) documento restrito: quem nao ve nao inclui (nem confirma que existe); exige justificativa; titulo oculto na listagem
 *  (3) validacoes: sem documentos, data futura, nome curto
 *  (4) prorrogacao: justificativa obrigatoria, +10 dias, so uma vez
 *  (5) conclusao: indeferimento exige fundamentacao; concluido nao muda mais
 *  (6) atrasados, resumo e historico por documento
 *  (7) comprovante PDF; restrito so por quem pode ver; RBAC
 *  (8) numeracao sem colisao com pedidos simultaneos
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
const SLUG = 'atendimento_e2e';
const S = `"tenant_${SLUG}"`;
const ADMIN = 'admin@atendimento.gov.br';
const ATENDENTE = 'atendente@atendimento.gov.br';
const LEITOR = 'leitor@atendimento.gov.br';
const PASS = 'senha-atendimento-e2e-123';
const ANO = new Date().getFullYear();
const DIA = 86_400_000;

let app: INestApplication;
let sql: postgres.Sql;
const ids: Record<string, string> = {};

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup();
  await provisionTenantSchema(sql, SLUG);
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos)
            VALUES (${SLUG}, 'Arquivo Municipal', ${'tenant_' + SLUG}, 'ativo', '{arquivo}')`;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [email, nome, role] of [
    [ADMIN, 'Ana Admin', 'admin'],
    [ATENDENTE, 'Beto Atendente', 'operador'],
    [LEITOR, 'Caio Leitor', 'operador'],
  ] as const) {
    const r = await sql.unsafe(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [email, nome, hash, role],
    );
    ids[email] = (r[0] as { id: string }).id;
  }
  for (const p of ['atendimento:read', 'atendimento:create', 'atendimento:update', 'acervo:read']) {
    await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [ids[ATENDENTE], p]);
  }
  await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, 'acervo:read')`, [ids[LEITOR]]);
  const doc = async (descricao: string, nivel: string) =>
    ((await sql.unsafe(
      `INSERT INTO ${S}.documents (module, descricao, exercicio, document_date, original_name, nivel_acesso)
       VALUES ('acervo', $1, 1990, '1990-05-01', 'x.pdf', $2) RETURNING id`,
      [descricao, nivel],
    ))[0] as { id: string }).id;
  ids.publico = await doc('Lei de criação do bairro Centro', 'publico');
  ids.restrito = await doc('Ficha funcional de servidor aposentado', 'restrito');

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

async function login(email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post(`/t/${SLUG}/auth/login`).send({ email, senha: PASS }).expect(200);
  return res.body.accessToken as string;
}

const BASE = {
  solicitanteNome: 'Maria da Silva',
  solicitanteDocumento: '123.456.789-00',
  solicitanteContato: 'maria@email.com',
  vinculo: 'pesquisador',
  canal: 'presencial',
  finalidade: 'Pesquisa sobre a história do bairro Centro',
  formaAcesso: 'consulta_local',
};

describe('Atendimento e consultas', () => {
  let admin: string;
  let atendente: string;
  let leitor: string;
  let primeiro: string;
  let comRestrito: string;

  const post = (path: string, body: object, tok = atendente) =>
    request(app.getHttpServer()).post(`/t/${SLUG}/atendimentos${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const get = (path: string, tok = atendente) =>
    request(app.getHttpServer()).get(`/t/${SLUG}/atendimentos${path}`).set('Authorization', `Bearer ${tok}`);

  it('(1) registra com protocolo sequencial e prazo de 20 dias', async () => {
    admin = await login(ADMIN);
    atendente = await login(ATENDENTE);
    leitor = await login(LEITOR);
    const a = (await post('', { ...BASE, documentIds: [ids.publico] }).expect(201)).body;
    primeiro = a.id;
    expect(a.protocolo).toBe(`ATD 001/${ANO}`);
    expect(a.status).toBe('aberto');
    expect(a.registradoPor).toBe('Beto Atendente');
    expect(Math.round((Date.parse(a.prazoFinal) - Date.parse(a.dataPedido)) / DIA)).toBe(20);
    expect(a.diasRestantes).toBeGreaterThanOrEqual(19);
    expect(a.documentos).toEqual([{ id: ids.publico, identificacao: 'Lei de criação do bairro Centro', restrito: false, modulo: 'acervo' }]);
    const b = (await post('', { ...BASE, documentIds: [], documentosNaoCadastrados: 'Caixa 12 de 1978 (não digitalizada)' }).expect(201)).body;
    expect(b.protocolo).toBe(`ATD 002/${ANO}`);
  });

  it('(2) documento restrito: bloqueio, justificativa e ocultacao', async () => {
    // atendente nao ve restrito: resposta nao revela que o documento existe
    const r = await post('', { ...BASE, documentIds: [ids.restrito], justificativaRestrito: 'Ordem judicial 123/2024' }).expect(400);
    expect(r.body.message).toMatch(/não existe/);
    // admin ve, mas precisa justificar
    await post('', { ...BASE, documentIds: [ids.restrito] }, admin).expect(400);
    const ok = (await post('', { ...BASE, documentIds: [ids.restrito, ids.publico], justificativaRestrito: 'Pedido do próprio servidor, identidade conferida' }, admin).expect(201)).body;
    comRestrito = ok.id;
    const visto = (await get(`/${ok.id}`).expect(200)).body;
    expect(visto.documentos.find((d: { id: string }) => d.id === ids.restrito).identificacao).toBe('Documento restrito');
    expect(visto.documentos.find((d: { id: string }) => d.id === ids.publico).identificacao).toBe('Lei de criação do bairro Centro');
  });

  it('(3) validacoes', async () => {
    await post('', { ...BASE, documentIds: [] }).expect(400);
    await post('', { ...BASE, documentIds: [ids.publico], dataPedido: new Date(Date.now() + 3 * DIA).toISOString() }).expect(400);
    await post('', { ...BASE, solicitanteNome: 'Jo', documentIds: [ids.publico] }).expect(400);
    await post('', { ...BASE, vinculo: 'inventado', documentIds: [ids.publico] }).expect(400);
  });

  it('(4) prorrogacao unica e justificada', async () => {
    await post(`/${primeiro}/prorrogar`, { justificativa: 'curta' }).expect(400);
    const p = (await post(`/${primeiro}/prorrogar`, { justificativa: 'Documentos em caixa de difícil acesso no depósito' }).expect(201)).body;
    expect(p.prorrogado).toBe(true);
    expect(Math.round((Date.parse(p.prazoFinal) - Date.parse(p.dataPedido)) / DIA)).toBe(30);
    await post(`/${primeiro}/prorrogar`, { justificativa: 'Mais uma vez, nao pode' }).expect(409);
  });

  it('(5) conclusao e imutabilidade', async () => {
    await post(`/${primeiro}/concluir`, { status: 'indeferido', resposta: 'Nao pode' }).expect(400);
    const c = (await post(`/${primeiro}/concluir`, { status: 'atendido', resposta: 'Consulta realizada na sala de pesquisa' }).expect(201)).body;
    expect(c).toMatchObject({ status: 'atendido', concluidoPor: 'Beto Atendente', diasRestantes: null });
    await post(`/${primeiro}/concluir`, { status: 'cancelado', resposta: 'Engano' }).expect(409);
    await post(`/${primeiro}/prorrogar`, { justificativa: 'Depois de concluido nao pode' }).expect(409);
  });

  it('(6) atrasados, resumo e historico do documento', async () => {
    const velho = (await post('', { ...BASE, documentIds: [ids.publico], dataPedido: new Date(Date.now() - 40 * DIA).toISOString() }).expect(201)).body;
    expect(velho.diasRestantes).toBeLessThan(0);
    const atrasados = (await get('?situacao=atrasados').expect(200)).body;
    expect(atrasados.items.map((i: { id: string }) => i.id)).toEqual([velho.id]);
    const resumo = (await get('/resumo').expect(200)).body;
    expect(resumo).toMatchObject({ abertos: 3, atrasados: 1, concluidosNoMes: 1 });
    const doDoc = (await get(`?situacao=todos&documentId=${ids.publico}`).expect(200)).body;
    expect(doDoc.total).toBe(3);
    // abertos primeiro, o mais urgente no topo
    expect(doDoc.items[0].id).toBe(velho.id);
  });

  it('(7) comprovante e permissoes', async () => {
    const pdf = await get(`/${primeiro}/comprovante`).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await get(`/${comRestrito}/comprovante`).expect(403);
    await get(`/${comRestrito}/comprovante`, admin).expect(200);
    await get('', leitor).expect(403);
    await post('', { ...BASE, documentIds: [ids.publico] }, leitor).expect(403);
  });

  it('(8) numeracao sem colisao com pedidos simultaneos', async () => {
    const respostas = await Promise.all(
      Array.from({ length: 6 }, () => post('', { ...BASE, documentIds: [ids.publico] })),
    );
    expect(respostas.every((r) => r.status === 201)).toBe(true);
    const numeros = respostas.map((r) => r.body.protocolo as string);
    expect(new Set(numeros).size).toBe(6);
  });
});
