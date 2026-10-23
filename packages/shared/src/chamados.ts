import { z } from 'zod';

/**
 * Chamados (atendimento JEOS aos orgaos), SLA em horas uteis e notas de versao.
 * Horario de atendimento: seg-sex, 08h-12h e 13h-17h em Fortaleza (UTC-3, sem
 * horario de verao), sem contar feriados.
 */

export const CRITICIDADES = ['critica', 'alta', 'media', 'baixa'] as const;
export type Criticidade = (typeof CRITICIDADES)[number];
export const CRITICIDADE_LABEL: Record<Criticidade, string> = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
export const CRITICIDADE_DESCRICAO: Record<Criticidade, string> = {
  critica: 'Sistema parado ou dados em risco',
  alta: 'Função importante sem funcionar',
  media: 'Problema com alternativa ou dúvida de uso',
  baixa: 'Sugestão ou ajuste pequeno',
};

/** Prazos em horas uteis: primeira resposta e solucao. */
export const PRAZOS_SLA: Record<Criticidade, { resposta: number; solucao: number }> = {
  critica: { resposta: 2, solucao: 8 },
  alta: { resposta: 4, solucao: 8 },
  media: { resposta: 8, solucao: 16 },
  baixa: { resposta: 8, solucao: 40 },
};

export const STATUS_CHAMADO = ['aberto', 'em_atendimento', 'aguardando_cliente', 'resolvido', 'fechado', 'cancelado'] as const;
export type StatusChamado = (typeof STATUS_CHAMADO)[number];
export const STATUS_CHAMADO_LABEL: Record<StatusChamado, string> = {
  aberto: 'Aberto',
  em_atendimento: 'Em atendimento',
  aguardando_cliente: 'Aguardando o órgão',
  resolvido: 'Resolvido',
  fechado: 'Fechado',
  cancelado: 'Cancelado',
};
export const STATUS_ENCERRADOS: readonly StatusChamado[] = ['resolvido', 'fechado', 'cancelado'];

export const CANAIS_CHAMADO = ['portal', 'email', 'telefone', 'whatsapp', 'presencial'] as const;
export const CANAL_CHAMADO_LABEL: Record<(typeof CANAIS_CHAMADO)[number], string> = {
  portal: 'Sistema',
  email: 'E-mail',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  presencial: 'Presencial',
};

export const CATEGORIAS_CHAMADO = ['duvida', 'erro', 'melhoria', 'acesso', 'dados', 'outro'] as const;
export const CATEGORIA_CHAMADO_LABEL: Record<(typeof CATEGORIAS_CHAMADO)[number], string> = {
  duvida: 'Dúvida',
  erro: 'Erro no sistema',
  melhoria: 'Sugestão de melhoria',
  acesso: 'Acesso e senha',
  dados: 'Ajuste de dados',
  outro: 'Outro',
};

// ---------------- Calendario de horas uteis ----------------

const FUSO_MS = -3 * 3_600_000;
const JANELAS: Array<[number, number]> = [
  [8 * 60, 12 * 60],
  [13 * 60, 17 * 60],
];

/** Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher). */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Feriados nacionais (fixos e moveis: Carnaval, Sexta-feira Santa, Corpus Christi). */
export function feriadosNacionais(ano: number): Map<string, string> {
  const m = new Map<string, string>([
    [`${ano}-01-01`, 'Confraternização Universal'],
    [`${ano}-04-21`, 'Tiradentes'],
    [`${ano}-05-01`, 'Dia do Trabalho'],
    [`${ano}-09-07`, 'Independência do Brasil'],
    [`${ano}-10-12`, 'Nossa Senhora Aparecida'],
    [`${ano}-11-02`, 'Finados'],
    [`${ano}-11-15`, 'Proclamação da República'],
    [`${ano}-11-20`, 'Dia da Consciência Negra'],
    [`${ano}-12-25`, 'Natal'],
  ]);
  const p = pascoa(ano).getTime();
  const dia = 86_400_000;
  m.set(iso(new Date(p - 48 * dia)), 'Carnaval');
  m.set(iso(new Date(p - 47 * dia)), 'Carnaval');
  m.set(iso(new Date(p - 2 * dia)), 'Sexta-feira Santa');
  m.set(iso(new Date(p + 60 * dia)), 'Corpus Christi');
  return m;
}

/** Feriados extras (cadastrados no superadmin) em YYYY-MM-DD. */
export type FeriadosExtras = ReadonlySet<string>;

function ehDiaUtil(local: Date, extras: FeriadosExtras): boolean {
  const dow = local.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const d = iso(local);
  return !extras.has(d) && !feriadosNacionais(local.getUTCFullYear()).has(d);
}

/**
 * Soma horas uteis a um instante. Trabalha no "relogio de Fortaleza" (UTC-3
 * fixo): exemplo, sexta 16h30 + 2 h = segunda 09h30.
 */
export function somarHorasUteis(inicio: Date, horas: number, extras: FeriadosExtras = new Set()): Date {
  let restante = Math.round(horas * 60);
  // "Local" = instante deslocado para que os campos UTC mostrem a hora de Fortaleza.
  let local = new Date(inicio.getTime() + FUSO_MS);
  for (let guarda = 0; guarda < 10_000; guarda++) {
    if (ehDiaUtil(local, extras)) {
      const min = local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60;
      for (const [ini, fim] of JANELAS) {
        if (min >= fim) continue;
        const de = Math.max(min, ini);
        const cabe = fim - de;
        if (restante <= cabe) {
          const fimLocal = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + (de + restante) * 60_000);
          return new Date(fimLocal.getTime() - FUSO_MS);
        }
        restante -= cabe;
      }
    }
    local = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1));
  }
  throw new Error('Prazo fora do calendário');
}

/** Horas uteis entre dois instantes (tempo de resposta/solucao do relatorio de SLA). */
export function horasUteisEntre(a: Date, b: Date, extras: FeriadosExtras = new Set()): number {
  if (b <= a) return 0;
  let total = 0;
  let local = new Date(a.getTime() + FUSO_MS);
  const fimLocal = b.getTime() + FUSO_MS;
  for (let guarda = 0; guarda < 10_000 && local.getTime() < fimLocal; guarda++) {
    const dia0 = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    if (ehDiaUtil(local, extras)) {
      for (const [ini, fim] of JANELAS) {
        const s = Math.max(local.getTime(), dia0 + ini * 60_000);
        const e = Math.min(fimLocal, dia0 + fim * 60_000);
        if (e > s) total += e - s;
      }
    }
    local = new Date(dia0 + 86_400_000);
  }
  return total / 3_600_000;
}

// ---------------- Schemas e visoes ----------------

const anexoSchema = z
  .object({ key: z.string().regex(/^[0-9a-f-]{36}\.(pdf|png|jpg)$/), nome: z.string().max(200), tamanho: z.number().int().nonnegative() })
  .strict();
export type AnexoChamado = z.infer<typeof anexoSchema>;

/** Aberto pelo usuario do orgao (tela Suporte). */
export const chamadoCreateSchema = z
  .object({
    titulo: z.string().trim().min(5, 'Descreva em poucas palavras (mínimo de 5 caracteres)').max(160),
    descricao: z.string().trim().min(10, 'Conte um pouco mais (mínimo de 10 caracteres)').max(10_000),
    categoria: z.enum(CATEGORIAS_CHAMADO),
    criticidade: z.enum(CRITICIDADES),
    anexos: z.array(anexoSchema).max(5).default([]),
  })
  .strict();
export type ChamadoCreateInput = z.infer<typeof chamadoCreateSchema>;

/** Aberto pela equipe em nome do orgao (telefone, e-mail, WhatsApp...). */
export const chamadoCreateAdminSchema = chamadoCreateSchema
  .extend({
    tenantId: z.string().uuid(),
    canal: z.enum(CANAIS_CHAMADO),
    solicitanteNome: z.string().trim().min(2).max(200),
    solicitanteEmail: z.string().email().max(254).nullable().optional(),
  })
  .strict();
export type ChamadoCreateAdminInput = z.infer<typeof chamadoCreateAdminSchema>;

export const mensagemChamadoSchema = z
  .object({
    corpo: z.string().trim().min(1, 'Escreva a mensagem').max(10_000),
    interna: z.boolean().default(false),
    anexos: z.array(anexoSchema).max(5).default([]),
  })
  .strict();
export type MensagemChamadoInput = z.infer<typeof mensagemChamadoSchema>;

export const chamadoUpdateSchema = z
  .object({
    status: z.enum(STATUS_CHAMADO).optional(),
    criticidade: z.enum(CRITICIDADES).optional(),
    responsavelId: z.string().uuid().nullable().optional(),
    justificativa: z.string().trim().max(2000).nullable().optional(),
    contingencia: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();
export type ChamadoUpdateInput = z.infer<typeof chamadoUpdateSchema>;

export const avaliacaoChamadoSchema = z.object({ nota: z.number().int().min(1).max(5), comentario: z.string().trim().max(1000).optional() }).strict();

export interface ChamadoResumo {
  id: string;
  numero: number;
  tenantId: string;
  orgao: string;
  titulo: string;
  categoria: string;
  criticidade: Criticidade;
  status: StatusChamado;
  canal: string;
  abertoPor: string;
  responsavel: string | null;
  responsavelId: string | null;
  criadoEm: string;
  atualizadoEm: string;
  prazoResposta: string;
  prazoSolucao: string;
  respondidoEm: string | null;
  resolvidoEm: string | null;
  respostaAtrasada: boolean;
  solucaoAtrasada: boolean;
  satisfacao: number | null;
}

export interface MensagemChamado {
  id: string;
  autorTipo: 'user' | 'admin' | 'system';
  autor: string;
  corpo: string;
  interna: boolean;
  anexos: AnexoChamado[];
  criadoEm: string;
}

export interface ChamadoDetalhe extends ChamadoResumo {
  descricao: string;
  anexos: AnexoChamado[];
  justificativa: string | null;
  contingencia: string | null;
  solicitanteEmail: string | null;
  mensagens: MensagemChamado[];
}

export interface RelatorioSla {
  de: string;
  ate: string;
  total: number;
  respostaNoPrazoPct: number | null;
  solucaoNoPrazoPct: number | null;
  mediaRespostaH: number | null;
  mediaSolucaoH: number | null;
  atrasadosAbertos: number;
  satisfacaoMedia: number | null;
  porCriticidade: Array<{ criticidade: Criticidade; total: number; respostaNoPrazoPct: number | null; solucaoNoPrazoPct: number | null }>;
  porOrgao: Array<{ tenantId: string; orgao: string; total: number; respostaNoPrazoPct: number | null; solucaoNoPrazoPct: number | null; satisfacaoMedia: number | null }>;
}

// ---------------- Releases ----------------

export const TIPOS_RELEASE = ['evolutiva', 'corretiva', 'seguranca', 'manutencao'] as const;
export type TipoRelease = (typeof TIPOS_RELEASE)[number];
export const TIPO_RELEASE_LABEL: Record<TipoRelease, string> = {
  evolutiva: 'Novidade',
  corretiva: 'Correção',
  seguranca: 'Segurança',
  manutencao: 'Manutenção',
};

export const releaseSchema = z
  .object({
    versao: z.string().trim().regex(/^\d+\.\d+(\.\d+)?$/, 'Use o formato 1.2 ou 1.2.3'),
    titulo: z.string().trim().min(3).max(160),
    tipo: z.enum(TIPOS_RELEASE),
    corpo: z.string().trim().min(3).max(20_000),
  })
  .strict();
export type ReleaseInput = z.infer<typeof releaseSchema>;

export interface ReleaseView extends ReleaseInput {
  id: string;
  publicadoEm: string;
}

export const feriadoSchema = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), nome: z.string().trim().min(2).max(120) }).strict();
export type FeriadoInput = z.infer<typeof feriadoSchema>;
