/**
 * Testes e2e de DOSSIES E PROCESSOS.
 *
 * Cobre:
 *  (1) abertura: numero automatico, numero duplicado, restrito invisivel
 *  (2) juntada: ordem, classe do conjunto, prazo suspenso enquanto aberto; sem duplicar; restrito; lixeira bloqueada
 *  (3) encerramento: prazo conta do encerramento e o conjunto aparece nas listas
 *  (4) eliminacao leva o conjunto inteiro
 *  (5) reabertura e desentranhamento (motivo) devolvem o documento a contagem propria
 *  (6) apensacao: apensado segue o principal; historico; capa em PDF
 *  (7) RBAC
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
const SLUG = 'dossies_e2e';
const S = `"tenant_${SLUG}"`;
const ADMIN = 'admin@dossies.gov.br';
const PROTOCOLO = 'protocolo@dossies.gov.br';
const LEITOR = 'leitor@dossies.gov.br';
const PASS = 'senha-dossies-e2e-123';
const ANO = new Date().getFullYear();

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
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos) VALUES (${SLUG}, 'Prefeitura Dossies', ${'tenant_' + SLUG}, 'ativo', '{arquivo}')`;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [email, nome, role, perms] of [
    [ADMIN, 'Ana Admin', 'admin', []],
    [PROTOCOLO, 'Paulo Protocolo', 'operador', ['acervo:read', 'acervo:delete', 'dossies:read', 'dossies:create', 'dossies:update']],
    [LEITOR, 'Lia Leitora', 'operador', ['acervo:read', 'dossies:read']],
  ] as const) {
    const r = await sql.unsafe(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [email, nome, hash, role],
    );
    for (const p of perms) await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [(r[0] as { id: string }).id, p]);
  }
  // Classe de licitacoes: 2 anos corrente + 3 intermediario, eliminacao, conta da data do documento.
  ids.classe = ((await sql.unsafe(
    `INSERT INTO ${S}.classificacoes (codigo, descricao, prazo_corrente_anos, prazo_intermediario_anos, destinacao, evento_contagem)
     VALUES ('030', 'Licitações', 2, 3, 'eliminacao', 'data_documento') RETURNING id`,
  ))[0] as { id: string }).id;
  const doc = async (descricao: string, data: string, nivel = 'publico') =>
    ((await sql.unsafe(
      `INSERT INTO ${S}.documents (module, descricao, exercicio, document_date, original_name, nivel_acesso, paginas)
       VALUES ('acervo', $1, $2, $3, 'x.pdf', $4, 3) RETURNING id`,
      [descricao, Number(data.slice(0, 4)), data, nivel],
    ))[0] as { id: string }).id;
  ids.edital = await doc('Edital do pregão 12/2015', '2015-03-01');
  ids.ata = await doc('Ata de julgamento', '2015-04-10');
  ids.recurso = await doc('Recurso da empresa X', '2015-05-02');
  ids.sigiloso = await doc('Parecer jurídico reservado', '2015-04-01', 'restrito');

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

const prazos = async (docId: string) =>
  (await sql.unsafe(`SELECT to_char(data_prevista_transferencia, 'YYYY-MM-DD') AS tr, to_char(data_prevista_destinacao, 'YYYY-MM-DD') AS de, classificacao_id FROM ${S}.documents WHERE id = $1`, [docId]))[0] as { tr: string | null; de: string | null; classificacao_id: string | null };

describe('Dossies e processos', () => {
  let admin: string;
  let prot: string;
  let leitor: string;
  let proc: string;
  let apenso: string;
  const api = (m: 'get' | 'post' | 'patch', path: string, tok = prot) =>
    request(app.getHttpServer())[m](`/t/${SLUG}${path}`).set('Authorization', `Bearer ${tok}`);

  it('(1) abertura', async () => {
    admin = await login(ADMIN);
    prot = await login(PROTOCOLO);
    leitor = await login(LEITOR);
    const p = (await api('post', '/dossies').send({ tipo: 'processo', assunto: 'Pregão 12/2015 — merenda escolar', interessado: 'Secretaria de Educação', classificacaoId: ids.classe, nivelAcesso: 'publico', dataAbertura: '2015-03-01' }).expect(201)).body;
    proc = p.id;
    expect(p).toMatchObject({ numero: '001/2015', status: 'aberto', classeCodigo: '030', totalDocumentos: 0 });
    expect(p.eventos[0]).toMatchObject({ tipo: 'abertura', usuario: 'Paulo Protocolo' });
    await api('post', '/dossies').send({ tipo: 'processo', numero: '001/2015', assunto: 'Duplicado' }).expect(409);
    // quem ve restritos: nasce restrito; quem nao ve nao consegue abrir restrito
    const restrito = (await api('post', '/dossies', admin).send({ tipo: 'dossie', assunto: 'Dossiê funcional de Maria' }).expect(201)).body;
    await api('post', '/dossies').send({ tipo: 'dossie', assunto: 'Outro funcional', nivelAcesso: 'restrito' }).expect(400);
    expect((await api('post', '/dossies').send({ tipo: 'dossie', assunto: 'Dossiê público' }).expect(201)).body.nivelAcesso).toBe('publico');
    expect(restrito.nivelAcesso).toBe('restrito');
    await api('get', `/dossies/${restrito.id}`, leitor).expect(404);
  });

  it('(2) juntada', async () => {
    const r = (await api('post', `/dossies/${proc}/juntar`).send({ documentIds: [ids.edital, ids.ata] }).expect(201)).body;
    expect(r.documentos.map((d: { ordem: number; id: string }) => [d.ordem, d.id])).toEqual([[1, ids.edital], [2, ids.ata]]);
    expect(r.totalPaginas).toBe(6);
    const pe = await prazos(ids.edital);
    expect(pe.classificacao_id).toBe(ids.classe);
    expect(pe.tr).toBeNull(); // aberto: prazo suspenso
    const aTransf = (await api('get', '/arquivistica/temporalidade?lista=a_eliminar', admin).expect(200)).body;
    expect(aTransf.items.map((i: { id: string }) => i.id)).not.toContain(ids.edital);

    const outro = (await api('post', '/dossies').send({ tipo: 'processo', assunto: 'Outro', nivelAcesso: 'publico' }).expect(201)).body;
    await api('post', `/dossies/${outro.id}/juntar`).send({ documentIds: [ids.ata] }).expect(409);
    await api('post', `/dossies/${proc}/juntar`).send({ documentIds: [ids.sigiloso] }).expect(400); // protocolo nao ve restrito
    const lixo = await api('delete', `/documents/${ids.edital}`).expect(400);
    expect(lixo.body.message).toMatch(/desentranhamento/);
  });

  it('(3) encerramento: prazo do conjunto conta do encerramento', async () => {
    await api('post', `/dossies/${proc}/encerrar`).send({ dataEncerramento: `${ANO + 1}-01-01` }).expect(400);
    await api('post', `/dossies/${proc}/encerrar`).send({ dataEncerramento: '2014-01-01' }).expect(400);
    const e = (await api('post', `/dossies/${proc}/encerrar`).send({ dataEncerramento: '2016-12-31' }).expect(201)).body;
    expect(e).toMatchObject({ status: 'encerrado', previsaoTransferencia: '2018-12-31', previsaoDestinacao: '2021-12-31', destinacao: 'eliminacao' });
    for (const id of [ids.edital, ids.ata]) expect(await prazos(id)).toMatchObject({ tr: '2018-12-31', de: '2021-12-31' });
    await api('post', `/dossies/${proc}/juntar`).send({ documentIds: [ids.recurso] }).expect(409);
  });

  it('(4) eliminacao inclui o conjunto inteiro', async () => {
    const el = (await api('post', '/arquivistica/eliminacoes', admin).send({}).expect(201)).body;
    const r = (await api('post', `/arquivistica/eliminacoes/${el.id}/itens`, admin).send({ ids: [ids.edital] }).expect(201)).body;
    expect(r.adicionados).toBe(2);
    await api('post', `/arquivistica/eliminacoes/${el.id}/cancelar`, admin).send({ motivo: 'Teste de conjunto concluido' });
    await sql.unsafe(`DELETE FROM ${S}.eliminacao_itens WHERE eliminacao_id = $1`, [el.id]);
  });

  it('(5) reabertura e desentranhamento', async () => {
    await api('post', `/dossies/${proc}/desentranhar`).send({ documentId: ids.ata, motivo: 'Juntado por engano' }).expect(409); // encerrado
    await api('post', `/dossies/${proc}/reabrir`).send({ motivo: 'curto' }).expect(400);
    const r = (await api('post', `/dossies/${proc}/reabrir`).send({ motivo: 'Recurso recebido após o encerramento' }).expect(201)).body;
    expect(r.status).toBe('aberto');
    expect((await prazos(ids.edital)).tr).toBeNull();
    const d = (await api('post', `/dossies/${proc}/desentranhar`).send({ documentId: ids.ata, motivo: 'Juntado por engano ao processo' }).expect(201)).body;
    expect(d.documentos.map((x: { id: string }) => x.id)).toEqual([ids.edital]);
    // volta a contar da propria data (2015-04-10 + 2 anos)
    expect((await prazos(ids.ata)).tr).toBe('2017-04-10');
    expect(d.eventos.map((x: { tipo: string }) => x.tipo)).toEqual(expect.arrayContaining(['desentranhamento', 'reabertura', 'encerramento', 'juntada', 'abertura']));
  });

  it('(6) apensacao, historico e capa', async () => {
    const a = (await api('post', '/dossies').send({ tipo: 'processo', assunto: 'Recurso administrativo', classificacaoId: ids.classe, nivelAcesso: 'publico', dataAbertura: '2015-05-01' }).expect(201)).body;
    apenso = a.id;
    await api('post', `/dossies/${apenso}/juntar`).send({ documentIds: [ids.recurso] }).expect(201);
    await api('post', `/dossies/${apenso}/apensar`).send({ principalId: apenso }).expect(400);
    const ap = (await api('post', `/dossies/${apenso}/apensar`).send({ principalId: proc }).expect(201)).body;
    expect(ap.apensadoA).toMatchObject({ id: proc, numero: '001/2015' });
    await api('post', `/dossies/${apenso}/encerrar`).send({}).expect(400); // segue o principal
    await api('post', `/dossies/${proc}/encerrar`).send({ dataEncerramento: '2017-06-30' }).expect(201);
    expect(await prazos(ids.recurso)).toMatchObject({ tr: '2019-06-30', de: '2022-06-30' });
    const principal = (await api('get', `/dossies/${proc}`).expect(200)).body;
    expect(principal.apensos.map((x: { id: string }) => x.id)).toEqual([apenso]);
    expect(principal.eventos.some((e: { tipo: string; descricao: string }) => e.tipo === 'apensacao' && /Recebeu em apenso/.test(e.descricao))).toBe(true);
    const capa = await api('get', `/dossies/${proc}/capa`).buffer(true).expect(200);
    expect(capa.headers['content-type']).toBe('application/pdf');
  });

  it('(7) RBAC', async () => {
    await api('post', '/dossies', leitor).send({ tipo: 'dossie', assunto: 'Sem permissão' }).expect(403);
    await api('post', `/dossies/${proc}/reabrir`, leitor).send({ motivo: 'Sem permissão alguma' }).expect(403);
    const lista = (await api('get', '/dossies', leitor).expect(200)).body;
    expect(lista.items.every((i: { nivelAcesso: string }) => i.nivelAcesso === 'publico')).toBe(true);
  });
});
