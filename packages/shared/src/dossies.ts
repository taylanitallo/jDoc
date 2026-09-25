import { z } from 'zod';
import { NIVEIS_ACESSO, type NivelAcesso } from './arquivistica.js';

/**
 * Dossies e processos (e-ARQ Brasil: documento arquivistico composto). Os documentos
 * juntados assumem a classe do conjunto e a temporalidade conta do ENCERRAMENTO do
 * dossie/processo; transferencia, recolhimento e eliminacao levam o conjunto inteiro.
 */

export const TIPOS_DOSSIE = ['dossie', 'processo'] as const;
export type TipoDossie = (typeof TIPOS_DOSSIE)[number];
export const TIPO_DOSSIE_LABEL: Record<TipoDossie, string> = { dossie: 'Dossiê', processo: 'Processo' };

export const EVENTOS_DOSSIE = ['abertura', 'juntada', 'desentranhamento', 'encerramento', 'reabertura', 'apensacao', 'desapensacao', 'alteracao'] as const;
export type EventoDossie = (typeof EVENTOS_DOSSIE)[number];
export const EVENTO_DOSSIE_LABEL: Record<EventoDossie, string> = {
  abertura: 'Abertura',
  juntada: 'Juntada',
  desentranhamento: 'Desentranhamento',
  encerramento: 'Encerramento',
  reabertura: 'Reabertura',
  apensacao: 'Apensação',
  desapensacao: 'Desapensação',
  alteracao: 'Alteração de dados',
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const motivo = z.string().trim().min(10, 'Informe o motivo (mín. 10 caracteres)').max(1000);

export const dossieCreateSchema = z
  .object({
    tipo: z.enum(TIPOS_DOSSIE),
    /** Numero do processo/dossie (ex.: numero do protocolo). Vazio = sequencial automatico "001/2026". */
    numero: z.string().trim().max(60).optional(),
    assunto: z.string().trim().min(3, 'Informe o assunto').max(500),
    interessado: z.string().trim().max(300).optional(),
    classificacaoId: z.string().uuid().nullable().optional(),
    /** Padrao: restrito para quem ve restritos; publico para quem nao ve (senao criaria algo invisivel para si). */
    nivelAcesso: z.enum(NIVEIS_ACESSO).optional(),
    dataAbertura: z.string().regex(ISO, 'Data inválida').optional(),
    localFisicoId: z.string().uuid().nullable().optional(),
    observacoes: z.string().trim().max(2000).optional(),
  })
  .strict();
export type DossieCreateInput = z.infer<typeof dossieCreateSchema>;

export const dossieUpdateSchema = z
  .object({
    assunto: z.string().trim().min(3).max(500).optional(),
    interessado: z.string().trim().max(300).nullable().optional(),
    classificacaoId: z.string().uuid().nullable().optional(),
    nivelAcesso: z.enum(NIVEIS_ACESSO).optional(),
    localFisicoId: z.string().uuid().nullable().optional(),
    observacoes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type DossieUpdateInput = z.infer<typeof dossieUpdateSchema>;

export const juntarDocumentosSchema = z.object({ documentIds: z.array(z.string().uuid()).min(1).max(200) }).strict();
export const desentranharSchema = z.object({ documentId: z.string().uuid(), motivo }).strict();
export const encerrarDossieSchema = z.object({ dataEncerramento: z.string().regex(ISO, 'Data inválida').optional() }).strict();
export const reabrirDossieSchema = z.object({ motivo }).strict();
export const apensarSchema = z.object({ principalId: z.string().uuid() }).strict();
export const desapensarSchema = z.object({ motivo }).strict();

export const dossiesQuerySchema = z
  .object({
    situacao: z.enum(['abertos', 'encerrados', 'todos']).default('todos'),
    tipo: z.enum(TIPOS_DOSSIE).optional(),
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type DossiesQuery = z.infer<typeof dossiesQuerySchema>;

export interface DossieResumoView {
  id: string;
  tipo: TipoDossie;
  numero: string;
  assunto: string;
  interessado: string | null;
  classeCodigo: string | null;
  classeDescricao: string | null;
  nivelAcesso: NivelAcesso;
  dataAbertura: string;
  dataEncerramento: string | null;
  status: 'aberto' | 'encerrado';
  totalDocumentos: number;
  totalPaginas: number;
  apensadoA: { id: string; numero: string; assunto: string } | null;
  totalApensos: number;
}

export interface DossieDocumentoView {
  id: string;
  ordem: number;
  identificacao: string;
  dataDocumento: string | null;
  paginas: number | null;
  restrito: boolean;
  juntadoEm: string;
  juntadoPor: string | null;
}

export interface DossieEventoView {
  tipo: EventoDossie;
  descricao: string;
  usuario: string | null;
  data: string;
}

export interface DossieView extends DossieResumoView {
  localFisico: string | null;
  observacoes: string | null;
  classificacaoId: string | null;
  /** Prazos do conjunto (contam do encerramento). */
  previsaoTransferencia: string | null;
  previsaoDestinacao: string | null;
  destinacao: 'eliminacao' | 'guarda_permanente' | null;
  fase: string | null;
  documentos: DossieDocumentoView[];
  apensos: Array<{ id: string; numero: string; assunto: string }>;
  eventos: DossieEventoView[];
  criadoPor: string | null;
}

export interface DossiesPage {
  items: DossieResumoView[];
  total: number;
  page: number;
  pageSize: number;
}
