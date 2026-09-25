import type { Destinacao, EventoContagem } from './arquivistica.js';

export interface ClasseModelo {
  codigo: string;
  descricao: string;
  prazoCorrenteAnos: number | null;
  prazoIntermediarioAnos: number | null;
  destinacao: Destinacao | null;
  eventoContagem: EventoContagem;
  observacoes: string | null;
}

const grupo = (codigo: string, descricao: string): ClasseModelo => ({
  codigo,
  descricao,
  prazoCorrenteAnos: null,
  prazoIntermediarioAnos: null,
  destinacao: null,
  eventoContagem: 'data_documento',
  observacoes: null,
});

const OBS_TCE =
  'Eliminar somente após aprovação das contas do exercício pelo Tribunal de Contas e sem pendência judicial.';

/**
 * Modelo INICIAL de Plano de Classificacao + TTD, carregado sob demanda pelo
 * admin do orgao (Configuracoes > Plano de Classificacao). Estrutura inspirada
 * no Codigo de Classificacao do CONARQ para atividades-meio (000) e reserva a
 * faixa 100+ para atividades-fim do municipio.
 *
 * Os prazos sao SUGESTOES e devem ser revisados/aprovados pela Comissao
 * Permanente de Avaliacao de Documentos (CPAD) do orgao. Quando o prazo nao e
 * consensual, a destinacao sugerida e guarda permanente — errar para o lado
 * da preservacao nunca destroi documento.
 */
export const MODELO_CLASSIFICACAO: readonly ClasseModelo[] = [
  grupo('000', 'ADMINISTRAÇÃO GERAL'),
  grupo('010', 'Organização e funcionamento'),
  {
    codigo: '010.1',
    descricao: 'Atos de criação, estrutura, regimentos e regulamentos',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'data_documento',
    observacoes: null,
  },
  grupo('020', 'Pessoal'),
  {
    codigo: '020.1',
    descricao: 'Assentamentos funcionais (dossiê do servidor)',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'manual',
    observacoes: 'Contagem a partir do desligamento do servidor. Contém dados pessoais: usar acesso restrito.',
  },
  {
    codigo: '020.2',
    descricao: 'Folhas de pagamento',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'fim_exercicio',
    observacoes: 'Comprovação de tempo de serviço e remuneração.',
  },
  grupo('030', 'Material'),
  {
    codigo: '030.1',
    descricao: 'Aquisição, controle e distribuição de material',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'fim_exercicio',
    observacoes: null,
  },
  grupo('040', 'Patrimônio'),
  {
    codigo: '040.1',
    descricao: 'Bens imóveis (aquisição, escrituras, cessão, alienação)',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'data_documento',
    observacoes: null,
  },
  {
    codigo: '040.2',
    descricao: 'Bens móveis e veículos',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'data_documento',
    observacoes: null,
  },
  grupo('050', 'Orçamento e finanças'),
  {
    codigo: '051',
    descricao: 'Planejamento orçamentário (PPA, LDO, LOA e créditos adicionais)',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'fim_exercicio',
    observacoes: null,
  },
  grupo('052', 'Execução financeira'),
  {
    codigo: '052.1',
    descricao: 'Receita (orçamentária e extraorçamentária)',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'eliminacao',
    eventoContagem: 'fim_exercicio',
    observacoes: OBS_TCE,
  },
  {
    codigo: '052.2',
    descricao: 'Despesa (empenho, liquidação e pagamento)',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'eliminacao',
    eventoContagem: 'fim_exercicio',
    observacoes: OBS_TCE,
  },
  {
    codigo: '052.3',
    descricao: 'Movimentação bancária (extratos e conciliações)',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'eliminacao',
    eventoContagem: 'fim_exercicio',
    observacoes: OBS_TCE,
  },
  grupo('053', 'Contabilidade'),
  {
    codigo: '053.1',
    descricao: 'Balancetes mensais',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'eliminacao',
    eventoContagem: 'fim_exercicio',
    observacoes: OBS_TCE,
  },
  {
    codigo: '053.2',
    descricao: 'Balanço geral anual e demonstrações contábeis',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'fim_exercicio',
    observacoes: null,
  },
  {
    codigo: '054',
    descricao: 'Prestação de contas ao Tribunal de Contas',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'fim_exercicio',
    observacoes: null,
  },
  grupo('060', 'Documentação e informação'),
  {
    codigo: '060.1',
    descricao: 'Gestão de documentos (guias de transferência, listagens e termos de eliminação)',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'data_documento',
    observacoes: 'Prova da gestão arquivística — nunca eliminar.',
  },
  grupo('100', 'LEGISLAÇÃO E ATOS NORMATIVOS MUNICIPAIS'),
  {
    codigo: '100.1',
    descricao: 'Leis municipais',
    prazoCorrenteAnos: 10,
    prazoIntermediarioAnos: 0,
    destinacao: 'guarda_permanente',
    eventoContagem: 'data_documento',
    observacoes: null,
  },
  {
    codigo: '100.2',
    descricao: 'Decretos',
    prazoCorrenteAnos: 10,
    prazoIntermediarioAnos: 0,
    destinacao: 'guarda_permanente',
    eventoContagem: 'data_documento',
    observacoes: null,
  },
  {
    codigo: '100.3',
    descricao: 'Portarias',
    prazoCorrenteAnos: 10,
    prazoIntermediarioAnos: 0,
    destinacao: 'guarda_permanente',
    eventoContagem: 'data_documento',
    observacoes: null,
  },
  grupo('110', 'LICITAÇÕES E CONTRATOS'),
  {
    codigo: '110.1',
    descricao: 'Processos licitatórios, dispensas e inexigibilidades',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'fim_exercicio',
    observacoes: null,
  },
  {
    codigo: '110.2',
    descricao: 'Contratos, convênios e aditivos',
    prazoCorrenteAnos: 5,
    prazoIntermediarioAnos: 5,
    destinacao: 'guarda_permanente',
    eventoContagem: 'manual',
    observacoes: 'Contagem a partir do encerramento da vigência.',
  },
];

/** Classe padrao sugerida por modulo financeiro ao carregar o modelo. */
export const MODELO_PADRAO_POR_MODULO = {
  receitas: '052.1',
  despesas: '052.2',
  extrato: '052.3',
  balancete: '053.1',
} as const;

/**
 * Pai de um codigo entre os ja existentes. Subclasse com ponto sobe digito a
 * digito ("052.21" -> "052.2" -> "052"); codigo inteiro sobe para a dezena e
 * depois a centena ("052" -> "050" -> "000").
 */
export function codigoPai(codigo: string, existentes: ReadonlySet<string>): string | null {
  const [inteiro, fracao] = codigo.split('.') as [string, string | undefined];
  if (fracao !== undefined) {
    for (let n = fracao.length - 1; n >= 1; n--) {
      const c = `${inteiro}.${fracao.slice(0, n)}`;
      if (existentes.has(c)) return c;
    }
    if (existentes.has(inteiro)) return inteiro;
  }
  const n = Number(inteiro);
  if (!Number.isInteger(n)) return null;
  for (const passo of [10, 100]) {
    const c = String(Math.floor(n / passo) * passo).padStart(inteiro.length, '0');
    if ((fracao !== undefined || c !== inteiro) && existentes.has(c)) return c;
  }
  return null;
}
