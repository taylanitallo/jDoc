import type { DocModule } from '../documents.js';
import {
  parseDataBR,
  parseValorBR,
  type ParseError,
  type ParsedRecord,
  type ParseResult,
} from './types.js';

/**
 * Formato ASPEC — relatorio de etiquetas em BLOCOS (texto).
 * Cada documento de caixa ocupa varias linhas, por exemplo:
 *
 *   Gov. Munic. de Irauçuba ─ Exerc 2026 ─ CMI
 *   CLASSIFICAÇÃO: 01 01. 01 031 0001 2.001 3.3.90.30.00
 *   DOCUM. CAIXA.: 05050005   EMPENHO: 15040018
 *   CREDOR.......: POSTO DE COMBUSTÍVEIS IRAUÇUBA LTDA
 *       Fonte....: CÂMARA       Ch: 023564    Vl............2.842,37
 *   DATA PAGTO...: 05/05/2026    VALOR PAGTO.............R$ 2.842,37
 *
 * Registros EXTRAORÇAMENTARIOS (ex.: retencoes/repasses como INSS) nao tem
 * EMPENHO — a linha do DOCUM. CAIXA traz o marcador "EXTRA─ORÇAMENTÁRIA" no
 * lugar do "EMPENHO: xxxx":
 *
 *   DOCUM. CAIXA.: 25060015                       EXTRA─ORÇAMENTÁRIA
 *   CREDOR.......: INSS ─ INSTITUTO NACIONAL DO SEGURO SOCIAL (INSS)
 *       Fonte....: 17.049─6                   Vl............3.125,17
 *   DATA PAGTO...: 25/06/2026    VALOR PAGTO.............R$ 3.125,17
 *
 * Registros de RESTO A PAGAR (despesa de exercicio anterior, paga no exercicio
 * atual) trazem uma linha "REST. PG. <ano>" no lugar da "CLASSIFICAÇÃO:",
 * com o mesmo formato de classificacao em seguida:
 *
 *   REST. PG. 2025 10 01. 17 512 0010 1.064 4.4.90.51.00 SEINFRA
 *   DOCUM. CAIXA.: 02060153   EMPENHO: 03110365
 *   CREDOR.......: VK CONSTRUÇÕES E EMPREENDIMENTOS LTDA ─ ME
 *       Fonte....: 22.720─X                   Vl...........32.244,65
 *   DATA PAGTO...: 02/06/2026    VALOR PAGTO............R$ 32.244,65
 *
 * Regras:
 *   - UM REGISTRO POR "DOCUM. CAIXA.:" (o cabecalho "Gov. Munic." e as linhas
 *     "CLASSIFICAÇÃO:"/"REST. PG." sao impressos por pagina/grupo e nao
 *     delimitam o registro).
 *   - Classificacao e unidade correntes (ultimas vistas) vao para o historico.
 *   - EMPENHO / SUBEMPENHO saem da mesma linha do DOCUM. CAIXA; se a linha
 *     tiver o marcador EXTRA-ORÇAMENTÁRIA, o registro e extraorcamentario e
 *     nao exige EMPENHO.
 *   - "REST. PG. <ano>" marca os registros seguintes como resto_a_pagar ate
 *     a proxima linha CLASSIFICAÇÃO/REST. PG. (o ano vai para o historico).
 *   - VALOR e DATA saem da linha "DATA PAGTO ... VALOR PAGTO ... R$".
 *   - totalLines = numero de documentos de caixa encontrados.
 */

const RE_HEADER = /^gov\.?\s*munic/i;
const RE_CLASSIF = /^classifica[çc][ãa]o/i;
const RE_RESTO = /^rest\.?\s*pg\.?\s*(\d{4})\s+(.+)$/i;
const RE_DOCUM = /^docum/i;
const RE_CREDOR = /^credor/i;
const RE_DATA_PAGTO = /^data\s*pagto/i;
const RE_DOC = /DOCUM.*?CAIXA.*?:\s*(\S+)/i;
const RE_EMPENHO = /(?<!SUB)EMPENHO\.*\s*:\s*(\S+)/i;
const RE_SUBEMPENHO = /SUBEMPENHO\.*\s*:\s*(\S+)/i;
const RE_EXTRA = /EXTRA[\s\-─–—]*OR[ÇC]AMENT[ÁA]RIA/i;
const RE_DATA = /(\d{2}\/\d{2}\/\d{4})/;
const RE_VALOR = /VALOR\s*PAGTO[.:\s]*R?\$?\s*([\d.,]+)/i;

interface Pending {
  startLine: number;
  docCaixa: string;
  empenho: string;
  subempenho: string;
  credor: string;
  classificacao: string;
  unidade: string;
  restoPgAno: string;
  dataRaw: string;
  valorRaw: string;
  valorPresente: boolean;
  subtype: 'orcamentaria' | 'extraorcamentaria' | 'resto_a_pagar';
}

export function parseASPEC(content: string, module: DocModule): ParseResult {
  const records: ParsedRecord[] = [];
  const errors: ParseError[] = [];
  const rawLines = content.split(/\r?\n/);

  let unidade = '';
  let classificacao = '';
  let subtypeAtual: 'orcamentaria' | 'resto_a_pagar' = 'orcamentaria';
  let restoPgAno = '';
  let cur: Pending | null = null;
  let total = 0;

  const finalize = (): void => {
    if (!cur) return;
    const p = cur;
    cur = null;

    const fieldErrors: string[] = [];
    if (!p.docCaixa) fieldErrors.push('DOCUM. CAIXA ausente');
    if (!p.empenho && p.subtype !== 'extraorcamentaria') fieldErrors.push('EMPENHO ausente');
    if (!p.credor) fieldErrors.push('CREDOR ausente');

    const valor = p.valorPresente ? parseValorBR(p.valorRaw) : null;
    if (!p.valorPresente) fieldErrors.push('VALOR PAGTO ausente');
    else if (Number.isNaN(valor)) fieldErrors.push(`VALOR PAGTO invalido: "${p.valorRaw}"`);

    const data = parseDataBR(p.dataRaw);
    if (!data) fieldErrors.push(`DATA PAGTO invalida (esperado DD/MM/YYYY): "${p.dataRaw}"`);

    if (fieldErrors.length > 0) {
      errors.push({ line: p.startLine, message: fieldErrors.join('; '), raw: p.docCaixa });
      return;
    }

    const historico =
      [
        p.classificacao && `Classif: ${p.classificacao}`,
        p.unidade && `Unid: ${p.unidade}`,
        p.subempenho && `Subempenho: ${p.subempenho}`,
        p.subtype === 'resto_a_pagar' && p.restoPgAno && `Resto a Pagar: ${p.restoPgAno}`,
      ]
        .filter(Boolean)
        .join(' | ') || null;

    // Codigo do orgao = primeiro token da CLASSIFICACAO (ex.: "01 01. 01 031..." -> "01").
    const orgaoCodigo = p.classificacao.trim().split(/\s+/)[0]?.replace(/[.,]+$/, '') || null;

    records.push({
      module,
      docCaixa: p.docCaixa,
      empenho: p.empenho,
      credor: p.credor,
      valor: valor as number | null,
      data: data as string,
      historico,
      orgaoCodigo,
      orgaoSigla: p.unidade || null,
      subtype: p.subtype,
    });
  };

  rawLines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t) return;

    if (RE_HEADER.test(t)) {
      // Unidade orcamentaria = ultimo segmento apos o traco do cabecalho.
      const partes = t.split(/[─\-–—]/);
      unidade = (partes[partes.length - 1] ?? '').trim();
      return;
    }
    if (RE_CLASSIF.test(t)) {
      classificacao = t.replace(/^classifica[çc][ãa]o\.*\s*:?\s*/i, '').trim();
      subtypeAtual = 'orcamentaria';
      restoPgAno = '';
      return;
    }
    if (RE_RESTO.test(t)) {
      const m = RE_RESTO.exec(t);
      restoPgAno = m?.[1] ?? '';
      classificacao = m?.[2]?.trim() ?? '';
      subtypeAtual = 'resto_a_pagar';
      return;
    }
    if (RE_DOCUM.test(t)) {
      // Novo documento de caixa: fecha o anterior e abre um novo.
      finalize();
      total += 1;
      cur = {
        startLine: i + 1,
        docCaixa: RE_DOC.exec(t)?.[1] ?? '',
        empenho: RE_EMPENHO.exec(t)?.[1] ?? '',
        subempenho: RE_SUBEMPENHO.exec(t)?.[1] ?? '',
        credor: '',
        classificacao,
        unidade,
        restoPgAno,
        dataRaw: '',
        valorRaw: '',
        valorPresente: false,
        subtype: RE_EXTRA.test(t) ? 'extraorcamentaria' : subtypeAtual,
      };
      return;
    }
    if (!cur) return; // linha solta antes de qualquer DOCUM. CAIXA.
    if (RE_CREDOR.test(t)) {
      cur.credor = t.replace(/^credor\.*\s*:?\s*/i, '').trim();
    } else if (RE_DATA_PAGTO.test(t)) {
      cur.dataRaw = RE_DATA.exec(t)?.[1] ?? cur.dataRaw;
      const vm = RE_VALOR.exec(t);
      if (vm) {
        cur.valorRaw = vm[1] ?? '';
        cur.valorPresente = true;
      }
    }
    // linhas "Fonte....:" sao ignoradas — o valor do registro e o VALOR PAGTO total.
  });
  finalize();

  return { format: 'ASPEC', records, errors, totalLines: total };
}
