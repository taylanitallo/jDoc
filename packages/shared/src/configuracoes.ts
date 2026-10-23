import { z } from 'zod';
import { camposMetadadosSchema } from './metadados.js';
import type { Sistema } from './sistemas.js';
import { cpfValido } from './auth.js';

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
  /** Onde o tipo aparece: Outros Arquivos (financeiro) ou Acervo (Arquivo Municipal). */
  modulo: z.enum(['outros', 'acervo']).default('outros'),
  /** Campos de metadados do tipo (so usados no Acervo). */
  campos: camposMetadadosSchema.default([]),
  /** Classe padrao do Plano de Classificacao para documentos deste tipo. */
  classificacaoId: z.string().uuid().nullable().default(null),
  nivelAcessoPadrao: z.enum(['publico', 'restrito']).default('restrito'),
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
  /** Lotacao: codigos das secretarias que enxerga (vazio = todas). */
  orgaosCodigos: z.array(z.string().max(20)).default([]),
  /** Verificacao em 2 etapas ligada. */
  mfaEnabled: z.boolean().optional(),
  cpf: z.string().nullable().optional(),
  /** null = permissoes individuais ("Personalizado"). */
  perfilId: z.string().uuid().nullable().optional(),
  perfilNome: z.string().nullable().optional(),
});
export type UsuarioTenant = z.infer<typeof usuarioTenantSchema>;

/** CPF opcional no cadastro do orgao: vazio = sem CPF. */
const cpfOpcional = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v === '' || cpfValido(v), 'CPF inválido')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const usuarioCreateSchema = z.object({
  email: z.string().email().max(254),
  nome: z.string().min(1).max(200),
  role: z.enum(['admin', 'operador', 'consulta']),
  senha: z.string().min(6).max(128),
  permissions: z.array(z.string()).default([]),
  unidadesIds: z.array(z.string().uuid()).default([]),
  orgaosCodigos: z.array(z.string().trim().min(1).max(20)).max(200).default([]),
  cpf: cpfOpcional,
  /** Com perfil, papel e permissoes vem dele (role/permissions sao ignorados). */
  perfilId: z.string().uuid().nullable().optional(),
});
export type UsuarioCreate = z.infer<typeof usuarioCreateSchema>;

export const usuarioUpdateSchema = z.object({
  nome: z.string().min(1).max(200),
  role: z.enum(['admin', 'operador', 'consulta']),
  ativo: z.boolean(),
  permissions: z.array(z.string()).default([]),
  unidadesIds: z.array(z.string().uuid()).default([]),
  orgaosCodigos: z.array(z.string().trim().min(1).max(20)).max(200).default([]),
  cpf: cpfOpcional,
  perfilId: z.string().uuid().nullable().optional(),
});
export type UsuarioUpdate = z.infer<typeof usuarioUpdateSchema>;

/** Perfil do orgao como o administrador do orgao ve (para escolher no cadastro). */
export interface PerfilOrgaoResumo {
  id: string;
  nome: string;
  descricao: string | null;
  papel: 'admin' | 'operador' | 'consulta';
  permissoes: string[];
}

export const resetSenhaSchema = z.object({
  userId: z.string().uuid(),
  novaSenha: z.string().min(6).max(128),
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
  /** Nome do orgao no cadastro (ex.: "Prefeitura de Itapajé") — usado quando nao ha nome exibido. */
  nomeOrgao?: string | null;
  corDestaque: string | null;
  /** Signed URL ja resolvida (nao e o file_key) — pronta para <img src>. */
  brasaoUrl: string | null;
  /** Modulos contratados pelo orgao — o menu so mostra o que esta ligado. */
  modulos: Sistema[];
}

// ---- Query params ----

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

// ---- Seguranca do orgao ----

export const segurancaOrgaoSchema = z
  .object({
    /** Administradores so usam o sistema com verificacao em 2 etapas ligada. */
    mfaObrigatorioAdmin: z.boolean(),
  })
  .strict();
export type SegurancaOrgaoInput = z.infer<typeof segurancaOrgaoSchema>;

export interface SegurancaOrgao {
  mfaObrigatorioAdmin: boolean;
  administradores: number;
  administradoresSemMfa: number;
}
