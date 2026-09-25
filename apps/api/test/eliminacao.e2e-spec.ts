/**
 * Testes e2e da ELIMINACAO LEGAL (Resolucao CONARQ n. 40) — fluxo destrutivo.
 * Requer postgres + redis (docker compose) rodando e STORAGE local (sem Supabase).
 *
 * Cobre:
 *  (1) listagem so aceita documento "a eliminar" e fora de outra listagem ativa
 *  (2) aprovacao exige CPAD (>= 2 membros); itens travam depois de aprovada
 *  (3) conclusao bloqueada: antes do prazo do edital, frase errada, nao-admin, item emprestado
 *  (4) conclusao: PDF (principal + extra) apagado do storage, texto de busca apagado,
 *      metadados + hash preservados, documento imutavel, verificacao publica "eliminado"
 *  (5) guarda permanente nunca entra na listagem
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import postgres from 'postgres';
import Redis from 'ioredis';
import * as argon2 from 'argon2';
import PDFKitDocument from 'pdfkit';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { provisionTenantSchema } from '@jdoc/database';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://jdoc:jdoc_dev@localhost:5432/jdoc';
const STORAGE_DIR = process.env.STORAGE_DIR ?? '.storage';
const SLUG = 'elim_e2e';
const ADMIN = 'admin@elim.gov.br';
const GESTOR = 'gestor@elim.gov.br';
const PASS = 'senha-elim-e2e-123';

let app: INestApplication;
let sql: postgres.Sql;

function gerarPdf(texto: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(12).text(texto);
    doc.end();
  });
}

async function cleanup(): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${SLUG}" CASCADE`);
  await sql`DELETE FROM public.tenants WHERE slug = ${SLUG}`;
}

beforeAll(async () => {
  sql = postgres(DB_URL, { max: 4 });
  await cleanup();
  await provisionTenantSchema(sql, SLUG);
  const hash = await argon2.hash(PASS, { type: argon2.argon2id });
  await sql`INSERT INTO public.tenants (slug, nome, schema_name, status) VALUES (${SLUG}, 'Prefeitura Elim', ${'tenant_' + SLUG}, 'ativo')`;
  await sql.unsafe(`INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Admin', $2, 'admin', false)`, [ADMIN, hash]);
  const g = await sql.unsafe(
    `INSERT INTO "tenant_${SLUG}".users (email, nome, senha_hash, role, must_change_password) VALUES ($1, 'Gestor', $2, 'operador', false) RETURNING id`,
    [GESTOR, hash],
  );
  for (const p of ['temporalidade:read', 'temporalidade:update', 'temporalidade:delete']) {
    await sql.unsafe(`INSERT INTO "tenant_${SLUG}".user_permissions (user_id, permission_key) VALUES ($1, $2)`, [(g[0] as { id: string }).id, p]);
  }
  // Orgao de teste contrata os dois modulos (Arquivo + Financeiro).
  for (const s of [SLUG]) {
    await sql`UPDATE public.tenants SET modulos = '{financeiro,arquivo}' WHERE slug = ${s}`;
  }
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const bfKeys = await redis.keys('bf:*');
  if (bfKeys.length > 0) await redis.del(...bfKeys);
  // Tenant recriado com o mesmo slug: o cache de 60s ainda teria o tenant_id anterior.
  const tenantKeys = await redis.keys('tenant:slug:*');
  if (tenantKeys.length > 0) await redis.del(...tenantKeys);
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

describe('Eliminacao legal', () => {
  let admin: string;
  let gestor: string;
  let docVelho: string; // despesa 2010: a eliminar
  let docRecente: string; // despesa 2024: em prazo
  let docEmprestado: string; // despesa 2011: a eliminar, mas emprestado
  let elimId: string;
  let codigoVerificacao: string;
  const chaves: string[] = [];
  const M = { nome: 'Ana Souza', cargo: 'Presidente da CPAD' };
  const M2 = { nome: 'Carlos Lima', cargo: 'Membro' };
  const base = `/t/${SLUG}/arquivistica/eliminacoes`;
  const post = (path: string, body: object, tok = gestor) =>
    request(app.getHttpServer()).post(`${base}${path}`).set('Authorization', `Bearer ${tok}`).send(body);

  async function despesa(exercicio: number, docCaixa: string): Promise<string> {
    const r = await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'despesas')
      .field('exercicio', String(exercicio))
      .field('docCaixa', docCaixa)
      .field('empenho', `${exercicio}NE1`)
      .field('credor', 'Fornecedor')
      .field('subtype', 'orcamentaria')
      .field('documentDate', `${exercicio}-05-10`)
      .attach('file', await gerarPdf(`Nota de empenho ${docCaixa} de ${exercicio}`), { filename: `${docCaixa}.pdf`, contentType: 'application/pdf' })
      .expect(201);
    return r.body.id as string;
  }

  it('(1) listagem aceita so documento a eliminar e fora de outra listagem', async () => {
    admin = await login(ADMIN);
    gestor = await login(GESTOR);
    await request(app.getHttpServer()).post(`/t/${SLUG}/arquivistica/classificacoes/modelo`).set('Authorization', `Bearer ${admin}`).expect(201);
    docVelho = await despesa(2010, 'V1');
    docRecente = await despesa(2024, 'R1');
    docEmprestado = await despesa(2011, 'E1');
    // PDF extra no documento que sera eliminado.
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents/${docVelho}/files`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', await gerarPdf('Anexo: nota fiscal'), { filename: 'nf.pdf', contentType: 'application/pdf' })
      .expect((r) => expect([200, 201]).toContain(r.status));
    const ks = await sql.unsafe(
      `SELECT file_key FROM "tenant_${SLUG}".documents WHERE id = $1 UNION ALL SELECT file_key FROM "tenant_${SLUG}".document_files WHERE document_id = $1`,
      [docVelho],
    );
    chaves.push(...ks.map((k) => k.file_key as string));
    expect(chaves).toHaveLength(2);
    for (const k of chaves) expect(existsSync(join(STORAGE_DIR, `jdoc-${SLUG}`, k))).toBe(true);
    // Copia autenticada antes: o codigo deve responder "eliminado" depois.
    const copia = await request(app.getHttpServer()).get(`/t/${SLUG}/documents/${docVelho}/copia-autenticada`).set('Authorization', `Bearer ${admin}`).expect(200);
    codigoVerificacao = copia.headers['x-codigo-verificacao'] as string;

    const cand = await request(app.getHttpServer()).get(`${base}/candidatos`).set('Authorization', `Bearer ${gestor}`).expect(200);
    const ids = cand.body.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([docVelho, docEmprestado]));
    expect(ids).not.toContain(docRecente);

    elimId = (await post('', {}).expect(201)).body.id;
    await post(`/${elimId}/itens`, { ids: [docRecente] }).expect(400);
    await post(`/${elimId}/itens`, { ids: [docVelho] }).expect(201);
    const outra = (await post('', {}).expect(201)).body.id;
    await post(`/${outra}/itens`, { ids: [docVelho] }).expect(400);
    await post(`/${outra}/cancelar`, { motivo: 'Listagem duplicada de teste' }).expect(200);
  });

  it('(2) aprovacao exige CPAD e trava os itens', async () => {
    await post(`/${elimId}/aprovar`, { ataAprovacao: '7/2026', dataAprovacao: '2026-01-05', comissao: [M] }).expect(400);
    const ok = await post(`/${elimId}/aprovar`, { ataAprovacao: '7/2026', dataAprovacao: '2026-01-05', comissao: [M, M2] }).expect(200);
    expect(ok.body.status).toBe('aprovada');
    await post(`/${elimId}/itens`, { ids: [docEmprestado] }).expect(409);
    for (const pdf of ['listagem.pdf', 'edital.pdf']) {
      const r = await request(app.getHttpServer()).get(`${base}/${elimId}/${pdf}`).set('Authorization', `Bearer ${gestor}`).expect(200);
      expect(r.headers['content-type']).toContain('application/pdf');
    }
  });

  it('(3) conclusao bloqueada antes do prazo, com frase errada, por nao-admin e com item emprestado', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const pub = await post(`/${elimId}/edital`, { veiculoPublicacao: 'Diário Oficial do Município', dataPublicacaoEdital: hoje }).expect(200);
    const frase = `ELIMINAR ${String(pub.body.numero).padStart(3, '0')}/${pub.body.ano}`;
    const r1 = await post(`/${elimId}/concluir`, { confirmacao: frase }, admin).expect(400);
    expect(r1.body.message).toMatch(/Prazo do edital/);

    await sql.unsafe(`UPDATE "tenant_${SLUG}".eliminacoes SET data_publicacao_edital = current_date - 60 WHERE id = $1`, [elimId]);
    await post(`/${elimId}/concluir`, { confirmacao: 'ELIMINAR' }, admin).expect(400);
    await post(`/${elimId}/concluir`, { confirmacao: frase }, gestor).expect(403);

    // Segunda eliminacao com documento emprestado: conclusao recusada.
    const e2 = (await post('', {}).expect(201)).body;
    await post(`/${e2.id}/itens`, { ids: [docEmprestado] }).expect(201);
    await post(`/${e2.id}/aprovar`, { ataAprovacao: '8/2026', dataAprovacao: '2026-01-05', comissao: [M, M2] }).expect(200);
    await post(`/${e2.id}/edital`, { veiculoPublicacao: 'DOM', dataPublicacaoEdital: '2026-01-06' }).expect(200);
    await sql.unsafe(`UPDATE "tenant_${SLUG}".documents SET possui_original_fisico = true WHERE id = $1`, [docEmprestado]);
    await request(app.getHttpServer())
      .post(`/t/${SLUG}/arquivo-fisico/emprestimos`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ documentId: docEmprestado, solicitanteNome: 'Maria', solicitanteSetor: 'Controle Interno', prazoDevolucao: '2099-01-01' })
      .expect(201);
    const r2 = await post(`/${e2.id}/concluir`, { confirmacao: `ELIMINAR ${String(e2.numero).padStart(3, '0')}/${e2.ano}` }, admin).expect(409);
    expect(r2.body.message).toMatch(/emprestado/);
    const doc = await sql.unsafe(`SELECT fase, file_key FROM "tenant_${SLUG}".documents WHERE id = $1`, [docEmprestado]);
    expect(doc[0]).toMatchObject({ fase: 'corrente' });
    expect(doc[0]!.file_key).not.toBeNull();

    // (4) conclusao valida
    const fim = await post(`/${elimId}/concluir`, { confirmacao: frase }, admin).expect(200);
    expect(fim.body.status).toBe('concluida');
  });

  it('(4) arquivos apagados, registro preservado, documento imutavel, verificacao "eliminado"', async () => {
    for (const k of chaves) expect(existsSync(join(STORAGE_DIR, `jdoc-${SLUG}`, k))).toBe(false);
    const d = await sql.unsafe(
      `SELECT fase, status, file_key, file_hash, eliminacao_id FROM "tenant_${SLUG}".documents WHERE id = $1`,
      [docVelho],
    );
    expect(d[0]).toMatchObject({ fase: 'eliminado', status: 'eliminado', file_key: null, eliminacao_id: elimId });
    expect(d[0]!.file_hash).toMatch(/^[a-f0-9]{64}$/);
    const extras = await sql.unsafe(`SELECT 1 FROM "tenant_${SLUG}".document_files WHERE document_id = $1`, [docVelho]);
    expect(extras).toHaveLength(0);
    const textos = await sql.unsafe(`SELECT 1 FROM "tenant_${SLUG}".document_textos WHERE document_id = $1`, [docVelho]);
    expect(textos).toHaveLength(0);
    const item = await sql.unsafe(`SELECT arquivos FROM "tenant_${SLUG}".eliminacao_itens WHERE document_id = $1`, [docVelho]);
    const arquivos = item[0]!.arquivos as Array<{ hash: string; nome: string }>;
    expect(arquivos).toHaveLength(2);
    expect(arquivos.map((a) => a.hash)).toContain(d[0]!.file_hash);

    await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents/${docVelho}/file`)
      .set('Authorization', `Bearer ${admin}`)
      .attach('file', await gerarPdf('tentativa de reanexar'), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(400);
    await request(app.getHttpServer()).patch(`/t/${SLUG}/documents/${docVelho}`).set('Authorization', `Bearer ${admin}`).send({ credor: 'Outro' }).expect(400);

    const termo = await request(app.getHttpServer()).get(`${base}/${elimId}/termo.pdf`).set('Authorization', `Bearer ${gestor}`).expect(200);
    expect(termo.headers['content-type']).toContain('application/pdf');
    const pub = await request(app.getHttpServer()).get(`/public/verificar/${codigoVerificacao}`).expect(200);
    expect(pub.body.situacao).toBe('eliminado');
    // Documento em prazo intacto.
    const r = await sql.unsafe(`SELECT fase, file_key FROM "tenant_${SLUG}".documents WHERE id = $1`, [docRecente]);
    expect(r[0]!.fase).toBe('corrente');
    expect(r[0]!.file_key).not.toBeNull();
  });

  it('(5) guarda permanente nunca entra na listagem', async () => {
    const lei = await sql.unsafe(`SELECT id FROM "tenant_${SLUG}".classificacoes WHERE codigo = '100.1'`);
    const tipo = await sql.unsafe(`INSERT INTO "tenant_${SLUG}".document_types (nome, cor) VALUES ('Lei', 'blue') RETURNING id`);
    const doc = await request(app.getHttpServer())
      .post(`/t/${SLUG}/documents`)
      .set('Authorization', `Bearer ${admin}`)
      .field('module', 'outros')
      .field('exercicio', '2001')
      .field('documentTypeId', (tipo[0] as { id: string }).id)
      .field('descricao', 'Lei antiga')
      .field('documentDate', '2001-01-01')
      .field('classificacaoId', (lei[0] as { id: string }).id)
      .expect(201);
    const e = (await post('', {}).expect(201)).body.id;
    await post(`/${e}/itens`, { ids: [doc.body.id] }).expect(400);
  });
});
