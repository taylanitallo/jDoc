import { BadRequestException } from '@nestjs/common';
import type { Sql, TransactionSql } from 'postgres';
import { perfisDeFabrica, type ModeloPerfilView, type TenantRole } from '@jdoc/shared';

/** Conexao do orgao ou transacao aberta nela. */
export type Db = Sql | TransactionSql;

/** Perfis padrao vigentes: fabrica do codigo + o que o superadmin mudou (platform.role_templates). */
export async function carregarModelos(catalogo: Sql): Promise<ModeloPerfilView[]> {
  const linhas = await catalogo<
    Array<{ key: string; name: string; description: string | null; permissions: string[]; updated_at: Date }>
  >`SELECT key, name, description, permissions, updated_at FROM platform.role_templates`;
  const porChave = new Map(linhas.map((l) => [l.key, l]));
  return perfisDeFabrica().map((f) => {
    const l = porChave.get(f.chave);
    return l
      ? {
          ...f,
          nome: l.name,
          descricao: l.description ?? f.descricao,
          permissoes: l.permissions,
          personalizado: true,
          atualizadoEm: l.updated_at.toISOString(),
        }
      : { ...f, personalizado: false, atualizadoEm: null };
  });
}

/**
 * Cria os perfis do sistema que faltarem (orgaos antigos) e associa os
 * administradores existentes ao perfil Administrador. Os demais usuarios
 * antigos ficam "Personalizado" (sem perfil), mantendo as permissoes que ja tinham.
 */
export async function garantirPerfis(sql: Sql, catalogo: Sql): Promise<void> {
  const [n] = await sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM perfis WHERE sistema`;
  const modelos = await carregarModelos(catalogo);
  if ((n?.n ?? 0) >= modelos.length) return;
  await sql.begin(async (tx) => {
    for (const m of modelos) {
      await tx`
        INSERT INTO perfis (chave, nome, descricao, papel, permissoes, sistema)
        VALUES (${m.chave}, ${m.nome}, ${m.descricao}, ${m.papel}, ${m.permissoes}, true)
        ON CONFLICT (chave) DO NOTHING
      `;
    }
    await tx`
      UPDATE users SET perfil_id = (SELECT id FROM perfis WHERE chave = 'administrador')
      WHERE role = 'admin' AND perfil_id IS NULL
    `;
  });
}

/** Reescreve papel e permissoes de quem usa o perfil. */
export async function sincronizarUsuariosDoPerfil(tx: Db, perfilId: string): Promise<void> {
  await tx`UPDATE users u SET role = p.papel, atualizado_em = now() FROM perfis p WHERE p.id = ${perfilId} AND u.perfil_id = p.id`;
  await tx`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE perfil_id = ${perfilId})`;
  await tx`
    INSERT INTO user_permissions (user_id, permission_key)
    SELECT u.id, unnest(p.permissoes) FROM users u JOIN perfis p ON p.id = u.perfil_id WHERE p.id = ${perfilId}
    ON CONFLICT DO NOTHING
  `;
}

/** Coloca um usuario num perfil (papel + permissoes). */
export async function aplicarPerfilAoUsuario(tx: Db, userId: string, perfilId: string): Promise<void> {
  const [p] = await tx<Array<{ papel: TenantRole; permissoes: string[] }>>`SELECT papel, permissoes FROM perfis WHERE id = ${perfilId}`;
  if (!p) throw new BadRequestException('Perfil não encontrado');
  await tx`UPDATE users SET perfil_id = ${perfilId}, role = ${p.papel}, atualizado_em = now() WHERE id = ${userId}`;
  await tx`DELETE FROM user_permissions WHERE user_id = ${userId}`;
  if (p.permissoes.length) {
    await tx`
      INSERT INTO user_permissions (user_id, permission_key)
      SELECT ${userId}, unnest(${p.permissoes}::text[]) ON CONFLICT DO NOTHING
    `;
  }
}
