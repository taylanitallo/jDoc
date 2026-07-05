import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { Sql } from 'postgres';
import * as argon2 from 'argon2';
import {
  type Orgao,
  type UnidadeOrcamentaria,
  type ProjetoAtividade,
  type DotacaoOrcamentaria,
  type ElementoDespesa,
  type OrdenadorDespesa,
  type TipoDocumento,
  type UsuarioTenant,
  type UsuarioCreate,
  type UsuarioUpdate,
  type TenantSettings,
  type TenantBranding,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { StorageService } from '../storage/storage.module';
import { requireTenantContext } from '../tenancy/tenant-context';

const BRASAO_URL_TTL_S = 3600;
const BRASAO_MAX_BYTES = 2 * 1024 * 1024;

/** Detecta PNG/JPEG pelos magic bytes (nao confia no Content-Type do multipart). */
function detectImageExt(buf: Buffer): 'png' | 'jpg' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  return null;
}

interface ListResult<T> {
  items: T[];
  total: number;
}

@Injectable()
export class ConfiguracoesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly storage: StorageService,
  ) {}

  // ===================== Guia 1: Orgaos =====================

  async listOrgaos(
    page: number,
    pageSize: number,
    descricao?: string,
    exercicio?: number,
  ): Promise<ListResult<Orgao>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;
    const texto = descricao ? `%${descricao}%` : null;

    const rows = await sql<
      Array<{ id: string; codigo: string; sigla: string | null; descricao: string; exercicio: number; importa: boolean; ativo: boolean }>
    >`
      SELECT id, codigo, sigla, descricao, exercicio, importa, ativo
      FROM orgaos
      WHERE deleted_at IS NULL
        AND (${texto}::text IS NULL OR descricao ILIKE ${texto})
        AND (${exercicio ?? null}::int IS NULL OR exercicio = ${exercicio ?? null})
      ORDER BY codigo ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM orgaos
      WHERE deleted_at IS NULL
        AND (${texto}::text IS NULL OR descricao ILIKE ${texto})
        AND (${exercicio ?? null}::int IS NULL OR exercicio = ${exercicio ?? null})
    `;

    return {
      items: rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        sigla: r.sigla,
        descricao: r.descricao,
        exercicio: r.exercicio,
        importa: r.importa,
        ativo: r.ativo,
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async createOrgao(data: Omit<Orgao, 'id'>, actorId: string, ip: string): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO orgaos (codigo, sigla, descricao, exercicio, importa, ativo)
      VALUES (${data.codigo}, ${data.sigla ?? null}, ${data.descricao}, ${data.exercicio}, ${data.importa}, ${data.ativo})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'orgao_created',
      resourceType: 'orgao',
      resourceId: id,
      ip,
      metadata: { codigo: data.codigo, exercicio: data.exercicio },
    });

    return { id };
  }

  async updateOrgao(
    id: string,
    data: Partial<Omit<Orgao, 'id'>>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.codigo !== undefined) { fields.push(`codigo = $${idx++}`); values.push(data.codigo); }
    if (data.sigla !== undefined) { fields.push(`sigla = $${idx++}`); values.push(data.sigla); }
    if (data.descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(data.descricao); }
    if (data.exercicio !== undefined) { fields.push(`exercicio = $${idx++}`); values.push(data.exercicio); }
    if (data.importa !== undefined) { fields.push(`importa = $${idx++}`); values.push(data.importa); }
    if (data.ativo !== undefined) { fields.push(`ativo = $${idx++}`); values.push(data.ativo); }

    if (fields.length === 0) return;

    values.push(id);
    await sql.unsafe(
      `UPDATE orgaos SET ${fields.join(', ')}, atualizado_em = now() WHERE id = $${idx}`,
      values,
    );

    await this.audit.logTenant({
      actorId,
      action: 'orgao_updated',
      resourceType: 'orgao',
      resourceId: id,
      ip,
      metadata: { fields_changed: Object.keys(data) },
    });
  }

  async deleteOrgao(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(`UPDATE orgaos SET deleted_at = now(), deleted_by = $1 WHERE id = $2`, [actorId, id]);

    await this.audit.logTenant({
      actorId,
      action: 'orgao_deleted',
      resourceType: 'orgao',
      resourceId: id,
      ip,
    });
  }

  // ===================== Guia 1: Unidades Orcamentarias =====================

  async listUnidadesByOrgao(orgaoId: string): Promise<UnidadeOrcamentaria[]> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string; orgao_id: string; codigo: string | null; nome: string; ativo: boolean }>>`
      SELECT id, orgao_id, codigo, nome, ativo
      FROM configuracoes_unidades
      WHERE orgao_id = ${orgaoId} AND deleted_at IS NULL
      ORDER BY nome ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      orgaoId: r.orgao_id,
      codigo: r.codigo,
      nome: r.nome,
      ativo: r.ativo,
    }));
  }

  async listUnidades(
    page: number,
    pageSize: number,
  ): Promise<ListResult<UnidadeOrcamentaria>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;

    const rows = await sql<Array<{ id: string; orgao_id: string; codigo: string | null; nome: string; ativo: boolean }>>`
      SELECT id, orgao_id, codigo, nome, ativo
      FROM configuracoes_unidades
      WHERE deleted_at IS NULL
      ORDER BY nome ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM configuracoes_unidades WHERE deleted_at IS NULL
    `;

    return {
      items: rows.map((r) => ({
        id: r.id,
        orgaoId: r.orgao_id,
        codigo: r.codigo,
        nome: r.nome,
        ativo: r.ativo,
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async createUnidade(
    data: Omit<UnidadeOrcamentaria, 'id'>,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO configuracoes_unidades (orgao_id, codigo, nome, ativo)
      VALUES (${data.orgaoId}, ${data.codigo}, ${data.nome}, ${data.ativo})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'unidade_created',
      resourceType: 'configuracoes_unidade',
      resourceId: id,
      ip,
      metadata: { nome: data.nome, orgaoId: data.orgaoId },
    });

    return { id };
  }

  async updateUnidade(
    id: string,
    data: Partial<Omit<UnidadeOrcamentaria, 'id'>>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.orgaoId !== undefined) { fields.push(`orgao_id = $${idx++}`); values.push(data.orgaoId); }
    if (data.codigo !== undefined) { fields.push(`codigo = $${idx++}`); values.push(data.codigo); }
    if (data.nome !== undefined) { fields.push(`nome = $${idx++}`); values.push(data.nome); }
    if (data.ativo !== undefined) { fields.push(`ativo = $${idx++}`); values.push(data.ativo); }

    if (fields.length === 0) return;

    values.push(id);
    await sql.unsafe(
      `UPDATE configuracoes_unidades SET ${fields.join(', ')}, atualizado_em = now() WHERE id = $${idx}`,
      values,
    );

    await this.audit.logTenant({
      actorId,
      action: 'unidade_updated',
      resourceType: 'configuracoes_unidade',
      resourceId: id,
      ip,
      metadata: { fields_changed: Object.keys(data) },
    });
  }

  async deleteUnidade(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(
      `UPDATE configuracoes_unidades SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [actorId, id],
    );

    await this.audit.logTenant({
      actorId,
      action: 'unidade_deleted',
      resourceType: 'configuracoes_unidade',
      resourceId: id,
      ip,
    });
  }

  // ===================== Guia 1c: Projeto/Atividade (catalogo por exercicio) =====================

  async listProjetos(
    page: number,
    pageSize: number,
    descricao?: string,
    exercicio?: number,
  ): Promise<ListResult<ProjetoAtividade>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;
    const texto = descricao ? `%${descricao}%` : null;

    const rows = await sql<
      Array<{ id: string; codigo: string; descricao: string; exercicio: number; ativo: boolean }>
    >`
      SELECT id, codigo, descricao, exercicio, ativo
      FROM projetos_atividades
      WHERE deleted_at IS NULL
        AND (${texto}::text IS NULL OR descricao ILIKE ${texto})
        AND (${exercicio ?? null}::int IS NULL OR exercicio = ${exercicio ?? null})
      ORDER BY codigo ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM projetos_atividades
      WHERE deleted_at IS NULL
        AND (${texto}::text IS NULL OR descricao ILIKE ${texto})
        AND (${exercicio ?? null}::int IS NULL OR exercicio = ${exercicio ?? null})
    `;

    return {
      items: rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        descricao: r.descricao,
        exercicio: r.exercicio,
        ativo: r.ativo,
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async createProjeto(
    data: Omit<ProjetoAtividade, 'id'>,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO projetos_atividades (codigo, descricao, exercicio, ativo)
      VALUES (${data.codigo}, ${data.descricao}, ${data.exercicio}, ${data.ativo})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'projeto_created',
      resourceType: 'projetos_atividades',
      resourceId: id,
      ip,
      metadata: { codigo: data.codigo, exercicio: data.exercicio },
    });

    return { id };
  }

  async updateProjeto(
    id: string,
    data: Partial<Omit<ProjetoAtividade, 'id'>>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.codigo !== undefined) { fields.push(`codigo = $${idx++}`); values.push(data.codigo); }
    if (data.descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(data.descricao); }
    if (data.exercicio !== undefined) { fields.push(`exercicio = $${idx++}`); values.push(data.exercicio); }
    if (data.ativo !== undefined) { fields.push(`ativo = $${idx++}`); values.push(data.ativo); }

    if (fields.length === 0) return;

    values.push(id);
    await sql.unsafe(
      `UPDATE projetos_atividades SET ${fields.join(', ')}, atualizado_em = now() WHERE id = $${idx}`,
      values,
    );

    await this.audit.logTenant({
      actorId,
      action: 'projeto_updated',
      resourceType: 'projetos_atividades',
      resourceId: id,
      ip,
    });
  }

  async deleteProjeto(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(
      `UPDATE projetos_atividades SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [actorId, id],
    );

    await this.audit.logTenant({
      actorId,
      action: 'projeto_deleted',
      resourceType: 'projetos_atividades',
      resourceId: id,
      ip,
    });
  }

  async listDotacoes(unidadeId: string): Promise<DotacaoOrcamentaria[]> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string; unidade_id: string; exercicio: number; valor: string; descricao: string | null }>>`
      SELECT id, unidade_id, exercicio, valor, descricao
      FROM dotacoes_orcamentarias
      WHERE unidade_id = ${unidadeId} AND deleted_at IS NULL
      ORDER BY exercicio DESC
    `;

    return rows.map((r) => ({
      id: r.id,
      unidadeId: r.unidade_id,
      exercicio: r.exercicio,
      valor: Number(r.valor),
      descricao: r.descricao,
    }));
  }

  async createDotacao(
    data: Omit<DotacaoOrcamentaria, 'id'>,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO dotacoes_orcamentarias (unidade_id, exercicio, valor, descricao)
      VALUES (${data.unidadeId}, ${data.exercicio}, ${data.valor}, ${data.descricao})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'dotacao_created',
      resourceType: 'dotacoes_orcamentarias',
      resourceId: id,
      ip,
      metadata: { exercicio: data.exercicio },
    });

    return { id };
  }

  async updateDotacao(
    id: string,
    data: Partial<Omit<DotacaoOrcamentaria, 'id' | 'unidadeId'>>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.exercicio !== undefined) { fields.push(`exercicio = $${idx++}`); values.push(data.exercicio); }
    if (data.valor !== undefined) { fields.push(`valor = $${idx++}`); values.push(data.valor); }
    if (data.descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(data.descricao); }

    if (fields.length === 0) return;

    values.push(id);
    await sql.unsafe(
      `UPDATE dotacoes_orcamentarias SET ${fields.join(', ')}, atualizado_em = now() WHERE id = $${idx}`,
      values,
    );

    await this.audit.logTenant({
      actorId,
      action: 'dotacao_updated',
      resourceType: 'dotacoes_orcamentarias',
      resourceId: id,
      ip,
    });
  }

  async deleteDotacao(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(
      `UPDATE dotacoes_orcamentarias SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [actorId, id],
    );

    await this.audit.logTenant({
      actorId,
      action: 'dotacao_deleted',
      resourceType: 'dotacoes_orcamentarias',
      resourceId: id,
      ip,
    });
  }

  async listElementos(
    page: number,
    pageSize: number,
    descricao?: string,
    exercicio?: number,
  ): Promise<ListResult<ElementoDespesa>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;
    const texto = descricao ? `%${descricao}%` : null;

    const rows = await sql<
      Array<{ id: string; codigo: string; nome: string; descricao: string | null; exercicio: number; ativo: boolean }>
    >`
      SELECT id, codigo, nome, descricao, exercicio, ativo
      FROM elementos_despesa
      WHERE deleted_at IS NULL
        AND (${texto}::text IS NULL OR nome ILIKE ${texto} OR descricao ILIKE ${texto})
        AND (${exercicio ?? null}::int IS NULL OR exercicio = ${exercicio ?? null})
      ORDER BY codigo ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM elementos_despesa
      WHERE deleted_at IS NULL
        AND (${texto}::text IS NULL OR nome ILIKE ${texto} OR descricao ILIKE ${texto})
        AND (${exercicio ?? null}::int IS NULL OR exercicio = ${exercicio ?? null})
    `;

    return {
      items: rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nome: r.nome,
        descricao: r.descricao,
        exercicio: r.exercicio,
        ativo: r.ativo,
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async createElemento(
    data: Omit<ElementoDespesa, 'id'>,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO elementos_despesa (codigo, nome, descricao, exercicio, ativo)
      VALUES (${data.codigo}, ${data.nome}, ${data.descricao}, ${data.exercicio}, ${data.ativo})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'elemento_created',
      resourceType: 'elementos_despesa',
      resourceId: id,
      ip,
      metadata: { codigo: data.codigo, exercicio: data.exercicio },
    });

    return { id };
  }

  async updateElemento(
    id: string,
    data: Partial<Omit<ElementoDespesa, 'id'>>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.codigo !== undefined) { fields.push(`codigo = $${idx++}`); values.push(data.codigo); }
    if (data.nome !== undefined) { fields.push(`nome = $${idx++}`); values.push(data.nome); }
    if (data.descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(data.descricao); }
    if (data.exercicio !== undefined) { fields.push(`exercicio = $${idx++}`); values.push(data.exercicio); }
    if (data.ativo !== undefined) { fields.push(`ativo = $${idx++}`); values.push(data.ativo); }

    if (fields.length === 0) return;

    values.push(id);
    await sql.unsafe(
      `UPDATE elementos_despesa SET ${fields.join(', ')}, atualizado_em = now() WHERE id = $${idx}`,
      values,
    );

    await this.audit.logTenant({
      actorId,
      action: 'elemento_updated',
      resourceType: 'elementos_despesa',
      resourceId: id,
      ip,
    });
  }

  async deleteElemento(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(
      `UPDATE elementos_despesa SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [actorId, id],
    );

    await this.audit.logTenant({
      actorId,
      action: 'elemento_deleted',
      resourceType: 'elementos_despesa',
      resourceId: id,
      ip,
    });
  }

  async listOrdenadores(unidadeId: string): Promise<OrdenadorDespesa[]> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string; unidade_id: string; nome: string; cpf_mascarado: string | null; cargo: string; vigencia_inicio: Date; vigencia_fim: Date | null; ativo: boolean }>>`
      SELECT id, unidade_id, nome, cpf_mascarado, cargo, vigencia_inicio, vigencia_fim, ativo
      FROM ordenadores_despesa
      WHERE unidade_id = ${unidadeId} AND deleted_at IS NULL
      ORDER BY nome ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      unidadeId: r.unidade_id,
      nome: r.nome,
      cpfMascarado: r.cpf_mascarado,
      cargo: r.cargo,
      vigenciaInicio: r.vigencia_inicio instanceof Date ? r.vigencia_inicio.toISOString().slice(0, 10) : String(r.vigencia_inicio),
      vigenciaFim: r.vigencia_fim ? (r.vigencia_fim instanceof Date ? r.vigencia_fim.toISOString().slice(0, 10) : String(r.vigencia_fim)) : null,
      ativo: r.ativo,
    }));
  }

  async createOrdenador(
    data: Omit<OrdenadorDespesa, 'id'>,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO ordenadores_despesa (unidade_id, nome, cpf_mascarado, cargo, vigencia_inicio, vigencia_fim, ativo)
      VALUES (${data.unidadeId}, ${data.nome}, ${data.cpfMascarado}, ${data.cargo}, ${data.vigenciaInicio}, ${data.vigenciaFim}, ${data.ativo})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'ordenador_created',
      resourceType: 'ordenadores_despesa',
      resourceId: id,
      ip,
      metadata: { nome: data.nome },
    });

    return { id };
  }

  async updateOrdenador(
    id: string,
    data: Partial<Omit<OrdenadorDespesa, 'id' | 'unidadeId'>>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.nome !== undefined) { fields.push(`nome = $${idx++}`); values.push(data.nome); }
    if (data.cpfMascarado !== undefined) { fields.push(`cpf_mascarado = $${idx++}`); values.push(data.cpfMascarado); }
    if (data.cargo !== undefined) { fields.push(`cargo = $${idx++}`); values.push(data.cargo); }
    if (data.vigenciaInicio !== undefined) { fields.push(`vigencia_inicio = $${idx++}`); values.push(data.vigenciaInicio); }
    if (data.vigenciaFim !== undefined) { fields.push(`vigencia_fim = $${idx++}`); values.push(data.vigenciaFim); }
    if (data.ativo !== undefined) { fields.push(`ativo = $${idx++}`); values.push(data.ativo); }

    if (fields.length === 0) return;

    values.push(id);
    await sql.unsafe(
      `UPDATE ordenadores_despesa SET ${fields.join(', ')}, atualizado_em = now() WHERE id = $${idx}`,
      values,
    );

    await this.audit.logTenant({
      actorId,
      action: 'ordenador_updated',
      resourceType: 'ordenadores_despesa',
      resourceId: id,
      ip,
    });
  }

  async deleteOrdenador(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(
      `UPDATE ordenadores_despesa SET deleted_at = now(), deleted_by = $1 WHERE id = $2`,
      [actorId, id],
    );

    await this.audit.logTenant({
      actorId,
      action: 'ordenador_deleted',
      resourceType: 'ordenadores_despesa',
      resourceId: id,
      ip,
    });
  }

  // ===================== Guia 2: Tipos de Documento =====================

  async listTiposDocumento(
    page: number,
    pageSize: number,
  ): Promise<ListResult<TipoDocumento>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;

    const rows = await sql<Array<{ id: string; nome: string; descricao: string | null; cor: string; ativo: boolean }>>`
      SELECT id, nome, descricao, cor, ativo
      FROM document_types
      WHERE ativo = true
      ORDER BY nome ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM document_types WHERE ativo = true
    `;

    return {
      items: rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        descricao: r.descricao,
        cor: r.cor,
        ativo: r.ativo,
      })),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async createTipoDocumento(
    data: Omit<TipoDocumento, 'id'>,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO document_types (nome, descricao, cor, ativo)
      VALUES (${data.nome}, ${data.descricao}, ${data.cor}, ${data.ativo ?? true})
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'tipo_documento_created',
      resourceType: 'document_type',
      resourceId: id,
      ip,
      metadata: { nome: data.nome },
    });

    return { id };
  }

  async updateTipoDocumento(
    id: string,
    data: Partial<Omit<TipoDocumento, 'id'>>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.nome !== undefined) { fields.push(`nome = $${idx++}`); values.push(data.nome); }
    if (data.descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(data.descricao); }
    if (data.cor !== undefined) { fields.push(`cor = $${idx++}`); values.push(data.cor); }
    if (data.ativo !== undefined) { fields.push(`ativo = $${idx++}`); values.push(data.ativo); }

    if (fields.length === 0) return;

    values.push(id);
    await sql.unsafe(
      `UPDATE document_types SET ${fields.join(', ')} WHERE id = $${idx}`,
      values,
    );

    await this.audit.logTenant({
      actorId,
      action: 'tipo_documento_updated',
      resourceType: 'document_type',
      resourceId: id,
      ip,
    });
  }

  async deleteTipoDocumento(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    // Soft delete: marca como inativo
    await sql.unsafe(`UPDATE document_types SET ativo = false WHERE id = $1`, [id]);

    await this.audit.logTenant({
      actorId,
      action: 'tipo_documento_deleted',
      resourceType: 'document_type',
      resourceId: id,
      ip,
    });
  }

  // ===================== Guia 3: Usuarios e Permissoes =====================

  async listUsuarios(
    page: number,
    pageSize: number,
  ): Promise<ListResult<UsuarioTenant>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;

    const rows = await sql<Array<{ id: string; email: string; nome: string; role: string; ativo: boolean; ultimo_acesso: Date | null; criado_em: Date }>>`
      SELECT id, email, nome, role, ativo, ultimo_acesso, criado_em
      FROM users
      ORDER BY nome ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM users
    `;

    const items: UsuarioTenant[] = [];
    for (const r of rows) {
      const perms = await sql<Array<{ permission_key: string }>>`
        SELECT permission_key FROM user_permissions WHERE user_id = ${r.id}
      `;
      items.push({
        id: r.id,
        email: r.email,
        nome: r.nome,
        role: r.role as 'admin' | 'operador' | 'consulta',
        ativo: r.ativo,
        ultimoAcesso: r.ultimo_acesso?.toISOString() ?? null,
        criadoEm: r.criado_em.toISOString(),
        permissions: perms.map((p) => p.permission_key),
        unidadesIds: [],
      });
    }

    return {
      items,
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async createUsuario(
    data: UsuarioCreate,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const senhaHash = await argon2.hash(data.senha, { type: argon2.argon2id });

    const rows = await sql<Array<{ id: string }>>`
      INSERT INTO users (email, nome, senha_hash, role, ativo, must_change_password)
      VALUES (${data.email}, ${data.nome}, ${senhaHash}, ${data.role}, true, true)
      RETURNING id
    `;
    const id = rows[0]?.id ?? '';

    for (const p of data.permissions) {
      await sql.unsafe(
        `INSERT INTO user_permissions (user_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, p],
      );
    }

    await this.audit.logTenant({
      actorId,
      action: 'usuario_created',
      resourceType: 'user',
      resourceId: id,
      ip,
      metadata: { email: data.email, role: data.role },
    });

    return { id };
  }

  async updateUsuario(
    id: string,
    data: UsuarioUpdate,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(
      `UPDATE users SET nome = $1, role = $2, ativo = $3 WHERE id = $4`,
      [data.nome, data.role, data.ativo, id],
    );

    // Replace permissions: simple approach
    await sql.unsafe(`DELETE FROM user_permissions WHERE user_id = $1`, [id]);
    for (const p of data.permissions) {
      await sql.unsafe(
        `INSERT INTO user_permissions (user_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, p],
      );
    }

    await this.audit.logTenant({
      actorId,
      action: 'usuario_updated',
      resourceType: 'user',
      resourceId: id,
      ip,
      metadata: { changes: data },
    });
  }

  async deleteUsuario(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(`DELETE FROM users WHERE id = $1`, [id]);

    // Revogar todas as sessoes do usuario
    await this.refreshTokens.revokeAllForUser('tenant', id);

    await this.audit.logTenant({
      actorId,
      action: 'usuario_deleted',
      resourceType: 'user',
      resourceId: id,
      ip,
    });
  }

  async toggleUsuarioAtivo(
    id: string,
    ativo: boolean,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    await sql.unsafe(`UPDATE users SET ativo = $1 WHERE id = $2`, [ativo, id]);

    if (!ativo) {
      // Revogar todas as sessoes se desativando
      await this.refreshTokens.revokeAllForUser('tenant', id);
    }

    await this.audit.logTenant({
      actorId,
      action: ativo ? 'usuario_activated' : 'usuario_deactivated',
      resourceType: 'user',
      resourceId: id,
      ip,
    });
  }

  async resetSenhaUsuario(
    userId: string,
    novaSenha: string,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const senhaHash = await argon2.hash(novaSenha, { type: argon2.argon2id });

    await sql.unsafe(
      `UPDATE users SET senha_hash = $1, must_change_password = true WHERE id = $2`,
      [senhaHash, userId],
    );

    // Revoga TODAS as sessoes do usuario (familia + set)
    await this.refreshTokens.revokeAllForUser('tenant', userId);

    await this.audit.logTenant({
      actorId,
      action: 'usuario_senha_reset',
      resourceType: 'user',
      resourceId: userId,
      ip,
    });
  }

  // ===================== Guia 4: Layout / Customizacao =====================

  async getSettings(): Promise<TenantSettings> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ chave: string; valor: string | unknown }>>`
      SELECT chave, valor FROM tenant_settings
      WHERE chave IN ('brasaoKey', 'nomeExibido', 'corDestaque', 'textoRodape')
    `;

    const settings: TenantSettings = {
      brasaoKey: null,
      nomeExibido: null,
      corDestaque: null,
      textoRodape: null,
    };

    for (const row of rows) {
      const val = typeof row.valor === 'string' ? JSON.parse(row.valor) : row.valor;
      if (val !== null && val !== undefined) {
        (settings as Record<string, unknown>)[row.chave] = val;
      }
    }

    return settings;
  }

  async saveSettings(
    data: Partial<TenantSettings>,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const entries: Array<[string, unknown]> = [];
    if (data.brasaoKey !== undefined) entries.push(['brasaoKey', data.brasaoKey]);
    if (data.nomeExibido !== undefined) entries.push(['nomeExibido', data.nomeExibido]);
    if (data.corDestaque !== undefined) entries.push(['corDestaque', data.corDestaque]);
    if (data.textoRodape !== undefined) entries.push(['textoRodape', data.textoRodape]);

    for (const [chave, valor] of entries) {
      await sql.unsafe(
        `INSERT INTO tenant_settings (chave, valor) VALUES ($1, $2)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
        [chave, JSON.stringify(valor)],
      );
    }

    await this.audit.logTenant({
      actorId,
      action: 'layout_updated',
      resourceType: 'tenant_settings',
      resourceId: 'settings',
      ip,
      metadata: { changed_keys: entries.map(([k]) => k) },
    });
  }

  private async getSettingRaw(sql: Sql, chave: string): Promise<unknown> {
    const rows = await sql<Array<{ valor: string | unknown }>>`
      SELECT valor FROM tenant_settings WHERE chave = ${chave} LIMIT 1
    `;
    if (rows.length === 0) return null;
    const val = rows[0]!.valor;
    return typeof val === 'string' ? JSON.parse(val) : val;
  }

  /** Identidade visual do tenant — acessivel a qualquer usuario autenticado (sidebar/relatorios). */
  async getBranding(): Promise<TenantBranding> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const rows = await sql<Array<{ chave: string; valor: string | unknown }>>`
      SELECT chave, valor FROM tenant_settings WHERE chave IN ('brasaoKey', 'nomeExibido', 'corDestaque')
    `;

    let brasaoKey: string | null = null;
    let nomeExibido: string | null = null;
    let corDestaque: string | null = null;
    for (const row of rows) {
      const val = typeof row.valor === 'string' ? JSON.parse(row.valor) : row.valor;
      if (row.chave === 'brasaoKey') brasaoKey = val;
      if (row.chave === 'nomeExibido') nomeExibido = val;
      if (row.chave === 'corDestaque') corDestaque = val;
    }

    const brasaoUrl =
      brasaoKey ? await this.storage.createSignedUrl(ctx.slug, brasaoKey, BRASAO_URL_TTL_S) : null;

    return { nomeExibido, corDestaque, brasaoUrl };
  }

  /** Substitui o brasao do tenant (upload de PNG/JPEG, valida pelos magic bytes). */
  async uploadBrasao(
    file: { buffer: Buffer; size: number },
    actorId: string,
    ip: string,
  ): Promise<{ brasaoUrl: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    if (file.size > BRASAO_MAX_BYTES) {
      throw new PayloadTooLargeException('Imagem do brasão excede 2MB');
    }
    const ext = detectImageExt(file.buffer);
    if (!ext) {
      throw new BadRequestException('Envie uma imagem PNG ou JPEG');
    }

    const prevKey = (await this.getSettingRaw(sql, 'brasaoKey')) as string | null;

    const key = `${randomUUID()}.${ext}`;
    await this.storage.upload(ctx.slug, key, file.buffer);

    await sql.unsafe(
      `INSERT INTO tenant_settings (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      ['brasaoKey', JSON.stringify(key)],
    );

    if (prevKey) {
      await this.storage.delete(ctx.slug, prevKey).catch(() => undefined);
    }

    await this.audit.logTenant({
      actorId,
      action: 'brasao_updated',
      resourceType: 'tenant_settings',
      resourceId: 'brasaoKey',
      ip,
      metadata: { key },
    });

    const brasaoUrl = await this.storage.createSignedUrl(ctx.slug, key, BRASAO_URL_TTL_S);
    return { brasaoUrl };
  }

  async deleteBrasao(actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    const key = (await this.getSettingRaw(sql, 'brasaoKey')) as string | null;
    if (key) {
      await this.storage.delete(ctx.slug, key).catch(() => undefined);
    }
    await sql`DELETE FROM tenant_settings WHERE chave = 'brasaoKey'`;

    await this.audit.logTenant({
      actorId,
      action: 'brasao_removed',
      resourceType: 'tenant_settings',
      resourceId: 'brasaoKey',
      ip,
    });
  }
}
