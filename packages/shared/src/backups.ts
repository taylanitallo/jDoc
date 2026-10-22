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

export const TIPOS_BACKUP = ['manual', 'agendado', 'seguranca'] as const;
export type TipoBackup = (typeof TIPOS_BACKUP)[number];
export const TIPO_BACKUP_LABEL: Record<TipoBackup, string> = { manual: 'Manual', agendado: 'Agendado', seguranca: 'Segurança' };
export const STATUS_BACKUP_LABEL = { pendente: 'Na fila', processando: 'Em andamento', concluido: 'Concluído', erro: 'Falhou' } as const;

export interface BackupView {
  id: string;
  /** null = backup completo (todo o banco). */
  tenantId: string | null;
  tenantSlug: string | null;
  tenantNome: string | null;
  kind: TipoBackup;
  criadoPor: string | null;
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

/** Etapas da restauracao, na ordem (a tela mostra o progresso). */
export const ETAPAS_RESTAURACAO = [
  { id: 'fila', label: 'Na fila' },
  { id: 'backup_seguranca', label: 'Backup de segurança do estado atual' },
  { id: 'manutencao', label: 'Órgão em manutenção' },
  { id: 'preparando', label: 'Conferindo o arquivo' },
  { id: 'restaurando', label: 'Restaurando os dados' },
  { id: 'reativando', label: 'Reativando o órgão' },
  { id: 'concluido', label: 'Concluído' },
] as const;
export type EtapaRestauracao = (typeof ETAPAS_RESTAURACAO)[number]['id'];

export interface RestoreJobView {
  id: string;
  tenantId: string;
  step: EtapaRestauracao | null;
  source: 'backup' | 'upload';
  status: 'pendente' | 'processando' | 'concluido' | 'erro';
  safetyBackupId: string | null;
  erroMensagem: string | null;
  criadoEm: string;
  concluidoEm: string | null;
}

export const restaurarDeBackupSchema = z.object({ tenantId: z.string().uuid(), backupId: z.string().uuid() }).strict();
export type RestaurarDeBackupInput = z.infer<typeof restaurarDeBackupSchema>;

export const limparBackupsSchema = z.object({ diasMaisQue: z.coerce.number().int().min(1).max(3650) }).strict();
