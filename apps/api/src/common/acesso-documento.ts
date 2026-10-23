import type { Sql } from 'postgres';
import type { TenantAccessClaims } from '@jdoc/shared';

/**
 * Regras de visibilidade de documento comuns a todas as telas (lista, detalhe,
 * busca, download, ZIP, relatorios).
 *
 * - Restrito: so admin ou quem tem acervo_restrito:read.
 * - Lotacao: usuario lotado em secretarias so ve os documentos delas e os que
 *   nao tem secretaria (documentos gerais da prefeitura). Admin ve tudo.
 */
export function podeVerRestrito(user: TenantAccessClaims): boolean {
  return user.role === 'admin' || user.permissions.includes('acervo_restrito:read');
}

/** Codigos das secretarias do usuario; null = sem restricao. */
export function lotacaoDe(user: TenantAccessClaims): string[] | null {
  if (user.role === 'admin' || !user.lot || user.lot.length === 0) return null;
  return user.lot;
}

/** Fragmento SQL para o WHERE; `coluna` e o orgao_id do documento (ex.: d.orgao_id). */
export function filtroLotacao(sql: Sql, user: TenantAccessClaims, coluna = 'd.orgao_id') {
  const lot = lotacaoDe(user);
  if (!lot) return sql`true`;
  // Identificador fixo vindo do codigo (nunca do usuario).
  const col = sql.unsafe(coluna);
  return sql`(${col} IS NULL OR EXISTS (SELECT 1 FROM orgaos lo WHERE lo.id = ${col} AND lo.codigo = ANY(${lot}::varchar[])))`;
}

/** Documento ja carregado: esta dentro da lotacao? (codigo null = sem secretaria). */
export function dentroDaLotacao(user: TenantAccessClaims, orgaoCodigo: string | null): boolean {
  const lot = lotacaoDe(user);
  return !lot || !orgaoCodigo || lot.includes(orgaoCodigo);
}
