/**
 * Testes e2e de ETIQUETAS (Fase 4).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  - preview interpreta registros + relatorio de erros linha a linha, SEM gravar nada
 *  - preview de formato irreconhecivel = 400
 *  - confirmacao enfileira no BullMQ; worker processa em background;
 *    polling do status ate 'concluido'; labels gravadas no schema do tenant
 *  - relatorio de erros persistido no labels_imports
 *  - usuario sem permissao (consulta) = 403
 *  - auditoria: labels_import_queued + labels_import_processed
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
const SLUG = 'lbl_e2e';
const ADMIN_EMAIL = 'admin@lbl.gov.br';
const CONSULTA_EMAIL = 'consulta@lbl.gov.br';
const PASS = 'senha-lbl-e2e-123';

const SS_FILE = [
  'DOC_CAIXA;EMPENHO;CREDOR;VALOR;DATA;HISTORICO',
  '000123;2026NE00045;Fornecedor Alfa LTDA;1.234,56;10/05/2026;Compra de material',
  ';2026NE00046;Sem Doc Caixa;5,00;11/05/2026;linha invalida',
  '000125;2026NE00047;Beta Servicos ME;89,90;12/05/2026;OK',
].join('\n');

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${SLUG}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  await cleanup();

  await provisionTenantSchema(sql, SLUG);
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status)
    VALUES (${SLUG}, 'Orgao Etiquetas', ${'tenant_' + SLUG}, 'ativo')
  `;
  await sql.unsafe(
    `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password)
     VALUES ($1, 'Admin Lbl', $2, 'admin', false), ($3, 'Consulta Lbl', $2, 'consulta', false)`,
    [ADMIN_EMAIL, hash, CONSULTA_EMAIL],
  );

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const bfKeys = await redis.keys('bf:*');
  if (bfKeys.length > 0) await redis.del(...bfKeys);
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
  const res = await request(app.getHttpServer())
    .post(`/t/${SLUG}/auth/login`)
    .send({ email, senha: PASS })
    .expect(200);
  return res.body.accessToken as string;
}

describe('Etiquetas — Fase 4', () => {
  it('preview interpreta registros e reporta erros linha a linha SEM gravar', async () => {
    const token = await login(ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG}/labels-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .attach('file', Buffer.from(SS_FILE), 'etiquetas.csv')
      .expect(200);

    expect(res.body.formato).toBe('SS');
    expect(res.body.totalValidos).toBe(2);
    expect(res.body.totalErros).toBe(1);
    expect(res.body.erros[0].line).toBe(3);
    expect(res.body.erros[0].message).toContain('DOC_CAIXA vazio');
    expect(res.body.amostra[0].credor).toBe('Fornecedor Alfa LTDA');

    // NADA gravado no banco.
    const imports = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM "tenant_${SLUG}".labels_imports`);
    expect((imports[0] as { n: number }).n).toBe(0);
  });

  it('formato irreconhecivel = 400 com mensagem clara', async () => {
    const token = await login(ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG}/labels-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .attach('file', Buffer.from('texto sem formato'), 'x.txt')
      .expect(400);
    expect(res.body.message).toContain('nao reconhecido');
  });

  it('binario disfarcado de txt = 400', async () => {
    const token = await login(ADMIN_EMAIL);
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/labels-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .attach('file', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]), 'bin.txt')
      .expect(400);
  });

  it("usuario 'consulta' sem permissao = 403", async () => {
    const token = await login(CONSULTA_EMAIL);
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/labels-imports/preview`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .attach('file', Buffer.from(SS_FILE), 'etiquetas.csv')
      .expect(403);
  });

  it('fluxo completo: confirmar -> fila -> worker -> polling -> labels gravadas', async () => {
    const token = await login(ADMIN_EMAIL);

    const queued = await request(app.getHttpServer())
      .post(`/t/${SLUG}/labels-imports`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .field('formato', 'SS')
      .attach('file', Buffer.from(SS_FILE), 'etiquetas.csv')
      .expect(202);
    const importId = queued.body.id as string;
    expect(importId).toMatch(/^[0-9a-f-]{36}$/);

    // Polling ate o worker concluir (max ~10s).
    let status = '';
    let view: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) {
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG}/labels-imports/${importId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      view = res.body as Record<string, unknown>;
      status = String(view.status);
      if (status === 'concluido' || status === 'erro') break;
      await new Promise((r) => setTimeout(r, 400));
    }

    expect(status).toBe('concluido');
    expect(view.registrosOk).toBe(2);
    expect(view.registrosErro).toBe(1);
    expect((view.relatorioErros as Array<{ line: number }>)[0]?.line).toBe(3);

    // Labels gravadas no schema do tenant.
    const labels = await sql.unsafe(
      `SELECT empenho, credor, valor::text FROM "tenant_${SLUG}".labels ORDER BY empenho`,
    );
    expect(labels).toHaveLength(2);
    expect((labels[0] as { empenho: string }).empenho).toBe('2026NE00045');

    // Historico lista a importacao.
    const list = await request(app.getHttpServer())
      .get(`/t/${SLUG}/labels-imports`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.total).toBe(1);

    // Auditoria completa.
    const audit = await sql.unsafe(
      `SELECT action FROM "tenant_${SLUG}".audit_logs WHERE action LIKE 'labels_%' ORDER BY criado_em`,
    );
    const actions = (audit as unknown as Array<{ action: string }>).map((a) => a.action);
    expect(actions).toContain('labels_import_queued');
    expect(actions).toContain('labels_import_processed');
  });

  it('importacao sem nenhum registro valido = 400 (nada enfileirado)', async () => {
    const token = await login(ADMIN_EMAIL);
    const allBad = ';;;;\n;;;;';
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/labels-imports`)
      .set('Authorization', `Bearer ${token}`)
      .field('module', 'despesas')
      .field('formato', 'SS')
      .attach('file', Buffer.from(allBad), 'ruim.csv')
      .expect(400);
  });
});
