import { z } from 'zod';
import { DOC_MODULES, type DocModule } from './documents.js';
import { FASES_ARQUIVISTICAS, NIVEIS_ACESSO, type FaseArquivistica, type NivelAcesso } from './arquivistica.js';

/**
 * Relatorios do Arquivo Municipal: inventario (listagem descritiva do acervo com
 * filtros), quantitativos (totais por fase, classe, tipo, modulo, exercicio) e
 * inventario topografico (o que ha em cada caixa/estante).
 */

/** Exportacao maior que isso pede filtro (PDF de milhares de paginas nao serve a ninguem). */
export const INVENTARIO_EXPORT_MAX = 20_000;

const listaModulos = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.enum(DOC_MODULES)).max(DOC_MODULES.length));

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const inventarioFiltroSchema = z
  .object({
    modulos: listaModulos.optional(),
    /** Codigo da classe; inclui as subclasses (prefixo: "100" pega 100.1, 100.2...). */
    classe: z.string().trim().max(40).regex(/^[0-9A-Za-z.-]+$/,'Código de classe inválido').optional(),
    semClasse: bool.optional(),
    fase: z.enum(FASES_ARQUIVISTICAS).optional(),
    nivelAcesso: z.enum(NIVEIS_ACESSO).optional(),
    tipoId: z.string().uuid().optional(),
    /** Local fisico; inclui tudo o que esta dentro dele (sala -> estantes -> caixas). */
    localId: z.string().uuid().optional(),
    exercicioDe: z.coerce.number().int().min(1800).max(2200).optional(),
    exercicioAte: z.coerce.number().int().min(1800).max(2200).optional(),
    q: z.string().trim().max(200).optional(),
    incluirEliminados: bool.optional(),
    /** LGPD: so documentos com dados pessoais (sim) ou so com sensiveis. */
    dadosPessoais: z.enum(['sim', 'sensiveis']).optional(),
    orgaoId: z.string().uuid().optional(),
  })
  .strict();
export type InventarioFiltro = z.infer<typeof inventarioFiltroSchema>;

export const inventarioQuerySchema = inventarioFiltroSchema
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type InventarioQuery = z.infer<typeof inventarioQuerySchema>;

export interface InventarioItem {
  id: string;
  classeCodigo: string | null;
  classeDescricao: string | null;
  tipo: string | null;
  /** Numero/titulo legivel (metadados do Acervo, doc. caixa, descricao...). */
  identificacao: string;
  dataDocumento: string | null;
  exercicio: number | null;
  modulo: DocModule;
  fase: FaseArquivistica;
  previsaoTransferencia: string | null;
  previsaoDestinacao: string | null;
  destinacao: 'eliminacao' | 'guarda_permanente' | null;
  /** Caminho do local fisico do original (ex.: "Sede / Sala 2 / CX-0012"). */
  localizacao: string | null;
  nivelAcesso: NivelAcesso;
  paginas: number | null;
  digitalizado: boolean;
  dadosPessoais: 'nao' | 'comuns' | 'sensiveis';
  secretaria: string | null;
}

export interface InventarioPage {
  items: InventarioItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface QuantitativoLinha {
  chave: string;
  rotulo: string;
  documentos: number;
  paginas: number;
}

export interface QuantitativoArquivo {
  totais: {
    documentos: number;
    paginas: number;
    bytes: number;
    digitalizados: number;
    comOriginalFisico: number;
    restritos: number;
    semClassificacao: number;
  };
  porFase: QuantitativoLinha[];
  porClasse: QuantitativoLinha[];
  porTipo: QuantitativoLinha[];
  porModulo: QuantitativoLinha[];
  porExercicio: QuantitativoLinha[];
}

/** Texto curto dos filtros aplicados (cabecalho dos PDFs e da tela). */
export function descreverFiltro(f: InventarioFiltro, nomes: { tipo?: string | null; local?: string | null } = {}): string[] {
  const out: string[] = [];
  if (f.modulos?.length) out.push(`Módulos: ${f.modulos.join(', ')}`);
  if (f.classe) out.push(`Classe: ${f.classe} (e subclasses)`);
  if (f.semClasse) out.push('Somente sem classificação');
  if (f.fase) out.push(`Fase: ${f.fase}`);
  if (f.nivelAcesso) out.push(`Acesso: ${f.nivelAcesso}`);
  if (f.tipoId) out.push(`Tipo: ${nomes.tipo ?? f.tipoId}`);
  if (f.localId) out.push(`Local: ${nomes.local ?? f.localId}`);
  if (f.exercicioDe || f.exercicioAte) out.push(`Exercício: ${f.exercicioDe ?? '…'} a ${f.exercicioAte ?? '…'}`);
  if (f.q) out.push(`Busca: "${f.q}"`);
  if (f.incluirEliminados) out.push('Inclui documentos eliminados');
  if (f.dadosPessoais) out.push(f.dadosPessoais === 'sensiveis' ? 'Só com dados pessoais sensíveis' : 'Só com dados pessoais');
  if (f.orgaoId) out.push('Uma secretaria');
  return out.length ? [out.join(' · ')] : ['Sem filtros: todo o acervo'];
}
