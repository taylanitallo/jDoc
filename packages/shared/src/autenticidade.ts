/**
 * Autenticidade publica: codigo de verificacao impresso (com QR) na copia
 * autenticada do PDF. Qualquer pessoa confere em /verificar/<codigo>.
 */

/** Crockford base32 (sem I, L, O, U — nao confunde com 1/0 ao digitar). */
export const CODIGO_ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODIGO_REGEX = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** "ab12-CD34 ef56 gh78" -> "AB12CD34EF56GH78"; confusoes comuns de digitacao corrigidas (O->0, I/L->1). */
export function normalizarCodigo(entrada: string): string {
  return entrada
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function formatarCodigo(codigo: string): string {
  return codigo.match(/.{1,4}/g)?.join('-') ?? codigo;
}

export const SITUACOES_VERIFICACAO = ['vigente', 'substituido', 'excluido', 'eliminado'] as const;
export type SituacaoVerificacao = (typeof SITUACOES_VERIFICACAO)[number];

/** Resposta publica — so metadados minimos, nunca titulo/conteudo/arquivo. */
export interface VerificacaoPublica {
  codigo: string;
  orgao: { nome: string; cidade: string | null; uf: string | null };
  tipoDocumental: string;
  dataDocumento: string | null;
  arquivadoEm: string;
  /** SHA-256 do PDF original ao qual o codigo se refere. */
  hashOriginal: string;
  situacao: SituacaoVerificacao;
  assinatura: { status: string; assinadoPor: string | null };
  copiasEmitidas: number;
}

export interface ConferenciaHashPublica {
  /** 'original' = arquivo identico ao guardado; 'copia' = copia autenticada emitida pelo sistema, sem alteracao. */
  resultado: 'original' | 'copia' | 'nao_confere';
  emitidaEm: string | null;
}
