/**
 * Testes e2e dos RELATORIOS DO ARQUIVO (inventario, quantitativos, topografico).
 *
 * Cobre:
 *  (1) inventario: ordem por classe, identificacao com numero, caminho do local fisico;
 *      lixeira e eliminados fora (eliminados so quando pedidos)
 *  (2) filtros: classe com subclasses, fase, local com sublocais, exercicio, busca livre
 *  (3) visibilidade: restrito so com acervo_restrito:read; modulo sem read nao aparece
 *  (4) exportacao: PDF e CSV (BOM, ';', formula neutralizada); exige acervo:export; auditada
 *  (5) quantitativos batem com o inventario; topografico em PDF
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
const SLUG = 'relatorios_e2e';
const S = `"tenant_${SLUG}"`;
const ADMIN = 'admin@relatorios.gov.br';
const LEITOR = 'leitor@relatorios.gov.br';
const PASS = 'senha-relatorios-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

function binario(res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) {
  const partes: Buffer[] = [];
  res.on('data', (c: Buffer) => partes.push(c));
  res.on('end', () => cb(null, Buffer.concat(partes)));
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup();
  await provisionTenantSchema(sql, SLUG);
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status, modulos)
            VALUES (${SLUG}, 'Arquivo Municipal de Teste', ${'tenant_' + SLUG}, 'ativo', '{financeiro,arquivo}')`;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const [email, role] of [
    [ADMIN, 'admin'],
    [LEITOR, 'operador'],
  ] as const) {
    const r = await sql.unsafe(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [email, email === ADMIN ? 'Ana Arquivista' : 'Leo Leitor', hash, role],
    );
    ids[email] = (r[0] as { id: string }).id;
  }
  // Leitor: le o Acervo e arquivo fisico; NAO ve restritos, NAO le despesas, NAO exporta.
  for (const p of ['acervo:read', 'arquivo_fisico:read']) {
    await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [ids[LEITOR], p]);
  }

  // Plano: 010 > 010.1, 020
  const cl = async (codigo: string, descricao: string, parent: string | null, destinacao: string | null) =>
    (
      (await sql.unsafe(
        `INSERT INTO ${S}.classificacoes (codigo, descricao, parent_id, prazo_corrente_anos, prazo_intermediario_anos, destinacao)
         VALUES ($1, $2, $3, 2, 5, $4) RETURNING id`,
        [codigo, descricao, parent, destinacao],
      ))[0] as { id: string }
    ).id;
  ids.c010 = await cl('010', 'Legislação', null, null);
  ids.c0101 = await cl('010.1', 'Leis municipais', ids.c010, 'guarda_permanente');
  ids.c020 = await cl('020', 'Contratos', null, 'eliminacao');

  // Locais: Sede > Sala 2 > CX-0012
  const loc = async (tipo: string, codigo: string, parent: string | null) =>
    ((await sql.unsafe(`INSERT INTO ${S}.locais_fisicos (tipo, codigo, parent_id) VALUES ($1, $2, $3) RETURNING id`, [tipo, codigo, parent]))[0] as { id: string }).id;
  ids.sede = await loc('predio', 'Sede', null);
  ids.sala = await loc('sala', 'Sala 2', ids.sede);
  ids.cx = await loc('caixa', 'CX-0012', ids.sala);

  const tipoLei = ((await sql.unsafe(`INSERT INTO ${S}.document_types (nome, cor, modulo) VALUES ('Lei Municipal', 'blue', 'acervo') RETURNING id`))[0] as { id: string }).id;
  ids.tipoLei = tipoLei;

  const doc = async (o: {
    module: string;
    descricao: string;
    classe?: string | null;
    exercicio: number;
    fase?: string;
    nivel?: string;
    local?: string | null;
    tipo?: string | null;
    metadados?: object;
    deleted?: boolean;
    paginas?: number;
  }) =>
    (
      (await sql.unsafe(
        `INSERT INTO ${S}.documents (module, descricao, exercicio, document_date, original_name, classificacao_id, fase, nivel_acesso,
                                     local_fisico_id, document_type_id, metadados, deleted_at, paginas, digitalizado)
         VALUES ($1, $2, $3, make_date($3, 3, 10), 'x.pdf', $4, $5, $6, $7, $8, $9, $10, $11, true) RETURNING id`,
        [
          o.module,
          o.descricao,
          o.exercicio,
          o.classe ?? null,
          o.fase ?? 'corrente',
          o.nivel ?? 'publico',
          o.local ?? null,
          o.tipo ?? null,
          sql.json((o.metadados ?? {}) as never),
          o.deleted ? new Date() : null,
          o.paginas ?? 2,
        ],
      ))[0] as { id: string }
    ).id;
  ids.lei = await doc({ module: 'acervo', descricao: 'Plano Diretor', classe: ids.c0101, exercicio: 2019, tipo: tipoLei, metadados: { numero: '1.234' }, local: ids.cx, paginas: 10 });
  ids.contrato = await doc({ module: 'acervo', descricao: '=HYPERLINK("http://mal")', classe: ids.c020, exercicio: 2021, fase: 'intermediaria' });
  ids.restrito = await doc({ module: 'acervo', descricao: 'Ficha funcional do servidor', classe: ids.c020, exercicio: 2020, nivel: 'restrito', local: ids.cx });
  ids.eliminado = await doc({ module: 'acervo', descricao: 'Contrato antigo', classe: ids.c020, exercicio: 2005, fase: 'eliminado' });
  ids.lixeira = await doc({ module: 'acervo', descricao: 'Na lixeira', classe: ids.c020, exercicio: 2021, deleted: true });
  ids.despesa = await doc({ module: 'despesas', descricao: 'Empenho de merenda', classe: null, exercicio: 2021 });

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

describe('Relatorios do Arquivo', () => {
  let admin: string;
  let leitor: string;
  const get = (path: string, tok = admin) =>
    request(app.getHttpServer()).get(`/t/${SLUG}/relatorios-arquivo${path}`).set('Authorization', `Bearer ${tok}`);
  const idsDe = (body: { items: Array<{ id: string }> }) => body.items.map((i) => i.id);

  it('(1) inventario: ordem, identificacao, localizacao; sem lixeira e sem eliminados', async () => {
    admin = await login(ADMIN);
    leitor = await login(LEITOR);
    const r = (await get('/inventario').expect(200)).body;
    expect(r.total).toBe(4); // lei, contrato, restrito, despesa
    expect(idsDe(r)).toEqual([ids.lei, ids.restrito, ids.contrato, ids.despesa]);
    const lei = r.items[0];
    expect(lei).toMatchObject({ classeCodigo: '010.1', destinacao: 'guarda_permanente', localizacao: 'Sede / Sala 2 / CX-0012', tipo: 'Lei Municipal' });
    expect(lei.identificacao).toBe('Lei Municipal nº 1.234 — Plano Diretor');

    const comElim = (await get('/inventario?incluirEliminados=true').expect(200)).body;
    expect(idsDe(comElim)).toContain(ids.eliminado);
    expect(idsDe(comElim)).not.toContain(ids.lixeira);
  });

  it('(2) filtros', async () => {
    expect(idsDe((await get('/inventario?classe=010').expect(200)).body)).toEqual([ids.lei]); // pega 010.1
    expect(idsDe((await get('/inventario?fase=intermediaria').expect(200)).body)).toEqual([ids.contrato]);
    expect(idsDe((await get(`/inventario?localId=${ids.sede}`).expect(200)).body).sort()).toEqual([ids.lei, ids.restrito].sort());
    expect(idsDe((await get('/inventario?exercicioDe=2020&exercicioAte=2020').expect(200)).body)).toEqual([ids.restrito]);
    expect(idsDe((await get('/inventario?q=merenda').expect(200)).body)).toEqual([ids.despesa]);
    expect(idsDe((await get('/inventario?semClasse=true').expect(200)).body)).toEqual([ids.despesa]);
    expect(idsDe((await get('/inventario?modulos=despesas').expect(200)).body)).toEqual([ids.despesa]);
    await get('/inventario?classe=010%27%3B--').expect(400);
    await get('/inventario?modulos=inventado').expect(400);
  });

  it('(3) visibilidade: sem restrito e sem modulo nao lido', async () => {
    const r = (await get('/inventario', leitor).expect(200)).body;
    expect(idsDe(r).sort()).toEqual([ids.lei, ids.contrato].sort());
    // pedir o modulo sem permissao nao o inclui
    expect((await get('/inventario?modulos=despesas', leitor).expect(200)).body.total).toBe(0);
  });

  it('(4) exportacoes PDF/CSV, permissao e auditoria', async () => {
    const pdf = (await get('/inventario/pdf').buffer(true).parse(binario).expect(200)).body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const csvRes = await get('/inventario/csv').buffer(true).parse(binario).expect(200);
    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    const csv = (csvRes.body as Buffer).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).trim().split('\r\n');
    expect(linhas[0]).toBe('Classe;Tipo;Identificação;Data;Exerc.;Fase;Transf. prevista;Destinação;Localização;Acesso;Dados pessoais;Págs.');
    expect(linhas).toHaveLength(5);
    // descricao "=HYPERLINK(...)" nao pode virar formula no Excel
    const contrato = linhas.find((l) => l.includes('HYPERLINK'))!;
    expect(contrato).toContain(`"'=HYPERLINK(""http://mal"")"`);

    await get('/inventario/pdf', leitor).expect(403);
    await get('/inventario/xls').expect(400);
    const aud = await sql.unsafe(`SELECT count(*)::int AS n FROM ${S}.audit_logs WHERE action = 'relatorio_inventario_exportado'`);
    expect((aud[0] as { n: number }).n).toBe(2);
  });

  it('(5) quantitativos e topografico', async () => {
    const q = (await get('/quantitativo').expect(200)).body;
    expect(q.totais).toMatchObject({ documentos: 4, paginas: 16, digitalizados: 4, comOriginalFisico: 2, restritos: 1, semClassificacao: 1 });
    expect(q.porClasse.find((l: { chave: string }) => l.chave === '020')).toMatchObject({ documentos: 2, rotulo: 'Contratos' });
    expect(q.porFase.find((l: { chave: string }) => l.chave === 'intermediaria')).toMatchObject({ rotulo: 'Intermediária', documentos: 1 });
    expect(q.porModulo.find((l: { chave: string }) => l.chave === 'despesas')).toMatchObject({ rotulo: 'Despesas', documentos: 1 });

    const qLeitor = (await get('/quantitativo', leitor).expect(200)).body;
    expect(qLeitor.totais.documentos).toBe(2);

    for (const path of ['/quantitativo/pdf', '/quantitativo/csv', '/topografico/pdf']) {
      const b = (await get(path).buffer(true).parse(binario).expect(200)).body as Buffer;
      expect(b.length).toBeGreaterThan(100);
    }
  });
});
