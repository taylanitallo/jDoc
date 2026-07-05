import { z } from 'zod';

/**
 * Schemas e tipos de backup (Fase 7a).
 * - Schemas Zod .strict() — rejeita chaves desconhecidas.
 * - UUIDs validados.
 */

export const createBackupSchema = z
  .object({
    tenantId: z.string().uuid(),
  })
  .strict();

export type CreateBackupInput = z.infer<typeof createBackupSchema>;

export interface BackupView {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantNome: string;
  status: 'pendente' | 'processando' | 'concluido' | 'erro';
  fileKey: string | null;
  sizeBytes: number | null;
  erroMensagem: string | null;
  criadoEm: string;
  iniciadoEm: string | null;
  concluidoEm: string | null;
}

export interface BackupsListResponse {
  items: BackupView[];
  total: number;
}

export interface BackupTriggerResponse {
  id: string;
  status: 'pendente';
}