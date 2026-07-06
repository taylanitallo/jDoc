import { z } from 'zod';

/**
 * Schemas e tipos de backup (Fase 7a/7b).
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
  isSafetyBackup: boolean;
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

export const BACKUP_FREQUENCIAS = ['diario', 'semanal'] as const;
export const backupFrequenciaSchema = z.enum(BACKUP_FREQUENCIAS);

export const updateBackupSettingsSchema = z
  .object({
    enabled: z.boolean(),
    frequencia: backupFrequenciaSchema,
    hora: z.number().int().min(0).max(23),
    retencao: z.number().int().min(1).max(90),
  })
  .strict();
export type UpdateBackupSettingsInput = z.infer<typeof updateBackupSettingsSchema>;

export interface TenantBackupSettings {
  enabled: boolean;
  frequencia: (typeof BACKUP_FREQUENCIAS)[number];
  hora: number;
  retencao: number;
  proximoBackup: string | null;
}

export const triggerRestoreSchema = z
  .object({
    tenantId: z.string().uuid(),
  })
  .strict();
export type TriggerRestoreInput = z.infer<typeof triggerRestoreSchema>;

export interface RestoreJobView {
  id: string;
  tenantId: string;
  status: 'pendente' | 'processando' | 'concluido' | 'erro';
  safetyBackupId: string | null;
  erroMensagem: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}
