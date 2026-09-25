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
