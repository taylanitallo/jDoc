import { z } from 'zod';

/**
 * Servico de digitalizacao (TR 1.5.3): plano de trabalho por secretaria,
 * lotes com cadeia de custodia, inventario, controle de qualidade por
 * amostragem, nao conformidades e aceite formal do fiscal. A unidade de
 * medicao e a pagina digitalizada E ACEITA.
 */

export const ETAPAS_LOTE = [
  'recebido',
  'preparacao',
  'digitalizacao',
  'indexacao',
  'controle_qualidade',
  'disponibilizado',
  'devolvido',
] as const;
export type EtapaLote = (typeof ETAPAS_LOTE)[number];
export const ETAPA_LOTE_LABEL: Record<EtapaLote, string> = {
  recebido: 'Recebido',
  preparacao: 'Preparação e higienização',
  digitalizacao: 'Digitalização',
  indexacao: 'Indexação',
  controle_qualidade: 'Controle de qualidade',
  disponibilizado: 'Disponibilizado',
  devolvido: 'Originais devolvidos',
};

/**
 * Proxima etapa permitida. Do controle de qualidade so se sai para
 * "disponibilizado" com o aceite do fiscal; reprovado volta para digitalizacao
 * (retrabalho).
 */
export function etapasPermitidas(atual: EtapaLote): EtapaLote[] {
  switch (atual) {
    case 'recebido':
      return ['preparacao'];
    case 'preparacao':
      return ['digitalizacao'];
    case 'digitalizacao':
      return ['indexacao'];
    case 'indexacao':
      return ['controle_qualidade', 'digitalizacao'];
    case 'controle_qualidade':
      return ['digitalizacao'];
    case 'disponibilizado':
      return ['devolvido'];
    case 'devolvido':
      return [];
  }
}

export const ESTADOS_CONSERVACAO = ['bom', 'regular', 'ruim', 'pessimo'] as const;
export type EstadoConservacao = (typeof ESTADOS_CONSERVACAO)[number];
export const ESTADO_CONSERVACAO_LABEL: Record<EstadoConservacao, string> = {
  bom: 'Bom',
  regular: 'Regular',
  ruim: 'Ruim',
  pessimo: 'Péssimo',
};

export const TIPOS_ITEM_LOTE = ['caixa', 'pasta', 'livro', 'processo', 'mapa', 'outro'] as const;
export type TipoItemLote = (typeof TIPOS_ITEM_LOTE)[number];
export const TIPO_ITEM_LOTE_LABEL: Record<TipoItemLote, string> = {
  caixa: 'Caixa',
  pasta: 'Pasta',
  livro: 'Livro',
  processo: 'Processo',
  mapa: 'Mapa/planta',
  outro: 'Outro',
};

/** Itens do checklist do controle de qualidade (TR: completude, legibilidade, correspondencia...). */
export const CHECKLIST_QC = ['completude', 'sequencia', 'orientacao', 'legibilidade', 'cortes', 'correspondencia_metadados'] as const;
export type ItemChecklistQc = (typeof CHECKLIST_QC)[number];
export const CHECKLIST_QC_LABEL: Record<ItemChecklistQc, string> = {
  completude: 'Todas as páginas foram digitalizadas',
  sequencia: 'Páginas na ordem do original',
  orientacao: 'Páginas na orientação correta',
  legibilidade: 'Imagem legível (resolução, contraste, foco)',
  cortes: 'Sem cortes de bordas, carimbos ou assinaturas',
  correspondencia_metadados: 'Metadados correspondem ao documento',
};

export const TIPOS_NAO_CONFORMIDADE = [
  'pagina_faltante',
  'fora_de_ordem',
  'ilegivel',
  'corte',
  'orientacao',
  'metadado_incorreto',
  'duplicidade',
  'outro',
] as const;
export type TipoNaoConformidade = (typeof TIPOS_NAO_CONFORMIDADE)[number];
export const TIPO_NAO_CONFORMIDADE_LABEL: Record<TipoNaoConformidade, string> = {
  pagina_faltante: 'Página faltante',
  fora_de_ordem: 'Fora de ordem',
  ilegivel: 'Ilegível',
  corte: 'Corte de informação',
  orientacao: 'Orientação errada',
  metadado_incorreto: 'Metadado incorreto',
  duplicidade: 'Duplicidade',
  outro: 'Outro',
};

const texto = (max: number) => z.string().trim().max(max);
const opcional = (max: number) => texto(max).nullable().optional();

// ---------------- Plano de trabalho ----------------

export const planoSchema = z
  .object({
    orgaoCodigo: opcional(20),
    titulo: texto(200).min(3, 'Informe o título'),
    diagnostico: opcional(5000),
    setores: opcional(2000),
    volumeCaixas: z.number().int().min(0).nullable().optional(),
    volumePaginas: z.number().int().min(0).nullable().optional(),
    inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    metas: opcional(3000),
  })
  .strict();
export type PlanoInput = z.infer<typeof planoSchema>;

export interface PlanoView {
  id: string;
  orgaoCodigo: string | null;
  orgaoNome: string | null;
  titulo: string;
  diagnostico: string | null;
  setores: string | null;
  volumeCaixas: number | null;
  volumePaginas: number | null;
  inicio: string | null;
  fim: string | null;
  metas: string | null;
  status: 'rascunho' | 'aprovado';
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  lotes: number;
  paginasAceitas: number;
}

// ---------------- Lote ----------------

export const loteCreateSchema = z
  .object({
    planoId: z.string().uuid().nullable().optional(),
    orgaoCodigo: opcional(20),
    descricao: texto(500).min(3, 'Descreva o lote'),
    setorOrigem: opcional(200),
    responsavelEntrega: opcional(200),
    caixas: z.number().int().min(0).max(100_000).default(0),
    paginasEstimadas: z.number().int().min(0).nullable().optional(),
    amostragemPct: z.number().int().min(1).max(100).default(10),
    estadoConservacao: z.enum(ESTADOS_CONSERVACAO).default('bom'),
    sigiloso: z.boolean().default(false),
    fragil: z.boolean().default(false),
    grandeFormato: z.boolean().default(false),
    contaminado: z.boolean().default(false),
    observacoes: opcional(3000),
  })
  .strict();
export type LoteCreateInput = z.infer<typeof loteCreateSchema>;

export const loteUpdateSchema = loteCreateSchema.partial().strict();
export type LoteUpdateInput = z.infer<typeof loteUpdateSchema>;

export const avancarEtapaSchema = z
  .object({ para: z.enum(ETAPAS_LOTE), observacao: texto(1000).optional() })
  .strict();
export type AvancarEtapaInput = z.infer<typeof avancarEtapaSchema>;

export const itemLoteSchema = z
  .object({
    tipo: z.enum(TIPOS_ITEM_LOTE),
    identificacao: texto(300).min(1, 'Identifique o item'),
    localFisicoId: z.string().uuid().nullable().optional(),
    datasLimite: opcional(60),
    folhas: z.number().int().min(0).nullable().optional(),
    estadoConservacao: z.enum(ESTADOS_CONSERVACAO).default('bom'),
    observacao: opcional(1000),
  })
  .strict();
export type ItemLoteInput = z.infer<typeof itemLoteSchema>;

export const itemLoteUpdateSchema = itemLoteSchema.partial().extend({ conferidoDevolucao: z.boolean().optional() }).strict();
export type ItemLoteUpdateInput = z.infer<typeof itemLoteUpdateSchema>;

export const qcSchema = z
  .object({
    amostra: z.number().int().min(1),
    checklist: z.record(z.enum(CHECKLIST_QC), z.boolean()),
    observacao: texto(2000).optional(),
    naoConformidades: z
      .array(
        z
          .object({
            tipo: z.enum(TIPOS_NAO_CONFORMIDADE),
            descricao: texto(1000).min(3),
            documentId: z.string().uuid().nullable().optional(),
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict();
export type QcInput = z.infer<typeof qcSchema>;

export const corrigirNcSchema = z.object({ correcao: texto(1000).min(3, 'Descreva a correção') }).strict();
export const aceiteSchema = z.object({ observacao: texto(2000).optional() }).strict();
export const vincularDocumentosSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict();

export const lotesQuerySchema = z
  .object({
    etapa: z.enum(ETAPAS_LOTE).optional(),
    orgaoCodigo: z.string().max(20).optional(),
    planoId: z.string().uuid().optional(),
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type LotesQuery = z.infer<typeof lotesQuerySchema>;

export interface LoteResumoView {
  id: string;
  protocolo: string;
  descricao: string;
  orgaoCodigo: string | null;
  orgaoNome: string | null;
  etapa: EtapaLote;
  caixas: number;
  documentos: number;
  paginas: number;
  paginasAceitas: number | null;
  ncAbertas: number;
  sigiloso: boolean;
  fragil: boolean;
  grandeFormato: boolean;
  contaminado: boolean;
  criadoEm: string;
  aceiteEm: string | null;
}

export interface EventoLoteView {
  id: string;
  etapaDe: EtapaLote | null;
  etapaPara: EtapaLote;
  observacao: string | null;
  usuario: string | null;
  ip: string | null;
  criadoEm: string;
}

export interface ItemLoteView {
  id: string;
  tipo: TipoItemLote;
  identificacao: string;
  localFisicoId: string | null;
  localFisicoCodigo: string | null;
  datasLimite: string | null;
  folhas: number | null;
  estadoConservacao: EstadoConservacao;
  observacao: string | null;
  conferidoDevolucao: boolean;
}

export interface QcView {
  id: string;
  amostra: number;
  checklist: Partial<Record<ItemChecklistQc, boolean>>;
  aprovado: boolean;
  observacao: string | null;
  avaliadoPor: string | null;
  criadoEm: string;
}

export interface NaoConformidadeView {
  id: string;
  tipo: TipoNaoConformidade;
  descricao: string;
  documentId: string | null;
  documento: string | null;
  status: 'aberta' | 'corrigida';
  criadoPor: string | null;
  criadoEm: string;
  correcao: string | null;
  corrigidaPor: string | null;
  corrigidaEm: string | null;
}

/** Conferencias que o sistema faz sozinho nos documentos do lote. */
export interface VerificacaoAutomaticaLote {
  documentos: number;
  semArquivo: number;
  semPaginas: number;
  semDescricaoOuData: number;
  duplicadosPorHash: Array<{ hash: string; documentos: number }>;
}

export interface LoteDetalheView extends LoteResumoView {
  planoId: string | null;
  planoTitulo: string | null;
  setorOrigem: string | null;
  responsavelEntrega: string | null;
  paginasEstimadas: number | null;
  amostragemPct: number;
  estadoConservacao: EstadoConservacao;
  observacoes: string | null;
  aceitePor: string | null;
  aceiteIp: string | null;
  aceiteObservacao: string | null;
  criadoPor: string | null;
  itens: ItemLoteView[];
  eventos: EventoLoteView[];
  qcs: QcView[];
  naoConformidades: NaoConformidadeView[];
  verificacao: VerificacaoAutomaticaLote;
  /** Amostra sugerida para o controle de qualidade (paginas ou documentos x percentual). */
  amostraSugerida: number;
}

export const TERMOS_LOTE = ['recebimento', 'aceite', 'devolucao'] as const;
export type TermoLote = (typeof TERMOS_LOTE)[number];

// ---------------- Producao ----------------

export const producaoQuerySchema = z
  .object({
    de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    orgaoCodigo: z.string().max(20).optional(),
  })
  .strict();
export type ProducaoQuery = z.infer<typeof producaoQuerySchema>;

export interface ProducaoLinha {
  loteId: string;
  protocolo: string;
  descricao: string;
  orgaoCodigo: string | null;
  orgaoNome: string | null;
  etapa: EtapaLote;
  documentos: number;
  paginasDigitalizadas: number;
  paginasAceitas: number;
  naoConformidades: number;
  ncAbertas: number;
  aceiteEm: string | null;
}

export interface ProducaoResumo {
  linhas: ProducaoLinha[];
  totais: { lotes: number; documentos: number; paginasDigitalizadas: number; paginasAceitas: number; naoConformidades: number };
  porSecretaria: Array<{ orgaoCodigo: string | null; orgaoNome: string | null; paginasAceitas: number; paginasDigitalizadas: number; lotes: number }>;
}

export function protocoloLote(numero: number, ano: number): string {
  return `LT ${String(numero).padStart(3, '0')}/${ano}`;
}
