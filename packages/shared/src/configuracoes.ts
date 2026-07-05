import { z } from 'zod';

/**
 * Permissoes proprias de configuracoes.
 * - unidades_orcamentarias: CRUD completo + sub-entidades
 * - tipos_documento: CRUD
 * - usuarios: CRUD + reset_senha + ativar/desativar
 * - layout: leitura/escrita das customizacoes visuais
 */
export const CONFIG_PERMISSOES = [
  'orgaos:read',
  'orgaos:create',
  'orgaos:update',
  'orgaos:delete',
  'unidades_orcamentarias:read',
  'unidades_orcamentarias:create',
  'unidades_orcamentarias:update',
  'unidades_orcamentarias:delete',
  'elementos_despesa:read',
  'elementos_despesa:create',
  'elementos_despesa:update',
  'elementos_despesa:delete',
  'projetos_atividades:read',
  'projetos_atividades:create',
  'projetos_atividades:update',
  'projetos_atividades:delete',
  'tipos_documento:read',
  'tipos_documento:create',
  'tipos_documento:update',
  'tipos_documento:delete',
  'usuarios:read',
  'usuarios:create',
  'usuarios:update',
  'usuarios:delete',
  'layout:read',
  'layout:update',
] as const;
export type ConfigPermissao = (typeof CONFIG_PERMISSOES)[number];

// ---- Guia 1: Orgaos + Unidades Orcamentarias ----

export const orgaoSchema = z.object({
  id: z.string().uuid().optional(),
  codigo: z.string().min(1).max(20),
  /** Sigla usada no cabecalho das etiquetas ASPEC (ex.: CMI, FME) — fallback
   *  de identificacao do orgao quando nao ha CLASSIFICACAO (extraorcamentario). */
  sigla: z.string().max(20).nullable().optional(),
  descricao: z.string().min(1).max(200),
  exercicio: z.number().int().min(2000).max(2100),
  importa: z.boolean().default(true),
  ativo: z.boolean().default(true),
});
export type Orgao = z.infer<typeof orgaoSchema>;

export const unidadeOrcamentariaSchema = z.object({
  id: z.string().uuid().optional(),
  orgaoId: z.string().uuid(),
  codigo: z.string().max(20).nullable(),
  nome: z.string().min(1).max(200),
  ativo: z.boolean().default(true),
});
export type UnidadeOrcamentaria = z.infer<typeof unidadeOrcamentariaSchema>;

export const projetoAtividadeSchema = z.object({
  id: z.string().uuid().optional(),
  codigo: z.string().min(1).max(30),
  descricao: z.string().min(1).max(300),
  exercicio: z.number().int().min(2000).max(2100),
  ativo: z.boolean().default(true),
});
export type ProjetoAtividade = z.infer<typeof projetoAtividadeSchema>;

export const dotacaoOrcamentariaSchema = z.object({
  id: z.string().uuid().optional(),
  unidadeId: z.string().uuid(),
  exercicio: z.number().int().min(2000).max(2100),
  valor: z.coerce.number().positive(),
  descricao: z.string().nullable(),
});
export type DotacaoOrcamentaria = z.infer<typeof dotacaoOrcamentariaSchema>;

export const elementoDespesaSchema = z.object({
  id: z.string().uuid().optional(),
  codigo: z.string().min(1).max(20),
  nome: z.string().min(1).max(200),
  descricao: z.string().nullable(),
  exercicio: z.number().int().min(2000).max(2100),
  ativo: z.boolean().default(true),
});
export type ElementoDespesa = z.infer<typeof elementoDespesaSchema>;

export const ordenadorDespesaSchema = z.object({
  id: z.string().uuid().optional(),
  unidadeId: z.string().uuid(),
  nome: z.string().min(1).max(200),
  cpfMascarado: z.string().regex(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/).nullable(),
  cargo: z.string().min(1).max(200),
  vigenciaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vigenciaFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  ativo: z.boolean().default(true),
});
export type OrdenadorDespesa = z.infer<typeof ordenadorDespesaSchema>;

// ---- Guia 2: Tipos de Documento ----

export const tipoDocumentoSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().min(1).max(100),
  descricao: z.string().max(200).nullable(),
  cor: z.string().min(1).max(20).default('blue'),
  ativo: z.boolean().default(true),
});
export type TipoDocumento = z.infer<typeof tipoDocumentoSchema>;

// ---- Guia 3: Usuarios e Permissoes ----

export const usuarioTenantSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().email().max(254),
  nome: z.string().min(1).max(200),
  role: z.enum(['admin', 'operador', 'consulta']),
  ativo: z.boolean().default(true),
  ultimoAcesso: z.string().nullable().optional(),
  criadoEm: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  unidadesIds: z.array(z.string().uuid()).default([]),
});
export type UsuarioTenant = z.infer<typeof usuarioTenantSchema>;

export const usuarioCreateSchema = z.object({
  email: z.string().email().max(254),
  nome: z.string().min(1).max(200),
  role: z.enum(['admin', 'operador', 'consulta']),
  senha: z.string().min(8).max(128),
  permissions: z.array(z.string()).default([]),
  unidadesIds: z.array(z.string().uuid()).default([]),
});
export type UsuarioCreate = z.infer<typeof usuarioCreateSchema>;

export const usuarioUpdateSchema = z.object({
  nome: z.string().min(1).max(200),
  role: z.enum(['admin', 'operador', 'consulta']),
  ativo: z.boolean(),
  permissions: z.array(z.string()).default([]),
  unidadesIds: z.array(z.string().uuid()).default([]),
});
export type UsuarioUpdate = z.infer<typeof usuarioUpdateSchema>;

export const resetSenhaSchema = z.object({
  userId: z.string().uuid(),
  novaSenha: z.string().min(8).max(128),
});
export type ResetSenhaInput = z.infer<typeof resetSenhaSchema>;

// ---- Guia 4: Layout / Customizacao ----

export const tenantSettingsSchema = z.object({
  brasaoKey: z.string().nullable(), // file_key do upload no storage
  nomeExibido: z.string().max(100).nullable(),
  corDestaque: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
  textoRodape: z.string().max(200).nullable(),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/** Identidade visual do tenant exposta a QUALQUER usuario autenticado (sidebar/relatorios) —
 *  nao exige a permissao layout:read (essa e so para a tela de edicao). */
export interface TenantBranding {
  nomeExibido: string | null;
  corDestaque: string | null;
  /** Signed URL ja resolvida (nao e o file_key) — pronta para <img src>. */
  brasaoUrl: string | null;
}

// ---- Query params ----

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
