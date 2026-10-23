/**
 * Requisitos de seguranca do TR (GED): lotacao por secretaria, trilha de
 * auditoria imutavel e verificavel, verificacao em 2 etapas no orgao.
 * Requer postgres + redis e `pnpm db:migrate`.
 *
 * Cobre:
 *  (1) usuario lotado na Educacao nao ve documento da Saude (lista, detalhe, ZIP)
 *      e ve os documentos sem secretaria; nao cadastra documento em outra secretaria
 *  (2) abrir documento e pesquisar ficam na trilha
 *  (3) audit_logs recusa UPDATE/DELETE/TRUNCATE; a verificacao acha adulteracao
 *  (4) tela de Auditoria: so com permissao; exporta CSV
 *  (5) 2 etapas: ativar, login pede codigo, obrigatoria para administradores, reset pelo admin
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { provisionTenantSchema } from '@jdoc/database';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'tr_seg_e2e';
const S = `"tenant_${SLUG}"`;
const PASS = 'senha-tr-seguranca-123';
const ADMIN = 'admin@trseg.gov.br';
const ADMIN2 = 'admin2@trseg.gov.br';
const LOTADO = 'educacao@trseg.gov.br';

let app: INestApplication;
let sql: postgres.Sql;
const doc: Record<'edu' | 'sau' | 'geral', string> = { edu: '', sau: '', geral: '' };
const orgao: Record<'edu' | 'sau', string> = { edu: '', sau: '' };

async function limparRedis(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const chaves = [...(await redis.keys('bf:*')), ...(await redis.keys('tenant:slug:*'))];
  if (chaves.length) await redis.del(...chaves);
  await redis.quit();
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

const http = () => request(app.getHttpServer());

async function login(email: string, totp?: string): Promise<request.Response> {
  return http()
    .post(`/t/${SLUG}/auth/login`)
    .send({ email, senha: PASS, ...(totp ? { totp } : {}) });
}

async function token(email: string): Promise<{ Authorization: string }> {
  const r = await login(email);
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.body.accessToken as string}` };
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup();
  await limparRedis();
  await provisionTenantSchema(sql, SLUG);
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status, quota_disco_mb)
    VALUES (${SLUG}, 'Prefeitura TR', ${'tenant_' + SLUG}, 'ativo', 100)
  `;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  for (const email of [ADMIN, ADMIN2]) {
    await sql.unsafe(
      `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, $2, $3, 'admin', false)`,
      [email, email === ADMIN ? 'Admin Um' : 'Admin Dois', hash],
    );
  }
  for (const [k, codigo, nome] of [
    ['edu', '06', 'Secretaria de Educação'],
    ['sau', '07', 'Secretaria de Saúde'],
  ] as const) {
    const [o] = await sql.unsafe<Array<{ id: string }>>(
      `INSERT INTO ${S}.orgaos (codigo, descricao, exercicio) VALUES ($1, $2, 2026) RETURNING id`,
      [codigo, nome],
    );
    orgao[k] = o!.id;
  }
  for (const [k, orgaoId] of [
    ['edu', orgao.edu],
    ['sau', orgao.sau],
    ['geral', null],
  ] as const) {
    const [d] = await sql.unsafe<Array<{ id: string }>>(
      `INSERT INTO ${S}.documents (module, subtype, doc_caixa, credor, exercicio, original_name, status, orgao_id)
       VALUES ('despesas', 'orcamentaria', $1, $2, 2026, $3, 'aguardando_arquivo', $4) RETURNING id`,
      [`DC-${k}`, `Fornecedor ${k}`, `${k}.pdf`, orgaoId],
    );
    doc[k] = d!.id;
  }

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

describe('Lotação por secretaria', () => {
  it('admin cadastra usuário lotado na Educação', async () => {
    const auth = await token(ADMIN);
    await http()
      .post(`/t/${SLUG}/configuracoes/usuarios`)
      .set(auth)
      .send({
        email: LOTADO,
        nome: 'Servidor Educação',
        role: 'operador',
        senha: PASS,
        permissions: ['despesas:read', 'despesas:create'],
        orgaosCodigos: ['06'],
      })
      .expect(201);
    await sql.unsafe(`UPDATE ${S}.users SET must_change_password = false WHERE email = $1`, [LOTADO]);
    const lista = await http().get(`/t/${SLUG}/configuracoes/usuarios`).set(auth).expect(200);
    const u = (lista.body.items as Array<{ email: string; orgaosCodigos: string[] }>).find((x) => x.email === LOTADO);
    expect(u?.orgaosCodigos).toEqual(['06']);
  });

  it('lista só os documentos da Educação e os sem secretaria', async () => {
    const auth = await token(LOTADO);
    const r = await http().get(`/t/${SLUG}/documents?module=despesas&pageSize=50`).set(auth).expect(200);
    const ids = (r.body.items as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toContain(doc.edu);
    expect(ids).toContain(doc.geral);
    expect(ids).not.toContain(doc.sau);
    const me = await http().get(`/t/${SLUG}/auth/me`).set(auth).expect(200);
    expect(me.body.lotacao).toEqual(['06']);
  });

  it('documento da Saúde: detalhe 404 e ZIP sem nada', async () => {
    const auth = await token(LOTADO);
    await http().get(`/t/${SLUG}/documents/${doc.sau}`).set(auth).expect(404);
    await http().post(`/t/${SLUG}/documents/bulk-download`).set(auth).send({ ids: [doc.sau] }).expect(404);
    await http().get(`/t/${SLUG}/documents/${doc.edu}`).set(auth).expect(200);
  });

  it('não cadastra documento em outra secretaria', async () => {
    const auth = await token(LOTADO);
    const base = (o: string) =>
      http()
        .post(`/t/${SLUG}/documents`)
        .set(auth)
        .field('module', 'despesas')
        .field('docCaixa', '999')
        .field('empenho', '1')
        .field('credor', 'Fornecedor Novo')
        .field('subtype', 'orcamentaria')
        .field('documentDate', '2026-05-10')
        .field('value', '10')
        .field('exercicio', '2026')
        .field('orgaoId', o);
    await base(orgao.sau).expect(403);
    await base(orgao.edu).expect(201);
  });

  it('admin vê todas as secretarias', async () => {
    const auth = await token(ADMIN);
    const r = await http().get(`/t/${SLUG}/documents?module=despesas&pageSize=50`).set(auth).expect(200);
    expect((r.body.items as Array<{ id: string }>).map((d) => d.id)).toContain(doc.sau);
  });
});

describe('Trilha de auditoria', () => {
  it('abrir documento e pesquisar ficam registrados', async () => {
    const auth = await token(LOTADO);
    await http().get(`/t/${SLUG}/documents/${doc.edu}`).set(auth).expect(200);
    await http().get(`/t/${SLUG}/documents?module=despesas&q=Fornecedor`).set(auth).expect(200);
    const rows = await sql.unsafe<Array<{ action: string; resource_id: string | null }>>(
      `SELECT action, resource_id FROM ${S}.audit_logs WHERE action IN ('document_viewed', 'busca_realizada')`,
    );
    expect(rows.some((r) => r.action === 'document_viewed' && r.resource_id === doc.edu)).toBe(true);
    expect(rows.some((r) => r.action === 'busca_realizada')).toBe(true);
  });

  it('banco recusa alterar, apagar e truncar a trilha', async () => {
    await expect(sql.unsafe(`UPDATE ${S}.audit_logs SET action = 'x'`)).rejects.toThrow(/não pode ser alterada/);
    await expect(sql.unsafe(`DELETE FROM ${S}.audit_logs`)).rejects.toThrow(/não pode ser alterada/);
    await expect(sql.unsafe(`TRUNCATE ${S}.audit_logs`)).rejects.toThrow(/não pode ser alterada/);
  });

  it('tela de Auditoria exige permissão; admin lista, exporta e verifica', async () => {
    const lotado = await token(LOTADO);
    await http().get(`/t/${SLUG}/auditoria`).set(lotado).expect(403);

    const auth = await token(ADMIN);
    const lista = await http().get(`/t/${SLUG}/auditoria?documentoId=${doc.edu}`).set(auth).expect(200);
    expect((lista.body.items as Array<{ action: string }>).some((i) => i.action === 'document_viewed')).toBe(true);

    const csv = await http().get(`/t/${SLUG}/auditoria/exportar`).set(auth).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('abriu um documento');

    const ok = await http().post(`/t/${SLUG}/auditoria/verificar`).set(auth).expect(200);
    expect(ok.body.integra).toBe(true);
    expect(ok.body.registros).toBeGreaterThan(3);
  });

  it('verificação aponta registro adulterado direto no banco', async () => {
    // Simula quem tem acesso ao banco e desliga a protecao para reescrever um registro.
    await sql.unsafe(`ALTER TABLE ${S}.audit_logs DISABLE TRIGGER audit_logs_imutavel`);
    await sql.unsafe(`UPDATE ${S}.audit_logs SET ip = '6.6.6.6' WHERE seq = (SELECT min(seq) + 1 FROM ${S}.audit_logs)`);
    await sql.unsafe(`ALTER TABLE ${S}.audit_logs ENABLE TRIGGER audit_logs_imutavel`);
    const auth = await token(ADMIN);
    const r = await http().post(`/t/${SLUG}/auditoria/verificar`).set(auth).expect(200);
    expect(r.body.integra).toBe(false);
    expect(r.body.quebras[0].motivo).toBe('conteudo_alterado');
  });
});

describe('Verificação em 2 etapas', () => {
  let segredo = '';

  it('admin ativa e o login passa a pedir o código', async () => {
    const auth = await token(ADMIN);
    const setup = await http().post(`/t/${SLUG}/auth/mfa/setup`).set(auth).expect(200);
    segredo = setup.body.secret as string;
    expect(setup.body.otpauthUrl).toContain('otpauth://');
    await http().post(`/t/${SLUG}/auth/mfa/enable`).set(auth).send({ totp: '000000' }).expect(400);
    await http().post(`/t/${SLUG}/auth/mfa/enable`).set(auth).send({ totp: authenticator.generate(segredo) }).expect(204);

    const sem = await login(ADMIN);
    expect(sem.status).toBe(401);
    expect(sem.body.code).toBe('mfa_required');
    const errado = await login(ADMIN, '123456');
    expect(errado.status).toBe(401);
    const certo = await login(ADMIN, authenticator.generate(segredo));
    expect(certo.status).toBe(200);
    expect(certo.body.mfaPendente).toBe(false);
  });

  it('obrigatória para administradores: quem não tem fica pendente', async () => {
    const r = await login(ADMIN, authenticator.generate(segredo));
    const auth = { Authorization: `Bearer ${r.body.accessToken as string}` };
    const s = await http().put(`/t/${SLUG}/configuracoes/seguranca`).set(auth).send({ mfaObrigatorioAdmin: true }).expect(200);
    expect(s.body.administradoresSemMfa).toBe(1);

    const outro = await login(ADMIN2);
    expect(outro.status).toBe(200);
    expect(outro.body.mfaPendente).toBe(true);
    const me = await http().get(`/t/${SLUG}/auth/me`).set({ Authorization: `Bearer ${outro.body.accessToken as string}` }).expect(200);
    expect(me.body.mfaPendente).toBe(true);
    // Usuario comum nao e afetado.
    expect((await login(LOTADO)).body.mfaPendente).toBe(false);
  });

  it('admin desliga o 2FA de quem perdeu o celular', async () => {
    const outro = await login(ADMIN2);
    const auth2 = { Authorization: `Bearer ${outro.body.accessToken as string}` };
    const [u] = await sql.unsafe<Array<{ id: string }>>(`SELECT id FROM ${S}.users WHERE email = $1`, [ADMIN]);
    await http().post(`/t/${SLUG}/configuracoes/usuarios/${u!.id}/reset-mfa`).set(auth2).expect(204);
    const r = await login(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.mfaPendente).toBe(true);
  });
});
