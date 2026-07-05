import { z } from 'zod';
import { docModuleSchema } from './documents.js';
import type { ParseError, ParsedRecord } from './parsers/types.js';

export const labelFormatSchema = z.enum(['SS', 'ASPEC', 'JBS']);

/** Campos do multipart de preview/importacao (alem do arquivo). */
export const labelsUploadFieldsSchema = z
  .object({
    module: docModuleSchema,
    formato: labelFormatSchema.optional(), // ausente = deteccao automatica
  })
  .strict();
export type LabelsUploadFields = z.infer<typeof labelsUploadFieldsSchema>;

export const labelsImportsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export type LabelsImportsQuery = z.infer<typeof labelsImportsQuerySchema>;

export const LABELS_IMPORT_STATUS = ['pendente', 'processando', 'concluido', 'erro'] as const;

export interface LabelsPreview {
  formato: string;
  totalLinhas: number;
  totalValidos: number;
  totalErros: number;
  amostra: ParsedRecord[];
  erros: ParseError[];
}

export interface LabelsImportView {
  id: string;
  formato: string;
  module: string;
  originalName: string;
  status: string;
  totalRegistros: number;
  registrosOk: number;
  registrosErro: number;
  relatorioErros: ParseError[] | null;
  criadoEm: string;
  concluidoEm: string | null;
}
