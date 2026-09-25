/**
 * Testes e2e de DESCRICAO ARQUIVISTICA (NOBRADE).
 *
 * Cobre:
 *  (1) arvore: hierarquia de niveis, acervo unico, codigo unico entre irmaos, codigo de referencia
 *  (2) obrigatorios: faltantes por nivel, produtor herdado, 4.1 so nos niveis 0 e 1
 *  (3) elementos opcionais: merge e remocao; pontos de acesso
 *  (4) vinculo de documentos e dossies: sugestoes de datas-limite e dimensao; restrito
 *  (5) instrumentos de pesquisa: guia, inventario e catalogo (PDF)
 *  (6) exclusao bloqueada com filhos ou vinculos; RBAC
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
const SLUG = 'descricao_e2e';
const S = `"tenant_${SLUG}"`;
const ADMIN = 'admin@descricao.gov.br';
const ARQUIVISTA = 'arquivista@descricao.gov.br';
const LEITOR = 'leitor@descricao.gov.br';
const PASS = 'senha-descricao-e2e-123';

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
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos) VALUES (${SLUG}, 'Prefeitura Descricao', ${'tenant_' + SLUG}, 'ativo', '{arquivo}')`;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [email, nome, role, perms] of [
    [ADMIN, 'Ana Admin', 'admin', []],
    [ARQUIVISTA, 'Artur Arquivista', 'operador', ['acervo:read', 'descricao:read', 'descricao:create', 'descricao:update']],
    [LEITOR, 'Lia Leitora', 'operador', ['acervo:read', 'descricao:read']],
  ] as const) {
    const r = await sql.unsafe(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [email, nome, hash, role],
    );
    for (const p of perms) await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [(r[0] as { id: string }).id, p]);
  }
  const doc = async (descricao: string, data: string, nivel = 'publico') =>
    ((await sql.unsafe(
      `INSERT INTO ${S}.documents (module, descricao, exercicio, document_date, original_name, nivel_acesso, paginas)
       VALUES ('acervo', $1, $2, $3, 'x.pdf', $4, 2) RETURNING id`,
      [descricao, Number(data.slice(0, 4)), data, nivel],
    ))[0] as { id: string }).id;
  ids.lei1 = await doc('Lei 100/1952 — cria o posto de saúde', '1952-06-10');
  ids.lei2 = await doc('Lei 850/1987 — reorganiza a secretaria', '1987-02-03');
  ids.prontuario = await doc('Prontuário de servidor', '1990-01-15', 'restrito');
  ids.dossie = ((await sql.unsafe(
    `INSERT INTO ${S}.dossies (tipo, numero, assunto, nivel_acesso, data_abertura) VALUES ('processo', '001/1995', 'Construção do hospital', 'publico', '1995-01-01') RETURNING id`,
  ))[0] as { id: string }).id;
  await sql.unsafe(`INSERT INTO ${S}.dossie_documentos (dossie_id, document_id, ordem) VALUES ($1, $2, 1)`, [
    ids.dossie,
    await doc('Projeto do hospital', '1995-03-01'),
  ]);

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

describe('Descricao arquivistica (NOBRADE)', () => {
  let admin: string;
  let arq: string;
  let leitor: string;
  const api = (m: 'get' | 'post' | 'patch' | 'delete', path: string, tok = arq) =>
    request(app.getHttpServer())[m](`/t/${SLUG}${path}`).set('Authorization', `Bearer ${tok}`);

  it('(1) arvore e codigo de referencia', async () => {
    admin = await login(ADMIN);
    arq = await login(ARQUIVISTA);
    leitor = await login(LEITOR);
    await api('post', '/descricao').send({ nivel: 'serie', codigo: '01', titulo: 'Série solta' }).expect(400);
    const acervo = (await api('post', '/descricao').send({ nivel: 'acervo', codigo: 'BR SPPMD', titulo: 'Arquivo Público Municipal', produtor: 'Prefeitura Municipal' }).expect(201)).body;
    ids.acervo = acervo.id;
    await api('post', '/descricao').send({ nivel: 'acervo', codigo: 'BR X', titulo: 'Outro acervo' }).expect(409);
    const fundo = (await api('post', '/descricao').send({ parentId: ids.acervo, nivel: 'fundo', codigo: 'SAU', titulo: 'Secretaria Municipal de Saúde' }).expect(201)).body;
    ids.fundo = fundo.id;
    await api('post', '/descricao').send({ parentId: ids.acervo, nivel: 'fundo', codigo: 'sau', titulo: 'Duplicado' }).expect(409);
    await api('post', '/descricao').send({ parentId: ids.fundo, nivel: 'fundo', codigo: 'X', titulo: 'Fundo dentro de fundo' }).expect(400);
    const serie = (await api('post', '/descricao').send({ parentId: ids.fundo, nivel: 'serie', codigo: '01', titulo: 'Legislação da saúde' }).expect(201)).body;
    ids.serie = serie.id;
    expect(serie.codigoReferencia).toBe('BR SPPMD SAU.01');
    expect(serie.caminho.map((c: { codigo: string }) => c.codigo)).toEqual(['BR SPPMD', 'SAU', '01']);
    const arvore = (await api('get', '/descricao', leitor).expect(200)).body;
    expect(arvore).toHaveLength(3);
  });

  it('(2) obrigatorios por nivel e produtor herdado', async () => {
    const fundo = (await api('get', `/descricao/${ids.fundo}`).expect(200)).body;
    // fundo: datas, dimensao e condicoes de acesso faltam; produtor herdado do acervo
    expect(fundo.faltantes).toEqual(['1.3', '1.5', '4.1']);
    expect(fundo.produtorHerdado).toBe('Prefeitura Municipal');
    const serie = (await api('get', `/descricao/${ids.serie}`).expect(200)).body;
    expect(serie.faltantes).toEqual(['1.3', '1.5']);
    const ok = (await api('patch', `/descricao/${ids.fundo}`).send({ datas: '1952-1995', dimensaoSuporte: '12 caixas', condicoesAcesso: 'Acesso livre, exceto dados pessoais' }).expect(200)).body;
    expect(ok.faltantes).toEqual([]);
    expect((await api('get', '/descricao').expect(200)).body.find((n: { id: string }) => n.id === ids.fundo).completa).toBe(true);
  });

  it('(3) elementos opcionais e pontos de acesso', async () => {
    let v = (await api('patch', `/descricao/${ids.fundo}`).send({ elementos: { historiaAdministrativa: 'Criada pela Lei 100/1952.', idioma: 'Português' }, pontosAcesso: ['Saúde', 'Hospital', 'Saúde'] }).expect(200)).body;
    expect(v.elementos).toEqual({ historiaAdministrativa: 'Criada pela Lei 100/1952.', idioma: 'Português' });
    expect(v.pontosAcesso).toEqual(['Saúde', 'Hospital']);
    v = (await api('patch', `/descricao/${ids.fundo}`).send({ elementos: { idioma: '', notasGerais: 'Doação parcial em 2001.' } }).expect(200)).body;
    expect(v.elementos).toEqual({ historiaAdministrativa: 'Criada pela Lei 100/1952.', notasGerais: 'Doação parcial em 2001.' });
    await api('patch', `/descricao/${ids.fundo}`).send({ elementos: { inventado: 'x' } }).expect(400);
  });

  it('(4) vinculos e sugestoes', async () => {
    await api('post', `/descricao/${ids.acervo}/vincular`).send({ documentIds: [ids.lei1] }).expect(400);
    // arquivista sem acesso a restritos nao vincula o prontuario
    await api('post', `/descricao/${ids.serie}/vincular`).send({ documentIds: [ids.prontuario] }).expect(404);
    const s = (await api('post', `/descricao/${ids.serie}/vincular`).send({ documentIds: [ids.lei1, ids.lei2] }).expect(201)).body;
    expect(s.totalDocumentos).toBe(2);
    expect(s.sugestoes).toEqual({ datas: '1952-1987', dimensaoSuporte: '2 documento(s) digital(is), 4 página(s)' });
    await api('post', `/descricao/${ids.fundo}/vincular`, admin).send({ documentIds: [ids.prontuario], dossieIds: [ids.dossie] }).expect(201);
    const f = (await api('get', `/descricao/${ids.fundo}`).expect(200)).body;
    // subarvore: 2 leis + prontuario + documento do processo; datas 1952-1995
    expect(f.sugestoes.datas).toBe('1952-1995');
    expect(f.sugestoes.dimensaoSuporte).toContain('4 documento(s)');
    expect(f.sugestoes.dimensaoSuporte).toContain('1 dossiê(s)/processo(s)');
    expect(f.documentos).toEqual([expect.objectContaining({ identificacao: 'Documento restrito', restrito: true })]);
    expect(f.dossies).toEqual([expect.objectContaining({ numero: '001/1995' })]);
    const semLei2 = (await api('post', `/descricao/${ids.serie}/desvincular`).send({ documentIds: [ids.lei2] }).expect(201)).body;
    expect(semLei2.totalDocumentos).toBe(1);
  });

  it('(5) instrumentos de pesquisa', async () => {
    for (const path of ['/descricao/guia', `/descricao/${ids.fundo}/instrumento`, `/descricao/${ids.fundo}/instrumento?tipo=catalogo`]) {
      const r = await api('get', path, leitor).buffer(true).expect(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      // conteudo curto cabe numa pagina (rodape nao pode abrir pagina em branco)
      expect((r.body as Buffer).toString('latin1').match(/\/Type \/Page(?!s)/g)).toHaveLength(1);
    }
    await api('get', `/descricao/${ids.fundo}/instrumento?tipo=outro`, leitor).expect(400);
  });

  it('(6) exclusao e RBAC', async () => {
    await api('post', '/descricao', leitor).send({ nivel: 'fundo', codigo: 'EDU', titulo: 'Educação' }).expect(403);
    await api('patch', `/descricao/${ids.serie}`, leitor).send({ titulo: 'x' }).expect(403);
    await api('delete', `/descricao/${ids.serie}`).expect(403);
    await api('delete', `/descricao/${ids.fundo}`, admin).expect(409);
    await api('delete', `/descricao/${ids.serie}`, admin).expect(409);
    await api('post', `/descricao/${ids.serie}/desvincular`).send({ documentIds: [ids.lei1] }).expect(201);
    await api('delete', `/descricao/${ids.serie}`, admin).expect(200);
    await api('get', `/descricao/${ids.serie}`).expect(404);
    const audit = await sql.unsafe(`SELECT action FROM ${S}.audit_logs WHERE resource_type = 'unidade_descricao'`);
    expect(audit.map((a) => (a as { action: string }).action)).toEqual(
      expect.arrayContaining(['descricao_criada', 'descricao_alterada', 'descricao_vinculada', 'descricao_excluida', 'instrumento_pesquisa_emitido']),
    );
  });
});
