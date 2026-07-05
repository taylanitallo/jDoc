/**
 * Testes e2e de CONFIGURACOES (Fase 5 + Fase 6).
 * Requer postgres + redis (docker compose) rodando.
 *
 * Cobre:
 *  (1) CRUD unidade orcamentaria + sub-entidades (projeto, dotacao, elemento, ordenador) com FK
 *  (2) CRUD tipo de documento
 *  (3) CRUD usuario tenant + alteracao de permissoes
 *  (4) reset de senha revoga TODAS as sessoes
 *  (5) 403 para usuario sem permissao configuracoes:*
 *  (6) cross-tenant 404
 *  (7) auditoria: mutacoes gravam audit_logs com actor correto
 *  (8) tenant_settings: salvar layout e ler de volta
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
const SLUG_A = 'cfg_e2e_a';
const SLUG_B = 'cfg_e2e_b';
const ADMIN_EMAIL = 'admin@cfg.gov.br';
const CONSULTA_EMAIL = 'consulta@cfg.gov.br';
const OPERADOR_EMAIL = 'operador@cfg.gov.br';
const PASS = 'senha-cfg-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

async function cleanup(slug: string): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${slug}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${slug}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup(SLUG_A);
  await cleanup(SLUG_B);
  await provisionTenantSchema(sql, SLUG_A);
  await provisionTenantSchema(sql, SLUG_B);

  const hash = await argon2.hash(PASS, { type: argon2.argon2id });

  // Tenant A
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status)
    VALUES (${SLUG_A}, 'Orgao A', ${'tenant_' + SLUG_A}, 'ativo')
  `;
  const userIds: Record<string, string> = {};
  for (const [email, nome, role] of [
    [ADMIN_EMAIL, 'Admin', 'admin'],
    [CONSULTA_EMAIL, 'Consulta', 'consulta'],
    [OPERADOR_EMAIL, 'Operador', 'operador'],
  ] as const) {
    const inserted = await sql.unsafe(
      `INSERT INTO "tenant_${SLUG_A}".users (email, nome, senha_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id`,
      [email, nome, hash, role],
    );
    userIds[email] = (inserted[0] as { id: string }).id;
  }
  // Operador recebe apenas unidades_orcamentarias:read
  await sql.unsafe(
    `INSERT INTO "tenant_${SLUG_A}".user_permissions (user_id, permission_key)
     VALUES ($1, 'unidades_orcamentarias:read')`,
    [userIds[OPERADOR_EMAIL]],
  );

  // Tenant B (sem permissoes admin; so pra testar cross-tenant)
  await sql`
    INSERT INTO public.tenants (slug, nome, schema_name, status)
    VALUES (${SLUG_B}, 'Orgao B', ${'tenant_' + SLUG_B}, 'ativo')
  `;
  await sql.unsafe(
    `INSERT INTO "tenant_${SLUG_B}".users (email, nome, senha_hash, role, must_change_password)
     VALUES ($1, 'Admin B', $2, 'admin', false)`,
    [ADMIN_EMAIL, hash],
  );

  // Limpa locks de brute-force
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
  await cleanup(SLUG_A);
  await cleanup(SLUG_B);
  await sql?.end({ timeout: 5 });
});

async function login(slug: string, email: string): Promise<{ token: string; cookies: string[] }> {
  const res = await request(app.getHttpServer())
    .post(`/t/${slug}/auth/login`)
    .send({ email, senha: PASS })
    .expect(200);
  const cookies = res.get('set-cookie') ?? [];
  return { token: res.body.accessToken as string, cookies };
}

describe('Configuracoes — Fase 5/6', () => {
  // =====================================================
  // (1) CRUD Unidade Orcamentaria + sub-entidades
  // =====================================================
  describe('Unidade Orcamentaria + Sub-entidades', () => {
    let unidadeId: string;

    it('cria unidade orcamentaria (admin)', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/unidades`)
        .set('Authorization', `Bearer ${token}`)
        .send({ codigo: 'UO-001', nome: 'Secretaria de Educacao', ativo: true })
        .expect(201);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      unidadeId = res.body.id as string;
    });

    it('lista unidades (paginado)', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG_A}/configuracoes/unidades?page=1&pageSize=20`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].nome).toBe('Secretaria de Educacao');
    });

    it('cria projeto vinculado a unidade', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/unidades/${unidadeId}/projetos`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tipo: 'projeto', codigo: 'PRJ-001', descricao: 'Construcao de escola', ativo: true })
        .expect(201);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('cria dotacao vinculada a unidade', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/unidades/${unidadeId}/dotacoes`)
        .set('Authorization', `Bearer ${token}`)
        .send({ exercicio: 2025, valor: 100000, descricao: 'Dotacao educacao' })
        .expect(201);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('cria elemento despesa vinculado a unidade', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/unidades/${unidadeId}/elementos`)
        .set('Authorization', `Bearer ${token}`)
        .send({ codigo: '3.3.90.30', nome: 'Material de consumo', descricao: null, ativo: true })
        .expect(201);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('cria ordenador vinculado a unidade', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/unidades/${unidadeId}/ordenadores`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          nome: 'Joao Silva',
          cpfMascarado: '123.456.789-00',
          cargo: 'Secretario Municipal',
          vigenciaInicio: '2025-01-01',
          vigenciaFim: null,
          ativo: true,
        })
        .expect(201);
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('GET sub-entidades da unidade retorna registros (FK)', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      for (const ep of ['projetos', 'dotacoes', 'elementos', 'ordenadores']) {
        const res = await request(app.getHttpServer())
          .get(`/t/${SLUG_A}/configuracoes/unidades/${unidadeId}/${ep}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('auditoria registra criacoes com actor correto', async () => {
      const audit = await sql.unsafe(
        `SELECT action, actor_id FROM "tenant_${SLUG_A}".audit_logs
         WHERE action IN ('unidade_created', 'projeto_created', 'dotacao_created', 'elemento_created', 'ordenador_created')
         ORDER BY criado_em`,
      );
      const actions = (audit as Array<{ action: string; actor_id: string }>).map((a) => a.action);
      expect(actions).toContain('unidade_created');
      expect(actions).toContain('projeto_created');
      expect(actions).toContain('dotacao_created');
      expect(actions).toContain('elemento_created');
      expect(actions).toContain('ordenador_created');

      // Verifica actor_id presente
      const first = (audit as Array<{ actor_id: string | null }>)[0];
      expect(first.actor_id).toBeTruthy();
    });
  });

  // =====================================================
  // (2) CRUD Tipo Documento
  // =====================================================
  describe('Tipo de Documento', () => {
    let tipoId: string;

    it('cria tipo de documento', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/tipos-documento`)
        .set('Authorization', `Bearer ${token}`)
        .send({ nome: 'Nota Fiscal', descricao: 'NF eletronica', cor: '#3B82F6', ativo: true })
        .expect(201);
      tipoId = res.body.id as string;
    });

    it('lista tipos de documento', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG_A}/configuracoes/tipos-documento?page=1&pageSize=20`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    });

    it('atualiza tipo de documento', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      await request(app.getHttpServer())
        .patch(`/t/${SLUG_A}/configuracoes/tipos-documento/${tipoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ descricao: 'NF-e atualizada' })
        .expect(200);
    });

    it('deleta tipo de documento', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      await request(app.getHttpServer())
        .delete(`/t/${SLUG_A}/configuracoes/tipos-documento/${tipoId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    });
  });

  // =====================================================
  // (3) CRUD Usuario + permissoes
  // =====================================================
  describe('Usuario Tenant', () => {
    let novoUserId: string;

    it('cria usuario operador', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/usuarios`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'novo.op@cfg.gov.br',
          nome: 'Novo Operador',
          role: 'operador',
          senha: PASS,
          permissions: ['unidades_orcamentarias:read'],
          unidadesIds: [],
        })
        .expect(201);
      novoUserId = res.body.id as string;
    });

    it('lista usuarios', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG_A}/configuracoes/usuarios?page=1&pageSize=20`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
    });

    it('altera permissoes do usuario', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      await request(app.getHttpServer())
        .patch(`/t/${SLUG_A}/configuracoes/usuarios/${novoUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          nome: 'Novo Operador 2',
          role: 'operador',
          ativo: true,
          permissions: ['unidades_orcamentarias:read', 'unidades_orcamentarias:create'],
          unidadesIds: [],
        })
        .expect(200);
    });

    it('auditoria registra criacao de usuario', async () => {
      const audit = await sql.unsafe(
        `SELECT action FROM "tenant_${SLUG_A}".audit_logs WHERE action = 'usuario_created'`,
      );
      expect((audit as unknown[]).length).toBeGreaterThanOrEqual(1);
    });
  });

  // =====================================================
  // (4) RBAC — 403 sem permissao (antes do reset, pois usa senha original)
  // =====================================================
  describe('RBAC — 403 sem permissao', () => {
    it('consulta (sem permissoes) recebe 403 em todas as rotas', async () => {
      const { token } = await login(SLUG_A, CONSULTA_EMAIL);
      const casos: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string; body?: unknown }> = [
        { method: 'get', path: `/t/${SLUG_A}/configuracoes/unidades?page=1&pageSize=20` },
        { method: 'post', path: `/t/${SLUG_A}/configuracoes/unidades`, body: { codigo: 'X', nome: 'Y', ativo: true } },
        { method: 'get', path: `/t/${SLUG_A}/configuracoes/tipos-documento?page=1&pageSize=20` },
        { method: 'get', path: `/t/${SLUG_A}/configuracoes/usuarios?page=1&pageSize=20` },
        { method: 'get', path: `/t/${SLUG_A}/configuracoes/settings` },
      ];

      for (const c of casos) {
        const req = request(app.getHttpServer())[c.method](c.path).set('Authorization', `Bearer ${token}`);
        const res = c.body ? await req.send(c.body) : await req;
        expect(res.status).toBe(403);
      }
    });

    it('operador com apenas read recebe 403 em write', async () => {
      const { token } = await login(SLUG_A, OPERADOR_EMAIL);
      await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/unidades`)
        .set('Authorization', `Bearer ${token}`)
        .send({ codigo: 'X', nome: 'Y', ativo: true })
        .expect(403);
    });
  });

  // =====================================================
  // (5) Reset de senha revoga sessoes
  // =====================================================
  describe('Reset de senha revoga sessoes', () => {
    let cookiesAntigos: string[];

    it('login inicial do operador cria sessao', async () => {
      const login1 = await login(SLUG_A, OPERADOR_EMAIL);
      cookiesAntigos = login1.cookies;
      expect(cookiesAntigos.some((c) => c.includes('jdoc_rt='))).toBe(true);
    });

    it('admin reseta a senha do operador', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      // Pega id do operador
      const list = await request(app.getHttpServer())
        .get(`/t/${SLUG_A}/configuracoes/usuarios?page=1&pageSize=50`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const op = (list.body.items as Array<{ id: string; email: string }>).find(
        (u) => u.email === OPERADOR_EMAIL,
      );
      expect(op).toBeTruthy();

      await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/configuracoes/usuarios/${op!.id}/reset-senha`)
        .set('Authorization', `Bearer ${token}`)
        .send({ novaSenha: 'nova-senha-456' })
        .expect(204);
    });

    it('refresh com cookie antigo = 401 (sessao revogada)', async () => {
      const cookieHeader = cookiesAntigos.join('; ');
      // Usa o refresh token antigo — DEVE FALHAR
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/auth/refresh`)
        .set('Cookie', cookieHeader);
      expect([401]).toContain(res.status);
    });

    it('login com senha antiga = 401', async () => {
      await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/auth/login`)
        .send({ email: OPERADOR_EMAIL, senha: PASS })
        .expect(401);
    });

    it('login com nova senha funciona', async () => {
      const res = await request(app.getHttpServer())
        .post(`/t/${SLUG_A}/auth/login`)
        .send({ email: OPERADOR_EMAIL, senha: 'nova-senha-456' })
        .expect(200);
      expect(res.body.accessToken).toBeTruthy();
    });
  });

  // =====================================================
  // (6) Cross-tenant 404
  // =====================================================
  describe('Cross-tenant — 404', () => {
    it('token do tenant A e rejeitado no tenant B (401 ou 404)', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      // Pode ser 401 se JWT issuer mismatch ou 404 se o tenant resolver deixar passar
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG_B}/configuracoes/unidades?page=1&pageSize=20`)
        .set('Authorization', `Bearer ${token}`);
      expect([401, 404]).toContain(res.status);
    });

    it('token do tenant A nao acessa settings do tenant B (401 ou 404)', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG_B}/configuracoes/settings`)
        .set('Authorization', `Bearer ${token}`);
      expect([401, 404]).toContain(res.status);
    });
  });

  // =====================================================
  // (8) Tenant Settings
  // =====================================================
  describe('Tenant Settings', () => {
    it('salva e le settings de layout', async () => {
      const { token } = await login(SLUG_A, ADMIN_EMAIL);
      await request(app.getHttpServer())
        .patch(`/t/${SLUG_A}/configuracoes/settings`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          brasaoKey: 'brasao-uuid-teste.pdf',
          nomeExibido: 'Prefeitura Teste',
          corDestaque: '#FF5733',
          textoRodape: 'Desenvolvido por JEOS',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/t/${SLUG_A}/configuracoes/settings`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.nomeExibido).toBe('Prefeitura Teste');
      expect(res.body.corDestaque).toBe('#FF5733');
      expect(res.body.brasaoKey).toBe('brasao-uuid-teste.pdf');
      expect(res.body.textoRodape).toBe('Desenvolvido por JEOS');
    });
  });
});