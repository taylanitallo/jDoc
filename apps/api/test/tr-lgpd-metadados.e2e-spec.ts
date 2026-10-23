/**
 * TR (GED) — fase 2: metadados padrao, busca avancada, nivel sigiloso,
 * LGPD (dados pessoais, privacidade, pedido do titular) e dicionario.
 * Requer postgres + redis e `pnpm db:migrate`.
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
const SLUG = 'tr_lgpd_e2e';
const S = `"tenant_${SLUG}"`;
const PASS = 'senha-tr-lgpd-123';
const ADMIN = 'admin@trlgpd.gov.br';
const RESTRITO = 'restrito@trlgpd.gov.br';
const SIGILOSO = 'sigiloso@trlgpd.gov.br';

let app: INestApplication;
let sql: postgres.Sql;
let docSigiloso = '';

const http = () => request(app.getHttpServer());

async function token(email: string): Promise<{ Authorization: string }> {
  const r = await http().post(`/t/${SLUG}/auth/login`).send({ email, senha: PASS });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.body.accessToken as string}` };
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const chaves = [...(await redis.keys('bf:*')), ...(await redis.keys('tenant:slug:*'))];
  if (chaves.length) await redis.del(...chaves);
  await redis.quit();
  await provisionTenantSchema(sql, SLUG);
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status, quota_disco_mb, modulos)
    VALUES (${SLUG}, 'Prefeitura LGPD', ${'tenant_' + SLUG}, 'ativo', 100, '{financeiro,arquivo}')
  `;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql.unsafe(`INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Admin', $2, 'admin', false)`, [ADMIN, hash]);
  for (const [email, perms] of [
    [RESTRITO, ['despesas:read', 'acervo_restrito:read']],
    [SIGILOSO, ['despesas:read', 'acervo_restrito:read', 'acervo_sigiloso:read']],
  ] as const) {
    const [u] = await sql.unsafe<Array<{ id: string }>>(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $1, $2, 'operador', false) RETURNING id`,
      [email, hash],
    );
    for (const p of perms) await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [u!.id, p]);
  }
  const [d] = await sql.unsafe<Array<{ id: string }>>(
    `INSERT INTO ${S}.documents (module, subtype, doc_caixa, credor, exercicio, original_name, status, nivel_acesso, grau_sigilo)
     VALUES ('despesas', 'orcamentaria', 'SIG-1', 'Fornecedor Sigiloso', 2026, 'sig.pdf', 'aguardando_arquivo', 'restrito', 'reservado') RETURNING id`,
  );
  docSigiloso = d!.id;

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

describe('Metadados padrão e busca avançada', () => {
  let docId = '';

  it('cadastra com número, assunto, interessado, palavras-chave e dados pessoais', async () => {
    const auth = await token(ADMIN);
    const r = await http()
      .post(`/t/${SLUG}/documents`)
      .set(auth)
      .field('module', 'despesas')
      .field('docCaixa', '777')
      .field('empenho', '9')
      .field('credor', 'Construtora Alfa')
      .field('subtype', 'orcamentaria')
      .field('documentDate', '2026-03-10')
      .field('exercicio', '2026')
      .field('numero', 'CT-45/2026')
      .field('assunto', 'Reforma da Escola Municipal Centro')
      .field('interessado', 'Secretaria de Educação')
      .field('palavrasChave', 'Obra, Escola; obra')
      .field('dadosPessoais', 'sensiveis')
      .expect(201);
    docId = r.body.id as string;
    expect(r.body.numero).toBe('CT-45/2026');
    expect(r.body.palavrasChave).toEqual(['obra', 'escola']);
    expect(r.body.dadosPessoais).toBe('sensiveis');
    expect(r.body.nivelEfetivo).toBe('publico');
  });

  it('filtra por palavra-chave, assunto, dados pessoais e texto livre', async () => {
    const auth = await token(ADMIN);
    const ids = async (qs: string) =>
      ((await http().get(`/t/${SLUG}/documents?module=despesas&${qs}`).set(auth).expect(200)).body.items as Array<{ id: string }>).map((d) => d.id);
    expect(await ids('palavraChave=Escola')).toContain(docId);
    expect(await ids('assunto=reforma')).toContain(docId);
    expect(await ids('dadosPessoais=sensiveis')).toContain(docId);
    expect(await ids('q=Educação')).toContain(docId);
    expect(await ids('assunto=inexistente')).not.toContain(docId);
    expect(await ids('dadosPessoais=nao')).not.toContain(docId);
  });

  it('edição apaga número e palavras-chave', async () => {
    const auth = await token(ADMIN);
    const r = await http().patch(`/t/${SLUG}/documents/${docId}`).set(auth).send({ numero: null, palavrasChave: '' }).expect(200);
    expect(r.body.numero).toBeNull();
    expect(r.body.palavrasChave).toEqual([]);
    expect(r.body.assunto).toBe('Reforma da Escola Municipal Centro');
  });
});

describe('Nível sigiloso (LAI)', () => {
  it('quem só tem restrito não vê o sigiloso; com permissão de sigiloso vê', async () => {
    const restrito = await token(RESTRITO);
    const lista = await http().get(`/t/${SLUG}/documents?module=despesas&pageSize=50`).set(restrito).expect(200);
    expect((lista.body.items as Array<{ id: string }>).map((d) => d.id)).not.toContain(docSigiloso);
    await http().get(`/t/${SLUG}/documents/${docSigiloso}`).set(restrito).expect(404);

    const sigiloso = await token(SIGILOSO);
    const r = await http().get(`/t/${SLUG}/documents/${docSigiloso}`).set(sigiloso).expect(200);
    expect(r.body.nivelEfetivo).toBe('sigiloso');
    const filtro = await http().get(`/t/${SLUG}/documents?module=despesas&nivel=sigiloso`).set(sigiloso).expect(200);
    expect((filtro.body.items as Array<{ id: string }>).map((d) => d.id)).toEqual([docSigiloso]);
  });
});

describe('LGPD', () => {
  it('página pública de privacidade sem login, com o padrão da plataforma', async () => {
    const r = await http().get(`/t/${SLUG}/privacidade/publica`).expect(200);
    expect(r.body.orgao).toBe('Prefeitura LGPD');
    expect(r.body.plataforma.suboperadores.length).toBeGreaterThan(0);
    expect(r.body.encarregado).toBeNull();
  });

  it('admin informa o encarregado e desliga a IA', async () => {
    const auth = await token(ADMIN);
    await http()
      .put(`/t/${SLUG}/privacidade`)
      .set(auth)
      .send({ encarregadoNome: 'Ana DPO', encarregadoEmail: 'dpo@trlgpd.gov.br', encarregadoTelefone: '', iaDesligada: true })
      .expect(200);
    const pub = await http().get(`/t/${SLUG}/privacidade/publica`).expect(200);
    expect(pub.body.encarregado.nome).toBe('Ana DPO');
    expect(pub.body.iaDesligada).toBe(true);
    const me = await http().get(`/t/${SLUG}/auth/me`).set(auth).expect(200);
    expect(me.body.iaDesligada).toBe(true);
    // Sem permissao de layout: nao altera.
    await http().put(`/t/${SLUG}/privacidade`).set(await token(RESTRITO)).send({ iaDesligada: false }).expect(403);
  });

  it('pedido do titular: exige o direito, prazo de 15 dias e sem prorrogação', async () => {
    const auth = await token(ADMIN);
    const base = {
      tipo: 'lgpd',
      solicitanteNome: 'João Titular',
      vinculo: 'cidadao',
      canal: 'email',
      finalidade: 'Quero saber quais dados meus a prefeitura guarda',
      formaAcesso: 'copia_digital',
      documentosNaoCadastrados: 'Dados cadastrais do titular',
    };
    await http().post(`/t/${SLUG}/atendimentos`).set(auth).send(base).expect(400);
    const r = await http().post(`/t/${SLUG}/atendimentos`).set(auth).send({ ...base, direitoLgpd: 'acesso' }).expect(201);
    expect(r.body.tipo).toBe('lgpd');
    expect(r.body.direitoLgpd).toBe('acesso');
    const dias = Math.round((new Date(r.body.prazoFinal).getTime() - new Date(r.body.dataPedido).getTime()) / 86_400_000);
    expect(dias).toBe(15);
    await http()
      .post(`/t/${SLUG}/atendimentos/${r.body.id as string}/prorrogar`)
      .set(auth)
      .send({ justificativa: 'Preciso de mais tempo para levantar' })
      .expect(409);
  });

  it('dicionário de metadados em CSV traz os campos padrão', async () => {
    const auth = await token(ADMIN);
    const r = await http().get(`/t/${SLUG}/relatorios-arquivo/dicionario/csv`).set(auth).expect(200);
    expect(r.text).toContain('palavras_chave');
    expect(r.text).toContain('Dados pessoais (LGPD)');
    const pdf = await http().get(`/t/${SLUG}/relatorios-arquivo/dicionario/pdf`).set(auth).expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });
});
