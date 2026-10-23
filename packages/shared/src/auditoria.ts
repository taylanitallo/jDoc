import { z } from 'zod';
import type { LogRegistro } from './logs.js';

/**
 * Trilha de auditoria do orgao (Configuracoes > Auditoria). Append-only: o
 * banco recusa alteracao e exclusao, e cada registro carrega o hash do
 * anterior, entao qualquer adulteracao aparece na verificacao da cadeia.
 */
export const auditoriaQuerySchema = z
  .object({
    de: z.coerce.date().optional(),
    ate: z.coerce.date().optional(),
    acao: z.string().max(80).optional(),
    usuarioId: z.string().uuid().optional(),
    /** Registros sobre um documento especifico. */
    documentoId: z.string().uuid().optional(),
    ip: z.string().max(45).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AuditoriaQuery = z.infer<typeof auditoriaQuerySchema>;

export interface AuditoriaRegistro extends LogRegistro {
  /** Numero sequencial na cadeia. */
  seq: number;
  usuarioId: string | null;
  userAgent: string | null;
  hash: string;
}

export interface AuditoriaPagina {
  items: AuditoriaRegistro[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VerificacaoCadeia {
  integra: boolean;
  registros: number;
  /** Primeiros registros em que a cadeia quebrou (alterado, apagado ou fora de ordem). */
  quebras: Array<{ seq: number; criadoEm: string; motivo: 'conteudo_alterado' | 'elo_quebrado' }>;
  verificadoEm: string;
  /** Hash do ultimo registro: guardado fora do sistema, prova que nada foi reescrito depois. */
  ultimoHash: string | null;
}
