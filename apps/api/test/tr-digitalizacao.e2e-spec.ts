/**
 * TR (servico) — fase 3: digitalizacao. Plano aprovado pelo fiscal, lote
 * percorre as etapas em ordem com cadeia de custodia, inventario, controle de
 * qualidade com nao conformidade e retrabalho, aceite do fiscal congelando as
 * paginas, devolucao conferida, termos e relatorio de producao.
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
const SLUG = 'tr_digit_e2e';
const S = `"tenant_${SLUG}"`;
const PASS = 'senha-tr-digit-123';
const ADMIN = 'fiscal@trdigit.gov.br';
const OPERADOR = 'operador@trdigit.gov.br';

let app: INestApplication;
let sql: postgres.Sql;
const docs: string[] = [];

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
    VALUES (${SLUG}, 'Prefeitura Digitalização', ${'tenant_' + SLUG}, 'ativo', 100, '{arquivo}')
  `;
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql.unsafe(`INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Fiscal', $2, 'admin', false)`, [ADMIN, hash]);
  const [op] = await sql.unsafe<Array<{ id: string }>>(
    `INSERT INTO ${S}.users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Operador', $2, 'operador', false) RETURNING id`,
    [OPERADOR, hash],
  );
  for (const p of ['digitalizacao:read', 'digitalizacao:create', 'digitalizacao:update', 'digitalizacao:export', 'acervo:read']) {
    await sql.unsafe(`INSERT INTO ${S}.user_permissions (user_id, permission_key) VALUES ($1, $2)`, [op!.id, p]);
  }
  await sql.unsafe(`INSERT INTO ${S}.orgaos (codigo, descricao, exercicio) VALUES ('06', 'Secretaria de Educação', 2026)`);
  for (const [i, pag] of [
    [1, 12],
    [2, 8],
  ] as const) {
    const [d] = await sql.unsafe<Array<{ id: string }>>(
      `INSERT INTO ${S}.documents (module, exercicio, original_name, status, file_key, file_hash, paginas, descricao, document_date)
       VALUES ('acervo', 2026, $1, 'disponivel', $2, $3, $4, 'Processo digitalizado', '2026-01-10') RETURNING id`,
      [`proc-${i}.pdf`, `k${i}.pdf`, String(i).repeat(64), pag],
    );
    docs.push(d!.id);
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

describe('Digitalização', () => {
  let planoId = '';
  let loteId = '';

  it('plano de trabalho: operador cria, só o fiscal aprova, aprovado não muda', async () => {
    const op = await token(OPERADOR);
    const plano = { orgaoCodigo: '06', titulo: 'Digitalização do arquivo da Educação', volumeCaixas: 40, volumePaginas: 20000, inicio: '2026-02-01', fim: '2026-12-20' };
    const r = await http().post(`/t/${SLUG}/digitalizacao/planos`).set(op).send(plano).expect(201);
    planoId = r.body.id as string;
    await http().post(`/t/${SLUG}/digitalizacao/planos/${planoId}/aprovar`).set(op).expect(403);
    await http().post(`/t/${SLUG}/digitalizacao/planos/${planoId}/aprovar`).set(await token(ADMIN)).expect(204);
    await http().patch(`/t/${SLUG}/digitalizacao/planos/${planoId}`).set(op).send(plano).expect(409);
  });

  it('recebe o lote com inventário e termo de recebimento', async () => {
    const op = await token(OPERADOR);
    const r = await http()
      .post(`/t/${SLUG}/digitalizacao/lotes`)
      .set(op)
      .send({ planoId, orgaoCodigo: '06', descricao: 'Pastas funcionais 2010-2015', caixas: 2, fragil: true, amostragemPct: 50 })
      .expect(201);
    loteId = r.body.id as string;
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/itens`).set(op).send({ tipo: 'caixa', identificacao: 'CX-01', folhas: 300, estadoConservacao: 'regular' }).expect(204);
    const d = await http().get(`/t/${SLUG}/digitalizacao/lotes/${loteId}`).set(op).expect(200);
    expect(d.body.protocolo).toMatch(/^LT 001\/\d{4}$/);
    expect(d.body.etapa).toBe('recebido');
    expect(d.body.itens).toHaveLength(1);
    expect(d.body.eventos[0].etapaPara).toBe('recebido');
    const termo = await http().get(`/t/${SLUG}/digitalizacao/lotes/${loteId}/termo/recebimento`).set(op).expect(200);
    expect(termo.headers['content-type']).toMatch(/pdf/);
  });

  it('etapas só andam na ordem e "disponibilizado" só pelo aceite', async () => {
    const op = await token(OPERADOR);
    const etapa = (para: string) => http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/etapa`).set(op).send({ para });
    await etapa('indexacao').expect(400);
    await etapa('preparacao').expect(204);
    await etapa('digitalizacao').expect(204);
    await etapa('indexacao').expect(204);
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/documentos`).set(op).send({ ids: docs }).expect(201);
    await etapa('controle_qualidade').expect(204);
    await etapa('disponibilizado').expect(400);
  });

  it('QC com não conformidade reprova; aceite bloqueado até corrigir e aprovar', async () => {
    const op = await token(OPERADOR);
    const fiscal = await token(ADMIN);
    const checklist = { completude: true, sequencia: true, orientacao: true, legibilidade: false, cortes: true, correspondencia_metadados: true };
    const qc = await http()
      .post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/qc`)
      .set(op)
      .send({ amostra: 10, checklist, naoConformidades: [{ tipo: 'ilegivel', descricao: 'Página 3 borrada', documentId: docs[0] }] })
      .expect(201);
    expect(qc.body.aprovado).toBe(false);
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/aceite`).set(fiscal).send({}).expect(400);

    const d = await http().get(`/t/${SLUG}/digitalizacao/lotes/${loteId}`).set(op).expect(200);
    expect(d.body.amostraSugerida).toBe(10);
    expect(d.body.verificacao).toMatchObject({ documentos: 2, semArquivo: 0, duplicadosPorHash: [] });
    const nc = d.body.naoConformidades[0] as { id: string };
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/nao-conformidades/${nc.id}/corrigir`).set(op).send({ correcao: 'Redigitalizada em 600 dpi' }).expect(204);
    await http()
      .post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/qc`)
      .set(op)
      .send({ amostra: 10, checklist: { ...checklist, legibilidade: true } })
      .expect(201);
    // Operador nao e fiscal.
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/aceite`).set(op).send({}).expect(403);
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/aceite`).set(fiscal).send({ observacao: 'Conferido por amostragem' }).expect(204);

    const aceito = await http().get(`/t/${SLUG}/digitalizacao/lotes/${loteId}`).set(op).expect(200);
    expect(aceito.body.etapa).toBe('disponibilizado');
    expect(aceito.body.paginasAceitas).toBe(20);
    expect(aceito.body.aceitePor).toBe('Fiscal');
    const termo = await http().get(`/t/${SLUG}/digitalizacao/lotes/${loteId}/termo/aceite`).set(op).expect(200);
    expect(termo.headers['content-type']).toMatch(/pdf/);
  });

  it('devolução exige conferir o inventário', async () => {
    const op = await token(OPERADOR);
    const d = await http().get(`/t/${SLUG}/digitalizacao/lotes/${loteId}`).set(op).expect(200);
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/etapa`).set(op).send({ para: 'devolvido' }).expect(400);
    await http()
      .patch(`/t/${SLUG}/digitalizacao/lotes/${loteId}/itens/${d.body.itens[0].id as string}`)
      .set(op)
      .send({ conferidoDevolucao: true })
      .expect(204);
    await http().post(`/t/${SLUG}/digitalizacao/lotes/${loteId}/etapa`).set(op).send({ para: 'devolvido' }).expect(204);
    const fim = await http().get(`/t/${SLUG}/digitalizacao/lotes/${loteId}`).set(op).expect(200);
    expect((fim.body.eventos as Array<{ etapaPara: string }>).map((e) => e.etapaPara)).toEqual([
      'recebido',
      'preparacao',
      'digitalizacao',
      'indexacao',
      'controle_qualidade',
      'disponibilizado',
      'devolvido',
    ]);
  });

  it('relatório de produção soma páginas aceitas por secretaria', async () => {
    const op = await token(OPERADOR);
    const r = await http().get(`/t/${SLUG}/digitalizacao/producao`).set(op).expect(200);
    expect(r.body.totais).toMatchObject({ lotes: 1, paginasAceitas: 20, paginasDigitalizadas: 20, naoConformidades: 1 });
    expect(r.body.porSecretaria[0]).toMatchObject({ orgaoCodigo: '06', orgaoNome: 'Secretaria de Educação', paginasAceitas: 20 });
    const csv = await http().get(`/t/${SLUG}/digitalizacao/producao/csv`).set(op).expect(200);
    expect(csv.text).toContain('LT 001/');
    const pdf = await http().get(`/t/${SLUG}/digitalizacao/producao/pdf`).set(op).expect(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });
});
