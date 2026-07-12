import { z } from 'zod';
import type { DocumentView } from './documents.js';

/**
 * Assistente de busca por IA — "pergunte em portugues" sobre os documentos
 * do tenant. Texto-para-consulta-estruturada (Claude com tool-use traduzindo
 * a pergunta em filtros sobre os campos ja existentes), NAO busca no corpo
 * do PDF (sem OCR/embeddings/vetor).
 */
export const perguntarSchema = z.object({ pergunta: z.string().min(3).max(500) }).strict();
export type PerguntarInput = z.infer<typeof perguntarSchema>;

export interface AssistenteResposta {
  /** Texto em portugues, pronto pra exibir — a resposta final do modelo. */
  resposta: string;
  /** Documentos citados como fonte da resposta (acumulados de todas as consultas feitas). */
  documentos: DocumentView[];
  /** Avisos nao-fatais (ex: limite de resultados atingido, modulo sem permissao). */
  avisos: string[];
}
