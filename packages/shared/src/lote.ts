import { metadadosSchemaFor, type CampoMetadado, type Metadados } from './metadados.js';

/**
 * Envio em lote para o Acervo (projetos de digitalizacao): varios PDFs de uma vez,
 * com os dados de cada documento vindos de uma planilha CSV (o Excel salva como CSV).
 * Funcoes puras: a tela usa para montar/validar e o servidor valida de novo em cada
 * inclusao (o lote reaproveita o mesmo POST /documents da inclusao individual).
 */

/** Arquivos por lote: acima disso o navegador fica pesado e o usuario perde o controle. */
export const LOTE_MAX_ARQUIVOS = 300;

export interface ItemLote {
  arquivo: string;
  descricao: string;
  /** ISO aaaa-mm-dd ou '' */
  dataDocumento: string;
  metadados: Metadados;
}

export interface LoteMontado {
  itens: ItemLote[];
  /** Linhas da planilha sem PDF correspondente, colunas desconhecidas etc. */
  avisos: string[];
}

/** Separa CSV (';', ',' ou TAB detectado pelo cabecalho), com aspas, quebras dentro de aspas, BOM e CRLF. */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^\uFEFF/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].reduce((melhor, s) => (primeira.split(s).length > primeira.split(melhor).length ? s : melhor), ';');
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"' && campo === '') aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      campo = '';
      if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
  return linhas.map((l) => l.map((c) => c.trim()));
}

/** "Data de Publicação" -> "data_de_publicacao" (compara cabecalhos sem acento/maiuscula). */
export function normalizarCabecalho(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** dd/mm/aaaa, d/m/aaaa, dd-mm-aaaa ou aaaa-mm-dd -> aaaa-mm-dd (ou null se invalida). */
export function dataParaIso(v: string): string | null {
  const s = v.trim();
  let a: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (r) [a, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else {
    r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (!r) return null;
    [d, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  }
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const nomeSemExtensao = (n: string) => n.replace(/\.[^.]+$/, '');
const chaveArquivo = (n: string) => normalizarCabecalho(nomeSemExtensao(n.split(/[\\/]/).pop() ?? n));

const COLUNAS_FIXAS = { arquivo: ['arquivo', 'nome_do_arquivo', 'pdf'], descricao: ['descricao', 'titulo', 'titulo_descricao'], data: ['data_documento', 'data_do_documento', 'data'] };

/** Cabecalho da planilha-modelo de um tipo documental (arquivo, descricao, data e os campos do tipo). */
export function cabecalhoModeloLote(campos: readonly CampoMetadado[]): string[] {
  return ['arquivo', 'descricao', 'data_documento', ...campos.map((c) => c.chave)];
}

/** Planilha-modelo em CSV (BOM + ';', abre direto no Excel) com uma linha de exemplo. */
export function modeloCsvLote(campos: readonly CampoMetadado[]): string {
  const exemplo = ['lei-1234.pdf', 'Institui o Plano Diretor', '15/04/2019', ...campos.map((c) => (c.tipo === 'data' ? '15/04/2019' : c.tipo === 'selecao' ? (c.opcoes?.[0] ?? '') : c.tipo === 'numero' ? '1234' : `(${c.rotulo})`))];
  const cel = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `\uFEFF${[cabecalhoModeloLote(campos), exemplo].map((l) => l.map(cel).join(';')).join('\r\n')}\r\n`;
}

/**
 * Junta os PDFs escolhidos com as linhas da planilha (pelo nome do arquivo, sem
 * extensao/acentos/maiusculas). PDF sem linha: descricao = nome do arquivo e a data
 * padrao. Linha sem PDF: aviso. Datas da planilha viram ISO.
 */
export function montarLote(
  nomesArquivos: readonly string[],
  csv: string | null,
  campos: readonly CampoMetadado[],
  padrao: { dataDocumento?: string } = {},
): LoteMontado {
  const avisos: string[] = [];
  const porArquivo = new Map<string, { descricao?: string; data?: string; metadados: Metadados; linha: number }>();

  if (csv && csv.trim()) {
    const [cab, ...linhas] = lerCsv(csv);
    const cabNorm = (cab ?? []).map(normalizarCabecalho);
    const idx = (nomes: string[]) => cabNorm.findIndex((h) => nomes.includes(h));
    const iArq = idx(COLUNAS_FIXAS.arquivo);
    const iDesc = idx(COLUNAS_FIXAS.descricao);
    const iData = idx(COLUNAS_FIXAS.data);
    if (iArq < 0) {
      avisos.push('A planilha precisa da coluna "arquivo" com o nome de cada PDF.');
    } else {
      const colCampo = campos.map((c) => ({ c, i: cabNorm.findIndex((h) => h === c.chave || h === normalizarCabecalho(c.rotulo)) }));
      const conhecidas = new Set([iArq, iDesc, iData, ...colCampo.map((x) => x.i)]);
      cabNorm.forEach((h, i) => {
        if (!conhecidas.has(i) && h) avisos.push(`Coluna "${cab![i]}" não pertence a este tipo documental e foi ignorada.`);
      });
      linhas.forEach((l, n) => {
        const nome = l[iArq] ?? '';
        if (!nome) return;
        const metadados: Metadados = {};
        for (const { c, i } of colCampo) {
          const v = i >= 0 ? (l[i] ?? '').trim() : '';
          if (!v) continue;
          metadados[c.chave] = c.tipo === 'data' ? (dataParaIso(v) ?? v) : v;
        }
        const chave = chaveArquivo(nome);
        if (porArquivo.has(chave)) avisos.push(`Linha ${n + 2}: o arquivo "${nome}" aparece mais de uma vez; vale a primeira linha.`);
        else porArquivo.set(chave, { descricao: iDesc >= 0 ? l[iDesc] : undefined, data: iData >= 0 ? l[iData] : undefined, metadados, linha: n + 2 });
      });
    }
  }

  const usados = new Set<string>();
  const itens = nomesArquivos.map((arquivo) => {
    const chave = chaveArquivo(arquivo);
    const linha = porArquivo.get(chave);
    if (linha) usados.add(chave);
    const dataTexto = linha?.data?.trim();
    return {
      arquivo,
      descricao: linha?.descricao?.trim() || nomeSemExtensao(arquivo).replace(/[_-]+/g, ' ').trim(),
      dataDocumento: dataTexto ? (dataParaIso(dataTexto) ?? dataTexto) : (padrao.dataDocumento ?? ''),
      metadados: linha?.metadados ?? {},
    };
  });
  for (const [chave, l] of porArquivo) {
    if (!usados.has(chave)) avisos.push(`Linha ${l.linha}: nenhum PDF selecionado com esse nome.`);
  }
  return { itens, avisos };
}

/** Problemas de um item (vazio = pronto para enviar). Mesmas regras do servidor. */
export function validarItemLote(item: ItemLote, campos: readonly CampoMetadado[]): string[] {
  const erros: string[] = [];
  if (!item.arquivo.toLowerCase().endsWith('.pdf')) erros.push('Somente arquivos PDF');
  if (!item.descricao.trim()) erros.push('Descrição obrigatória');
  if (item.descricao.length > 2000) erros.push('Descrição muito longa');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.dataDocumento) || !dataParaIso(item.dataDocumento)) erros.push('Data do documento inválida ou ausente');
  else {
    const ano = Number(item.dataDocumento.slice(0, 4));
    if (ano < 1800 || ano > 2100) erros.push('Ano fora do intervalo aceito (1800 a 2100)');
  }
  const r = metadadosSchemaFor(campos).safeParse(item.metadados);
  if (!r.success) erros.push(...r.error.issues.map((i) => i.message));
  return erros;
}
