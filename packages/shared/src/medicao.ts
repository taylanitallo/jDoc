import { z } from 'zod';

/**
 * Contrato por item (cada secretaria e um item do TR) e boletim de medicao
 * mensal: mensalidade do GED + paginas digitalizadas e aceitas no mes,
 * limitadas ao saldo contratado. Medicao fechada nao muda e as paginas
 * dela nao entram de novo em outro mes.
 */

export const contratoItemSchema = z
  .object({
    numero: z.number().int().min(1).max(999),
    orgaoCodigo: z.string().trim().max(20).nullable(),
    descricao: z.string().trim().min(3).max(300),
    valorMensalGed: z.number().nonnegative().max(1e9),
    valorPagina: z.number().nonnegative().max(1e6),
    paginasContratadas: z.number().int().min(0).max(1e9),
    ativo: z.boolean().default(true),
  })
  .strict();
export type ContratoItemInput = z.infer<typeof contratoItemSchema>;

export const contratoItensSchema = z
  .object({ itens: z.array(contratoItemSchema).max(100) })
  .strict()
  .refine((v) => new Set(v.itens.map((i) => i.numero)).size === v.itens.length, { message: 'Número de item repetido' });

export interface ContratoItemView extends ContratoItemInput {
  id: string;
  orgaoNome: string | null;
}

export interface LinhaMedicao {
  numero: number;
  descricao: string;
  orgaoCodigo: string | null;
  orgaoNome: string | null;
  valorMensalGed: number;
  /** Paginas aceitas no mes (lotes com aceite do fiscal no mes). */
  paginasMes: number;
  /** Ja medidas em meses fechados antes deste. */
  paginasAnteriores: number;
  paginasContratadas: number;
  /** Paginas pagas neste mes (limitadas ao saldo). */
  paginasMedidas: number;
  /** Aceitas acima do saldo contratado (nao pagas). */
  paginasExcedentes: number;
  valorPagina: number;
  valorServico: number;
  valorTotal: number;
}

export interface MedicaoView {
  mes: string;
  fechada: boolean;
  fechadaPor: string | null;
  fechadaEm: string | null;
  observacao: string | null;
  /** Disponibilidade media do mes (%), para conferencia do SLA. */
  disponibilidade: number | null;
  metaDisponibilidade: number;
  contrato: { numero: string | null; vigenciaInicio: string | null; vigenciaFim: string | null; fiscal: string | null; preposto: string | null };
  linhas: LinhaMedicao[];
  totais: { ged: number; servico: number; total: number; paginasMedidas: number };
  /** Paginas aceitas de secretarias sem item no contrato (nao medidas). */
  paginasSemItem: number;
}

export const fecharMedicaoSchema = z.object({ observacao: z.string().trim().max(2000).optional() }).strict();

export const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM');

/** Calculo de uma linha (o mesmo no servidor e nos testes). */
export function calcularLinha(
  item: Pick<ContratoItemInput, 'valorMensalGed' | 'valorPagina' | 'paginasContratadas'>,
  paginasMes: number,
  paginasAnteriores: number,
  gedNoMes: boolean,
): Pick<LinhaMedicao, 'paginasMedidas' | 'paginasExcedentes' | 'valorServico' | 'valorTotal' | 'valorMensalGed'> {
  const saldo = Math.max(0, item.paginasContratadas - paginasAnteriores);
  const paginasMedidas = Math.min(paginasMes, saldo);
  const valorServico = Math.round(paginasMedidas * item.valorPagina * 100) / 100;
  const ged = gedNoMes ? item.valorMensalGed : 0;
  return {
    valorMensalGed: ged,
    paginasMedidas,
    paginasExcedentes: paginasMes - paginasMedidas,
    valorServico,
    valorTotal: Math.round((ged + valorServico) * 100) / 100,
  };
}

// ---------------- Treinamentos ----------------

export const participanteSchema = z
  .object({
    nome: z.string().trim().min(2).max(200),
    cargo: z.string().trim().max(120).optional().default(''),
    secretaria: z.string().trim().max(200).optional().default(''),
  })
  .strict();

export const treinamentoSchema = z
  .object({
    titulo: z.string().trim().min(3).max(200),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
    cargaHoraria: z.number().min(0).max(999).nullable().optional(),
    instrutor: z.string().trim().max(200).optional(),
    local: z.string().trim().max(200).optional(),
    conteudo: z.string().trim().max(5000).optional(),
    modalidade: z.enum(['presencial', 'remoto']).default('presencial'),
    participantes: z.array(participanteSchema).max(500).default([]),
  })
  .strict();
export type TreinamentoInput = z.infer<typeof treinamentoSchema>;

export interface TreinamentoView extends TreinamentoInput {
  id: string;
  criadoPor: string | null;
  criadoEm: string;
}
