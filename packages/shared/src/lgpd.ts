import { z } from 'zod';

/**
 * LGPD (Lei 13.709/2018). O orgao e o CONTROLADOR dos dados; a JEOS e a
 * OPERADORA; os provedores de nuvem sao SUBOPERADORES. A pagina publica
 * "Privacidade" de cada orgao junta as duas partes:
 * - plataforma (Superadmin > Configuracoes > LGPD): operador, suboperadores, hospedagem
 * - orgao (Configuracoes > Privacidade): encarregado (DPO) e uso de IA
 */

const texto = (max: number) => z.string().trim().max(max);

export const suboperadorSchema = z
  .object({
    nome: texto(120).min(2),
    finalidade: texto(300).min(3),
    /** Pais/regiao onde os dados ficam. */
    local: texto(120).min(2),
  })
  .strict();
export type Suboperador = z.infer<typeof suboperadorSchema>;

export const lgpdPlataformaSchema = z
  .object({
    operadorNome: texto(200).min(2),
    operadorCnpj: texto(20).optional().default(''),
    operadorEmail: z.string().trim().email().max(200),
    /** Onde ficam banco e arquivos (ex.: "Brasil — São Paulo"). */
    regiaoHospedagem: texto(200).min(2),
    suboperadores: z.array(suboperadorSchema).max(20),
    /** Compromissos contratuais exibidos na pagina (um por linha). */
    compromissos: z.array(texto(400).min(3)).max(20),
  })
  .strict();
export type LgpdPlataforma = z.infer<typeof lgpdPlataformaSchema>;

/** Padrao enquanto a equipe nao edita no painel. */
export const LGPD_PLATAFORMA_PADRAO: LgpdPlataforma = {
  operadorNome: 'JEOS Sistemas',
  operadorCnpj: '',
  operadorEmail: 'privacidade@jeossistemas.com',
  regiaoHospedagem: 'Nuvem com servidores no Brasil e nos Estados Unidos (ver suboperadores)',
  suboperadores: [
    { nome: 'Supabase', finalidade: 'Banco de dados e armazenamento dos arquivos', local: 'Brasil (São Paulo)' },
    { nome: 'Railway', finalidade: 'Servidor da aplicação (API)', local: 'Estados Unidos' },
    { nome: 'Vercel', finalidade: 'Entrega das telas do sistema', local: 'Global (CDN)' },
    { nome: 'Google (Gemini)', finalidade: 'Assistente e conferência por IA, só quando o órgão permite', local: 'Estados Unidos' },
  ],
  compromissos: [
    'Os documentos e dados pertencem ao órgão e são tratados apenas para prestar o serviço contratado.',
    'Os documentos não são usados para treinar modelos de inteligência artificial.',
    'Todo acesso fica registrado na trilha de auditoria, que não pode ser alterada.',
    'Ao fim do contrato, o órgão recebe a exportação integral dos documentos e metadados em formatos abertos.',
    'Incidentes de segurança são comunicados ao órgão em até 24 horas da ciência, com descrição, dados afetados e medidas de contenção, para as providências do art. 48 da LGPD.',
  ],
};

export const privacidadeOrgaoSchema = z
  .object({
    encarregadoNome: texto(200).optional().default(''),
    encarregadoEmail: z.union([z.literal(''), z.string().trim().email().max(200)]).default(''),
    encarregadoTelefone: texto(40).optional().default(''),
    /** Desliga assistente e conferencia por IA: nenhum documento sai para provedor de IA. */
    iaDesligada: z.boolean().default(false),
  })
  .strict();
export type PrivacidadeOrgao = z.infer<typeof privacidadeOrgaoSchema>;

/** Pagina publica /[slug]/privacidade. */
export interface PrivacidadePublica {
  orgao: string;
  encarregado: { nome: string; email: string; telefone: string } | null;
  iaDesligada: boolean;
  plataforma: LgpdPlataforma;
}

/** Direitos do titular (LGPD art. 18) registrados no Atendimento. */
export const DIREITOS_LGPD = [
  'confirmacao',
  'acesso',
  'correcao',
  'anonimizacao',
  'eliminacao',
  'portabilidade',
  'informacao_compartilhamento',
  'revogacao_consentimento',
  'oposicao',
] as const;
export type DireitoLgpd = (typeof DIREITOS_LGPD)[number];
export const DIREITO_LGPD_LABEL: Record<DireitoLgpd, string> = {
  confirmacao: 'Confirmação de que há tratamento',
  acesso: 'Acesso aos dados',
  correcao: 'Correção de dados',
  anonimizacao: 'Anonimização ou bloqueio',
  eliminacao: 'Eliminação de dados',
  portabilidade: 'Portabilidade',
  informacao_compartilhamento: 'Com quem os dados foram compartilhados',
  revogacao_consentimento: 'Revogação do consentimento',
  oposicao: 'Oposição ao tratamento',
};

/** LGPD art. 19, II: resposta completa em ate 15 dias. */
export const LGPD_PRAZO_DIAS = 15;
