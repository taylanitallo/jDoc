import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
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
  type PerfilOrgaoResumo,
  type UsuarioCreate,
  type UsuarioUpdate,
  type TenantSettings,
  type TenantBranding,
  type SegurancaOrgao,
  type SegurancaOrgaoInput,
  MODELOS_TIPO_ACERVO,
  camposMetadadosSchema,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.module';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { StorageService, detectImageExt } from '../storage/storage.module';
import { requireTenantContext } from '../tenancy/tenant-context';
import { aplicarPerfilAoUsuario, garantirPerfis } from '../perfis/perfis-orgao';
import { CHAVE_MFA_OBRIGATORIO } from '../auth/auth.service';

/** Codigos de secretaria sem repeticao e sem espaco (vazio = enxerga todas). */
function normalizarLotacao(codigos: string[] | undefined): string[] {
  return [...new Set((codigos ?? []).map((c) => c.trim()).filter(Boolean))];
}

const BRASAO_URL_TTL_S = 3600;
const BRASAO_MAX_BYTES = 2 * 1024 * 1024;

interface ListResult<T> {
  items: T[];
  total: number;
}

interface TipoDocumentoRow {
  id: string;
  nome: string;
  descricao: string | null;
  cor: string;
  ativo: boolean;
  modulo: 'outros' | 'acervo';
  campos: unknown;
  classificacao_id: string | null;
  nivel_acesso_padrao: 'publico' | 'restrito';
}

function toTipoDocumento(r: TipoDocumentoRow): TipoDocumento {
  const campos = typeof r.campos === 'string' ? (JSON.parse(r.campos) as unknown) : r.campos;
  return {
    id: r.id,
    nome: r.nome,
    descricao: r.descricao,
    cor: r.cor,
    ativo: r.ativo,
    modulo: r.modulo,
    campos: camposMetadadosSchema.catch([]).parse(campos),
    classificacaoId: r.classificacao_id,
    nivelAcessoPadrao: r.nivel_acesso_padrao,
  };
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
    const values: Array<string | number | boolean | null> = [];
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
    const values: Array<string | number | boolean | null> = [];
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
    const values: Array<string | number | boolean | null> = [];
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
    const values: Array<string | number | boolean | null> = [];
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
    const values: Array<string | number | boolean | null> = [];
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
    const values: Array<string | number | boolean | null> = [];
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
    modulo?: 'outros' | 'acervo',
  ): Promise<ListResult<TipoDocumento>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;

    const rows = await sql<TipoDocumentoRow[]>`
      SELECT id, nome, descricao, cor, ativo, modulo, campos, classificacao_id, nivel_acesso_padrao
      FROM document_types
      WHERE ativo = true AND (${modulo ?? null}::varchar IS NULL OR modulo = ${modulo ?? null})
      ORDER BY nome ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const totalRows = await sql<Array<{ total: string }>>`
      SELECT COUNT(*)::bigint AS total FROM document_types
      WHERE ativo = true AND (${modulo ?? null}::varchar IS NULL OR modulo = ${modulo ?? null})
    `;

    return {
      items: rows.map(toTipoDocumento),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  /** Nome de tipo repetido no mesmo modulo = 409 com mensagem (antes vazava como 500). */
  private async tipoUnico<T>(q: () => Promise<T>): Promise<T> {
    try {
      return await q();
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException('Ja existe um tipo de documento com esse nome neste modulo');
      }
      throw e;
    }
  }

  /** Classe padrao do tipo precisa existir e ter temporalidade (nao pode ser agrupadora). */
  private async assertClasseDoTipo(sql: Sql, classificacaoId: string | null | undefined): Promise<void> {
    if (!classificacaoId) return;
    const rows = await sql<Array<{ ok: boolean }>>`
      SELECT (ativo AND prazo_corrente_anos IS NOT NULL AND prazo_intermediario_anos IS NOT NULL
              AND destinacao IS NOT NULL) AS ok
      FROM classificacoes WHERE id = ${classificacaoId}
    `;
    if (!rows[0]?.ok) {
      throw new BadRequestException('Classe padrao invalida: escolha uma classe ativa com temporalidade definida');
    }
  }

  async createTipoDocumento(
    data: Omit<TipoDocumento, 'id'>,
    actorId: string,
    ip: string,
  ): Promise<{ id: string }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    await this.assertClasseDoTipo(sql, data.classificacaoId);

    const rows = await this.tipoUnico(() => sql<Array<{ id: string }>>`
      INSERT INTO document_types (nome, descricao, cor, ativo, modulo, campos, classificacao_id, nivel_acesso_padrao)
      VALUES (${data.nome}, ${data.descricao}, ${data.cor}, ${data.ativo ?? true}, ${data.modulo ?? 'outros'},
              ${sql.json((data.campos ?? []) as never)}, ${data.classificacaoId ?? null},
              ${data.nivelAcessoPadrao ?? 'restrito'})
      RETURNING id
    `);
    const id = rows[0]?.id ?? '';

    await this.audit.logTenant({
      actorId,
      action: 'tipo_documento_created',
      resourceType: 'document_type',
      resourceId: id,
      ip,
      metadata: { nome: data.nome, modulo: data.modulo ?? 'outros' },
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
    const atual = await sql<TipoDocumentoRow[]>`
      SELECT id, nome, descricao, cor, ativo, modulo, campos, classificacao_id, nivel_acesso_padrao
      FROM document_types WHERE id = ${id}
    `;
    const row = atual[0];
    if (!row) throw new BadRequestException('Tipo de documento nao encontrado');
    if (data.classificacaoId !== undefined) await this.assertClasseDoTipo(sql, data.classificacaoId);
    // Tipo com documentos nao muda de modulo: os documentos ficariam orfaos na outra tela.
    if (data.modulo !== undefined && data.modulo !== row.modulo) {
      const uso = await sql`SELECT 1 FROM documents WHERE document_type_id = ${id} LIMIT 1`;
      if (uso.length > 0) throw new BadRequestException('Tipo ja possui documentos: nao pode trocar de modulo');
    }
    const t = toTipoDocumento(row);

    await this.tipoUnico(() => sql`
      UPDATE document_types SET
        nome = ${data.nome ?? t.nome},
        descricao = ${data.descricao === undefined ? t.descricao : data.descricao},
        cor = ${data.cor ?? t.cor},
        ativo = ${data.ativo ?? t.ativo},
        modulo = ${data.modulo ?? t.modulo},
        campos = ${sql.json((data.campos ?? t.campos) as never)},
        classificacao_id = ${data.classificacaoId === undefined ? t.classificacaoId : data.classificacaoId},
        nivel_acesso_padrao = ${data.nivelAcessoPadrao ?? t.nivelAcessoPadrao}
      WHERE id = ${id}
    `);

    // Campos alterados nao reescrevem metadados antigos: valores de chaves removidas
    // ficam guardados no documento (historico), so deixam de aparecer no formulario.
    await this.audit.logTenant({
      actorId,
      action: 'tipo_documento_updated',
      resourceType: 'document_type',
      resourceId: id,
      ip,
      metadata: { antes: t, depois: data as Record<string, unknown> },
    });
  }

  /**
   * Cria os tipos documentais prontos do Acervo (Lei, Decreto, Portaria,
   * Contrato, Licitacao, Ficha Funcional) que ainda nao existem pelo nome,
   * ligando cada um a classe do Plano de Classificacao pelo codigo, se houver.
   */
  async criarModelosAcervo(actorId: string, ip: string): Promise<{ criados: number }> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const existentes = await sql<Array<{ nome: string }>>`
      SELECT lower(nome) AS nome FROM document_types WHERE modulo = 'acervo'
    `;
    const nomes = new Set(existentes.map((e) => e.nome));
    const classes = await sql<Array<{ id: string; codigo: string }>>`
      SELECT id, codigo FROM classificacoes
      WHERE ativo AND prazo_corrente_anos IS NOT NULL AND prazo_intermediario_anos IS NOT NULL AND destinacao IS NOT NULL
    `;
    const porCodigo = new Map(classes.map((c) => [c.codigo, c.id]));
    let criados = 0;
    for (const m of MODELOS_TIPO_ACERVO) {
      if (nomes.has(m.nome.toLowerCase())) continue;
      await sql`
        INSERT INTO document_types (nome, descricao, cor, ativo, modulo, campos, classificacao_id, nivel_acesso_padrao)
        VALUES (${m.nome}, ${m.descricao}, 'blue', true, 'acervo', ${sql.json(m.campos as never)},
                ${m.classificacaoCodigo ? (porCodigo.get(m.classificacaoCodigo) ?? null) : null}, ${m.nivelAcessoPadrao})
      `;
      criados++;
    }
    await this.audit.logTenant({
      actorId,
      action: 'tipo_documento_modelos_acervo',
      resourceType: 'document_type',
      ip,
      metadata: { criados },
    });
    return { criados };
  }

  async deleteTipoDocumento(id: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);

    // Exclusao definitiva (para corrigir tipo criado errado). Bloqueada se houver
    // qualquer documento com o tipo — inclusive na lixeira — para nao perder a
    // referencia (a FK tambem impediria). Documentos vinculados: inative o tipo.
    const tipo = await sql<Array<{ nome: string }>>`SELECT nome FROM document_types WHERE id = ${id}`;
    if (!tipo[0]) throw new NotFoundException('Tipo de documento nao encontrado');
    const [uso] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM documents WHERE document_type_id = ${id}
    `;
    if ((uso?.n ?? 0) > 0) {
      throw new ConflictException(
        `Não é possível excluir "${tipo[0].nome}": há ${uso!.n} documento(s) vinculado(s) a este tipo (inclusive na lixeira).`,
      );
    }
    await sql`DELETE FROM document_types WHERE id = ${id}`;

    await this.audit.logTenant({
      actorId,
      action: 'tipo_documento_deleted',
      resourceType: 'document_type',
      resourceId: id,
      ip,
    });
  }

  // ===================== Guia 3: Usuarios e Permissoes =====================

  /** Perfis do orgao (definidos pela equipe JEOS) para escolher no cadastro de usuario. */
  async listPerfis(): Promise<PerfilOrgaoResumo[]> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    await garantirPerfis(sql, this.db.catalog());
    return sql<PerfilOrgaoResumo[]>`
      SELECT id, nome, descricao, papel, permissoes FROM perfis ORDER BY sistema DESC, nome
    `;
  }

  async listUsuarios(
    page: number,
    pageSize: number,
  ): Promise<ListResult<UsuarioTenant>> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const offset = (page - 1) * pageSize;

    await garantirPerfis(sql, this.db.catalog());
    const rows = await sql<
      Array<{
        id: string;
        email: string;
        nome: string;
        role: string;
        ativo: boolean;
        ultimo_acesso: Date | null;
        criado_em: Date;
        cpf: string | null;
        perfil_id: string | null;
        perfil_nome: string | null;
        orgaos_codigos: string[] | null;
        totp_enabled: boolean;
      }>
    >`
      SELECT u.id, u.email, u.nome, u.role, u.ativo, u.ultimo_acesso, u.criado_em, u.cpf, u.perfil_id, p.nome AS perfil_nome,
             u.orgaos_codigos, u.totp_enabled
      FROM users u LEFT JOIN perfis p ON p.id = u.perfil_id
      ORDER BY u.nome ASC
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
        orgaosCodigos: r.orgaos_codigos ?? [],
        mfaEnabled: r.totp_enabled,
        cpf: r.cpf,
        perfilId: r.perfil_id,
        perfilNome: r.perfil_nome,
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

    if (data.cpf && (await sql`SELECT 1 FROM users WHERE cpf = ${data.cpf}`).length) {
      throw new ConflictException('CPF já cadastrado neste órgão');
    }
    const id = await sql.begin(async (tx) => {
      const rows = await tx<Array<{ id: string }>>`
        INSERT INTO users (email, nome, cpf, senha_hash, role, ativo, must_change_password, orgaos_codigos)
        VALUES (${data.email}, ${data.nome}, ${data.cpf ?? null}, ${senhaHash}, ${data.role}, true, true,
                ${normalizarLotacao(data.orgaosCodigos)}::varchar[])
        RETURNING id
      `;
      const novo = rows[0]?.id ?? '';
      // Com perfil, papel e permissoes vem dele; sem, ficam as marcadas na tela.
      if (data.perfilId) await aplicarPerfilAoUsuario(tx, novo, data.perfilId);
      else
        for (const p of data.permissions) {
          await tx`INSERT INTO user_permissions (user_id, permission_key) VALUES (${novo}, ${p}) ON CONFLICT DO NOTHING`;
        }
      return novo;
    });

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

    if (data.cpf && (await sql`SELECT 1 FROM users WHERE cpf = ${data.cpf} AND id <> ${id}`).length) {
      throw new ConflictException('CPF já cadastrado neste órgão');
    }
    await sql.begin(async (tx) => {
      await tx`
        UPDATE users SET nome = ${data.nome}, role = ${data.role}, ativo = ${data.ativo},
          orgaos_codigos = ${normalizarLotacao(data.orgaosCodigos)}::varchar[]
        WHERE id = ${id}
      `;
      if (data.cpf !== undefined) await tx`UPDATE users SET cpf = ${data.cpf} WHERE id = ${id}`;
      if (data.perfilId) {
        await aplicarPerfilAoUsuario(tx, id, data.perfilId);
      } else {
        // Permissoes marcadas uma a uma: o usuario sai do perfil ("Personalizado").
        await tx`UPDATE users SET perfil_id = NULL WHERE id = ${id}`;
        await tx`DELETE FROM user_permissions WHERE user_id = ${id}`;
        for (const p of data.permissions) {
          await tx`INSERT INTO user_permissions (user_id, permission_key) VALUES (${id}, ${p}) ON CONFLICT DO NOTHING`;
        }
      }
    });

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

    if (id === actorId) throw new BadRequestException('Você não pode excluir o próprio usuário');
    const [alvo] = await sql<Array<{ role: string; ativo: boolean }>>`SELECT role, ativo FROM users WHERE id = ${id}`;
    if (!alvo) throw new NotFoundException('Usuário não encontrado');
    if (alvo.role === 'admin' && alvo.ativo) {
      const [n] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND ativo AND id <> ${id}`;
      if ((n?.n ?? 0) === 0) throw new ConflictException('Não é possível excluir o único administrador ativo');
    }
    const [docs] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM documents WHERE created_by = ${id}`;
    if ((docs?.n ?? 0) > 0) throw new ConflictException('Este usuário já registrou documentos ou atos; para manter o histórico, desative-o em vez de excluir');
    try {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM user_permissions WHERE user_id = ${id}`;
        await tx`DELETE FROM users WHERE id = ${id}`;
      });
    } catch (e) {
      // Autoria de documentos/atos precisa continuar rastreavel.
      if ((e as { code?: string }).code === '23503') {
        throw new ConflictException('Este usuário já registrou documentos ou atos; para manter o histórico, desative-o em vez de excluir');
      }
      throw e;
    }

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

  /** Celular perdido: o admin desliga o 2FA do usuario, que configura de novo no proximo acesso. */
  async resetMfaUsuario(userId: string, actorId: string, ip: string): Promise<void> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const r = await sql`
      UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_secret_pending = NULL, atualizado_em = now()
      WHERE id = ${userId}
    `;
    if (r.count === 0) throw new NotFoundException('Usuário não encontrado');
    await this.refreshTokens.revokeAllForUser('tenant', userId);
    await this.audit.logTenant({ actorId, action: 'usuario_mfa_resetado', resourceType: 'user', resourceId: userId, ip });
  }

  // ===================== Seguranca do orgao =====================

  async getSeguranca(): Promise<SegurancaOrgao> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const [s] = await sql<Array<{ valor: unknown }>>`SELECT valor FROM tenant_settings WHERE chave = ${CHAVE_MFA_OBRIGATORIO}`;
    const [n] = await sql<Array<{ total: number; sem: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT totp_enabled)::int AS sem
      FROM users WHERE role = 'admin' AND ativo
    `;
    return { mfaObrigatorioAdmin: s?.valor === true || s?.valor === 'true', administradores: n?.total ?? 0, administradoresSemMfa: n?.sem ?? 0 };
  }

  async salvarSeguranca(data: SegurancaOrgaoInput, actorId: string, ip: string): Promise<SegurancaOrgao> {
    const ctx = requireTenantContext();
    const sql = this.db.tenant(ctx.schemaName);
    const antes = await this.getSeguranca();
    await sql.unsafe(
      `INSERT INTO tenant_settings (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
      [CHAVE_MFA_OBRIGATORIO, JSON.stringify(data.mfaObrigatorioAdmin)],
    );
    await this.audit.logTenant({
      actorId,
      action: 'seguranca_atualizada',
      resourceType: 'tenant_settings',
      resourceId: CHAVE_MFA_OBRIGATORIO,
      ip,
      metadata: { antes: antes.mfaObrigatorioAdmin, depois: data.mfaObrigatorioAdmin },
    });
    return this.getSeguranca();
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

    return { nomeExibido, nomeOrgao: ctx.nome ?? null, corDestaque, brasaoUrl, modulos: ctx.modulos };
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
