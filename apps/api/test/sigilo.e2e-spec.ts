/**
 * Testes e2e do SIGILO (LAI).
 *
 * Cobre:
 *  (1) classificar: TCI numerado, prazo legal, documento vira restrito e some para quem nao ve restritos
 *  (2) regras: uma classificacao vigente, hipotese x grau, prazo vencido, prazo acima do maximo, RBAC
 *  (3) listagem/TCI sem permissao de restrito nao revelam titulo nem razoes
 *  (4) desclassificacao antecipada restaura o acesso anterior (publico ou restrito)
 *  (5) fim automatico do sigilo por prazo + auditoria; rol anual em PDF
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
const SLUG = 'sigilo_e2e';
const S = `"tenant_${SLUG}"`;
const ARQUIVISTA = 'arquivista@sigilo.gov.br';
const LEITOR = 'leitor@sigilo.gov.br';
const PASS = 'senha-sigilo-e2e-123';
const ANO = new Date().getFullYear();
const hojeMais = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

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
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos) VALUES (${SLUG}, 'Prefeitura Sigilo', ${'tenant_' + SLUG}, 'ativo', '{arquivo}')`;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [email, nome, perms] of [
    [ARQUIVISTA, 'Ana Arquivista', ['acervo:read', 'acervo:update', 'acervo_restrito:read', 'acervo_sigiloso:read', 'sigilo:read', 'sigilo:create', 'sigilo:update']],
    [LEITOR, 'Leo Leitor', ['acervo:read', 'sigilo:read']],
  ] as const) {
    const r = await sql.unsafe(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $2, $3, 'operador', false) RETURNING id`,
      [email, nome, hash],
    );
    for (const p of perms) {
      await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [(r[0] as { id: string }).id, p]);
    }
  }
  const doc = async (descricao: string, data: string, nivel = 'publico') =>
    ((await sql.unsafe(
      `INSERT INTO ${S}.documents (module, descricao, exercicio, document_date, original_name, nivel_acesso)
       VALUES ('acervo', $1, $2, $3, 'x.pdf', $4) RETURNING id`,
      [descricao, Number(data.slice(0, 4)), data, nivel],
    ))[0] as { id: string }).id;
  ids.fiscal = await doc('Relatório de fiscalização tributária', `${ANO - 1}-01-10`);
  ids.antigo = await doc('Ofício de 2010', '2010-01-01');
  ids.prontuario = await doc('Prontuário médico de servidor', `${ANO - 2}-06-01`, 'restrito');
  ids.expira = await doc('Parecer com sigilo vencendo', `${ANO - 4}-01-01`);

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

const CLASSIF = {
  grau: 'reservado',
  hipotese: 'art23_VIII',
  razoes: 'Fiscalização tributária em andamento sobre o contribuinte citado no relatório',
  autoridadeNome: 'João Prefeito',
  autoridadeCargo: 'Prefeito Municipal',
};

describe('Sigilo (LAI)', () => {
  let arq: string;
  let leitor: string;
  let termoFiscal: string;
  const post = (path: string, body: object, tok = arq) =>
    request(app.getHttpServer()).post(`/t/${SLUG}/sigilo${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const get = (path: string, tok = arq) => request(app.getHttpServer()).get(`/t/${SLUG}${path}`).set('Authorization', `Bearer ${tok}`);

  it('(1) classifica: TCI, prazo legal e documento restrito', async () => {
    arq = await login(ARQUIVISTA);
    leitor = await login(LEITOR);
    const t = (await post(`/documentos/${ids.fiscal}/classificar`, CLASSIF).expect(201)).body;
    termoFiscal = t.id;
    expect(t).toMatchObject({ numeroTci: `TCI 001/${ANO}`, grau: 'reservado', status: 'vigente', prazoFim: `${ANO + 4}-01-10`, classificadoPor: 'Ana Arquivista' });
    expect(t.fundamento).toMatch(/^Art\. 23, VIII/);
    const doc = (await get(`/documents/${ids.fiscal}`).expect(200)).body;
    expect(doc).toMatchObject({ nivelAcesso: 'restrito', grauSigilo: 'reservado' });
    await get(`/documents/${ids.fiscal}`, leitor).expect(404);
    // a edicao comum nao consegue liberar documento classificado (so pelo termo)
    const burla = await request(app.getHttpServer())
      .patch(`/t/${SLUG}/documents/${ids.fiscal}`)
      .set('Authorization', `Bearer ${arq}`)
      .send({ nivelAcesso: 'publico' })
      .expect(400);
    expect(burla.body.message).toMatch(/desclassifique/);
    const lista = (await get('/documents?module=acervo&pageSize=50', leitor).expect(200)).body;
    expect(lista.items.map((i: { id: string }) => i.id)).not.toContain(ids.fiscal);
  });

  it('(2) regras de classificacao', async () => {
    await post(`/documentos/${ids.fiscal}/classificar`, CLASSIF).expect(409);
    await post(`/documentos/${ids.antigo}/classificar`, { ...CLASSIF, grau: 'pessoal' }).expect(400); // pessoal exige art. 31
    const vencido = await post(`/documentos/${ids.antigo}/classificar`, CLASSIF).expect(400); // 2010 + 5 anos ja passou
    expect(vencido.body.message).toMatch(/já venceu/);
    const acima = await post(`/documentos/${ids.antigo}/classificar`, { ...CLASSIF, grau: 'secreto', prazoFim: '2040-01-01' }).expect(400);
    expect(acima.body.message).toMatch(/prazo máximo/);
    await post(`/documentos/${ids.antigo}/classificar`, CLASSIF, leitor).expect(403);
    // quem nao ve restrito nao descobre que o documento existe
    await post(`/documentos/${ids.prontuario}/classificar`, { ...CLASSIF, grau: 'pessoal', hipotese: 'art31' }, leitor).expect(403);
  });

  it('(3) sem permissao de restrito: titulo e razoes ocultos; TCI vigente inacessivel', async () => {
    const lista = (await get('/sigilo/termos', leitor).expect(200)).body;
    expect(lista[0]).toMatchObject({ documento: 'Documento classificado', razoes: '—', grau: 'reservado' });
    await get(`/sigilo/termos/${termoFiscal}/tci`, leitor).expect(404);
    const pdf = await get(`/sigilo/termos/${termoFiscal}/tci`).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('(4) desclassificacao restaura o acesso anterior', async () => {
    await post(`/termos/${termoFiscal}/desclassificar`, { motivo: 'curto' }).expect(400);
    const d = (await post(`/termos/${termoFiscal}/desclassificar`, { motivo: 'Fiscalização concluída e publicada no Diário Oficial' }).expect(201)).body;
    expect(d.status).toBe('desclassificado');
    const doc = (await get(`/documents/${ids.fiscal}`, leitor).expect(200)).body;
    expect(doc).toMatchObject({ nivelAcesso: 'publico', grauSigilo: null });
    await post(`/termos/${termoFiscal}/desclassificar`, { motivo: 'De novo nao pode' }).expect(404);

    // documento que ja era restrito continua restrito depois do sigilo
    const p = (await post(`/documentos/${ids.prontuario}/classificar`, { ...CLASSIF, grau: 'pessoal', hipotese: 'art31', razoes: 'Dados de saúde do servidor, protegidos pelo art. 31 da LAI' }).expect(201)).body;
    expect(p.prazoFim).toBe(`${ANO + 98}-06-01`);
    await post(`/termos/${p.id}/desclassificar`, { motivo: 'Consentimento expresso do titular registrado' }).expect(201);
    expect((await get(`/documents/${ids.prontuario}`).expect(200)).body).toMatchObject({ nivelAcesso: 'restrito', grauSigilo: null });
  });

  it('(5) fim automatico do sigilo e rol anual', async () => {
    const t = (await post(`/documentos/${ids.expira}/classificar`, { ...CLASSIF, prazoFim: hojeMais(10) }).expect(201)).body;
    // simula a passagem do tempo: o prazo venceu ontem
    await sql.unsafe(`UPDATE ${S}.termos_sigilo SET prazo_fim = current_date - 1 WHERE id = $1`, [t.id]);
    const resumo = (await get('/sigilo/resumo').expect(200)).body;
    expect(resumo.vigentesPorGrau.reservado).toBe(0);
    expect(resumo.desclassificados12Meses).toBe(3);
    const termo = (await get(`/sigilo/termos?situacao=todos&documentId=${ids.expira}`).expect(200)).body[0];
    expect(termo).toMatchObject({ status: 'expirado' });
    expect(termo.motivoEncerramento).toMatch(/Fim do prazo/);
    expect((await get(`/documents/${ids.expira}`, leitor).expect(200)).body.nivelAcesso).toBe('publico');
    const aud = await sql.unsafe(`SELECT count(*)::int AS n FROM ${S}.audit_logs WHERE action = 'sigilo_expirado'`);
    expect((aud[0] as { n: number }).n).toBe(1);
    const rol = await get('/sigilo/rol', leitor).buffer(true).expect(200);
    expect(rol.headers['content-type']).toBe('application/pdf');
  });
});
