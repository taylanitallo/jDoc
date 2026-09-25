import { z } from 'zod';

/**
 * Arquivo fisico: onde esta o ORIGINAL em papel de cada documento digital
 * (predio > sala > estante > prateleira > caixa) e o controle de emprestimo.
 */
export const TIPOS_LOCAL = ['predio', 'sala', 'estante', 'prateleira', 'caixa'] as const;
export const tipoLocalSchema = z.enum(TIPOS_LOCAL);
export type TipoLocal = z.infer<typeof tipoLocalSchema>;

export const TIPO_LOCAL_LABEL: Record<TipoLocal, string> = {
  predio: 'Prédio',
  sala: 'Sala',
  estante: 'Estante',
  prateleira: 'Prateleira',
  caixa: 'Caixa',
};

/** Hierarquia permitida: cada tipo so pode ficar dentro de um tipo "maior". */
export function podeConter(pai: TipoLocal | null, filho: TipoLocal): boolean {
  if (pai === null) return true; // qualquer tipo pode ser raiz (ex.: caixa avulsa)
  return TIPOS_LOCAL.indexOf(filho) > TIPOS_LOCAL.indexOf(pai);
}

export const localFisicoSchema = z
  .object({
    parentId: z.string().uuid().nullable().default(null),
    tipo: tipoLocalSchema,
    codigo: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{N} ._/-]+$/u, 'Codigo: letras, numeros, espaco e . _ / -'),
    descricao: z.string().trim().max(300).nullable().default(null),
    capacidade: z.number().int().min(1).max(100000).nullable().default(null),
    ativo: z.boolean().default(true),
  })
  .strict();
export type LocalFisicoInput = z.infer<typeof localFisicoSchema>;

export interface LocalFisicoView {
  id: string;
  parentId: string | null;
  tipo: TipoLocal;
  codigo: string;
  descricao: string | null;
  capacidade: number | null;
  ativo: boolean;
  totalDocumentos: number;
  emprestado: boolean;
}

/** "Prédio Sede > Sala 2 > Estante A > Caixa 12" a partir da lista plana. */
export function caminhoLocal(
  id: string | null,
  locais: ReadonlyArray<Pick<LocalFisicoView, 'id' | 'parentId' | 'tipo' | 'codigo'>>,
): string {
  const porId = new Map(locais.map((l) => [l.id, l]));
  const partes: string[] = [];
  const vistos = new Set<string>();
  let atual = id ? porId.get(id) : undefined;
  while (atual && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    partes.unshift(`${TIPO_LOCAL_LABEL[atual.tipo]} ${atual.codigo}`);
    atual = atual.parentId ? porId.get(atual.parentId) : undefined;
  }
  return partes.join(' › ');
}

export const emprestimoCreateSchema = z
  .object({
    documentId: z.string().uuid().nullable().default(null),
    localFisicoId: z.string().uuid().nullable().default(null),
    solicitanteNome: z.string().trim().min(3).max(200),
    solicitanteSetor: z.string().trim().min(2).max(200),
    finalidade: z.string().trim().max(500).nullable().default(null),
    prazoDevolucao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida'),
  })
  .strict()
  .refine((e) => (e.documentId === null) !== (e.localFisicoId === null), {
    message: 'Informe o documento OU a caixa emprestada',
  });
export type EmprestimoCreateInput = z.infer<typeof emprestimoCreateSchema>;

export const EMPRESTIMO_STATUS = ['aberto', 'devolvido'] as const;
export type EmprestimoStatus = (typeof EMPRESTIMO_STATUS)[number];

export interface EmprestimoView {
  id: string;
  numero: number;
  ano: number;
  status: EmprestimoStatus;
  atrasado: boolean;
  documentId: string | null;
  documentoDescricao: string | null;
  localFisicoId: string | null;
  localCodigo: string | null;
  solicitanteNome: string;
  solicitanteSetor: string;
  finalidade: string | null;
  dataSaida: string;
  prazoDevolucao: string;
  dataDevolucao: string | null;
  registradoPor: string | null;
  recebidoPor: string | null;
}

export interface ArquivoFisicoResumo {
  caixas: number;
  documentosComOriginal: number;
  emprestimosAbertos: number;
  emprestimosAtrasados: number;
}

export interface ConteudoLocal {
  itens: Array<{
    id: string;
    module: string;
    descricao: string;
    classificacaoCodigo: string | null;
    exercicio: number;
    documentDate: string | null;
    fase: string;
  }>;
  /** Documentos restritos na caixa que o usuario nao pode ver (so a contagem). */
  ocultos: number;
}
