/**
 * Espelho, no renderer, da visao de sessao entregue pelo main.
 * Nunca inclui token — o renderer nao tem acesso a credenciais.
 */
export interface SessionView {
  user: {
    id: string;
    email: string | null;
    role: string;
    permissions: string[];
    mustChangePassword: boolean;
  };
  tenant: {
    id: string;
    slug: string;
  };
}

/** Espelho do snapshot da fila de upload emitido pelo main. */
export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'canceled';

export interface UploadItemStatus {
  fileId: string;
  name: string;
  size: number;
  module: string;
  status: UploadStatus;
  attempt: number;
  error?: string;
  documentId?: string;
}

export interface UploadSnapshot {
  items: UploadItemStatus[];
  aggregate: {
    total: number;
    queued: number;
    uploading: number;
    done: number;
    failed: number;
    canceled: number;
  };
}

/** Lookups do upload (espelham os GETs de configuracoes). */
export interface BudgetUnit {
  id: string;
  codigo: string | null;
  nome: string;
}

export interface DocumentType {
  id: string;
  nome: string;
  cor: string;
}

export type LookupKind = 'budget-units' | 'document-types';

/** Espelho de um pendente da pasta monitorada (Marco 9). */
export interface WatchedPendingFile {
  fileId: string;
  name: string;
  size: number;
  detectedAt: string;
}

/** Espelho do status/certs de assinatura (PKCS#11) vindo do main. */
export interface SigningStatus {
  available: boolean;
  libPath: string | null;
  fromSettings: boolean;
  detected: string[];
  tokenPresent: boolean;
  pending: boolean;
  message: string;
  error?: string;
}

export interface CertInfo {
  id: string;
  label: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
}
