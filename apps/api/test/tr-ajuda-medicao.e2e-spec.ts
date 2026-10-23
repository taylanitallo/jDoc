/**
 * TR — fase 5: manual do usuario, registro de treinamentos com lista de
 * presenca e boletim de medicao mensal (GED + paginas aceitas, saldo,
 * fechamento sem pagar a mesma pagina duas vezes).
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
import { authenticator } from 'otplib';
import { provisionTenantSchema } from '@jdoc/database';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const SLUG = 'tr_med_e2e';
const S = `"tenant_${SLUG}"`;
const PASS = 'senha-tr-med-123';
const ADMIN = 'admin@trmed.gov.br';
const OPER = 'oper@trmed.gov.br';
const SA = 'sa-med-e2e@jeossistemas.com';
const SA_PASS = 'senha-sa-medicao-123';
const SA_TOTP = 'JDOCE2EMEDICAOSECRETJDOCMED';

let app: INestApplication;
let sql: postgres.Sql;
let tenantId = '';
const http = () => request(app.getHttpServer());

/** Mes AAAA-MM deslocado a partir do atual (Fortaleza). */
function mes(desloc = 0): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  d.setDate(15);
  d.setMonth(d.getMonth() + desloc);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function token(email: string): Promise<{ Authorization: string }> {
  const r = await http().post(`/t/${SLUG}/auth/login`).send({ email, senha: PASS });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.body.accessToken as string}` };
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
  await sql`DELETE FROM public.superadmins WHERE email = ${SA}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4, onnotice: () => undefined });
  await cleanup();
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const chaves = [...(await redis.keys('bf:*')), ...(await redis.keys('tenant:slug:*'))];
  if (chaves.length) await redis.del(...chaves);
  await redis.quit();
  await provisionTenantSchema(sql, SLUG);
  const [t] = await sql<Array<{ id: string }>>`
    INSERT INTO public.tenants (slug, nome, schema_name, status, quota_disco_mb, modulos, contrato)
    VALUES (${SLUG}, 'Prefeitura Medição', ${'tenant_' + SLUG}, 'ativo', 100, '{arquivo}',
            ${sql.json({ numero: '25/2026', vigenciaInicio: '2026-01-01', vigenciaFim: '2099-12-31', fiscal: 'Maria Fiscal' })})
    RETURNING id
  `;
  tenantId = t!.id;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql.unsafe(`INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Admin', $2, 'admin', false), ($3, 'Oper', $2, 'operador', false)`, [ADMIN, hash, OPER]);
  await sql.unsafe(`INSERT INTO ${S}.orgaos (codigo, descricao, exercicio) VALUES ('06', 'Secretaria de Educação', 2026), ('07', 'Secretaria de Saúde', 2026)`);
  const saHash = await argon2.hash(SA_PASS, { type: argon2.argon2id });
  await sql`INSERT INTO public.superadmins (email, nome, senha_hash, must_change_password, totp_secret, totp_enabled, role)
            VALUES (${SA}, 'SA Medição', ${saHash}, false, ${SA_TOTP}, true, 'owner')`;

  // Lotes aceitos: 20 pag. da Educacao neste mes, 15 de uma secretaria sem item, 25 da Educacao no mes seguinte.
  const aceite = (m: string) => `${m}-10T15:00:00Z`;
  for (const [n, orgao, pag, m] of [
    [1, '06', 20, mes(0)],
    [2, '08', 15, mes(0)],
    [3, '06', 25, mes(1)],
  ] as const) {
    await sql.unsafe(
      `INSERT INTO ${S}.digit_lotes (numero, ano, orgao_codigo, descricao, etapa, aceite_em, paginas_aceitas)
       VALUES ($1, 2026, $2, 'Lote de teste', 'disponibilizado', $3, $4)`,
      [n, orgao, aceite(m), pag],
    );
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

describe('Ajuda e treinamentos', () => {
  it('qualquer usuário baixa o manual em PDF', async () => {
    const r = await http().get(`/t/${SLUG}/ajuda/manual.pdf`).set(await token(OPER)).expect(200);
    expect(r.headers['content-type']).toMatch(/pdf/);
  });

  it('treinamento com participantes e lista de presença; sem permissão, 403', async () => {
    await http().get(`/t/${SLUG}/ajuda/treinamentos`).set(await token(OPER)).expect(403);
    const auth = await token(ADMIN);
    const r = await http()
      .post(`/t/${SLUG}/ajuda/treinamentos`)
      .set(auth)
      .send({
        titulo: 'Uso do GED para protocolistas',
        data: '2026-03-02',
        cargaHoraria: 4,
        instrutor: 'Equipe JEOS',
        participantes: [{ nome: 'Ana Souza', cargo: 'Protocolista', secretaria: 'Educação' }],
      })
      .expect(201);
    expect(r.body.participantes).toHaveLength(1);
    const lista = await http().get(`/t/${SLUG}/ajuda/treinamentos/${r.body.id as string}/lista-presenca`).set(auth).expect(200);
    expect(lista.headers['content-type']).toMatch(/pdf/);
    const todos = await http().get(`/t/${SLUG}/ajuda/treinamentos`).set(auth).expect(200);
    expect(todos.body).toHaveLength(1);
  });
});

describe('Medição mensal', () => {
  let sa: { Authorization: string };

  it('equipe cadastra os itens do contrato por secretaria', async () => {
    const r = await http().post('/superadmin/auth/login').send({ email: SA, senha: SA_PASS, totp: authenticator.generate(SA_TOTP) }).expect(200);
    sa = { Authorization: `Bearer ${r.body.accessToken as string}` };
    const itens = await http()
      .put(`/superadmin/tenants/${tenantId}/contrato-itens`)
      .set(sa)
      .send({
        itens: [
          { numero: 1, orgaoCodigo: '06', descricao: 'Gestão documental — Educação', valorMensalGed: 1000, valorPagina: 0.5, paginasContratadas: 30, ativo: true },
          { numero: 2, orgaoCodigo: '07', descricao: 'Gestão documental — Saúde', valorMensalGed: 800, valorPagina: 0.4, paginasContratadas: 100, ativo: true },
        ],
      })
      .expect(200);
    expect(itens.body[0].orgaoNome).toBe('Secretaria de Educação');
  });

  it('prévia do mês: GED + páginas aceitas; secretaria sem item fica de fora', async () => {
    const m = await http().get(`/superadmin/tenants/${tenantId}/medicoes/${mes(0)}`).set(sa).expect(200);
    expect(m.body.fechada).toBe(false);
    expect(m.body.linhas[0]).toMatchObject({ numero: 1, paginasMes: 20, paginasMedidas: 20, valorServico: 10, valorTotal: 1010 });
    expect(m.body.linhas[1]).toMatchObject({ numero: 2, paginasMes: 0, valorTotal: 800 });
    expect(m.body.paginasSemItem).toBe(15);
    expect(m.body.totais.total).toBe(1810);
  });

  it('fechar exige reautenticação; fechada não recalcula e o saldo segue no mês seguinte', async () => {
    const sem = await http().post(`/superadmin/tenants/${tenantId}/medicoes/${mes(0)}/fechar`).set(sa).send({}).expect(403);
    expect(sem.body.code).toBe('reauth_required');
    await http().post('/superadmin/auth/reauth').set(sa).send({ senha: SA_PASS, totp: authenticator.generate(SA_TOTP) }).expect(200);
    const f = await http().post(`/superadmin/tenants/${tenantId}/medicoes/${mes(0)}/fechar`).set(sa).send({ observacao: 'Conferido com o fiscal' }).expect(201);
    expect(f.body.fechada).toBe(true);
    await http().post(`/superadmin/tenants/${tenantId}/medicoes/${mes(0)}/fechar`).set(sa).send({}).expect(409);

    // Lote aceito depois nao muda a medicao fechada.
    await sql.unsafe(`UPDATE ${S}.digit_lotes SET paginas_aceitas = 999 WHERE numero = 1`);
    const fechada = await http().get(`/superadmin/tenants/${tenantId}/medicoes/${mes(0)}`).set(sa).expect(200);
    expect(fechada.body.linhas[0].paginasMedidas).toBe(20);

    const prox = await http().get(`/superadmin/tenants/${tenantId}/medicoes/${mes(1)}`).set(sa).expect(200);
    expect(prox.body.linhas[0]).toMatchObject({ paginasMes: 25, paginasAnteriores: 20, paginasMedidas: 10, paginasExcedentes: 15, valorServico: 5 });
    await http().post(`/superadmin/tenants/${tenantId}/medicoes/${mes(1)}/fechar`).set(sa).send({}).expect(409);

    const pdf = await http().get(`/superadmin/tenants/${tenantId}/medicoes/${mes(0)}/boletim.pdf`).set(sa).expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });

  it('fiscal do órgão confere o boletim; operador não', async () => {
    await http().get(`/t/${SLUG}/medicoes/${mes(0)}`).set(await token(OPER)).expect(403);
    const auth = await token(ADMIN);
    const m = await http().get(`/t/${SLUG}/medicoes/${mes(0)}`).set(auth).expect(200);
    expect(m.body).toMatchObject({ fechada: true, totais: { total: 1810 } });
    const lista = await http().get(`/t/${SLUG}/medicoes`).set(auth).expect(200);
    expect(lista.body[0]).toMatchObject({ mes: mes(0), total: 1810 });
  });
});
