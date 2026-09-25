import { z } from 'zod';

/**
 * Descricao arquivistica segundo a NOBRADE (Norma Brasileira de Descricao Arquivistica,
 * CONARQ 2006): 28 elementos em 8 areas, 7 obrigatorios, descricao multinivel do geral
 * (acervo da entidade, nivel 0) ao particular (item documental, nivel 5).
 */

export const NIVEIS_DESCRICAO = ['acervo', 'fundo', 'colecao', 'secao', 'subsecao', 'serie', 'subserie', 'dossie', 'item'] as const;
export type NivelDescricao = (typeof NIVEIS_DESCRICAO)[number];

export const NIVEL_DESCRICAO_LABEL: Record<NivelDescricao, string> = {
  acervo: 'Acervo da entidade custodiadora',
  fundo: 'Fundo',
  colecao: 'Coleção',
  secao: 'Seção',
  subsecao: 'Subseção',
  serie: 'Série',
  subserie: 'Subsérie',
  dossie: 'Dossiê ou processo',
  item: 'Item documental',
};

/** Numero do nivel na NOBRADE (subsecao e subserie sao niveis intermediarios, 2,5 e 3,5). */
export const NIVEL_DESCRICAO_NUMERO: Record<NivelDescricao, number> = {
  acervo: 0,
  fundo: 1,
  colecao: 1,
  secao: 2,
  subsecao: 2.5,
  serie: 3,
  subserie: 3.5,
  dossie: 4,
  item: 5,
};

/** Niveis permitidos logo abaixo de cada nivel (null = raiz). Hierarquia estrita, com exceção das subdivisoes repetiveis. */
export const FILHOS_PERMITIDOS: Record<NivelDescricao | 'raiz', readonly NivelDescricao[]> = {
  raiz: ['acervo', 'fundo', 'colecao'],
  acervo: ['fundo', 'colecao'],
  fundo: ['secao', 'serie', 'dossie', 'item'],
  colecao: ['secao', 'serie', 'dossie', 'item'],
  secao: ['subsecao', 'serie', 'dossie', 'item'],
  subsecao: ['subsecao', 'serie', 'dossie', 'item'],
  serie: ['subserie', 'dossie', 'item'],
  subserie: ['subserie', 'dossie', 'item'],
  dossie: ['item'],
  item: [],
};

export function nivelFilhoPermitido(pai: NivelDescricao | null, filho: NivelDescricao): boolean {
  return FILHOS_PERMITIDOS[pai ?? 'raiz'].includes(filho);
}

export const AREAS_NOBRADE = [
  { id: 1, nome: 'Área de identificação' },
  { id: 2, nome: 'Área de contextualização' },
  { id: 3, nome: 'Área de conteúdo e estrutura' },
  { id: 4, nome: 'Área de condições de acesso e uso' },
  { id: 5, nome: 'Área de fontes relacionadas' },
  { id: 6, nome: 'Área de notas' },
  { id: 7, nome: 'Área de controle da descrição' },
  { id: 8, nome: 'Área de pontos de acesso e indexação de assuntos' },
] as const;

/**
 * Os 28 elementos. `chave` e o campo no formulario/API. Os 7 obrigatorios (1.1 a 1.5, 2.1 e 4.1)
 * ficam em colunas proprias; os demais ficam em `elementos` (jsonb). 1.1 e 1.4 sao derivados
 * (codigo montado pela hierarquia e nivel escolhido); 8.1 e a lista `pontosAcesso`.
 */
export const ELEMENTOS_NOBRADE = [
  { id: '1.1', area: 1, chave: 'codigo', nome: 'Código de referência', ajuda: 'Código do país, da entidade custodiadora (CODEARQ) e da unidade. Montado pela hierarquia.' },
  { id: '1.2', area: 1, chave: 'titulo', nome: 'Título', ajuda: 'Nome atribuído ou formal da unidade de descrição.' },
  { id: '1.3', area: 1, chave: 'datas', nome: 'Data(s)', ajuda: 'Datas de produção (ex.: 1948-1990) e, se houver, de acumulação.' },
  { id: '1.4', area: 1, chave: 'nivel', nome: 'Nível de descrição', ajuda: 'Posição da unidade na hierarquia (fundo, série, dossiê…).' },
  { id: '1.5', area: 1, chave: 'dimensaoSuporte', nome: 'Dimensão e suporte', ajuda: 'Quantidade e suporte (ex.: 12 caixas, 3,2 m lineares; 1.540 documentos digitais).' },
  { id: '2.1', area: 2, chave: 'produtor', nome: 'Nome(s) do(s) produtor(es)', ajuda: 'Entidade coletiva, pessoa ou família que produziu a documentação.' },
  { id: '2.2', area: 2, chave: 'historiaAdministrativa', nome: 'História administrativa / Biografia', ajuda: 'Criação, competências, estrutura e mudanças do produtor.' },
  { id: '2.3', area: 2, chave: 'historiaArquivistica', nome: 'História arquivística', ajuda: 'Custódia, transferências e tratamentos anteriores.' },
  { id: '2.4', area: 2, chave: 'procedencia', nome: 'Procedência', ajuda: 'Origem imediata da aquisição ou transferência.' },
  { id: '3.1', area: 3, chave: 'ambitoConteudo', nome: 'Âmbito e conteúdo', ajuda: 'Assuntos, espécies documentais e período abrangidos.' },
  { id: '3.2', area: 3, chave: 'avaliacao', nome: 'Avaliação, eliminação e temporalidade', ajuda: 'Prazos de guarda e eliminações aplicadas.' },
  { id: '3.3', area: 3, chave: 'incorporacoes', nome: 'Incorporações', ajuda: 'Acréscimos previstos.' },
  { id: '3.4', area: 3, chave: 'sistemaArranjo', nome: 'Sistema de arranjo', ajuda: 'Estrutura interna e ordenação.' },
  { id: '4.1', area: 4, chave: 'condicoesAcesso', nome: 'Condições de acesso', ajuda: 'Restrições de acesso (LAI, LGPD, estado de conservação).' },
  { id: '4.2', area: 4, chave: 'condicoesReproducao', nome: 'Condições de reprodução', ajuda: 'Restrições de reprodução e direitos autorais.' },
  { id: '4.3', area: 4, chave: 'idioma', nome: 'Idioma', ajuda: 'Idioma(s) e escrita(s) predominantes.' },
  { id: '4.4', area: 4, chave: 'caracteristicasFisicas', nome: 'Características físicas e requisitos técnicos', ajuda: 'Estado de conservação, equipamentos necessários à leitura.' },
  { id: '4.5', area: 4, chave: 'instrumentosPesquisa', nome: 'Instrumentos de pesquisa', ajuda: 'Guias, inventários e catálogos existentes.' },
  { id: '5.1', area: 5, chave: 'originais', nome: 'Existência e localização dos originais', ajuda: 'Quando a unidade for cópia.' },
  { id: '5.2', area: 5, chave: 'copias', nome: 'Existência e localização de cópias', ajuda: 'Microfilmes, cópias digitais e onde estão.' },
  { id: '5.3', area: 5, chave: 'unidadesRelacionadas', nome: 'Unidades de descrição relacionadas', ajuda: 'Documentação relacionada nesta ou em outra instituição.' },
  { id: '5.4', area: 5, chave: 'notaPublicacao', nome: 'Nota sobre publicação', ajuda: 'Publicações baseadas na unidade ou que a reproduzem.' },
  { id: '6.1', area: 6, chave: 'notasConservacao', nome: 'Notas sobre conservação', ajuda: 'Intervenções de conservação e restauro.' },
  { id: '6.2', area: 6, chave: 'notasGerais', nome: 'Notas gerais', ajuda: 'Informações que não cabem nas demais áreas.' },
  { id: '7.1', area: 7, chave: 'notaArquivista', nome: 'Nota do arquivista', ajuda: 'Fontes consultadas e responsáveis pela descrição.' },
  { id: '7.2', area: 7, chave: 'regrasConvencoes', nome: 'Regras ou convenções', ajuda: 'Normas usadas na descrição.' },
  { id: '7.3', area: 7, chave: 'dataDescricao', nome: 'Data(s) da(s) descrição(ões)', ajuda: 'Quando a descrição foi feita ou revista.' },
  { id: '8.1', area: 8, chave: 'pontosAcesso', nome: 'Pontos de acesso e indexação de assuntos', ajuda: 'Termos de busca: nomes, lugares, assuntos.' },
] as const;
export type ElementoNobrade = (typeof ELEMENTOS_NOBRADE)[number];

/** Chaves dos elementos opcionais guardados em `elementos` (jsonb). */
export const ELEMENTOS_OPCIONAIS = [
  'historiaAdministrativa',
  'historiaArquivistica',
  'procedencia',
  'ambitoConteudo',
  'avaliacao',
  'incorporacoes',
  'sistemaArranjo',
  'condicoesReproducao',
  'idioma',
  'caracteristicasFisicas',
  'instrumentosPesquisa',
  'originais',
  'copias',
  'unidadesRelacionadas',
  'notaPublicacao',
  'notasConservacao',
  'notasGerais',
  'notaArquivista',
  'regrasConvencoes',
  'dataDescricao',
] as const;
export type ElementoOpcional = (typeof ELEMENTOS_OPCIONAIS)[number];
export type ElementosDescricao = Partial<Record<ElementoOpcional, string>>;

export interface CamposObrigatorios {
  codigo: string | null;
  titulo: string | null;
  datas: string | null;
  nivel: NivelDescricao;
  dimensaoSuporte: string | null;
  produtor: string | null;
  condicoesAcesso: string | null;
}

/**
 * Elementos obrigatorios ausentes (ids NOBRADE). 4.1 Condicoes de acesso so e obrigatorio nos
 * niveis 0 e 1. 2.1 Produtor pode ser herdado do nivel superior (`produtorHerdado`).
 */
export function faltantesNobrade(c: CamposObrigatorios, produtorHerdado = false): string[] {
  const vazio = (v: string | null | undefined) => !v || v.trim() === '';
  const f: string[] = [];
  if (vazio(c.codigo)) f.push('1.1');
  if (vazio(c.titulo)) f.push('1.2');
  if (vazio(c.datas)) f.push('1.3');
  if (vazio(c.dimensaoSuporte)) f.push('1.5');
  if (vazio(c.produtor) && !produtorHerdado) f.push('2.1');
  if (NIVEL_DESCRICAO_NUMERO[c.nivel] <= 1 && vazio(c.condicoesAcesso)) f.push('4.1');
  return f;
}

/**
 * Codigo de referencia (1.1) a partir dos codigos dos niveis, da raiz para a unidade.
 * O codigo do nivel 0 (ex.: "BR SPPMX") separa do resto por espaco; os demais por ponto:
 * ["BR SPPMX", "SAU", "01", "003"] => "BR SPPMX SAU.01.003".
 */
export function codigoReferencia(cadeia: ReadonlyArray<{ nivel: NivelDescricao; codigo: string }>): string {
  if (cadeia.length === 0) return '';
  const [primeiro, ...resto] = cadeia;
  if (primeiro!.nivel === 'acervo') {
    return resto.length ? `${primeiro!.codigo} ${resto.map((x) => x.codigo).join('.')}` : primeiro!.codigo;
  }
  return cadeia.map((x) => x.codigo).join('.');
}

/** Datas-limite (1.3) sugeridas a partir dos anos dos documentos vinculados. */
export function datasLimite(anoMin: number | null, anoMax: number | null): string | null {
  if (anoMin === null || anoMax === null) return null;
  return anoMin === anoMax ? String(anoMin) : `${anoMin}-${anoMax}`;
}

const texto = (max: number) => z.string().trim().max(max);
const opcional = z.string().trim().max(20000).nullable().optional();

const elementosSchema = z
  .object(Object.fromEntries(ELEMENTOS_OPCIONAIS.map((k) => [k, opcional])) as Record<ElementoOpcional, typeof opcional>)
  .strict();

const CODIGO = /^[\p{L}\p{N} ._/-]+$/u;

export const unidadeDescricaoCreateSchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    nivel: z.enum(NIVEIS_DESCRICAO),
    codigo: texto(40).min(1, 'Informe o código').regex(CODIGO, 'Use letras, números, espaço, ponto, hífen ou barra'),
    titulo: texto(500).min(2, 'Informe o título'),
    datas: texto(100).nullable().optional(),
    dimensaoSuporte: texto(1000).nullable().optional(),
    produtor: texto(500).nullable().optional(),
    condicoesAcesso: texto(4000).nullable().optional(),
    elementos: elementosSchema.optional(),
    pontosAcesso: z.array(texto(120).min(1)).max(50).optional(),
  })
  .strict();
export type UnidadeDescricaoCreateInput = z.infer<typeof unidadeDescricaoCreateSchema>;

export const unidadeDescricaoUpdateSchema = unidadeDescricaoCreateSchema.omit({ parentId: true, nivel: true }).partial().strict();
export type UnidadeDescricaoUpdateInput = z.infer<typeof unidadeDescricaoUpdateSchema>;

export const vincularDescricaoSchema = z
  .object({
    documentIds: z.array(z.string().uuid()).max(500).optional(),
    dossieIds: z.array(z.string().uuid()).max(200).optional(),
  })
  .strict()
  .refine((v) => (v.documentIds?.length ?? 0) + (v.dossieIds?.length ?? 0) > 0, 'Informe ao menos um documento ou dossiê');
export type VincularDescricaoInput = z.infer<typeof vincularDescricaoSchema>;

export const instrumentoQuerySchema = z
  .object({
    /** Inventario: descricao da unidade e de todos os niveis abaixo. Catalogo: inventario + lista dos documentos. */
    tipo: z.enum(['inventario', 'catalogo']).default('inventario'),
  })
  .strict();

/** No da arvore (leve, para montar a navegacao). */
export interface UnidadeDescricaoNo {
  id: string;
  parentId: string | null;
  nivel: NivelDescricao;
  codigo: string;
  titulo: string;
  datas: string | null;
  completa: boolean;
  totalDocumentos: number;
  totalDossies: number;
}

export interface UnidadeDescricaoView {
  id: string;
  parentId: string | null;
  nivel: NivelDescricao;
  codigo: string;
  /** 1.1 montado pela hierarquia. */
  codigoReferencia: string;
  titulo: string;
  datas: string | null;
  dimensaoSuporte: string | null;
  produtor: string | null;
  /** Produtor do nivel superior mais proximo (a NOBRADE nao repete informacao herdada). */
  produtorHerdado: string | null;
  condicoesAcesso: string | null;
  elementos: ElementosDescricao;
  pontosAcesso: string[];
  /** Ids NOBRADE dos obrigatorios ausentes. */
  faltantes: string[];
  caminho: Array<{ id: string; nivel: NivelDescricao; codigo: string; titulo: string }>;
  /** Calculado da unidade e de todos os niveis abaixo. */
  sugestoes: { datas: string | null; dimensaoSuporte: string | null };
  documentos: Array<{ id: string; identificacao: string; dataDocumento: string | null; restrito: boolean }>;
  totalDocumentos: number;
  dossies: Array<{ id: string; tipo: 'dossie' | 'processo'; numero: string; assunto: string }>;
  atualizadoEm: string;
  atualizadoPor: string | null;
}
