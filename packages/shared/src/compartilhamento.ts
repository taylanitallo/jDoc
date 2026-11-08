import { z } from 'zod';

/** Compartilhar documento com usuarios do orgao que ja podem le-lo. */
export const compartilharDocumentoSchema = z
  .object({
    destinatarios: z.array(z.string().uuid()).min(1, 'Escolha ao menos um usuário').max(30),
    mensagem: z.string().trim().max(500).optional(),
  })
  .strict();
export type CompartilharDocumentoInput = z.infer<typeof compartilharDocumentoSchema>;

export const compartilhadosQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type CompartilhadosQuery = z.infer<typeof compartilhadosQuerySchema>;

export interface DestinatarioCompartilhamento {
  id: string;
  nome: string;
  email: string;
}

export interface CompartilhamentoRecebido {
  id: string;
  documentId: string;
  titulo: string;
  temArquivo: boolean;
  deNome: string;
  mensagem: string | null;
  criadoEm: string;
  vistoEm: string | null;
}

export interface CompartilhadosPage {
  items: CompartilhamentoRecebido[];
  total: number;
  naoVistos: number;
  page: number;
  pageSize: number;
}
