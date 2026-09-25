import { z } from 'zod';

/**
 * Legislacao compilada (estilo Planalto): o texto da norma guardado dispositivo por
 * dispositivo (artigo, paragrafo, inciso, alinea...), com o historico de redacoes
 * dadas por normas posteriores. O "texto compilado" mostra a redacao vigente numa data,
 * o texto superado riscado e as notas "(Redação dada pela Lei nº X)".
 */

export const TIPOS_NORMA = ['lei', 'lei_complementar', 'decreto', 'portaria', 'resolucao', 'emenda_lom', 'lei_organica', 'outro'] as const;
export type TipoNorma = (typeof TIPOS_NORMA)[number];
export const TIPO_NORMA_LABEL: Record<TipoNorma, string> = {
  lei: 'Lei',
  lei_complementar: 'Lei Complementar',
  decreto: 'Decreto',
  portaria: 'Portaria',
  resolucao: 'Resolução',
  emenda_lom: 'Emenda à Lei Orgânica',
  lei_organica: 'Lei Orgânica',
  outro: 'Ato normativo',
};

export const SITUACOES_NORMA = ['vigente', 'alterada', 'revogada_parcial', 'revogada'] as const;
export type SituacaoNorma = (typeof SITUACOES_NORMA)[number];
export const SITUACAO_NORMA_LABEL: Record<SituacaoNorma, string> = {
  vigente: 'Vigente',
  alterada: 'Alterada',
  revogada_parcial: 'Revogada parcialmente',
  revogada: 'Revogada',
};

export const TIPOS_DISPOSITIVO = [
  'preambulo',
  'parte',
  'livro',
  'titulo',
  'capitulo',
  'secao',
  'subsecao',
  'artigo',
  'paragrafo',
  'inciso',
  'alinea',
  'item',
  'fecho',
] as const;
export type TipoDispositivo = (typeof TIPOS_DISPOSITIVO)[number];
export const TIPO_DISPOSITIVO_LABEL: Record<TipoDispositivo, string> = {
  preambulo: 'Preâmbulo',
  parte: 'Parte',
  livro: 'Livro',
  titulo: 'Título',
  capitulo: 'Capítulo',
  secao: 'Seção',
  subsecao: 'Subseção',
  artigo: 'Artigo',
  paragrafo: 'Parágrafo',
  inciso: 'Inciso',
  alinea: 'Alínea',
  item: 'Item',
  fecho: 'Fecho',
};
/** Agrupadores (estrutura), que nao sao "dispositivos" normativos. */
export const AGRUPADORES: readonly TipoDispositivo[] = ['parte', 'livro', 'titulo', 'capitulo', 'secao', 'subsecao'];

export const ACOES_REDACAO = ['redacao', 'revogacao', 'inclusao'] as const;
export type AcaoRedacao = (typeof ACOES_REDACAO)[number];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface DispositivoParse {
  /** Id provisorio ("d1", "d2"...) usado para montar a arvore antes de gravar. */
  ref: string;
  parentRef: string | null;
  tipo: TipoDispositivo;
  rotulo: string;
  texto: string;
}

const ORD = '[º°ºª]|o(?=\\s)';
const NIVEL_AGRUPADOR: Record<string, number> = { parte: 0, livro: 1, titulo: 2, capitulo: 3, secao: 4, subsecao: 5 };

// Caixa alta (TÍTULO/CAPÍTULO) ou "Seção"/"Subseção" com inicial maiuscula: evita
// confundir "parte II desta Lei" no meio do texto com um agrupador.
const RE_AGRUPADOR =
  /^(PARTE|LIVRO|T[IÍ]TULO|CAP[IÍ]TULO|SUBSE[CÇ][AÃ]O|SE[CÇ][AÃ]O|Subse[cç][aã]o|Se[cç][aã]o)\s+([IVXLCDM]+|[ÚU]NIC[OA]|\d+|GERAL|ESPECIAL)\b\s*[-–—.:]?\s*(.*)$/;
// Sufixo "-A" colado ao numero (Art. 1º-A); em "Art. 3º - O prefeito" o hifen nao e sufixo.
const SUFIXO = '(-[A-Z](?=[\\s.–—:]|$))?';
const RE_ARTIGO = new RegExp(`^Art(?:igo)?\\.?\\s*(\\d+)\\s*(?:${ORD})?${SUFIXO}\\s*[.\\-–—:]?\\s*(.*)$`);
const RE_PARAGRAFO_UNICO = /^Par[aá]grafo\s+[úu]nico\s*[.\-–—:]?\s*(.*)$/i;
const RE_PARAGRAFO = new RegExp(`^§\\s*(\\d+)\\s*(?:${ORD})?${SUFIXO}\\s*[.\\-–—:]?\\s*(.*)$`);
const RE_INCISO = /^([IVXLCDM]+)(-[A-Z])?\s*[-–—]\s*(.*)$/;
const RE_ALINEA = /^([a-z])\)\s*(.*)$/;
const RE_ITEM = /^(\d{1,2})[.)]\s+(.*)$/;
/** Inicio do fecho: local e data, assinaturas ("Paço Municipal...", "Itapajé, 10 de março de 2020"). */
const RE_FECHO = /^(Pa[cç]o\b|Gabinete d[oa]\b|Sala das Sess[oõ]es|Prefeitura Municipal de .{2,60},\s*(em\s*)?\d|[A-ZÀ-Ú][\p{L} ]{2,40},\s*(em\s*)?\d{1,2}\s*(de\s+)?[\p{L}]+\s+de\s+\d{4})/u;
/** Epigrafe: "LEI Nº 1.234, DE 15 DE ABRIL DE 2019", "DECRETO N.º 45/2021", "PORTARIA Nº 10". */
const RE_EPIGRAFE = /^(LEI|DECRETO|PORTARIA|RESOLU[CÇ][AÃ]O|EMENDA|LEI COMPLEMENTAR|LEI ORG[AÂ]NICA)\b.*\bN\.?\s*[º°o]?\s*\.?\s*\d/i;
/** Inicio do preambulo (formula de promulgacao). */
const RE_PREAMBULO = /^(O|A)\s+(PREFEIT[OA]|PRESIDENTE|C[AÂ]MARA|GOVERNADOR|VICE|SECRET[AÁ]RI[OA])|^(Fa[cç]o saber|FA[CÇ]O SABER|DECRETA|RESOLVE)/;

/** Notas de texto ja compilado (quando se importa de um site compilado): retiradas do texto. */
const RE_NOTAS = /\s*\((?:Reda[cç][aã]o dada|Inclu[ií]d[oa]|Renumerad[oa]|Vide|Vig[eê]ncia|Regulamento|Promulga[cç][aã]o)[^)]*\)/gi;

function ordinal(n: number): string {
  return n < 10 ? `${n}º` : `${n}`;
}
function sufixo(s: string | undefined): string {
  return s ? `-${s.replace(/[-\s]/g, '')}` : '';
}

/**
 * Separa o texto de uma norma em dispositivos. Tolerante ao texto extraido de PDF/OCR:
 * linhas quebradas no meio da frase sao juntadas ao dispositivo corrente.
 */
export function parseTextoNormativo(texto: string): DispositivoParse[] {
  const linhas = texto
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(RE_NOTAS, '').replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0);

  const out: DispositivoParse[] = [];
  let seq = 0;
  const novo = (tipo: TipoDispositivo, rotulo: string, textoIni: string, parentRef: string | null): DispositivoParse => {
    const d: DispositivoParse = { ref: `d${++seq}`, parentRef, tipo, rotulo, texto: textoIni.trim() };
    out.push(d);
    return d;
  };

  // Pilha de agrupadores abertos (parte > livro > titulo > capitulo > secao > subsecao).
  const agrupadores: DispositivoParse[] = [];
  let artigo: DispositivoParse | null = null;
  let paragrafo: DispositivoParse | null = null;
  let inciso: DispositivoParse | null = null;
  let alinea: DispositivoParse | null = null;
  let atual: DispositivoParse | null = null;
  let fecho: DispositivoParse | null = null;
  /** Agrupador que acabou de abrir: a proxima linha em caixa alta e o nome dele ("DA PERSONALIDADE"). */
  let aguardandoNome: DispositivoParse | null = null;

  const paiAgrupador = () => agrupadores[agrupadores.length - 1]?.ref ?? null;
  const fecharArtigo = () => {
    artigo = null;
    paragrafo = null;
    inciso = null;
    alinea = null;
  };

  for (const linha of linhas) {
    if (fecho) {
      fecho.texto += `\n${linha}`;
      continue;
    }
    let m: RegExpMatchArray | null;

    if ((m = linha.match(RE_AGRUPADOR))) {
      const palavra = m[1]!
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
      const tipo = (palavra === 'subsecao' ? 'subsecao' : palavra === 'secao' ? 'secao' : palavra) as TipoDispositivo;
      const nivel = NIVEL_AGRUPADOR[tipo]!;
      while (agrupadores.length && NIVEL_AGRUPADOR[agrupadores[agrupadores.length - 1]!.tipo]! >= nivel) agrupadores.pop();
      fecharArtigo();
      const d = novo(tipo, `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}`, m[3] ?? '', paiAgrupador());
      agrupadores.push(d);
      atual = d;
      aguardandoNome = m[3] ? null : d;
      continue;
    }
    if (aguardandoNome && linha === linha.toUpperCase() && /\p{L}/u.test(linha) && !RE_ARTIGO.test(linha)) {
      aguardandoNome.texto = aguardandoNome.texto ? `${aguardandoNome.texto} ${linha}` : linha;
      continue;
    }
    aguardandoNome = null;

    if ((m = linha.match(RE_ARTIGO))) {
      fecharArtigo();
      artigo = novo('artigo', `Art. ${ordinal(Number(m[1]))}${sufixo(m[2])}`, m[3] ?? '', paiAgrupador());
      atual = artigo;
      continue;
    }
    if (artigo && (m = linha.match(RE_PARAGRAFO_UNICO))) {
      paragrafo = novo('paragrafo', 'Parágrafo único', m[1] ?? '', artigo.ref);
      inciso = null;
      alinea = null;
      atual = paragrafo;
      continue;
    }
    if (artigo && (m = linha.match(RE_PARAGRAFO))) {
      paragrafo = novo('paragrafo', `§ ${ordinal(Number(m[1]))}${sufixo(m[2])}`, m[3] ?? '', artigo.ref);
      inciso = null;
      alinea = null;
      atual = paragrafo;
      continue;
    }
    if (artigo && (m = linha.match(RE_INCISO))) {
      inciso = novo('inciso', `${m[1]}${m[2] ?? ''}`, m[3] ?? '', (paragrafo ?? artigo).ref);
      alinea = null;
      atual = inciso;
      continue;
    }
    if (artigo && (m = linha.match(RE_ALINEA))) {
      alinea = novo('alinea', `${m[1]})`, m[2] ?? '', (inciso ?? paragrafo ?? artigo).ref);
      atual = alinea;
      continue;
    }
    if (alinea && (m = linha.match(RE_ITEM))) {
      atual = novo('item', `${m[1]}.`, m[2] ?? '', alinea.ref);
      continue;
    }
    if (out.some((d) => d.tipo === 'artigo') && RE_FECHO.test(linha)) {
      fecho = novo('fecho', 'Fecho', linha, null);
      continue;
    }
    // Antes do primeiro artigo: epigrafe ("LEI Nº 100, DE ..."), ementa e preambulo ("O PREFEITO...").
    if (!out.some((d) => d.tipo !== 'preambulo')) {
      if (RE_EPIGRAFE.test(linha) && !out.length) {
        atual = novo('preambulo', 'Epígrafe', linha, null);
        continue;
      }
      if (atual?.rotulo === 'Epígrafe') {
        atual = novo('preambulo', RE_PREAMBULO.test(linha) ? 'Preâmbulo' : 'Ementa', linha, null);
        continue;
      }
      if (atual?.rotulo === 'Ementa' && RE_PREAMBULO.test(linha)) {
        atual = novo('preambulo', 'Preâmbulo', linha, null);
        continue;
      }
    }
    // Continuacao da linha anterior (quebra de linha do PDF) ou preambulo.
    if (atual) {
      atual.texto = atual.texto ? `${atual.texto} ${linha}` : linha;
    } else {
      atual = novo('preambulo', 'Preâmbulo', linha, null);
    }
  }
  for (const d of out) d.texto = d.tipo === 'fecho' ? d.texto.trim() : d.texto.replace(/\s+/g, ' ').trim();
  return out;
}

// ---------------------------------------------------------------------------
// Texto compilado
// ---------------------------------------------------------------------------

export interface NormaRef {
  id: string;
  tipo: TipoNorma;
  numero: string;
  ano: number;
  dataPublicacao: string | null;
}

export interface DispositivoBase {
  id: string;
  parentId: string | null;
  tipo: TipoDispositivo;
  rotulo: string;
  ordem: number;
  /** null quando o dispositivo foi incluido por norma posterior. */
  textoOriginal: string | null;
}

export interface RedacaoBase {
  id: string;
  dispositivoId: string;
  acao: AcaoRedacao;
  /** null na revogacao. */
  texto: string | null;
  vigenciaInicio: string;
  normaAlteradora: NormaRef | null;
  criadoEm: string;
}

export interface EventoDispositivo {
  acao: 'original' | AcaoRedacao;
  texto: string | null;
  vigenciaInicio: string | null;
  normaAlteradora: NormaRef | null;
  /** true = e a redacao em vigor na data consultada. */
  vigente: boolean;
}

export interface NoCompilado {
  id: string;
  tipo: TipoDispositivo;
  rotulo: string;
  /** Texto em vigor na data (null = revogado). */
  texto: string | null;
  revogado: boolean;
  /** Redacoes anteriores e a atual, em ordem (o que o Planalto mostra riscado + notas). */
  historico: EventoDispositivo[];
  filhos: NoCompilado[];
}

/** "Lei nº 1.234/2019" */
export function rotuloNormaCurto(n: Pick<NormaRef, 'tipo' | 'numero' | 'ano'>): string {
  return `${TIPO_NORMA_LABEL[n.tipo]} nº ${n.numero}/${n.ano}`;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "Lei nº 1.234, de 15 de abril de 2019" */
export function rotuloNorma(n: Pick<NormaRef, 'tipo' | 'numero' | 'ano' | 'dataPublicacao'>): string {
  if (!n.dataPublicacao) return rotuloNormaCurto(n);
  const [a, m, d] = n.dataPublicacao.split('-').map(Number);
  return `${TIPO_NORMA_LABEL[n.tipo]} nº ${n.numero}, de ${d} de ${MESES[(m ?? 1) - 1]} de ${a}`;
}

/**
 * Rotulo como aparece no texto (estilo Planalto): "I –", "a)", "Parágrafo único.", "§ 1º", "Art. 1º".
 * Epigrafe/ementa/preambulo/fecho nao tem rotulo impresso.
 */
export function rotuloExibicao(tipo: TipoDispositivo, rotulo: string): string {
  if (tipo === 'preambulo' || tipo === 'fecho') return '';
  if (tipo === 'inciso') return `${rotulo} –`;
  if (tipo === 'paragrafo' && /^par[aá]grafo [úu]nico$/i.test(rotulo)) return 'Parágrafo único.';
  return rotulo;
}

const MESES_NUM: Record<string, number> = Object.fromEntries(MESES.map((m, i) => [m.normalize('NFD').replace(/[̀-ͯ]/g, ''), i + 1]));

/**
 * Numero, ano e data de publicacao a partir da epigrafe:
 * "LEI Nº 1.234, DE 15 DE ABRIL DE 2019" -> { numero: '1.234', ano: 2019, dataPublicacao: '2019-04-15' }.
 */
export function dadosDaEpigrafe(epigrafe: string): { numero: string | null; ano: number | null; dataPublicacao: string | null } {
  const e = epigrafe.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const num = e.match(/n\.?\s*[º°o]?\s*\.?\s*(\d[\d.]*)(?:\/(\d{4}))?/);
  const data = e.match(/(\d{1,2})\s*[º°o]?\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  let dataPublicacao: string | null = null;
  if (data && MESES_NUM[data[2]!]) {
    dataPublicacao = `${data[3]}-${String(MESES_NUM[data[2]!]).padStart(2, '0')}-${data[1]!.padStart(2, '0')}`;
  }
  const ano = data ? Number(data[3]) : num?.[2] ? Number(num[2]) : null;
  return { numero: num ? num[1]!.replace(/\.$/, '') : null, ano, dataPublicacao };
}

/** Nota no estilo Planalto: "(Redação dada pela Lei nº 13.146, de 2015)". */
export function notaEvento(e: EventoDispositivo): string | null {
  if (!e.normaAlteradora) return null;
  const n = e.normaAlteradora;
  const artigo = n.tipo === 'lei' || n.tipo === 'lei_complementar' || n.tipo === 'lei_organica' ? 'pela' : 'pelo';
  const ref = `${TIPO_NORMA_LABEL[n.tipo]} nº ${n.numero}, de ${n.ano}`;
  if (e.acao === 'revogacao') return `(Revogado ${artigo} ${ref})`;
  if (e.acao === 'inclusao') return `(Incluído ${artigo} ${ref})`;
  return `(Redação dada ${artigo} ${ref})`;
}

/**
 * Monta a arvore do texto compilado na data `data` (YYYY-MM-DD). Redacoes com vigencia
 * posterior a data sao ignoradas — da para ver "como estava em 01/03/2019".
 * Dispositivo incluido depois da data nao aparece.
 */
export function textoCompilado(dispositivos: DispositivoBase[], redacoes: RedacaoBase[], data: string): NoCompilado[] {
  const porDisp = new Map<string, RedacaoBase[]>();
  for (const r of redacoes) {
    const l = porDisp.get(r.dispositivoId) ?? [];
    l.push(r);
    porDisp.set(r.dispositivoId, l);
  }
  for (const l of porDisp.values()) l.sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio) || a.criadoEm.localeCompare(b.criadoEm));

  const nos = new Map<string, NoCompilado>();
  const visiveis = [...dispositivos].sort((a, b) => a.ordem - b.ordem);
  for (const d of visiveis) {
    const eventos = (porDisp.get(d.id) ?? []).filter((r) => r.vigenciaInicio <= data);
    // Incluido por norma posterior e ainda nao vigente na data: nao existe.
    if (d.textoOriginal === null && eventos.length === 0) continue;
    const historico: EventoDispositivo[] = [];
    if (d.textoOriginal !== null) historico.push({ acao: 'original', texto: d.textoOriginal, vigenciaInicio: null, normaAlteradora: null, vigente: false });
    for (const r of eventos) historico.push({ acao: r.acao, texto: r.texto, vigenciaInicio: r.vigenciaInicio, normaAlteradora: r.normaAlteradora, vigente: false });
    const ultimo = historico[historico.length - 1]!;
    ultimo.vigente = true;
    const revogado = ultimo.acao === 'revogacao';
    nos.set(d.id, { id: d.id, tipo: d.tipo, rotulo: d.rotulo, texto: revogado ? null : ultimo.texto, revogado, historico, filhos: [] });
  }
  const raiz: NoCompilado[] = [];
  for (const d of visiveis) {
    const no = nos.get(d.id);
    if (!no) continue;
    const pai = d.parentId ? nos.get(d.parentId) : undefined;
    if (pai) pai.filhos.push(no);
    else raiz.push(no);
  }
  return raiz;
}

/**
 * Situacao da norma a partir dos dispositivos normativos (artigos para baixo) na data.
 * `revogadaTotal` = outra norma revogou a norma inteira.
 */
export function situacaoNorma(dispositivos: DispositivoBase[], redacoes: RedacaoBase[], data: string, revogadaTotal = false): SituacaoNorma {
  if (revogadaTotal) return 'revogada';
  const normativos = dispositivos.filter((d) => !AGRUPADORES.includes(d.tipo) && d.tipo !== 'preambulo' && d.tipo !== 'fecho');
  const vigentes = redacoes.filter((r) => r.vigenciaInicio <= data);
  if (vigentes.length === 0) return 'vigente';
  const ultimaPor = new Map<string, RedacaoBase>();
  for (const r of [...vigentes].sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio) || a.criadoEm.localeCompare(b.criadoEm))) {
    ultimaPor.set(r.dispositivoId, r);
  }
  const artigos = normativos.filter((d) => d.tipo === 'artigo' && d.textoOriginal !== null);
  const artigoRevogado = (id: string) => ultimaPor.get(id)?.acao === 'revogacao';
  if (artigos.length > 0 && artigos.every((a) => artigoRevogado(a.id))) return 'revogada';
  if ([...ultimaPor.values()].some((r) => r.acao === 'revogacao')) return 'revogada_parcial';
  return 'alterada';
}

// ---------------------------------------------------------------------------
// Schemas da API
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const estruturarSchema = z.object({ texto: z.string().max(2_000_000).optional() }).strict();

const dispositivoInputSchema = z
  .object({
    ref: z.string().min(1).max(20),
    parentRef: z.string().min(1).max(20).nullable(),
    tipo: z.enum(TIPOS_DISPOSITIVO),
    rotulo: z.string().trim().min(1).max(60),
    texto: z.string().max(50_000),
  })
  .strict();
export type DispositivoInput = z.infer<typeof dispositivoInputSchema>;

const numeroNorma = z.string().trim().min(1).max(20).regex(/^[\d.\-/A-Za-z]+$/, 'Número inválido');

export const normaCreateSchema = z
  .object({
    documentId: z.string().uuid(),
    tipo: z.enum(TIPOS_NORMA),
    numero: numeroNorma,
    ano: z.number().int().min(1800).max(2100),
    dataPublicacao: z.string().regex(ISO).nullable().optional(),
    ementa: z.string().trim().min(3).max(5000),
    publicada: z.boolean().default(false),
    dispositivos: z.array(dispositivoInputSchema).min(1, 'Nenhum dispositivo').max(8000),
  })
  .strict();
export type NormaCreateInput = z.infer<typeof normaCreateSchema>;

export const normaUpdateSchema = z
  .object({
    tipo: z.enum(TIPOS_NORMA).optional(),
    numero: numeroNorma.optional(),
    ano: z.number().int().min(1800).max(2100).optional(),
    dataPublicacao: z.string().regex(ISO).nullable().optional(),
    ementa: z.string().trim().min(3).max(5000).optional(),
    publicada: z.boolean().optional(),
  })
  .strict();
export type NormaUpdateInput = z.infer<typeof normaUpdateSchema>;

export const dispositivosPutSchema = z.object({ dispositivos: z.array(dispositivoInputSchema).min(1).max(8000) }).strict();

const alteracaoItemSchema = z
  .object({
    acao: z.enum(ACOES_REDACAO),
    /** Dispositivo da norma alvo (redacao/revogacao). */
    dispositivoId: z.string().uuid().optional(),
    /** Inclusao: onde entra (depois de qual dispositivo) e sob qual pai. */
    inserirAposId: z.string().uuid().optional(),
    parentId: z.string().uuid().nullable().optional(),
    tipo: z.enum(TIPOS_DISPOSITIVO).optional(),
    rotulo: z.string().trim().min(1).max(60).optional(),
    texto: z.string().trim().max(50_000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.acao !== 'inclusao' && !v.dispositivoId) ctx.addIssue({ code: 'custom', message: 'Informe o dispositivo alterado' });
    if (v.acao !== 'revogacao' && !v.texto) ctx.addIssue({ code: 'custom', message: 'Informe o novo texto' });
    if (v.acao === 'inclusao' && (!v.tipo || !v.rotulo || !v.inserirAposId)) ctx.addIssue({ code: 'custom', message: 'Inclusão exige tipo, rótulo e posição' });
  });

export const alteracoesSchema = z
  .object({
    /** Norma alterada (a alteradora e a do :id da rota). */
    alvoId: z.string().uuid(),
    /** Vigencia das mudancas; padrao = data de publicacao da alteradora. */
    vigenciaInicio: z.string().regex(ISO).optional(),
    /** Revoga a norma alvo inteira. */
    revogacaoTotal: z.boolean().optional(),
    itens: z.array(alteracaoItemSchema).max(500).default([]),
  })
  .strict()
  .refine((v) => v.revogacaoTotal || v.itens.length > 0, 'Informe ao menos uma alteração')
  .refine((v) => {
    const ids = v.itens.filter((i) => i.acao !== 'inclusao').map((i) => i.dispositivoId);
    return new Set(ids).size === ids.length;
  }, 'O mesmo dispositivo aparece mais de uma vez nesta alteração');
export type AlteracoesInput = z.infer<typeof alteracoesSchema>;

export const normasQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    tipo: z.enum(TIPOS_NORMA).optional(),
    ano: z.coerce.number().int().min(1800).max(2100).optional(),
    situacao: z.enum(SITUACOES_NORMA).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type NormasQuery = z.infer<typeof normasQuerySchema>;

export const compiladoQuerySchema = z.object({ data: z.string().regex(ISO).optional() }).strict();

export interface NormaResumoView extends NormaRef {
  documentId: string;
  ementa: string;
  situacao: SituacaoNorma;
  publicada: boolean;
  rotulo: string;
}

export interface NormaRelacaoView {
  tipo: 'altera' | 'revoga' | 'revoga_parcialmente';
  norma: NormaResumoView;
}

export interface NormaView extends NormaResumoView {
  data: string;
  compilado: NoCompilado[];
  /** Normas que alteraram esta. */
  alteradaPor: NormaRelacaoView[];
  /** Normas que esta alterou. */
  altera: NormaRelacaoView[];
  totalDispositivos: number;
  temAlteracoes: boolean;
  revisadaPor: string | null;
  revisadaEm: string | null;
  /** Estrutura crua (para o editor) — so na rota autenticada. */
  dispositivos?: DispositivoBase[];
}

export interface NormasPage {
  items: NormaResumoView[];
  total: number;
  page: number;
  pageSize: number;
}
