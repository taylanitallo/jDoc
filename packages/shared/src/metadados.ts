import { z } from 'zod';

/**
 * Metadados configuraveis por Tipo de Documento (modulo Acervo). Cada tipo
 * define seus campos (ex.: Lei = numero, data de publicacao, ementa); o
 * documento guarda os valores em `documents.metadados` (jsonb).
 *
 * Valores sempre como string (vem de formulario/multipart); o tipo do campo
 * define o formato aceito. O mesmo validador roda no front e no back.
 */
export const TIPOS_CAMPO = ['texto', 'texto_longo', 'numero', 'data', 'selecao'] as const;
export const tipoCampoSchema = z.enum(TIPOS_CAMPO);
export type TipoCampo = z.infer<typeof tipoCampoSchema>;

/** Chave do campo: identificador estavel (vira chave no jsonb e no indice de busca). */
export const CHAVE_CAMPO_REGEX = /^[a-z][a-z0-9_]{0,39}$/;

export const campoMetadadoSchema = z
  .object({
    chave: z.string().regex(CHAVE_CAMPO_REGEX, 'Chave: letras minusculas, numeros e _ (ex.: numero_lei)'),
    rotulo: z.string().min(1).max(80),
    tipo: tipoCampoSchema,
    obrigatorio: z.boolean().default(false),
    /** Somente para tipo 'selecao'. */
    opcoes: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .strict()
  .refine((c) => c.tipo !== 'selecao' || (c.opcoes?.length ?? 0) > 0, {
    message: 'Campo de selecao precisa de ao menos uma opcao',
    path: ['opcoes'],
  });
export type CampoMetadado = z.infer<typeof campoMetadadoSchema>;

export const camposMetadadosSchema = z
  .array(campoMetadadoSchema)
  .max(30)
  .refine((cs) => new Set(cs.map((c) => c.chave)).size === cs.length, { message: 'Chaves de campo repetidas' });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERO = /^-?\d+([.,]\d+)?$/;

/**
 * Gera o validador dos metadados de um tipo. Estrito: chave fora da definicao
 * e rejeitada (sem mass assignment no jsonb). Vazio em campo opcional = omitido.
 */
export function metadadosSchemaFor(campos: readonly CampoMetadado[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const c of campos) {
    let s: z.ZodTypeAny;
    switch (c.tipo) {
      case 'texto':
        s = z.string().trim().max(500);
        break;
      case 'texto_longo':
        s = z.string().trim().max(5000);
        break;
      case 'numero':
        s = z.string().trim().regex(NUMERO, `${c.rotulo}: número inválido`);
        break;
      case 'data':
        s = z.string().regex(ISO_DATE, `${c.rotulo}: data inválida`);
        break;
      case 'selecao':
        s = z.string().refine((v) => (c.opcoes ?? []).includes(v), `${c.rotulo}: opção inválida`);
        break;
    }
    shape[c.chave] = c.obrigatorio
      ? z
          .string({ required_error: `${c.rotulo} é obrigatório`, invalid_type_error: `${c.rotulo} é obrigatório` })
          .min(1, `${c.rotulo} é obrigatório`)
          .pipe(s)
      : z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional());
  }
  return z.object(shape).strict();
}

export type Metadados = Record<string, string>;

/** Aceita objeto ou string JSON (multipart manda string). */
export const metadadosInputSchema = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v; // falha no z.record abaixo com mensagem clara
  }
}, z.record(z.string(), z.string().max(5000)));

/** Texto de exibicao de um valor conforme o tipo (data ISO -> dd/mm/aaaa). */
export function formatarMetadado(campo: Pick<CampoMetadado, 'tipo'>, valor: string | undefined): string {
  if (!valor) return '—';
  if (campo.tipo === 'data' && ISO_DATE.test(valor)) {
    const [a, m, d] = valor.split('-');
    return `${d}/${m}/${a}`;
  }
  return valor;
}

/** Modelos prontos de tipos documentais comuns no Arquivo Municipal (o admin ajusta). */
export const MODELOS_TIPO_ACERVO: ReadonlyArray<{
  nome: string;
  descricao: string;
  classificacaoCodigo: string | null;
  nivelAcessoPadrao: 'publico' | 'restrito';
  campos: CampoMetadado[];
}> = [
  {
    nome: 'Lei Municipal',
    descricao: 'Leis ordinárias e complementares',
    classificacaoCodigo: '100.1',
    nivelAcessoPadrao: 'restrito',
    campos: [
      { chave: 'numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true },
      { chave: 'data_publicacao', rotulo: 'Data de publicação', tipo: 'data', obrigatorio: false },
      { chave: 'ementa', rotulo: 'Ementa', tipo: 'texto_longo', obrigatorio: true },
      { chave: 'especie', rotulo: 'Espécie', tipo: 'selecao', obrigatorio: false, opcoes: ['Ordinária', 'Complementar'] },
    ],
  },
  {
    nome: 'Decreto',
    descricao: 'Decretos do Executivo',
    classificacaoCodigo: '100.2',
    nivelAcessoPadrao: 'restrito',
    campos: [
      { chave: 'numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true },
      { chave: 'data_publicacao', rotulo: 'Data de publicação', tipo: 'data', obrigatorio: false },
      { chave: 'ementa', rotulo: 'Ementa', tipo: 'texto_longo', obrigatorio: true },
    ],
  },
  {
    nome: 'Portaria',
    descricao: 'Portarias (nomeações, designações, etc.)',
    classificacaoCodigo: '100.3',
    nivelAcessoPadrao: 'restrito',
    campos: [
      { chave: 'numero', rotulo: 'Número', tipo: 'texto', obrigatorio: true },
      { chave: 'assunto', rotulo: 'Assunto', tipo: 'texto_longo', obrigatorio: true },
      { chave: 'interessado', rotulo: 'Interessado', tipo: 'texto', obrigatorio: false },
    ],
  },
  {
    nome: 'Contrato',
    descricao: 'Contratos, convênios e aditivos',
    classificacaoCodigo: '110.2',
    nivelAcessoPadrao: 'restrito',
    campos: [
      { chave: 'numero', rotulo: 'Número do contrato', tipo: 'texto', obrigatorio: true },
      { chave: 'contratado', rotulo: 'Contratado', tipo: 'texto', obrigatorio: true },
      { chave: 'cnpj_cpf', rotulo: 'CNPJ/CPF', tipo: 'texto', obrigatorio: false },
      { chave: 'valor', rotulo: 'Valor global (R$)', tipo: 'numero', obrigatorio: false },
      { chave: 'vigencia_inicio', rotulo: 'Início da vigência', tipo: 'data', obrigatorio: false },
      { chave: 'vigencia_fim', rotulo: 'Fim da vigência', tipo: 'data', obrigatorio: false },
      { chave: 'processo', rotulo: 'Processo licitatório', tipo: 'texto', obrigatorio: false },
    ],
  },
  {
    nome: 'Processo Licitatório',
    descricao: 'Licitações, dispensas e inexigibilidades',
    classificacaoCodigo: '110.1',
    nivelAcessoPadrao: 'restrito',
    campos: [
      { chave: 'numero', rotulo: 'Número do processo', tipo: 'texto', obrigatorio: true },
      {
        chave: 'modalidade',
        rotulo: 'Modalidade',
        tipo: 'selecao',
        obrigatorio: true,
        opcoes: ['Pregão', 'Concorrência', 'Concurso', 'Leilão', 'Diálogo competitivo', 'Dispensa', 'Inexigibilidade'],
      },
      { chave: 'objeto', rotulo: 'Objeto', tipo: 'texto_longo', obrigatorio: true },
    ],
  },
  {
    nome: 'Ficha Funcional',
    descricao: 'Assentamento individual do servidor (dados pessoais — LGPD)',
    classificacaoCodigo: '020.1',
    nivelAcessoPadrao: 'restrito',
    campos: [
      { chave: 'servidor', rotulo: 'Servidor', tipo: 'texto', obrigatorio: true },
      { chave: 'matricula', rotulo: 'Matrícula', tipo: 'texto', obrigatorio: true },
      { chave: 'cargo', rotulo: 'Cargo', tipo: 'texto', obrigatorio: false },
    ],
  },
];

/** Tipo documental como os modais de inclusao consomem (GET /t/:slug/document-types?modulo=). */
export interface DocumentTypeLookup {
  id: string;
  nome: string;
  cor: string;
  campos: CampoMetadado[];
  classificacaoId: string | null;
  nivelAcessoPadrao: 'publico' | 'restrito';
}

// ---------------- Dicionario de metadados ----------------

export interface CampoDicionario {
  campo: string;
  rotulo: string;
  descricao: string;
  formato: string;
  obrigatorio: boolean;
  exemplo: string;
}

/**
 * Metadados padrao de todo documento (e-ARQ Brasil / Decreto 10.278/2020).
 * O dicionario do orgao = esta lista + os campos de cada tipo de documento.
 */
export const CAMPOS_PADRAO_DICIONARIO: CampoDicionario[] = [
  { campo: 'identificador', rotulo: 'Identificador', descricao: 'Código único do documento no sistema', formato: 'UUID', obrigatorio: true, exemplo: '3f2c…9a1b' },
  { campo: 'modulo', rotulo: 'Módulo', descricao: 'Área do sistema onde o documento está (Acervo, Despesas, Receitas...)', formato: 'Lista', obrigatorio: true, exemplo: 'Acervo' },
  { campo: 'secretaria', rotulo: 'Secretaria', descricao: 'Secretaria/órgão produtor (código e nome)', formato: 'Texto', obrigatorio: false, exemplo: '06 — Secretaria de Educação' },
  { campo: 'tipo_documental', rotulo: 'Tipo documental', descricao: 'Espécie do documento (lei, decreto, contrato, processo...)', formato: 'Lista', obrigatorio: false, exemplo: 'Decreto' },
  { campo: 'numero', rotulo: 'Número', descricao: 'Número do documento ou do processo', formato: 'Texto (até 60)', obrigatorio: false, exemplo: '123/2026' },
  { campo: 'assunto', rotulo: 'Assunto', descricao: 'Resumo do conteúdo (ementa, objeto)', formato: 'Texto (até 500)', obrigatorio: false, exemplo: 'Nomeação de servidores' },
  { campo: 'interessado', rotulo: 'Interessado', descricao: 'Pessoa, empresa ou setor a quem o documento se refere', formato: 'Texto (até 300)', obrigatorio: false, exemplo: 'Maria da Silva' },
  { campo: 'palavras_chave', rotulo: 'Palavras-chave', descricao: 'Termos para pesquisa, separados por vírgula', formato: 'Lista de textos (até 30)', obrigatorio: false, exemplo: 'nomeação, educação' },
  { campo: 'data_documento', rotulo: 'Data do documento', descricao: 'Data de produção', formato: 'Data (DD/MM/AAAA)', obrigatorio: true, exemplo: '10/05/2026' },
  { campo: 'exercicio', rotulo: 'Exercício', descricao: 'Ano a que o documento se refere', formato: 'Número (AAAA)', obrigatorio: true, exemplo: '2026' },
  { campo: 'descricao', rotulo: 'Descrição', descricao: 'Descrição livre do documento', formato: 'Texto (até 2000)', obrigatorio: false, exemplo: 'Decreto de nomeação' },
  { campo: 'classificacao', rotulo: 'Classificação', descricao: 'Classe do Plano de Classificação (CONARQ)', formato: 'Código + descrição', obrigatorio: false, exemplo: '022.1 — Admissão' },
  { campo: 'fase', rotulo: 'Fase arquivística', descricao: 'Corrente, intermediária, permanente ou eliminado', formato: 'Lista', obrigatorio: true, exemplo: 'Corrente' },
  { campo: 'prazos', rotulo: 'Prazos de guarda', descricao: 'Datas previstas de transferência e destinação (TTD)', formato: 'Datas', obrigatorio: false, exemplo: '31/12/2031' },
  { campo: 'nivel_acesso', rotulo: 'Nível de acesso', descricao: 'Público, restrito ou sigiloso (classificado pela LAI)', formato: 'Lista', obrigatorio: true, exemplo: 'Restrito' },
  { campo: 'dados_pessoais', rotulo: 'Dados pessoais (LGPD)', descricao: 'Se o documento contém dados pessoais comuns ou sensíveis', formato: 'Lista', obrigatorio: true, exemplo: 'Dados pessoais' },
  { campo: 'hash_sha256', rotulo: 'Hash SHA-256', descricao: 'Resumo criptográfico do arquivo, para provar integridade', formato: '64 caracteres hexadecimais', obrigatorio: true, exemplo: 'e3b0c442…b855' },
  { campo: 'paginas', rotulo: 'Páginas', descricao: 'Quantidade de páginas do PDF', formato: 'Número', obrigatorio: false, exemplo: '12' },
  { campo: 'digitalizacao', rotulo: 'Digitalização', descricao: 'Responsável, data e local da digitalização (Decreto 10.278/2020)', formato: 'Texto + data', obrigatorio: false, exemplo: 'João — 20/05/2026 — Arquivo Central' },
  { campo: 'local_fisico', rotulo: 'Localização do original', descricao: 'Caixa/estante onde está o papel', formato: 'Código do local', obrigatorio: false, exemplo: 'PRED1/SALA2/EST3/CX45' },
  { campo: 'nome_arquivo', rotulo: 'Nome do arquivo', descricao: 'Nome original do PDF enviado', formato: 'Texto', obrigatorio: true, exemplo: 'decreto-123-2026.pdf' },
];

/** Padrao de nomes e pastas usado na exportacao integral do acervo. */
export const PADRAO_NOMES_EXPORTACAO =
  '<secretaria>/<exercício>/<módulo>/<tipo documental>/<data AAAA-MM-DD>_<número ou identificador>.pdf — sem acentos, espaços viram hífen';

export const ROTULO_TIPO_CAMPO: Record<TipoCampo, string> = {
  texto: 'Texto',
  texto_longo: 'Texto longo',
  numero: 'Número',
  data: 'Data',
  selecao: 'Lista',
};
