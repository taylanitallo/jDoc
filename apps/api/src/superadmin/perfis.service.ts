import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Sql } from 'postgres';
import {
  chaveDoNome,
  type ModeloPerfilInput,
  type ModeloPerfilView,
  type PerfilCreateInput,
  type PerfilPadrao,
  type PerfilUpdateInput,
  type PerfilView,
  type PreviaAplicarModelo,
  type TenantRole,
} from '@jdoc/shared';
import { DatabaseService } from '../database/database.service';
import { SuperadminTenantsService } from './superadmin-tenants.service';
import {
  aplicarPerfilAoUsuario,
  carregarModelos,
  garantirPerfis,
  sincronizarUsuariosDoPerfil,
  type Db,
} from '../perfis/perfis-orgao';

interface PerfilRow {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  papel: TenantRole;
  permissoes: string[];
  sistema: boolean;
  usuarios: number;
}

const mesmoConjunto = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
};

/**
 * Perfis do orgao (conjuntos nomeados de permissoes) e os modelos globais
 * (platform.role_templates) de onde saem os perfis do sistema.
 *
 * Usuario com perfil herda papel e permissoes: `user_permissions` e
 * reescrita sempre que o perfil muda, entao o login/refresh continuam lendo
 * a mesma tabela de sempre.
 */
@Injectable()
export class PerfisService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: SuperadminTenantsService,
  ) {}

  // ---------------- Modelos globais ----------------

  modelos(): Promise<ModeloPerfilView[]> {
    return carregarModelos(this.db.catalog());
  }

  private async modelo(chave: string): Promise<PerfilPadrao> {
    const m = (await this.modelos()).find((x) => x.chave === chave);
    if (!m) throw new NotFoundException('Modelo de perfil não encontrado');
    return m;
  }

  async salvarModelo(chave: string, input: ModeloPerfilInput, adminId: string): Promise<{ antes: PerfilPadrao; depois: PerfilPadrao }> {
    const antes = await this.modelo(chave);
    await this.db.catalog()`
      INSERT INTO platform.role_templates (key, name, description, permissions, updated_by, updated_at)
      VALUES (${chave}, ${input.nome}, ${input.descricao}, ${input.permissoes}, ${adminId}, now())
      ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
        permissions = EXCLUDED.permissions, updated_by = EXCLUDED.updated_by, updated_at = now()
    `;
    return { antes, depois: await this.modelo(chave) };
  }

  /** "Voltar ao padrao de fabrica". */
  async restaurarModelo(chave: string): Promise<void> {
    await this.modelo(chave);
    await this.db.catalog()`DELETE FROM platform.role_templates WHERE key = ${chave}`;
  }

  async previaAplicar(chave: string): Promise<PreviaAplicarModelo> {
    const m = await this.modelo(chave);
    const tenants = await this.db.catalog()<Array<{ id: string; nome: string; schema_name: string }>>`
      SELECT id, nome, schema_name FROM public.tenants ORDER BY nome
    `;
    const detalhes: PreviaAplicarModelo['detalhes'] = [];
    for (const t of tenants) {
      const sql = this.db.tenant(t.schema_name);
      await this.garantirPerfis(sql);
      const [p] = await sql<Array<{ nome: string; descricao: string | null; permissoes: string[]; usuarios: number }>>`
        SELECT p.nome, p.descricao, p.permissoes, (SELECT count(*)::int FROM users u WHERE u.perfil_id = p.id) AS usuarios
        FROM perfis p WHERE p.chave = ${chave} AND p.sistema
      `;
      const mudaria = !p || !mesmoConjunto(p.permissoes, m.permissoes) || p.nome !== m.nome;
      detalhes.push({ tenantId: t.id, orgao: t.nome, mudaria, usuarios: p?.usuarios ?? 0 });
    }
    return { orgaos: tenants.length, perfisQueMudam: detalhes.filter((d) => d.mudaria).length, detalhes };
  }

  /** "Aplicar a todos os orgaos": sobrescreve o perfil do sistema de mesma chave em cada orgao. */
  async aplicarModelo(chave: string): Promise<{ alterados: number }> {
    const m = await this.modelo(chave);
    const previa = await this.previaAplicar(chave);
    let alterados = 0;
    for (const d of previa.detalhes.filter((x) => x.mudaria)) {
      const t = await this.tenants.getById(d.tenantId);
      const sql = this.db.tenant(t.schema_name);
      await sql.begin(async (tx) => {
        const [p] = await tx<Array<{ id: string }>>`
          UPDATE perfis SET nome = ${m.nome}, descricao = ${m.descricao}, papel = ${m.papel}, permissoes = ${m.permissoes}, atualizado_em = now()
          WHERE chave = ${chave} AND sistema RETURNING id
        `;
        if (p) await this.sincronizarUsuarios(tx, p.id);
      });
      alterados++;
    }
    return { alterados };
  }

  // ---------------- Perfis do orgao ----------------

  garantirPerfis(sql: Sql): Promise<void> {
    return garantirPerfis(sql, this.db.catalog());
  }

  private async sqlDo(tenantId: string): Promise<Sql> {
    const t = await this.tenants.getById(tenantId);
    const sql = this.db.tenant(t.schema_name);
    await this.garantirPerfis(sql);
    return sql;
  }

  async listar(tenantId: string): Promise<PerfilView[]> {
    const sql = await this.sqlDo(tenantId);
    const modelos = new Map((await this.modelos()).map((m) => [m.chave, m]));
    const rows = await sql<PerfilRow[]>`
      SELECT p.id, p.chave, p.nome, p.descricao, p.papel, p.permissoes, p.sistema,
        (SELECT count(*)::int FROM users u WHERE u.perfil_id = p.id) AS usuarios
      FROM perfis p ORDER BY p.sistema DESC, p.nome
    `;
    return rows.map((r) => {
      const m = r.sistema ? modelos.get(r.chave) : undefined;
      return {
        ...r,
        alteradoDoPadrao: !!m && (!mesmoConjunto(m.permissoes, r.permissoes) || m.nome !== r.nome || m.papel !== r.papel),
      };
    });
  }

  private async perfil(sql: Sql, id: string): Promise<PerfilRow> {
    const [p] = await sql<PerfilRow[]>`
      SELECT p.id, p.chave, p.nome, p.descricao, p.papel, p.permissoes, p.sistema,
        (SELECT count(*)::int FROM users u WHERE u.perfil_id = p.id) AS usuarios
      FROM perfis p WHERE p.id = ${id}
    `;
    if (!p) throw new NotFoundException('Perfil não encontrado');
    return p;
  }

  async criar(tenantId: string, input: PerfilCreateInput): Promise<PerfilRow> {
    const sql = await this.sqlDo(tenantId);
    let permissoes = input.permissoes;
    if (input.copiarDe) permissoes = (await this.perfil(sql, input.copiarDe)).permissoes;
    const base = chaveDoNome(input.nome) || 'perfil';
    let chave = base;
    for (let i = 2; (await sql`SELECT 1 FROM perfis WHERE chave = ${chave}`).length > 0; i++) chave = `${base}_${i}`.slice(0, 40);
    const [p] = await sql<Array<{ id: string }>>`
      INSERT INTO perfis (chave, nome, descricao, papel, permissoes, sistema)
      VALUES (${chave}, ${input.nome}, ${input.descricao ?? null}, ${input.papel}, ${permissoes}, false)
      RETURNING id
    `;
    return this.perfil(sql, p!.id);
  }

  async atualizar(tenantId: string, id: string, input: PerfilUpdateInput): Promise<{ antes: PerfilRow; depois: PerfilRow }> {
    const sql = await this.sqlDo(tenantId);
    const antes = await this.perfil(sql, id);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE perfis SET
          nome = ${input.nome ?? antes.nome},
          descricao = ${input.descricao === undefined ? antes.descricao : input.descricao},
          papel = ${input.papel ?? antes.papel},
          permissoes = ${input.permissoes ?? antes.permissoes},
          atualizado_em = now()
        WHERE id = ${id}
      `;
      await this.sincronizarUsuarios(tx, id);
    });
    return { antes, depois: await this.perfil(sql, id) };
  }

  async excluir(tenantId: string, id: string): Promise<PerfilRow> {
    const sql = await this.sqlDo(tenantId);
    const p = await this.perfil(sql, id);
    if (p.sistema) throw new BadRequestException('Perfis do sistema não podem ser excluídos; restaure o padrão se precisar');
    if (p.usuarios > 0) throw new ConflictException(`${p.usuarios} usuário(s) usam este perfil; troque o perfil deles antes de excluir`);
    await sql`DELETE FROM perfis WHERE id = ${id}`;
    return p;
  }

  /** Volta o perfil do sistema ao modelo global atual. */
  async restaurar(tenantId: string, id: string): Promise<{ antes: PerfilRow; depois: PerfilRow }> {
    const sql = await this.sqlDo(tenantId);
    const antes = await this.perfil(sql, id);
    if (!antes.sistema) throw new BadRequestException('Só perfis do sistema têm padrão para restaurar');
    const m = await this.modelo(antes.chave);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE perfis SET nome = ${m.nome}, descricao = ${m.descricao}, papel = ${m.papel}, permissoes = ${m.permissoes}, atualizado_em = now()
        WHERE id = ${id}
      `;
      await this.sincronizarUsuarios(tx, id);
    });
    return { antes, depois: await this.perfil(sql, id) };
  }

  sincronizarUsuarios(tx: Db, perfilId: string): Promise<void> {
    return sincronizarUsuariosDoPerfil(tx, perfilId);
  }

  aplicarAoUsuario(tx: Db, userId: string, perfilId: string): Promise<void> {
    return aplicarPerfilAoUsuario(tx, userId, perfilId);
  }
}
