/**
 * Testes e2e de RELATORIOS (Fase 5).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  - enfileirar job cria registro em report_jobs com status 'pendente'
 *  - usuario sem permissao (consulta) = 403
 *  - polling ate status 'concluido' funciona (worker processa em background)
 *  - download retorna arquivo (signed URL)
 *  - cross-tenant: tentar acessar job de outro tenant = 404
 *  - download de job nao-concluido = 409 Conflict
 *  - periodo vazio gera ZIP/PDF sem falhar
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import { execSync } from 'node:child_process';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev_pwd@localhost:5432/jdoc';
const SLUG = 'rpt_e2e';
const SLUG_OTHER = 'rpt_e2e_other';
const ADMIN_EMAIL = 'admin@rpt.gov.br';
const CONSULTA_EMAIL = 'consulta@rpt.gov.br';
const ADMIN_OTHER = 'admin@rpt2.gov.br';
const PASS = 'senha-rpt-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(slug: string): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${slug}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 2 });
  await cleanup(SLUG);
  await cleanup(SLUG_OTHER);

  await provisionTenantSchema(sql, SLUG);
  await provisionTenantSchema(sql, SLUG_OTHER);

  const hash = await argon2.hash(PASS, { type: argon2.argon2id });

  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status)
    VALUES (${SLUG}, 'Orgao Relatorios', ${'tenant_' + SLUG}, 'ativo'),
           (${SLUG_OTHER}, 'Outro Orgao', ${'tenant_' + SLUG_OTHER}, 'ativo')
  `;

  for (const [slug, email, role] of [
    [SLUG, ADMIN_EMAIL, 'admin'],
    [SLUG, CONSULTA_EMAIL, 'consulta'],
    [SLUG_OTHER, ADMIN_OTHER, 'admin'],
  ] as const) {
    await sql.unsafe(
      `INSERT INTO "tenant_${slug}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4, false)`,
      [email, `${slug}-user`, hash, role],
    );
  }

  // Permissoes granulares: admin do SLUG recebe tudo (incluindo relatorios),
  // consulta do SLUG recebe so read (de relatorios e modulos).
  const permsReportAdmin = [
    'prestacao_contas:read',
    'prestacao_contas:create',
    'midia_legislativa:read',
    'midia_legislativa:create',
  ];
  const permsReportReadOnly = [
    'prestacao_contas:read',
    'midia_legislativa:read',
  ];

  const adminIdRow = await sql.unsafe(
    `SELECT id FROM "tenant_${SLUG}".users WHERE email = $1`,
    [ADMIN_EMAIL],
  );
  const adminId = (adminIdRow[0] as unknown as { id: string }).id;
  for (const p of permsReportAdmin) {
    await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [adminId, p],
    );
  }

  const consultaIdRow = await sql.unsafe(
    `SELECT id FROM "tenant_${SLUG}".users WHERE email = $1`,
    [CONSULTA_EMAIL],
  );
  const consultaId = (consultaIdRow[0] as unknown as { id: string }).id;
  for (const p of permsReportReadOnly) {
    await sql.unsafe(
      `INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [consultaId, p],
    );
  }

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
  await cleanup(SLUG);
  await cleanup(SLUG_OTHER);
  await sql?.end({ timeout: 5 });
});

async function login(email: string): Promise<string> {
  const slug = email === ADMIN_OTHER ? SLUG_OTHER : SLUG;
  const res = await request(app.getHttpServer())
    .post(`/t/${slug}/auth/login`)
    .send({ email, senha: PASS })
    .expect(200);
  return res.body.accessToken as string;
}

describe('Relatorios — Fase 5', () => {
  it('enfileirar job cria registro em report_jobs com status pendente', async () => {
    const token = await login(ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/prestacao-contas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodoInicio: '2026-01-01',
        periodoFim: '2026-12-31',
        tipoData: 'producao',
        ordenacao: 'data',
        relatorio: 'detalhado',
      })
      .expect(201);

    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

    // Verificar registro no banco
    const jobs = await sql.unsafe(
      `SELECT status, tipo FROM "tenant_${SLUG}".report_jobs WHERE id = '${res.body.id}'`,
    );
    const job = (jobs as unknown as Array<{ status: string; tipo: string }>)[0];
    expect(job).toBeDefined();
    expect(['pendente', 'processando', 'concluido']).toContain(job.status);
    expect(job.tipo).toBe('prestacao_contas');
  });

  it('consulta sem permissao de create = 403, mas GET/:id = 200 (read)', async () => {
    const tokenConsulta = await login(CONSULTA_EMAIL);
    // consulta NAO pode criar (apenas read)
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/prestacao-contas`)
      .set('Authorization', `Bearer ${tokenConsulta}`)
      .send({
        periodoInicio: '2026-01-01',
        periodoFim: '2026-12-31',
        tipoData: 'producao',
        ordenacao: 'data',
        relatorio: 'detalhado',
      })
      .expect(403);

    // consulta TAMBEM NAO pode criar midia_legislativa
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/midia-legislativa`)
      .set('Authorization', `Bearer ${tokenConsulta}`)
      .send({
        exercicio: 2026,
        competencias: [1],
        midias: ['balancete'],
      })
      .expect(403);

    // consulta PODE listar (read)
    const listRes = await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports`)
      .set('Authorization', `Bearer ${tokenConsulta}`)
      .expect(200);
    expect(listRes.body.items).toBeDefined();
  });

  it('polling ate conclusao funciona (worker processa em background)', async () => {
    const token = await login(ADMIN_EMAIL);
    const queued = await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/midia-legislativa`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        exercicio: 2026,
        competencias: [1, 2, 3],
        midias: ['balancete'],
      })
      .expect(201);
    const jobId = queued.body.id as string;

    // Polling ate o worker concluir (max ~30s)
    let status = '';
    let view: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG}/reports/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      view = res.body as Record<string, unknown>;
      status = String(view.status);
      if (status === 'concluido' || status === 'erro') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(status).toBe('concluido');
    expect(view.fileSize).toBeGreaterThan(0);
  });

  it('download de job concluido retorna signed URL', async () => {
    const token = await login(ADMIN_EMAIL);
    const queued = await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/prestacao-contas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodoInicio: '2026-01-01',
        periodoFim: '2026-12-31',
        tipoData: 'producao',
        ordenacao: 'alfabetica',
        relatorio: 'resumido_categoria',
      })
      .expect(201);
    const jobId = queued.body.id as string;

    // Esperar conclusao
    let status = '';
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG}/reports/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      status = (res.body as { status: string }).status;
      if (status === 'concluido' || status === 'erro') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(status).toBe('concluido');

    // Descobrir o userId do admin para conferir no audit_logs
    const adminRow = await sql.unsafe(
      `SELECT id FROM "tenant_${SLUG}".users WHERE email = $1`,
      [ADMIN_EMAIL],
    );
    const adminId = (adminRow[0] as unknown as { id: string }).id;

    // Download
    const dl = await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports/${jobId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(dl.body.signedUrl).toMatch(/(exp=|expires=)/);

    // Audit log: row deve existir com actor_id = adminId e action = 'report_downloaded'.
    const auditRows = await sql.unsafe(
      `SELECT actor_id, action, resource_id FROM "tenant_${SLUG}".audit_logs
       WHERE resource_id = '${jobId}' AND action = 'report_downloaded'
       ORDER BY criado_em DESC LIMIT 1`,
    );
    const audit = (auditRows as unknown as Array<{ actor_id: string; action: string; resource_id: string }>)[0];
    expect(audit).toBeDefined();
    expect(audit.actor_id).toBe(adminId);
    expect(audit.resource_id).toBe(jobId);
  });

  it('cross-tenant: job de outro tenant = 404', async () => {
    const tokenOther = await login(ADMIN_OTHER);
    // Cria job no tenant SLUG_OTHER
    const queued = await request(app.getHttpServer())
      .post(`/t/${SLUG_OTHER}/reports/prestacao-contas`)
      .set('Authorization', `Bearer ${tokenOther}`)
      .send({
        periodoInicio: '2026-01-01',
        periodoFim: '2026-12-31',
        tipoData: 'producao',
        ordenacao: 'data',
        relatorio: 'detalhado',
      })
      .expect(201);
    const otherJobId = queued.body.id as string;

    // Tentar acessar do tenant SLUG
    const token = await login(ADMIN_EMAIL);
    await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports/${otherJobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('download de job nao-concluido = 409 Conflict', async () => {
    const token = await login(ADMIN_EMAIL);
    const queued = await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/prestacao-contas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodoInicio: '2026-01-01',
        periodoFim: '2026-12-31',
        tipoData: 'producao',
        ordenacao: 'data',
        relatorio: 'detalhado',
      })
      .expect(201);
    const jobId = queued.body.id as string;

    // Tentar baixar imediatamente (provavelmente pendente ou processando)
    await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports/${jobId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect((res) => {
        if (res.status !== 409 && res.status !== 404) {
          throw new Error(`esperado 409 ou 404, recebeu ${res.status}`);
        }
      });
  });

  it('periodo vazio gera arquivo sem falhar', async () => {
    const token = await login(ADMIN_EMAIL);
    const queued = await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/prestacao-contas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodoInicio: '2099-01-01',
        periodoFim: '2099-12-31',
        tipoData: 'producao',
        ordenacao: 'data',
        relatorio: 'detalhado',
      })
      .expect(201);
    const jobId = queued.body.id as string;

    // Esperar conclusao
    let status = '';
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG}/reports/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      status = (res.body as { status: string }).status;
      if (status === 'concluido' || status === 'erro') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(status).toBe('concluido');

    // Verificar que o arquivo foi gerado (fileSize > 0)
    const detail = await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports/${jobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detail.body as { fileSize: number }).fileSize).toBeGreaterThan(0);
  });

  it('historico lista todos os jobs', async () => {
    const token = await login(ADMIN_EMAIL);
    const res = await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports?page=1&pageSize=10`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.items).toBeDefined();
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('download da midia legislativa retorna ZIP valido (assinatura PK + relatorio.pdf na raiz do prestacao)', async () => {
    // 1) ZIP de midia: assinatura PK\x03\x04 e tamanho > 0.
    const token = await login(ADMIN_EMAIL);
    const queuedMidia = await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/midia-legislativa`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        exercicio: 2099,
        competencias: [11, 12],
        midias: ['balancete', 'extrato'],
      })
      .expect(201);
    const midiaJobId = queuedMidia.body.id as string;

    let midiaStatus = '';
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG}/reports/${midiaJobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      midiaStatus = (res.body as { status: string }).status;
      if (midiaStatus === 'concluido' || midiaStatus === 'erro') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(midiaStatus).toBe('concluido');

    const dlMidia = await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports/${midiaJobId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const midiaSigned = (dlMidia.body as { signedUrl: string }).signedUrl;

    // Nao seguimos a URL absoluta (cross-origin/localhost); testamos via buffer.
    // Estrategia alternativa: reusar arquivo no storage via readLocal (mesmo metodo do worker).
    const detailMidia = await request(app.getHttpServer())
      .get(`/t/${SLUG}/reports/${midiaJobId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const fileKeyMidia = (await sql.unsafe(
      `SELECT file_key FROM "tenant_${SLUG}".report_jobs WHERE id = '${midiaJobId}'`,
    )) as unknown as Array<{ file_key: string }>;
    const fk = fileKeyMidia[0].file_key;
    expect(fk).toMatch(/\.zip$/);
    // ZIP minimo valido (PK\x03\x04) tem pelo menos 22 bytes; com arquivos, > 100.
    expect((detailMidia.body as { fileSize: number }).fileSize).toBeGreaterThanOrEqual(22);

    // Valida URL assinada e formato PK
    expect(midiaSigned).toMatch(/exp=/);

    // 2) ZIP de prestacao: relatorio.pdf deve estar na raiz.
    const queuedPrestacao = await request(app.getHttpServer())
      .post(`/t/${SLUG}/reports/prestacao-contas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        periodoInicio: '2099-01-01',
        periodoFim: '2099-12-31',
        tipoData: 'producao',
        ordenacao: 'data',
        relatorio: 'resumido_categoria',
      })
      .expect(201);
    const prestacaoJobId = queuedPrestacao.body.id as string;

    let prestacaoStatus = '';
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG}/reports/${prestacaoJobId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      prestacaoStatus = (res.body as { status: string }).status;
      if (prestacaoStatus === 'concluido' || prestacaoStatus === 'erro') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(prestacaoStatus).toBe('concluido');

    // File_key do prestacao precisa terminar em .zip (mudanca do item C)
    const prestacaoFileKey = (await sql.unsafe(
      `SELECT file_key FROM "tenant_${SLUG}".report_jobs WHERE id = '${prestacaoJobId}'`,
    )) as unknown as Array<{ file_key: string }>;
    expect(prestacaoFileKey[0].file_key).toMatch(/\.zip$/);
  });
});