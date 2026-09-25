import { z } from 'zod';

/**
 * Classificacao de sigilo (Lei 12.527/2011 — LAI, arts. 23, 24, 27, 28, 30 e 31;
 * Decreto 7.724/2012). O prazo conta da DATA DE PRODUCAO do documento; vencido,
 * a informacao se torna publica automaticamente (art. 24, par. 4o).
 */

export const GRAUS_SIGILO = ['reservado', 'secreto', 'ultrassecreto', 'pessoal'] as const;
export type GrauSigilo = (typeof GRAUS_SIGILO)[number];

/** Prazo maximo em anos (art. 24, par. 1o; informacao pessoal: art. 31, par. 1o, I). */
export const PRAZO_SIGILO_ANOS: Record<GrauSigilo, number> = {
  reservado: 5,
  secreto: 15,
  ultrassecreto: 25,
  pessoal: 100,
};

export const GRAU_SIGILO_LABEL: Record<GrauSigilo, string> = {
  reservado: 'Reservado',
  secreto: 'Secreto',
  ultrassecreto: 'Ultrassecreto',
  pessoal: 'Informação pessoal',
};

/** Hipoteses legais de sigilo (art. 23, I a VIII) e informacao pessoal (art. 31). */
export const HIPOTESES_SIGILO = [
  { codigo: 'art23_I', texto: 'Art. 23, I — pôr em risco a defesa e a soberania nacionais ou a integridade do território' },
  { codigo: 'art23_II', texto: 'Art. 23, II — prejudicar negociações ou relações internacionais' },
  { codigo: 'art23_III', texto: 'Art. 23, III — pôr em risco a vida, a segurança ou a saúde da população' },
  { codigo: 'art23_IV', texto: 'Art. 23, IV — oferecer risco à estabilidade financeira, econômica ou monetária' },
  { codigo: 'art23_V', texto: 'Art. 23, V — prejudicar ou causar risco a planos ou operações estratégicos' },
  { codigo: 'art23_VI', texto: 'Art. 23, VI — prejudicar projetos de pesquisa e desenvolvimento científico ou tecnológico' },
  { codigo: 'art23_VII', texto: 'Art. 23, VII — pôr em risco a segurança de instituições ou de altas autoridades' },
  { codigo: 'art23_VIII', texto: 'Art. 23, VIII — comprometer atividades de inteligência, investigação ou fiscalização em andamento' },
  { codigo: 'art31', texto: 'Art. 31 — informação pessoal (intimidade, vida privada, honra e imagem)' },
] as const;
export type HipoteseSigilo = (typeof HIPOTESES_SIGILO)[number]['codigo'];
const CODIGOS_HIPOTESE = HIPOTESES_SIGILO.map((h) => h.codigo) as [HipoteseSigilo, ...HipoteseSigilo[]];

export const STATUS_TERMO_SIGILO = ['vigente', 'desclassificado', 'expirado'] as const;
export type StatusTermoSigilo = (typeof STATUS_TERMO_SIGILO)[number];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Data final do sigilo: data de producao + prazo do grau. */
export function prazoFimSigilo(dataProducao: string, grau: GrauSigilo): string {
  if (!ISO.test(dataProducao)) throw new Error(`Data invalida: ${dataProducao}`);
  const [a, m, d] = dataProducao.split('-').map(Number) as [number, number, number];
  const alvo = new Date(Date.UTC(a + PRAZO_SIGILO_ANOS[grau], m - 1, d));
  // 29/02 + N anos nao bissexto cai em 01/03: usa o ultimo dia de fevereiro.
  if (alvo.getUTCMonth() !== m - 1) alvo.setUTCDate(0);
  return alvo.toISOString().slice(0, 10);
}

export const classificarSigiloSchema = z
  .object({
    grau: z.enum(GRAUS_SIGILO),
    hipotese: z.enum(CODIGOS_HIPOTESE),
    fundamentoComplemento: z.string().trim().max(500).optional(),
    /** Razoes da classificacao (art. 28, II): obrigatorias e especificas. */
    razoes: z.string().trim().min(20, 'Descreva as razões da classificação (mín. 20 caracteres)').max(3000),
    autoridadeNome: z.string().trim().min(3, 'Informe a autoridade classificadora').max(200),
    autoridadeCargo: z.string().trim().min(3, 'Informe o cargo da autoridade').max(200),
    /** Padrao: data do documento. */
    dataProducao: z.string().regex(ISO, 'Data de produção inválida').optional(),
    /** Prazo menor que o maximo do grau (ou evento), opcional. */
    prazoFim: z.string().regex(ISO, 'Prazo inválido').optional(),
  })
  .strict()
  .refine((v) => (v.grau === 'pessoal') === (v.hipotese === 'art31'), {
    message: 'Informação pessoal usa o art. 31; os graus reservado, secreto e ultrassecreto usam o art. 23',
    path: ['hipotese'],
  });
export type ClassificarSigiloInput = z.infer<typeof classificarSigiloSchema>;

export const desclassificarSigiloSchema = z
  .object({ motivo: z.string().trim().min(10, 'Informe o motivo da desclassificação (mín. 10 caracteres)').max(2000) })
  .strict();

export const termosSigiloQuerySchema = z
  .object({
    situacao: z.enum(['vigentes', 'encerrados', 'todos']).default('vigentes'),
    documentId: z.string().uuid().optional(),
  })
  .strict();

export interface TermoSigiloView {
  id: string;
  numeroTci: string;
  documentId: string;
  documento: string;
  grau: GrauSigilo;
  hipotese: HipoteseSigilo;
  fundamento: string;
  razoes: string;
  autoridadeNome: string;
  autoridadeCargo: string;
  dataProducao: string;
  dataClassificacao: string;
  prazoFim: string;
  status: StatusTermoSigilo;
  encerradoEm: string | null;
  motivoEncerramento: string | null;
  classificadoPor: string | null;
  /** Dias ate o fim do sigilo (vigente). */
  diasRestantes: number | null;
}

export interface SigiloResumo {
  vigentesPorGrau: Record<GrauSigilo, number>;
  /** Vigentes que perdem o sigilo nos proximos 30 dias. */
  expirandoEm30Dias: number;
  /** Desclassificados/expirados nos ultimos 12 meses (rol do art. 30). */
  desclassificados12Meses: number;
}

export function fundamentoSigilo(hipotese: HipoteseSigilo, complemento?: string | null): string {
  const base = HIPOTESES_SIGILO.find((h) => h.codigo === hipotese)?.texto ?? hipotese;
  return complemento ? `${base}. ${complemento}` : base;
}
