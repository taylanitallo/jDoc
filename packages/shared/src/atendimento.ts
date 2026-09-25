import { z } from 'zod';

/**
 * Atendimento e consultas ao acervo (Lei 12.527/2011 — LAI). Registra quem pediu,
 * para que, quais documentos, como foi atendido e em quanto tempo. Prazo legal:
 * 20 dias, prorrogaveis por mais 10 com justificativa (art. 11).
 */

export const LAI_PRAZO_DIAS = 20;
export const LAI_PRORROGACAO_DIAS = 10;
/** "Vencendo": faltam ate N dias. */
export const LAI_ALERTA_DIAS = 5;

export const VINCULOS_SOLICITANTE = ['cidadao', 'servidor', 'pesquisador', 'orgao_publico', 'imprensa', 'outro'] as const;
export const VINCULO_LABEL: Record<(typeof VINCULOS_SOLICITANTE)[number], string> = {
  cidadao: 'Cidadão',
  servidor: 'Servidor municipal',
  pesquisador: 'Pesquisador',
  orgao_publico: 'Órgão público',
  imprensa: 'Imprensa',
  outro: 'Outro',
};

export const CANAIS_ATENDIMENTO = ['presencial', 'email', 'telefone', 'esic', 'oficio'] as const;
export const CANAL_LABEL: Record<(typeof CANAIS_ATENDIMENTO)[number], string> = {
  presencial: 'Presencial',
  email: 'E-mail',
  telefone: 'Telefone',
  esic: 'e-SIC / Ouvidoria',
  oficio: 'Ofício',
};

export const FORMAS_ACESSO = ['consulta_local', 'copia_digital', 'copia_autenticada', 'emprestimo'] as const;
export const FORMA_ACESSO_LABEL: Record<(typeof FORMAS_ACESSO)[number], string> = {
  consulta_local: 'Consulta no local',
  copia_digital: 'Cópia digital',
  copia_autenticada: 'Cópia autenticada',
  emprestimo: 'Empréstimo do original',
};

export const STATUS_ATENDIMENTO = ['aberto', 'atendido', 'indeferido', 'cancelado'] as const;
export type StatusAtendimento = (typeof STATUS_ATENDIMENTO)[number];

const texto = (max: number) => z.string().trim().max(max);

export const atendimentoCreateSchema = z
  .object({
    solicitanteNome: texto(200).min(3, 'Informe o nome do solicitante'),
    solicitanteDocumento: texto(40).optional(),
    solicitanteContato: texto(200).optional(),
    vinculo: z.enum(VINCULOS_SOLICITANTE),
    setorOrgao: texto(200).optional(),
    canal: z.enum(CANAIS_ATENDIMENTO),
    finalidade: texto(2000).min(5, 'Descreva a finalidade do pedido'),
    formaAcesso: z.enum(FORMAS_ACESSO),
    /** Documentos do sistema consultados/solicitados. */
    documentIds: z.array(z.string().uuid()).max(200).default([]),
    /** Documentos pedidos que nao estao no sistema (ex.: caixa ainda nao digitalizada). */
    documentosNaoCadastrados: texto(2000).optional(),
    /** Obrigatoria se houver documento restrito: por que o acesso foi autorizado. */
    justificativaRestrito: texto(1000).optional(),
    /** Data do pedido (padrao: agora); permite registrar pedido recebido antes. */
    dataPedido: z.coerce.date().optional(),
  })
  .strict();
export type AtendimentoCreateInput = z.infer<typeof atendimentoCreateSchema>;

export const atendimentoConcluirSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('atendido'), resposta: texto(4000).min(3, 'Descreva o que foi entregue') }).strict(),
  z.object({ status: z.literal('indeferido'), resposta: texto(4000).min(20, 'A LAI exige a fundamentação do indeferimento (mín. 20 caracteres)') }).strict(),
  z.object({ status: z.literal('cancelado'), resposta: texto(1000).min(3, 'Informe o motivo') }).strict(),
]);
export type AtendimentoConcluirInput = z.infer<typeof atendimentoConcluirSchema>;

export const atendimentoProrrogarSchema = z
  .object({ justificativa: texto(1000).min(10, 'A prorrogação precisa de justificativa (mín. 10 caracteres)') })
  .strict();

export const atendimentosQuerySchema = z
  .object({
    situacao: z.enum(['abertos', 'atrasados', 'concluidos', 'todos']).default('abertos'),
    q: texto(200).optional(),
    documentId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AtendimentosQuery = z.infer<typeof atendimentosQuerySchema>;

export interface AtendimentoDocumento {
  id: string;
  identificacao: string;
  restrito: boolean;
  modulo: string;
}

export interface AtendimentoView {
  id: string;
  protocolo: string;
  status: StatusAtendimento;
  solicitanteNome: string;
  solicitanteDocumento: string | null;
  solicitanteContato: string | null;
  vinculo: (typeof VINCULOS_SOLICITANTE)[number];
  setorOrgao: string | null;
  canal: (typeof CANAIS_ATENDIMENTO)[number];
  finalidade: string;
  formaAcesso: (typeof FORMAS_ACESSO)[number];
  documentos: AtendimentoDocumento[];
  documentosNaoCadastrados: string | null;
  justificativaRestrito: string | null;
  dataPedido: string;
  prazoFinal: string;
  prorrogado: boolean;
  justificativaProrrogacao: string | null;
  resposta: string | null;
  concluidoEm: string | null;
  registradoPor: string | null;
  concluidoPor: string | null;
  /** Dias ate o prazo (negativo = atrasado); null se concluido. */
  diasRestantes: number | null;
}

export interface AtendimentosPage {
  items: AtendimentoView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AtendimentoResumo {
  abertos: number;
  vencendo: number;
  atrasados: number;
  concluidosNoMes: number;
  /** Media de dias para concluir (ultimos 12 meses). */
  mediaDiasResposta: number | null;
}

/** Prazo final: pedido + 20 dias (+10 se prorrogado). */
export function prazoFinalLai(dataPedido: Date, prorrogado: boolean): Date {
  const d = new Date(dataPedido);
  d.setDate(d.getDate() + LAI_PRAZO_DIAS + (prorrogado ? LAI_PRORROGACAO_DIAS : 0));
  return d;
}
