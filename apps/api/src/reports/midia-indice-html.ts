/**
 * Gera um indice.html autocontido (sem nenhuma dependencia externa — CSS/JS
 * 100% inline) para acompanhar o ZIP de Midia Legislativa de UM mes. Reproduz
 * a experiencia do antigo visualizador desktop (contadores por categoria,
 * busca/filtro, abrir arquivo), mas roda em qualquer navegador via file://.
 */

export type Midia = 'balancete' | 'extrato' | 'receita' | 'despesa' | 'outros';

export interface IndiceEntry {
  midia: Midia;
  /** Ja inclui a extensao (".pdf") — nao concatenar de novo. */
  fileKey: string;
  /** Subpasta dentro de midia/ no ZIP (ex.: orgao, so para despesas) — null quando "achatado". */
  subFolder: string | null;
  docCaixa: string | null;
  empenho: string | null;
  credor: string | null;
  historico: string | null;
  descricao: string | null;
  subtype: string | null;
  /** YYYY-MM-DD — para balancete/extrato ja vem com fallback para a data de criacao. */
  documentDate: string | null;
  value: number | null;
  competencia: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  orgaoCodigo: string | null;
  orgaoNome: string | null;
  documentTypeNome: string | null;
}

export interface BuildIndiceHtmlOptions {
  tenantNome: string;
  exercicio: number;
  mesNome: string;
  geradoPor: string;
  /** ISO 8601. */
  geradoEm: string;
  /** tenant_settings.corDestaque (#rrggbb) — null usa o gradiente institucional padrao. */
  corDestaque?: string | null;
  /** tenant_settings.nomeExibido — sobrepoe tenantNome no cabecalho quando presente. */
  nomeExibido?: string | null;
  /** Brasao ja em data URI (base64) — o arquivo precisa ser autocontido/offline. */
  brasaoDataUri?: string | null;
  midiasSelecionadas: Midia[];
  entries: IndiceEntry[];
}

const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/i;

/** Clareia (percent > 0) ou escurece (percent < 0) uma cor hex — sem depender de color-mix() do CSS. */
function shadeHex(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const r = clamp(((num >> 16) & 0xff) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** Gradiente do cabeçalho: cor do tenant (clara→escura) ou o roxo institucional por padrao. */
function headerGradient(corDestaque: string | null | undefined): string {
  if (corDestaque && HEX_COLOR_REGEX.test(corDestaque)) {
    return `linear-gradient(120deg, ${shadeHex(corDestaque, -25)}, ${corDestaque} 55%, ${shadeHex(corDestaque, 20)})`;
  }
  return 'linear-gradient(120deg, #4c1d95, #7c3aed 55%, #d946ef)';
}

const MIDIA_LABEL: Record<Midia, string> = {
  despesa: 'Despesas',
  receita: 'Receitas',
  balancete: 'Balancetes',
  extrato: 'Extratos',
  outros: 'Outros Documentos',
};

/** Ordem fixa das abas, independente da ordem em que o usuario marcou as midias no formulario. */
const MIDIA_ORDER: Midia[] = ['despesa', 'balancete', 'receita', 'extrato', 'outros'];

/** Icone (chave de ICON_PATHS) + cor de destaque por categoria (abas, valores, badges). */
const MIDIA_ICON: Record<Midia, string> = {
  despesa: 'trendingDown',
  balancete: 'barChart',
  receita: 'trendingUp',
  extrato: 'landmark',
  outros: 'folderOpen',
};

const MIDIA_COLOR: Record<Midia, string> = {
  despesa: '#f97316',
  balancete: '#7c3aed',
  receita: '#16a34a',
  extrato: '#2563eb',
  outros: '#64748b',
};

const MIDIA_BG: Record<Midia, string> = {
  despesa: '#fff7ed',
  balancete: '#f5f3ff',
  receita: '#f0fdf4',
  extrato: '#eff6ff',
  outros: '#f8fafc',
};

const SUBTYPE_LABEL: Record<string, string> = {
  orcamentaria: 'Orçamentária',
  extraorcamentaria: 'Extraorçamentária',
  resto_a_pagar: 'Resto a Pagar',
};

/** Paths de icones estilo lucide (stroke, viewBox 24x24) — sem dependencia externa. */
const ICON_PATHS: Record<string, string> = {
  film: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  trendingDown: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  trendingUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  barChart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  landmark: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  folderOpen: '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
  fileText: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M12 15V3"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><path d="m7 10 5 5 5-5"/>',
};

/** SVG inline (sem <img>/fonte externa) — herda cor via currentColor. */
function svgIcon(name: string, size = 18): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ''}</svg>`;
}

interface ColumnDef {
  key: keyof IndiceEntry | 'orgao' | 'valorFmt' | 'dataFmt' | 'subtypeFmt';
  label: string;
  /** Largura fixa (px) pra campos curtos de formato fixo — colunas sem width dividem o espaco restante (texto livre: credor/orgao/descricao). */
  width?: number;
}

const COLUMNS: Record<Midia, ColumnDef[]> = {
  despesa: [
    { key: 'dataFmt', label: 'Data', width: 86 },
    { key: 'docCaixa', label: 'Doc. Caixa', width: 100 },
    { key: 'empenho', label: 'Empenho', width: 100 },
    { key: 'orgao', label: 'Órgão' },
    { key: 'credor', label: 'Credor' },
    { key: 'subtypeFmt', label: 'Tipo', width: 110 },
    { key: 'valorFmt', label: 'Valor', width: 100 },
  ],
  receita: [
    { key: 'dataFmt', label: 'Data', width: 86 },
    { key: 'historico', label: 'Título/Descrição' },
    { key: 'orgao', label: 'Órgão' },
    { key: 'conta', label: 'Conta', width: 90 },
    { key: 'subtypeFmt', label: 'Tipo', width: 110 },
    { key: 'valorFmt', label: 'Valor', width: 100 },
  ],
  balancete: [
    { key: 'dataFmt', label: 'Data', width: 86 },
    { key: 'descricao', label: 'Título/Descrição' },
    { key: 'orgao', label: 'Órgão' },
    { key: 'competencia', label: 'Competência', width: 110 },
  ],
  extrato: [
    { key: 'dataFmt', label: 'Data', width: 86 },
    { key: 'descricao', label: 'Título/Descrição' },
    { key: 'banco', label: 'Banco', width: 90 },
    { key: 'agencia', label: 'Agência', width: 80 },
    { key: 'conta', label: 'Conta', width: 90 },
    { key: 'competencia', label: 'Competência', width: 110 },
    { key: 'orgao', label: 'Órgão' },
  ],
  outros: [
    { key: 'dataFmt', label: 'Data', width: 86 },
    { key: 'descricao', label: 'Título/Descrição' },
    { key: 'orgao', label: 'Órgão' },
    { key: 'documentTypeNome', label: 'Tipo', width: 110 },
  ],
};

function formatDataBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formatDataHoraBR(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR')}`;
}

/** Neutraliza qualquer "</script" que possa aparecer em texto livre (historico/descricao/credor). */
function safeJsonForScriptTag(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildIndiceHtml(opts: BuildIndiceHtmlOptions): string {
  const { tenantNome, exercicio, mesNome, geradoPor, geradoEm, corDestaque, nomeExibido, brasaoDataUri, midiasSelecionadas, entries } = opts;
  const nomeHeader = nomeExibido || tenantNome;
  const headerLogo = brasaoDataUri
    ? `<img src="${escapeHtml(brasaoDataUri)}" alt="Brasão" class="header-logo-img" />`
    : svgIcon('film', 40);

  const midiasOrdenadas = [...midiasSelecionadas].sort(
    (a, b) => MIDIA_ORDER.indexOf(a) - MIDIA_ORDER.indexOf(b),
  );

  const counts = midiasOrdenadas.map((m) => ({
    midia: m,
    label: MIDIA_LABEL[m],
    count: entries.filter((e) => e.midia === m).length,
    icon: svgIcon(MIDIA_ICON[m], 20),
    color: MIDIA_COLOR[m],
    bg: MIDIA_BG[m],
  }));

  const enriched = entries.map((e) => ({
    ...e,
    orgao: [e.orgaoCodigo, e.orgaoNome].filter(Boolean).join(' — ') || null,
    valorFmt: e.value !== null ? e.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null,
    dataFmt: e.documentDate ? formatDataBR(e.documentDate) : null,
    subtypeFmt: e.subtype ? SUBTYPE_LABEL[e.subtype] ?? e.subtype : null,
  }));

  const payload = safeJsonForScriptTag({
    entries: enriched,
    columns: COLUMNS,
    midiaLabel: MIDIA_LABEL,
    fileIcon: svgIcon('fileText', 14),
  });

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Mídia Legislativa — ${escapeHtml(mesNome)}/${exercicio}</title>
<style>
  :root {
    color-scheme: light;
    --accent: #7c3aed; --accent-bg: #f5f3ff;
    --bg: #f8f9fb; --card: #fff; --border: #e5e7eb; --ink: #1f2937; --muted: #6b7280;
    --table-head: #f9fafb; --hover: #f9fafb; --input-border: #d1d5db;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: var(--bg); color: var(--ink); -webkit-font-smoothing: antialiased; }

  .shell { max-width: 1180px; margin: 32px auto; padding: 0 24px 48px; }

  .hero { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; border-radius: 16px; background: ${headerGradient(corDestaque)}; padding: 28px 30px; color: #fff; box-shadow: 0 8px 20px rgba(124,58,237,0.25); margin-bottom: 24px; }
  .hero .header-logo-img { height: 56px; width: 56px; flex-shrink: 0; object-fit: contain; border-radius: 12px; background: #fff; padding: 5px; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
  .hero > svg { flex-shrink: 0; }
  .hero-main { flex: 1 1 260px; }
  .hero .eyebrow { margin: 0 0 5px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; opacity: .8; }
  .hero h1 { margin: 0 0 5px; font-size: 22px; font-weight: 800; letter-spacing: -.01em; }
  .hero p.sub { margin: 0; font-size: 13.5px; opacity: .88; }
  .hero-meta { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }
  .hero-meta span { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.16); border-radius: 9px; padding: 7px 14px; font-size: 12.5px; white-space: nowrap; }
  .hero-meta svg { flex-shrink: 0; opacity: .9; }

  .aviso { display: flex; align-items: flex-start; gap: 11px; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; padding: 16px 20px; font-size: 13.5px; line-height: 1.5; border-radius: 12px; margin-bottom: 24px; }
  .aviso svg { flex-shrink: 0; margin-top: 1px; color: #ea580c; }
  .aviso b { font-weight: 700; }

  .tabs { display: flex; flex-wrap: wrap; gap: 10px; background: var(--table-head); border: 1px solid var(--border); border-radius: 16px; padding: 10px; margin-bottom: 24px; }
  .tab { cursor: pointer; flex: 1 1 170px; display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 12px; transition: background .12s ease, box-shadow .12s ease; }
  .tab:hover { background: rgba(255,255,255,0.6); }
  .tab.active { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  .tab .icon-badge { flex-shrink: 0; width: 42px; height: 42px; border-radius: 11px; display: flex; align-items: center; justify-content: center; background: #fff; color: var(--accent); box-shadow: inset 0 0 0 1px var(--border); }
  .tab .count { display: block; font-size: 21px; font-weight: 800; color: var(--accent); line-height: 1.15; }
  .tab .label { display: block; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); margin-top: 2px; }

  .panel { background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); margin-bottom: 24px; overflow: hidden; }

  .controls { padding: 22px; border-bottom: 1px solid var(--border); background: var(--table-head); }
  .controls-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
  .controls-row + .controls-row { margin-top: 16px; }
  .total-card { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 11px 18px; }
  .total-card b { font-size: 10.5px; text-transform: uppercase; color: var(--muted); font-weight: 700; letter-spacing: .03em; }
  .total-card span { font-size: 15.5px; font-weight: 800; color: var(--ink); }
  .filter-group { display: flex; align-items: center; gap: 10px; }
  .filter-group label { font-size: 11.5px; font-weight: 700; text-transform: uppercase; color: var(--muted); }
  .filter-group select, .filter-group input[type="date"] { border: 1px solid var(--input-border); border-radius: 9px; padding: 10px 14px; font-size: 13px; background: #fff; color: var(--ink); }
  .filter-group select:focus, .filter-group input[type="date"]:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .filter-group .date-sep { font-size: 13px; color: #9ca3af; }

  .search-wrap { position: relative; flex: 1 1 280px; max-width: 460px; display: flex; align-items: center; }
  .search-wrap .search-icon { position: absolute; left: 14px; color: #9ca3af; pointer-events: none; }
  .search-wrap input { width: 100%; padding: 12px 14px 12px 40px; border: 1px solid var(--input-border); border-radius: 9px; font-size: 14px; }
  .search-wrap input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

  .btn-print { display: flex; align-items: center; gap: 9px; padding: 12px 24px; border: none; border-radius: 9px; background: linear-gradient(135deg, #7c3aed 0%, #d946ef 100%); color: #fff; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; cursor: pointer; }
  .btn-print:hover { opacity: .9; }
  .btn-zip { display: flex; align-items: center; gap: 9px; padding: 12px 20px; border: 1px solid var(--input-border); border-radius: 9px; background: #fff; color: var(--ink); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .02em; cursor: pointer; }
  .btn-zip:hover:not(:disabled) { background: var(--table-head); }
  .btn-zip:disabled { opacity: .45; cursor: not-allowed; }

  .table-scroll { overflow-x: auto; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  th, td { padding: 8px 10px; font-size: 12px; text-align: left; word-break: break-word; }
  th:last-child, td:last-child, td.valor, td.nowrap { white-space: nowrap; word-break: normal; overflow: hidden; text-overflow: ellipsis; }
  th:last-child, td:last-child { width: 168px; }
  th.select-col, td.select-col { width: 38px; text-align: center; padding-left: 14px; padding-right: 4px; white-space: nowrap; }
  th.select-col input, td.select-col input { width: 15px; height: 15px; cursor: pointer; accent-color: var(--accent); vertical-align: middle; }
  td.desc-cell { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  th { background: var(--table-head); text-transform: uppercase; font-size: 10.5px; letter-spacing: .03em; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); }
  tbody tr { border-top: 1px solid var(--border); }
  tbody tr:hover td { background: var(--hover); }
  td.valor { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink); }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 999px; background: var(--accent-bg); color: var(--accent); font-size: 11px; font-weight: 600; white-space: nowrap; }
  a.arquivo { color: var(--ink); text-decoration: none; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }
  a.arquivo:hover { text-decoration: underline; }

  .empty { border: 1px dashed var(--border); border-radius: 12px; background: #fff; margin: 24px; padding: 56px 24px; text-align: center; color: #9ca3af; font-size: 14px; }
  .empty svg { display: block; margin: 0 auto 12px; color: #c4c8d0; }

  @media (max-width: 720px) {
    .shell { padding: 0 16px 36px; margin: 20px auto; }
    .hero { padding: 22px; gap: 16px; }
    .hero-meta { flex-direction: row; flex-wrap: wrap; }
    .tab { flex: 1 1 45%; }
    .search-wrap { max-width: none; flex-basis: 100%; }
    .btn-print, .btn-zip { flex: 1; justify-content: center; }
  }

  @media print {
    @page { margin: 10mm; size: landscape; }
    .aviso, .controls, .tabs, td .arquivo, th:last-child, td:last-child, th.select-col, td.select-col { display: none !important; }
    body { background: #fff; margin: 0; }
    .shell { max-width: none; margin: 0; padding: 0; }
    .hero { box-shadow: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .panel { box-shadow: none; border: none; }
    .table-scroll { overflow: visible; }
    table { width: 100%; table-layout: fixed; }
  }
</style>
</head>
<body>
<div class="shell">
  <div class="hero">
    ${headerLogo}
    <div class="hero-main">
      <p class="eyebrow">Índice de Documentos</p>
      <h1>${escapeHtml(nomeHeader)} — Mídia Legislativa</h1>
      <p class="sub">Competência: ${escapeHtml(mesNome)}/${exercicio}</p>
    </div>
    <div class="hero-meta">
      <span>${svgIcon('user', 13)}${escapeHtml(geradoPor)}</span>
      <span>${svgIcon('clock', 13)}${escapeHtml(formatDataHoraBR(geradoEm))}</span>
    </div>
  </div>

  <div class="aviso">
    ${svgIcon('alertTriangle', 16)}
    <span><b>Importante:</b> extraia todo o conteúdo do ZIP para uma pasta antes de abrir este arquivo
    (botão direito no .zip → "Extrair Tudo"). Se abrir direto de dentro do ZIP, os links
    "Visualizar arquivo" não vão funcionar, porque os PDFs não são extraídos junto.</span>
  </div>

  <div class="tabs" id="tabs"></div>

  <div class="panel">
    <div class="controls" id="filtersBar">
      <div class="controls-row">
        <div class="total-card" id="totalCard" style="display:none">
          <b id="totalLabel"></b>
          <span id="totalValue"></span>
        </div>
        <div class="filter-group" id="tipoGroup" style="display:none">
          <label>Tipo</label>
          <select id="filterTipo"></select>
        </div>
        <div class="filter-group" id="orgaoGroup" style="display:none">
          <label>Órgão</label>
          <select id="filterOrgao"></select>
        </div>
        <div class="filter-group">
          <label>Período</label>
          <input type="date" id="filterDateFrom" />
          <span class="date-sep">até</span>
          <input type="date" id="filterDateTo" />
        </div>
      </div>
      <div class="controls-row">
        <div class="search-wrap"><span class="search-icon">${svgIcon('search', 15)}</span><input id="search" type="text" placeholder="Buscar…" /></div>
        <button type="button" class="btn-zip" id="zipBtn" disabled>${svgIcon('download', 15)}<span>Baixar selecionados</span></button>
        <button type="button" class="btn-print" id="printBtn">${svgIcon('printer', 16)}<span>Imprimir</span></button>
      </div>
    </div>
    <main id="main">
      <div class="table-scroll">
        <table>
          <thead id="thead"></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
      <div class="empty" id="empty" style="display:none">${svgIcon('inbox', 32)}Nenhum documento encontrado.</div>
    </main>
  </div>
</div>
<script type="application/json" id="jdoc-midia-data">${payload}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById('jdoc-midia-data').textContent);
  var counts = ${safeJsonForScriptTag(counts)};
  var current = counts.length ? counts[0].midia : null;

  var mainEl = document.getElementById('main');
  var tabsEl = document.getElementById('tabs');
  var theadEl = document.getElementById('thead');
  var tbodyEl = document.getElementById('tbody');
  var emptyEl = document.getElementById('empty');
  var searchEl = document.getElementById('search');
  var printBtnEl = document.getElementById('printBtn');
  var tipoGroupEl = document.getElementById('tipoGroup');
  var filterTipoEl = document.getElementById('filterTipo');
  var orgaoGroupEl = document.getElementById('orgaoGroup');
  var filterOrgaoEl = document.getElementById('filterOrgao');
  var totalCardEl = document.getElementById('totalCard');
  var totalLabelEl = document.getElementById('totalLabel');
  var totalValueEl = document.getElementById('totalValue');
  var filterDateFromEl = document.getElementById('filterDateFrom');
  var filterDateToEl = document.getElementById('filterDateTo');
  var zipBtnEl = document.getElementById('zipBtn');

  var MES_NOME = ${JSON.stringify(mesNome)};
  var EXERCICIO = ${exercicio};
  var selected = {};

  function updateZipBtn() {
    var count = Object.keys(selected).length;
    zipBtnEl.disabled = count === 0;
    zipBtnEl.querySelector('span').textContent = count > 0 ? ('Baixar selecionados (' + count + ')') : 'Baixar selecionados';
  }

  /** Gerador de ZIP 100% client-side (sem dependencia externa) — metodo STORE (sem compressao). */
  var CRC_TABLE = (function () {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) { return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | (Math.floor(d.getSeconds() / 2) & 0x1F); }
  function dosDate(d) { return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F); }
  function buildZipBlob(files) {
    var now = new Date();
    var time = dosTime(now), date = dosDate(now);
    var encoder = new TextEncoder();
    var localParts = [];
    var centralParts = [];
    var offset = 0;

    files.forEach(function (f) {
      var nameBytes = encoder.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var size = data.length;

      var lh = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(lh.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0, true);
      ldv.setUint16(8, 0, true);
      ldv.setUint16(10, time, true);
      ldv.setUint16(12, date, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, size, true);
      ldv.setUint32(22, size, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      localParts.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(ch.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, time, true);
      cdv.setUint16(14, date, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centralParts.push(ch);

      offset += lh.length + data.length;
    });

    var centralSize = centralParts.reduce(function (sum, p) { return sum + p.length; }, 0);
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, offset, true);

    return new Blob(localParts.concat(centralParts, [eocd]), { type: 'application/zip' });
  }

  function sanitizeFileName(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, '-').trim() || 'documento';
  }

  async function downloadSelectedZip() {
    var chosen = DATA.entries.filter(function (e) { return selected[e.fileKey]; });
    if (!chosen.length) return;
    var originalLabel = zipBtnEl.querySelector('span').textContent;
    zipBtnEl.disabled = true;
    zipBtnEl.querySelector('span').textContent = 'Baixando…';
    try {
      var used = {};
      var files = [];
      for (var i = 0; i < chosen.length; i++) {
        var e = chosen[i];
        var url = './' + e.midia + '/' + (e.subFolder ? e.subFolder + '/' : '') + e.fileKey;
        var res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var buf = await res.arrayBuffer();
        var base = sanitizeFileName(e.docCaixa || e.empenho || e.fileKey.replace(/\.[a-z0-9]+$/i, ''));
        var name = base + '.pdf';
        var n = 2;
        while (used[name]) { name = base + ' (' + n + ').pdf'; n++; }
        used[name] = true;
        files.push({ name: name, data: new Uint8Array(buf) });
      }
      var blob = buildZipBlob(files);
      var zipUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = zipUrl;
      a.download = sanitizeFileName((DATA.midiaLabel[current] || 'documentos') + '-' + MES_NOME + '-' + EXERCICIO).replace(/\s+/g, '_') + '.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(zipUrl); }, 4000);
    } catch (err) {
      alert('Não foi possível gerar o ZIP neste navegador. O Chrome e o Edge bloqueiam por padrão a leitura de arquivos locais quando este índice é aberto direto do arquivo (file://). Tente abrir este índice com o Firefox, ou use o link "Visualizar arquivo" de cada documento individualmente.');
    } finally {
      zipBtnEl.disabled = Object.keys(selected).length === 0;
      updateZipBtn();
    }
  }
  zipBtnEl.addEventListener('click', function () { void downloadSelectedZip(); });

  function currentMeta() {
    for (var i = 0; i < counts.length; i++) if (counts[i].midia === current) return counts[i];
    return null;
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    counts.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'tab' + (c.midia === current ? ' active' : '');
      el.style.setProperty('--accent', c.color);
      el.style.setProperty('--accent-bg', c.bg);

      var iconEl = document.createElement('span');
      iconEl.className = 'icon-badge';
      iconEl.innerHTML = c.icon;

      var metaEl = document.createElement('span');
      var countEl = document.createElement('span');
      countEl.className = 'count';
      countEl.textContent = String(c.count);
      var labelEl = document.createElement('span');
      labelEl.className = 'label';
      labelEl.textContent = c.label;
      metaEl.appendChild(countEl);
      metaEl.appendChild(labelEl);

      el.appendChild(iconEl);
      el.appendChild(metaEl);
      el.addEventListener('click', function () {
        current = c.midia;
        selected = {};
        updateZipBtn();
        renderTabs();
        populateFilters();
        renderTable();
      });
      tabsEl.appendChild(el);
    });
  }

  /** Repopula os selects de Tipo/Orgao com as opcoes da aba atual e reseta os filtros. */
  function populateFilters() {
    var cols = DATA.columns[current] || [];
    var hasSubtype = cols.some(function (c) { return c.key === 'subtypeFmt'; });
    var hasValor = cols.some(function (c) { return c.key === 'valorFmt'; });
    var rowsForTab = DATA.entries.filter(function (e) { return e.midia === current; });

    filterTipoEl.innerHTML = '';
    var allTipoOpt = document.createElement('option');
    allTipoOpt.value = 'all';
    allTipoOpt.textContent = 'Todos os tipos';
    filterTipoEl.appendChild(allTipoOpt);
    var seenSubtype = {};
    rowsForTab.forEach(function (e) {
      if (e.subtype && !seenSubtype[e.subtype]) {
        seenSubtype[e.subtype] = true;
        var opt = document.createElement('option');
        opt.value = e.subtype;
        opt.textContent = e.subtypeFmt || e.subtype;
        filterTipoEl.appendChild(opt);
      }
    });
    filterTipoEl.value = 'all';
    tipoGroupEl.style.display = hasSubtype ? '' : 'none';

    filterOrgaoEl.innerHTML = '';
    var allOrgaoOpt = document.createElement('option');
    allOrgaoOpt.value = 'all';
    allOrgaoOpt.textContent = 'Todos os órgãos';
    filterOrgaoEl.appendChild(allOrgaoOpt);
    var seenOrgao = {};
    rowsForTab.forEach(function (e) {
      if (e.orgao && !seenOrgao[e.orgao]) {
        seenOrgao[e.orgao] = true;
        var opt = document.createElement('option');
        opt.value = e.orgao;
        opt.textContent = e.orgao;
        filterOrgaoEl.appendChild(opt);
      }
    });
    filterOrgaoEl.value = 'all';
    orgaoGroupEl.style.display = Object.keys(seenOrgao).length > 0 ? '' : 'none';

    totalCardEl.style.display = hasValor ? '' : 'none';
    if (hasValor) {
      var label = DATA.midiaLabel[current] || '';
      totalLabelEl.textContent = 'Valor total — ' + label;
    }
  }

  function renderTable() {
    var meta = currentMeta();
    if (meta) {
      mainEl.style.setProperty('--accent', meta.color);
      mainEl.style.setProperty('--accent-bg', meta.bg);
    }

    var cols = DATA.columns[current] || [];
    var hasValor = cols.some(function (c) { return c.key === 'valorFmt'; });
    theadEl.innerHTML = '';
    var trh = document.createElement('tr');
    var thSelect = document.createElement('th');
    thSelect.className = 'select-col';
    var selectAllChk = document.createElement('input');
    selectAllChk.type = 'checkbox';
    selectAllChk.setAttribute('aria-label', 'Selecionar todos');
    thSelect.appendChild(selectAllChk);
    trh.appendChild(thSelect);
    cols.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.label;
      if (col.key === 'valorFmt') th.style.textAlign = 'right';
      if (col.width) th.style.width = col.width + 'px';
      trh.appendChild(th);
    });
    var thAcoes = document.createElement('th');
    thAcoes.textContent = 'Ações';
    trh.appendChild(thAcoes);
    theadEl.appendChild(trh);

    var term = (searchEl.value || '').toLowerCase().trim();
    var filterTipo = filterTipoEl.value || 'all';
    var filterOrgao = filterOrgaoEl.value || 'all';
    var dateFrom = filterDateFromEl.value || '';
    var dateTo = filterDateToEl.value || '';
    var rows = DATA.entries.filter(function (e) { return e.midia === current; });
    if (filterTipo !== 'all') {
      rows = rows.filter(function (e) { return e.subtype === filterTipo; });
    }
    if (filterOrgao !== 'all') {
      rows = rows.filter(function (e) { return e.orgao === filterOrgao; });
    }
    if (dateFrom) {
      rows = rows.filter(function (e) { return e.documentDate && e.documentDate >= dateFrom; });
    }
    if (dateTo) {
      rows = rows.filter(function (e) { return e.documentDate && e.documentDate <= dateTo; });
    }
    if (term) {
      rows = rows.filter(function (e) {
        return cols.some(function (col) {
          var v = e[col.key];
          return v != null && String(v).toLowerCase().indexOf(term) !== -1;
        });
      });
    }

    if (hasValor) {
      var total = rows.reduce(function (sum, e) { return sum + (typeof e.value === 'number' ? e.value : 0); }, 0);
      totalValueEl.textContent = total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function syncSelectAll() {
      var total = rows.length;
      var marked = rows.filter(function (e) { return selected[e.fileKey]; }).length;
      selectAllChk.checked = total > 0 && marked === total;
      selectAllChk.indeterminate = marked > 0 && marked < total;
    }

    tbodyEl.innerHTML = '';
    rows.forEach(function (e) {
      var tr = document.createElement('tr');
      var tdSelect = document.createElement('td');
      tdSelect.className = 'select-col';
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.setAttribute('aria-label', 'Selecionar documento');
      chk.checked = !!selected[e.fileKey];
      chk.addEventListener('change', function () {
        if (chk.checked) selected[e.fileKey] = true;
        else delete selected[e.fileKey];
        syncSelectAll();
        updateZipBtn();
      });
      tdSelect.appendChild(chk);
      tr.appendChild(tdSelect);
      cols.forEach(function (col) {
        var td = document.createElement('td');
        var v = e[col.key];
        var text = v == null || v === '' ? '—' : String(v);
        if (col.key === 'valorFmt') {
          td.className = 'valor';
          td.textContent = text;
        } else if (col.key === 'subtypeFmt' && v) {
          var badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = text;
          td.appendChild(badge);
        } else if (col.key === 'descricao' || col.key === 'historico') {
          td.className = 'desc-cell';
          td.textContent = text;
          td.title = text;
        } else {
          td.textContent = text;
        }
        tr.appendChild(td);
      });
      var tdAcao = document.createElement('td');
      var a = document.createElement('a');
      a.className = 'arquivo';
      a.href = './' + e.midia + '/' + (e.subFolder ? e.subFolder + '/' : '') + e.fileKey;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = DATA.fileIcon + '<span>Visualizar arquivo</span>';
      tdAcao.appendChild(a);
      tr.appendChild(tdAcao);
      tbodyEl.appendChild(tr);
    });

    selectAllChk.addEventListener('change', function () {
      rows.forEach(function (e) {
        if (selectAllChk.checked) selected[e.fileKey] = true;
        else delete selected[e.fileKey];
      });
      renderTable();
      updateZipBtn();
    });
    syncSelectAll();
    updateZipBtn();

    emptyEl.style.display = rows.length === 0 ? 'block' : 'none';
  }

  searchEl.addEventListener('input', renderTable);
  filterTipoEl.addEventListener('change', renderTable);
  filterOrgaoEl.addEventListener('change', renderTable);
  filterDateFromEl.addEventListener('change', renderTable);
  filterDateToEl.addEventListener('change', renderTable);
  printBtnEl.addEventListener('click', function () { window.print(); });
  renderTabs();
  populateFilters();
  renderTable();
})();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
