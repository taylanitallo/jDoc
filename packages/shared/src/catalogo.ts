import { z } from 'zod';
import { MODULE_ACTIONS, MODULES, type ModuleAction, type ModuleName, type TenantRole } from './constants.js';
import { MODULOS_RBAC_POR_SISTEMA, type Sistema } from './sistemas.js';

/**
 * Catalogo do sistema para o superadmin: modulos contrataveis (com descricao
 * do que fazem), os itens de menu de cada um (desligaveis por orgao) e as
 * permissoes (linhas da matriz de perfis).
 */

export interface MenuCatalogo {
  /** Segmento da rota do orgao (`/<slug>/<id>`); e a chave em `menu_overrides`. */
  id: string;
  label: string;
  descricao: string;
}

export interface ModuloCatalogo {
  id: Sistema | 'geral';
  nome: string;
  /** Nome do icone lucide (o front mapeia). */
  icone: string;
  descricao: string;
  menus: MenuCatalogo[];
}

export const CATALOGO_MODULOS: ModuloCatalogo[] = [
  {
    id: 'financeiro',
    nome: 'Financeiro/Contábil',
    icone: 'Landmark',
    descricao:
      'Guarda e organiza os documentos da execução orçamentária (receitas, despesas, balancetes e extratos), monta a prestação de contas e a mídia legislativa, com conferência por IA.',
    menus: [
      { id: 'receitas', label: 'Receitas', descricao: 'Receitas orçamentárias e extraorçamentárias' },
      { id: 'despesas', label: 'Despesas', descricao: 'Empenhos, liquidações e pagamentos' },
      { id: 'balancete', label: 'Balancete', descricao: 'Balancetes orçamentários mensais' },
      { id: 'extrato', label: 'Extrato de contas', descricao: 'Extratos bancários por competência' },
      { id: 'outros', label: 'Outros arquivos', descricao: 'Documentos diversos por tipo' },
      { id: 'prestacao-contas', label: 'Prestação de contas', descricao: 'Pacotes para o Tribunal de Contas' },
      { id: 'midia-legislativa', label: 'Mídia legislativa', descricao: 'Pacotes mensais para a Câmara' },
      { id: 'pasta-monitorada', label: 'Pasta monitorada', descricao: 'Envio automático pelo jDoc Desktop' },
    ],
  },
  {
    id: 'arquivo',
    nome: 'Arquivo Municipal',
    icone: 'Library',
    descricao:
      'Gestão arquivística completa: acervo, plano de classificação, temporalidade e eliminação, arquivo físico, dossiês, descrição NOBRADE, legislação compilada, atendimento LAI e sigilo.',
    menus: [
      { id: 'acervo', label: 'Acervo', descricao: 'Documentos do Arquivo Municipal' },
      { id: 'dossies', label: 'Dossiês e processos', descricao: 'Conjuntos documentais' },
      { id: 'descricao', label: 'Descrição (NOBRADE)', descricao: 'Quadro de arranjo e instrumentos de pesquisa' },
      { id: 'normas', label: 'Legislação', descricao: 'Texto compilado de leis e decretos' },
      { id: 'arquivo-fisico', label: 'Arquivo físico', descricao: 'Caixas, localização e empréstimos' },
      { id: 'atendimento', label: 'Atendimento', descricao: 'Pedidos de consulta e acesso (LAI)' },
      { id: 'sigilo', label: 'Sigilo', descricao: 'Informações classificadas pela LAI' },
      { id: 'temporalidade', label: 'Temporalidade', descricao: 'Prazos de guarda e eliminação' },
      { id: 'integridade', label: 'Integridade', descricao: 'Conferência periódica dos arquivos' },
      { id: 'digitalizacao', label: 'Digitalização', descricao: 'Lotes, custódia, controle de qualidade e produção' },
      { id: 'relatorios', label: 'Relatórios', descricao: 'Inventário e quantitativos' },
    ],
  },
  {
    id: 'geral',
    nome: 'Geral',
    icone: 'Settings',
    descricao: 'Recursos comuns aos dois módulos.',
    menus: [
      { id: 'busca', label: 'Busca no conteúdo', descricao: 'Procura dentro do texto dos PDFs' },
      { id: 'auditoria', label: 'Auditoria', descricao: 'Trilha de quem fez o quê, quando e de onde' },
      { id: 'continuidade', label: 'Continuidade', descricao: 'Backups, restauração, disponibilidade e exportação' },
      { id: 'ajuda', label: 'Ajuda', descricao: 'Manual do sistema e treinamentos' },
      { id: 'suporte', label: 'Suporte', descricao: 'Chamados com a equipe JEOS' },
      { id: 'novidades', label: 'Novidades', descricao: 'Notas de versão do sistema' },
    ],
  },
];

/** Menus que nunca podem ser desligados (o orgao ficaria sem administracao). */
export const MENUS_FIXOS = ['dashboard', 'configuracoes', 'conta'] as const;

export const menuOverridesSchema = z.record(z.string().regex(/^[a-z-]{2,40}$/), z.boolean());
export type MenuOverrides = z.infer<typeof menuOverridesSchema>;

/** Rotulo e acoes de cada modulo de permissao (linhas da matriz). */
export const PERMISSAO_LABEL: Record<ModuleName, { label: string; acoes?: readonly ModuleAction[]; dica?: string }> = {
  receitas: { label: 'Receitas' },
  despesas: { label: 'Despesas' },
  balancete: { label: 'Balancete' },
  extrato: { label: 'Extrato de contas' },
  outros: { label: 'Outros arquivos' },
  configuracoes: { label: 'Configurações' },
  prestacao_contas: { label: 'Prestação de contas' },
  midia_legislativa: { label: 'Mídia legislativa', acoes: ['read', 'create'] },
  acervo: { label: 'Acervo' },
  acervo_restrito: { label: 'Acervo restrito', acoes: ['read'], dica: 'Ver documentos de acesso restrito (RH, LGPD)' },
  acervo_sigiloso: { label: 'Acervo sigiloso', acoes: ['read'], dica: 'Ver documentos classificados como sigilosos (LAI); todo acesso fica na auditoria' },
  classificacao: { label: 'Plano de classificação' },
  temporalidade: { label: 'Temporalidade' },
  arquivo_fisico: { label: 'Arquivo físico' },
  integridade: { label: 'Integridade', acoes: ['read', 'create', 'update'] },
  atendimento: { label: 'Atendimento (LAI)' },
  sigilo: { label: 'Sigilo' },
  dossies: { label: 'Dossiês e processos' },
  descricao: { label: 'Descrição (NOBRADE)' },
  legislacao: { label: 'Legislação' },
  digitalizacao: { label: 'Digitalização' },
  fiscal_contrato: { label: 'Fiscal do contrato', acoes: ['read', 'update'], dica: 'Aprovar plano de trabalho e dar o aceite formal dos lotes digitalizados' },
  orgaos: { label: 'Órgãos (cadastro)' },
  unidades_orcamentarias: { label: 'Unidades orçamentárias' },
  projetos_atividades: { label: 'Projetos e atividades' },
  elementos_despesa: { label: 'Elementos de despesa' },
  tipos_documento: { label: 'Tipos de documento' },
  usuarios: { label: 'Usuários' },
  layout: { label: 'Aparência do órgão', acoes: ['read', 'update'] },
  auditoria: { label: 'Auditoria', acoes: ['read', 'export'], dica: 'Ver e exportar a trilha de auditoria do órgão' },
  treinamentos: { label: 'Treinamentos', dica: 'Registrar capacitações e listas de presença' },
};

export const ACAO_LABEL: Record<ModuleAction, string> = {
  read: 'Ver',
  create: 'Criar',
  update: 'Editar',
  delete: 'Excluir',
  export: 'Exportar',
};

export function acoesDoModulo(m: ModuleName): readonly ModuleAction[] {
  return PERMISSAO_LABEL[m].acoes ?? MODULE_ACTIONS;
}

/** Linhas da matriz agrupadas por sistema (comuns em "Geral"). */
export function linhasPermissao(sistemas: readonly Sistema[] = ['financeiro', 'arquivo']): Array<{
  grupo: string;
  modulos: ModuleName[];
}> {
  const doSistema = new Set(Object.values(MODULOS_RBAC_POR_SISTEMA).flat());
  const grupos: Array<{ grupo: string; modulos: ModuleName[] }> = [];
  if (sistemas.includes('financeiro')) {
    grupos.push({ grupo: 'Financeiro/Contábil', modulos: MODULOS_RBAC_POR_SISTEMA.financeiro as ModuleName[] });
  }
  if (sistemas.includes('arquivo')) {
    grupos.push({ grupo: 'Arquivo Municipal', modulos: MODULOS_RBAC_POR_SISTEMA.arquivo as ModuleName[] });
  }
  grupos.push({ grupo: 'Geral', modulos: MODULES.filter((m) => !doSistema.has(m)) });
  return grupos;
}

/** Todas as permissoes validas (modulo:acao) do catalogo. */
export function todasPermissoes(sistemas: readonly Sistema[] = ['financeiro', 'arquivo']): string[] {
  return linhasPermissao(sistemas).flatMap((g) => g.modulos.flatMap((m) => acoesDoModulo(m).map((a) => `${m}:${a}`)));
}

// ---------------- Perfis ----------------

export interface PerfilPadrao {
  chave: string;
  nome: string;
  descricao: string;
  papel: TenantRole;
  permissoes: string[];
}

const SO_ADMIN = new Set<ModuleName>(['usuarios', 'layout', 'orgaos', 'auditoria', 'fiscal_contrato']);

/** Perfis de fabrica (os modelos globais do superadmin sobrescrevem estes). */
export function perfisDeFabrica(): PerfilPadrao[] {
  const todas = todasPermissoes();
  const semAdmin = todas.filter((p) => !SO_ADMIN.has(p.split(':')[0] as ModuleName));
  return [
    {
      chave: 'administrador',
      nome: 'Administrador',
      descricao: 'Acesso total ao órgão, inclusive usuários e configurações.',
      papel: 'admin',
      permissoes: todas,
    },
    {
      chave: 'operador',
      nome: 'Operador',
      descricao: 'Cadastra, edita e exporta documentos; não exclui nem administra usuários.',
      papel: 'operador',
      permissoes: semAdmin.filter((p) => !p.endsWith(':delete') && p !== 'acervo_restrito:read' && p !== 'acervo_sigiloso:read'),
    },
    {
      chave: 'consulta',
      nome: 'Consulta',
      descricao: 'Somente leitura e exportação.',
      papel: 'consulta',
      permissoes: semAdmin
        .filter((p) => p.endsWith(':read') || p.endsWith(':export'))
        .filter((p) => p !== 'acervo_restrito:read' && p !== 'acervo_sigiloso:read'),
    },
  ];
}

export const chavePerfilSchema = z
  .string()
  .regex(/^[a-z0-9_]{2,40}$/, 'Use letras minúsculas, números e _');

/** "Secretário de Finanças" -> "secretario_de_financas" */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const permissaoValida = z.string().refine((p) => todasPermissoes().includes(p), 'Permissão desconhecida');

export const perfilCreateSchema = z
  .object({
    nome: z.string().trim().min(2).max(80),
    descricao: z.string().trim().max(200).nullable().optional(),
    papel: z.enum(['admin', 'operador', 'consulta']),
    permissoes: z.array(permissaoValida).max(500),
    /** "Comecar a partir de": copia as permissoes de outro perfil. */
    copiarDe: z.string().uuid().optional(),
  })
  .strict();
export type PerfilCreateInput = z.infer<typeof perfilCreateSchema>;

export const perfilUpdateSchema = z
  .object({
    nome: z.string().trim().min(2).max(80).optional(),
    descricao: z.string().trim().max(200).nullable().optional(),
    papel: z.enum(['admin', 'operador', 'consulta']).optional(),
    permissoes: z.array(permissaoValida).max(500).optional(),
  })
  .strict();
export type PerfilUpdateInput = z.infer<typeof perfilUpdateSchema>;

export interface PerfilView {
  id: string;
  chave: string;
  nome: string;
  descricao: string | null;
  papel: TenantRole;
  permissoes: string[];
  /** Veio de um perfil padrao (pode "restaurar o padrao"). */
  sistema: boolean;
  /** Difere do modelo atual (so para perfis do sistema). */
  alteradoDoPadrao: boolean;
  usuarios: number;
}

export const modeloPerfilSchema = z
  .object({
    nome: z.string().trim().min(2).max(80),
    descricao: z.string().trim().max(200).nullable(),
    permissoes: z.array(permissaoValida).max(500),
  })
  .strict();
export type ModeloPerfilInput = z.infer<typeof modeloPerfilSchema>;

export interface ModeloPerfilView extends PerfilPadrao {
  /** Alterado em relacao ao padrao de fabrica. */
  personalizado: boolean;
  atualizadoEm: string | null;
}

export interface PreviaAplicarModelo {
  orgaos: number;
  perfisQueMudam: number;
  detalhes: Array<{ tenantId: string; orgao: string; mudaria: boolean; usuarios: number }>;
}
