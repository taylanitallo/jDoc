/**
 * Operacao da plataforma: jobs, monitoramento de performance e correcoes.
 */

export const JOBS = {
  limpeza: {
    nome: 'Limpeza de registros antigos',
    descricao: 'Apaga requisições lentas e amostras de saúde com mais de 7 dias, métricas com mais de 90 dias e sessões e recuperações de senha vencidas.',
    agenda: 'Todo dia às 03h30',
    manual: true,
  },
  correcoes: {
    nome: 'Correções automáticas',
    descricao: 'Corrige sozinho o que é seguro (estatísticas do banco, conexões presas, órgão travado em manutenção, backup agendado que falhou...).',
    agenda: 'Todo dia às 12h00 (horário de menor uso), só as críticas',
    manual: true,
  },
  backup: {
    nome: 'Backup',
    descricao: 'Cópia do banco de um órgão (manual, agendada ou de segurança).',
    agenda: 'Conforme o agendamento de cada órgão',
    manual: false,
  },
  backup_completo: {
    nome: 'Backup completo',
    descricao: 'Cópia de todo o banco (catálogo e todos os órgãos).',
    agenda: 'Sob demanda',
    manual: false,
  },
  restauracao: {
    nome: 'Restauração',
    descricao: 'Restauração do banco de um órgão.',
    agenda: 'Sob demanda',
    manual: false,
  },
} as const;
export type JobNome = keyof typeof JOBS;
export const JOBS_MANUAIS = (Object.keys(JOBS) as JobNome[]).filter((j) => JOBS[j].manual);

export interface JobRunView {
  id: string;
  job: string;
  nome: string;
  tenantId: string | null;
  orgao: string | null;
  status: 'running' | 'success' | 'failed';
  origem: 'agendado' | 'manual';
  disparadoPor: string | null;
  inicio: string;
  fim: string | null;
  duracaoMs: number | null;
  tentativa: number;
  resumo: string | null;
  erro: string | null;
}

export const STATUS_JOB_LABEL = { running: 'Em andamento', success: 'Concluído', failed: 'Falhou' } as const;

// ---------------- Performance ----------------

/** Limites (ms) das faixas do histograma de tempo de resposta; a ultima e "acima". */
export const FAIXAS_MS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000] as const;

/** p-esimo percentil (0..1) a partir do histograma (limite superior da faixa). */
export function percentilDasFaixas(faixas: readonly number[], p: number, maximo: number): number {
  const total = faixas.reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  const alvo = Math.ceil(total * p);
  let acum = 0;
  for (let i = 0; i < faixas.length; i++) {
    acum += faixas[i] ?? 0;
    if (acum >= alvo) return i < FAIXAS_MS.length ? Math.min(FAIXAS_MS[i]!, maximo || FAIXAS_MS[i]!) : maximo;
  }
  return maximo;
}

export function indiceFaixa(ms: number): number {
  const i = FAIXAS_MS.findIndex((lim) => ms <= lim);
  return i === -1 ? FAIXAS_MS.length : i;
}

export interface RotaDesempenho {
  method: string;
  route: string;
  qtd: number;
  mediaMs: number;
  p95Ms: number;
  maxMs: number;
  erros5xx: number;
}

export interface PontoHora {
  hora: string;
  qtd: number;
  erros5xx: number;
  p95Ms: number;
  mediaMs: number;
}

export interface ErroAgrupado {
  fingerprint: string;
  method: string;
  route: string;
  mensagem: string;
  qtd: number;
  primeiraEm: string;
  ultimaEm: string;
  resolvido: boolean;
}

export interface AmostraSaude {
  em: string;
  memoriaMb: number;
  cpuPct: number;
  dbMs: number | null;
  redisMs: number | null;
  dbConexoes: number | null;
  dbTamanhoMb: number | null;
  filas: Record<string, { aguardando: number; ativos: number; falhas: number; atrasados: number }>;
}

export interface ConsultaLenta {
  consulta: string;
  chamadas: number;
  mediaMs: number;
  totalMs: number;
}

export interface PainelPerformance {
  horas: number;
  kpis: {
    requisicoes: number;
    porMinuto: number;
    p95Ms: number;
    mediaMs: number;
    taxaErroPct: number;
    lentas: number;
    filasComFalha: number;
  };
  serie: PontoHora[];
  rotas: RotaDesempenho[];
  erros: ErroAgrupado[];
  saude: AmostraSaude | null;
  serieSaude: Array<{ em: string; memoriaMb: number; cpuPct: number; dbMs: number | null }>;
  consultas: ConsultaLenta[] | null;
  limiteLentaMs: number;
}

export interface RequisicaoLenta {
  id: string;
  method: string;
  route: string;
  status: number;
  duracaoMs: number;
  orgao: string | null;
  em: string;
}

// ---------------- Correcoes ----------------

export type SeveridadeCorrecao = 'critica' | 'media' | 'baixa';

export const SEVERIDADE_LABEL: Record<SeveridadeCorrecao, string> = { critica: 'Crítica', media: 'Média', baixa: 'Baixa' };

export interface Correcao {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  severidade: SeveridadeCorrecao;
  /** false = precisa mudar o codigo; so aparece como diagnostico. */
  automatica: boolean;
  /** O que sera feito ao executar (ex.: "ANALYZE em tenant_x.documents"). */
  acao: string | null;
  evidencia: string | null;
}

export interface ResultadoCorrecoes {
  aplicadas: Array<{ id: string; titulo: string }>;
  falhas: Array<{ id: string; titulo: string; erro: string }>;
  ignoradas: number;
}

// ---------------- Painel (visao geral) ----------------

export interface PainelPlataforma {
  kpis: {
    orgaosAtivos: number;
    orgaosTotal: number;
    usuariosAtivos: number;
    acessos24h: number;
    chamadosAbertos: number;
    chamadosAtrasados: number;
    ultimoBackup: { status: 'concluido' | 'erro' | 'processando' | 'pendente'; em: string; orgao: string | null } | null;
    backupsComFalha24h: number;
    jobsComFalha24h: number;
  };
  falhasLogin: {
    porOrgao: Array<{ orgao: string; tenantId: string | null; qtd: number }>;
    porIp: Array<{ ip: string; qtd: number }>;
  };
  rotasLentas: Array<{ method: string; route: string; qtd: number; mediaMs: number; maxMs: number }>;
  orgaos: Array<{
    id: string;
    nome: string;
    slug: string;
    cidade: string | null;
    uf: string | null;
    status: string;
    brasaoUrl: string | null;
    usuariosAtivos: number;
    ultimoAcesso: string | null;
  }>;
}
