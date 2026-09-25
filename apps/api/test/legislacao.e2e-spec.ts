/**
 * Testes e2e de LEGISLACAO COMPILADA.
 *
 * Cobre:
 *  (1) estruturar a partir do texto extraido do PDF (document_textos) com sugestao dos metadados
 *  (2) salvar normas; duplicidade; leitor sem create = 403
 *  (3) Lei B revoga inciso, da nova redacao e inclui artigo na Lei A: compilado, notas,
 *      situacao revogada_parcial, relacoes, consulta por data e bloqueio de reestruturacao
 *  (4) portal publico: so publicada + documento publico; restrito nunca aparece; PDF
 *  (5) busca no texto e revogacao total
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
const SLUG = 'legis_e2e';
const S = `"tenant_${SLUG}"`;
const ADMIN = 'admin@legis.gov.br';
const LEITOR = 'leitor@legis.gov.br';
const PASS = 'senha-legis-e2e-123';

const TEXTO_A = `LEI Nº 100, DE 1º DE MARÇO DE 2010
Dispõe sobre a capacidade civil municipal.
O PREFEITO MUNICIPAL faz saber que a Câmara aprovou e ele sanciona a seguinte Lei:
CAPÍTULO I
DAS PESSOAS
Art. 3º São absolutamente incapazes:
I - os menores de dezesseis anos;
II - os que não puderem exprimir sua vontade.
Art. 4º São incapazes relativamente
a certos atos.
Art. 5º Esta Lei entra em vigor na data de sua publicação.
Paço Municipal de Itapajé, 1º de março de 2010.`;

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
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos) VALUES (${SLUG}, 'Prefeitura Legis', ${'tenant_' + SLUG}, 'ativo', '{arquivo}')`;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [email, role, perms] of [
    [ADMIN, 'admin', []],
    [LEITOR, 'operador', ['acervo:read', 'legislacao:read']],
  ] as const) {
    const r = await sql.unsafe(`INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $1, $2, $3, false) RETURNING id`, [email, hash, role]);
    for (const p of perms) await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [(r[0] as { id: string }).id, p]);
  }
  const tipo = ((await sql.unsafe(`INSERT INTO ${S}.document_types (nome, modulo) VALUES ('Lei Municipal', 'acervo') RETURNING id`))[0] as { id: string }).id;
  const doc = async (numero: string, data: string, ementa: string, nivel = 'publico') =>
    ((await sql.unsafe(
      `INSERT INTO ${S}.documents (module, document_type_id, descricao, exercicio, document_date, original_name, nivel_acesso, metadados)
       VALUES ('acervo', $1, $2, $3, $4, 'lei.pdf', $5, $6::text::jsonb) RETURNING id`,
      [tipo, ementa, Number(data.slice(0, 4)), data, nivel, JSON.stringify({ numero, data_publicacao: data, ementa })],
    ))[0] as { id: string }).id;
  ids.docA = await doc('100', '2010-03-01', 'Dispõe sobre a capacidade civil municipal.');
  ids.docB = await doc('200', '2015-07-06', 'Altera a Lei nº 100, de 2010.');
  ids.docC = await doc('300', '2018-01-01', 'Lei restrita.', 'restrito');
  // texto extraido do PDF da Lei A (como o OCR grava)
  const [p1, p2] = [TEXTO_A.slice(0, 180), TEXTO_A.slice(180)];
  await sql.unsafe(`INSERT INTO ${S}.document_textos (document_id, pagina, texto, tsv) VALUES ($1, 1, $2, to_tsvector('simple', $2)), ($1, 2, $3, to_tsvector('simple', $3))`, [ids.docA, p1, p2]);

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
  const r = await request(app.getHttpServer()).post(`/t/${SLUG}/auth/login`).send({ email, senha: PASS }).expect(200);
  return r.body.accessToken as string;
}

type Disp = { ref: string; parentRef: string | null; tipo: string; rotulo: string; texto: string };

describe('Legislacao compilada', () => {
  let admin: string;
  let leitor: string;
  const api = (m: 'get' | 'post' | 'patch' | 'put', path: string, tok = admin) =>
    request(app.getHttpServer())[m](`/t/${SLUG}/legislacao${path}`).set('Authorization', `Bearer ${tok}`);
  const pub = (path: string) => request(app.getHttpServer()).get(`/t/${SLUG}/legislacao-publica${path}`);

  it('(1) estrutura a partir do texto do PDF', async () => {
    admin = await login(ADMIN);
    leitor = await login(LEITOR);
    const r = (await api('post', `/documentos/${ids.docA}/estruturar`).send({}).expect(201)).body as { dispositivos: Disp[]; sugestao: Record<string, unknown> };
    expect(r.sugestao).toMatchObject({ tipo: 'lei', numero: '100', ano: 2010, dataPublicacao: '2010-03-01' });
    expect(r.dispositivos.map((d) => d.rotulo)).toEqual(['Epígrafe', 'Ementa', 'Preâmbulo', 'CAPÍTULO I', 'Art. 3º', 'I', 'II', 'Art. 4º', 'Art. 5º', 'Fecho']);
    expect(r.dispositivos.find((d) => d.rotulo === 'Art. 4º')!.texto).toBe('São incapazes relativamente a certos atos.');
    ids.dispA = JSON.stringify(r.dispositivos);
    // sem texto extraido e sem colar = 422
    await api('post', `/documentos/${ids.docB}/estruturar`).send({}).expect(422);
  });

  it('(2) salva as normas', async () => {
    const dispA = JSON.parse(ids.dispA!) as Disp[];
    const a = (await api('post', '/normas').send({ documentId: ids.docA, tipo: 'lei', numero: '100', ano: 2010, dataPublicacao: '2010-03-01', ementa: 'Dispõe sobre a capacidade civil municipal.', publicada: true, dispositivos: dispA }).expect(201)).body;
    ids.A = a.id;
    expect(a).toMatchObject({ situacao: 'vigente', rotulo: 'Lei nº 100, de 1 de março de 2010', temAlteracoes: false });
    await api('post', '/normas').send({ documentId: ids.docA, tipo: 'lei', numero: '101', ano: 2010, ementa: 'Duplicado', dispositivos: dispA }).expect(409);
    const textoB = 'Art. 1º A Lei nº 100, de 2010, passa a vigorar com alterações.\nArt. 2º Esta Lei entra em vigor em 3 de janeiro de 2016.';
    const pb = (await api('post', `/documentos/${ids.docB}/estruturar`).send({ texto: textoB }).expect(201)).body;
    // sem metadados no documento, numero/ano/data saem da epigrafe
    await sql.unsafe(`UPDATE ${S}.documents SET metadados = '{}'::jsonb WHERE id = $1`, [ids.docC]);
    const pe = (await api('post', `/documentos/${ids.docC}/estruturar`).send({ texto: 'LEI Nº 300, DE 2 DE JANEIRO DE 2018\nDispõe sobre algo.\nArt. 1º Texto.' }).expect(201)).body;
    expect(pe.sugestao).toMatchObject({ numero: '300', ano: 2018, dataPublicacao: '2018-01-02', ementa: 'Dispõe sobre algo.' });
    await api('post', '/normas', leitor).send({ documentId: ids.docB, tipo: 'lei', numero: '200', ano: 2015, ementa: 'Altera', dispositivos: pb.dispositivos }).expect(403);
    ids.B = (await api('post', '/normas').send({ documentId: ids.docB, tipo: 'lei', numero: '200', ano: 2015, dataPublicacao: '2015-07-06', ementa: 'Altera a Lei nº 100, de 2010.', publicada: false, dispositivos: pb.dispositivos }).expect(201)).body.id;
    const pc = (await api('post', `/documentos/${ids.docC}/estruturar`).send({ texto: 'Art. 1º Norma restrita.' }).expect(201)).body;
    ids.C = (await api('post', '/normas').send({ documentId: ids.docC, tipo: 'lei', numero: '300', ano: 2018, ementa: 'Lei restrita.', publicada: true, dispositivos: pc.dispositivos }).expect(201)).body.id;
  });

  it('(3) Lei B altera a Lei A dispositivo por dispositivo', async () => {
    const a = (await api('get', `/normas/${ids.A}`).expect(200)).body as { dispositivos: Array<{ id: string; rotulo: string; parentId: string | null }> };
    const id = (rot: string) => a.dispositivos.find((d) => d.rotulo === rot)!.id;
    const incisoI = a.dispositivos.find((d) => d.rotulo === 'I')!.id;
    await api('post', `/normas/${ids.B}/alteracoes`, leitor).send({ alvoId: ids.A, itens: [{ acao: 'revogacao', dispositivoId: incisoI }] }).expect(403);
    await api('post', `/normas/${ids.B}/alteracoes`).send({ alvoId: ids.B, itens: [{ acao: 'revogacao', dispositivoId: incisoI }] }).expect(400);
    const r = (await api('post', `/normas/${ids.B}/alteracoes`)
      .send({
        alvoId: ids.A,
        vigenciaInicio: '2016-01-03',
        itens: [
          { acao: 'revogacao', dispositivoId: incisoI },
          { acao: 'redacao', dispositivoId: id('Art. 4º'), texto: 'São incapazes, relativamente a certos atos ou à maneira de os exercer:' },
          { acao: 'inclusao', inserirAposId: id('Art. 4º'), parentId: id('CAPÍTULO I'), tipo: 'artigo', rotulo: 'Art. 4º-A', texto: 'A capacidade civil é presumida.' },
        ],
      })
      .expect(201)).body;
    expect(r.situacao).toBe('revogada_parcial');
    const cap = r.compilado.find((n: { rotulo: string }) => n.rotulo === 'CAPÍTULO I');
    expect(cap.filhos.map((n: { rotulo: string }) => n.rotulo)).toEqual(['Art. 3º', 'Art. 4º', 'Art. 4º-A', 'Art. 5º']);
    const art3 = cap.filhos[0];
    expect(art3.filhos[0]).toMatchObject({ rotulo: 'I', revogado: true, texto: null });
    expect(art3.filhos[0].historico[1].normaAlteradora).toMatchObject({ numero: '200', ano: 2015 });
    expect(cap.filhos[1].texto).toBe('São incapazes, relativamente a certos atos ou à maneira de os exercer:');
    expect(r.alteradaPor.map((x: { tipo: string }) => x.tipo).sort()).toEqual(['altera', 'revoga_parcialmente']);
    // como era antes da vigencia
    const antes = (await api('get', `/normas/${ids.A}?data=2015-12-31`).expect(200)).body;
    const capAntes = antes.compilado.find((n: { rotulo: string }) => n.rotulo === 'CAPÍTULO I');
    expect(capAntes.filhos.map((n: { rotulo: string }) => n.rotulo)).toEqual(['Art. 3º', 'Art. 4º', 'Art. 5º']);
    expect(capAntes.filhos[0].filhos[0].texto).toBe('os menores de dezesseis anos;');
    // a alteradora mostra o que alterou
    const b = (await api('get', `/normas/${ids.B}`).expect(200)).body;
    expect(b.altera.map((x: { norma: { id: string } }) => x.norma.id)).toContain(ids.A);
    // estrutura nao pode mais ser refeita
    await api('put', `/normas/${ids.A}/dispositivos`).send({ dispositivos: JSON.parse(ids.dispA!) }).expect(409);
  });

  it('(4) portal publico', async () => {
    const lista = (await pub('').expect(200)).body;
    expect(lista.items.map((n: { id: string }) => n.id)).toEqual([ids.A]); // B nao publicada; C restrita
    const a = (await pub(`/${ids.A}`).expect(200)).body;
    expect(a.situacao).toBe('revogada_parcial');
    expect(a.dispositivos).toBeUndefined();
    expect(a.revisadaPor).toBeNull();
    // a alteradora nao publicada nao aparece nas relacoes publicas
    expect(a.alteradaPor).toEqual([]);
    await pub(`/${ids.B}`).expect(404);
    await pub(`/${ids.C}`).expect(404);
    const pdf = await pub(`/${ids.A}/compilado.pdf`).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    // leitor com acervo_restrito? nao: C restrita invisivel tambem na area interna
    await api('get', `/normas/${ids.C}`, leitor).expect(404);
    await api('get', `/normas/${ids.C}`).expect(200);
  });

  it('(5) busca e revogacao total', async () => {
    const busca = (await api('get', '/normas?q=maneira de os exercer').expect(200)).body;
    expect(busca.items.map((n: { id: string }) => n.id)).toEqual([ids.A]);
    expect((await api('get', '/normas?q=200').expect(200)).body.items.map((n: { id: string }) => n.id)).toEqual([ids.B]);
    const r = (await api('post', `/normas/${ids.C}/alteracoes`).send({ alvoId: ids.A, revogacaoTotal: true, vigenciaInicio: '2018-01-01' }).expect(201)).body;
    expect(r.situacao).toBe('revogada');
    const audit = await sql.unsafe(`SELECT action FROM ${S}.audit_logs WHERE resource_type = 'norma'`);
    expect(audit.map((x) => (x as { action: string }).action)).toEqual(expect.arrayContaining(['norma_estruturada', 'norma_alteracao_registrada']));
  });
});
