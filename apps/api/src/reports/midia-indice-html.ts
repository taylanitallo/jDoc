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
};

/** SVG inline (sem <img>/fonte externa) — herda cor via currentColor. */
function svgIcon(name: string, size = 18): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ''}</svg>`;
}

interface ColumnDef {
  key: keyof IndiceEntry | 'orgao' | 'valorFmt' | 'dataFmt' | 'subtypeFmt';
  label: string;
}

const COLUMNS: Record<Midia, ColumnDef[]> = {
  despesa: [
    { key: 'dataFmt', label: 'Data' },
    { key: 'docCaixa', label: 'Doc. Caixa' },
    { key: 'empenho', label: 'Empenho' },
    { key: 'orgao', label: 'Órgão' },
    { key: 'credor', label: 'Credor' },
    { key: 'subtypeFmt', label: 'Tipo' },
    { key: 'valorFmt', label: 'Valor' },
  ],
  receita: [
    { key: 'dataFmt', label: 'Data' },
    { key: 'orgao', label: 'Órgão' },
    { key: 'conta', label: 'Conta' },
    { key: 'historico', label: 'Histórico' },
    { key: 'subtypeFmt', label: 'Tipo' },
    { key: 'valorFmt', label: 'Valor' },
  ],
  balancete: [
    { key: 'dataFmt', label: 'Data' },
    { key: 'orgao', label: 'Órgão' },
    { key: 'competencia', label: 'Competência' },
  ],
  extrato: [
    { key: 'dataFmt', label: 'Data' },
    { key: 'banco', label: 'Banco' },
    { key: 'agencia', label: 'Agência' },
    { key: 'conta', label: 'Conta' },
    { key: 'competencia', label: 'Competência' },
    { key: 'orgao', label: 'Órgão' },
  ],
  outros: [
    { key: 'dataFmt', label: 'Data' },
    { key: 'orgao', label: 'Órgão' },
    { key: 'documentTypeNome', label: 'Tipo' },
    { key: 'descricao', label: 'Descrição' },
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
  :root { color-scheme: light; --accent: #7c3aed; --accent-bg: #f5f3ff; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #f4f5f7; color: #1f2430; }
  header { background: ${headerGradient(corDestaque)}; color: #fff; padding: 8px 28px; box-shadow: 0 2px 10px rgba(76,29,149,0.25); }
  header .header-row { display: flex; align-items: center; gap: 16px; }
  header .header-logo-img { height: 64px; width: 64px; flex-shrink: 0; object-fit: contain; border-radius: 10px; background: #fff; padding: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
  header .header-row svg { flex-shrink: 0; }
  header h1 { margin: 0 0 4px; font-size: 21px; }
  header p { margin: 0; font-size: 13px; opacity: 0.9; }
  .aviso { background: #fff7ed; border-bottom: 1px solid #fed7aa; color: #9a3412; padding: 10px 28px; font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
  .aviso svg { flex-shrink: 0; margin-top: 1px; color: #ea580c; }
  .aviso b { font-weight: 700; }
  .info-bar { display: flex; flex-wrap: wrap; gap: 12px; padding: 16px 28px; background: #fff; border-bottom: 1px solid #e2e4e9; font-size: 12px; }
  .info-bar div { display: flex; align-items: center; gap: 10px; background: #f4f5f7; border-radius: 10px; padding: 10px 16px; }
  .info-bar svg { flex-shrink: 0; color: #7c3aed; }
  .info-bar b { display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 2px; font-weight: 700; letter-spacing: .02em; }
  .info-bar span.value { font-size: 13px; font-weight: 600; color: #1f2430; }
  .tabs { display: flex; flex-wrap: wrap; gap: 10px; padding: 20px 28px 0; }
  .tab { cursor: pointer; border: 1px solid #e2e4e9; background: #fff; border-radius: 14px; padding: 10px 16px; font-size: 13px; font-weight: 600; color: #374151; display: flex; align-items: center; gap: 12px; min-width: 150px; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease, background .12s ease; }
  .tab:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
  .tab .icon-badge { flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--accent-bg); color: var(--accent); }
  .tab .count { display: block; font-size: 19px; font-weight: 800; color: var(--accent); line-height: 1.1; }
  .tab .label { display: block; font-size: 11px; font-weight: 600; color: #6b7280; margin-top: 1px; }
  .tab.active { border-color: var(--accent); background: var(--accent-bg); box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
  .filters-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 16px 28px 0; }
  .total-card { display: flex; align-items: center; gap: 10px; background: #fff; border: 1px solid #e2e4e9; border-radius: 10px; padding: 10px 16px; }
  .total-card b { display: block; font-size: 10px; text-transform: uppercase; color: #6b7280; font-weight: 700; letter-spacing: .02em; }
  .total-card span { font-size: 17px; font-weight: 800; color: #1f2430; }
  .filter-group { display: flex; align-items: center; gap: 8px; }
  .filter-group label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; }
  .filter-group select, .filter-group input[type="date"] { padding: 7px 10px; border: 1px solid #d8dae0; border-radius: 8px; font-size: 12px; background: #fff; color: #1f2430; }
  .filter-group select:focus, .filter-group input[type="date"]:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .filter-group .date-sep { font-size: 12px; color: #9ca3af; }
  .toolbar { padding: 18px 28px; display: flex; gap: 10px; }
  .search-wrap { position: relative; flex: 1; max-width: 420px; display: flex; align-items: center; }
  .search-wrap .search-icon { position: absolute; left: 10px; color: #9ca3af; pointer-events: none; }
  .search-wrap input { width: 100%; padding: 9px 12px 9px 34px; border: 1px solid #d8dae0; border-radius: 10px; font-size: 13px; }
  .search-wrap input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  main { padding: 0 28px 28px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  th, td { padding: 10px 12px; font-size: 12px; text-align: left; border-bottom: 1px solid #eef0f3; }
  th { background: #f4f5f7; text-transform: uppercase; font-size: 10px; letter-spacing: .03em; color: #6b7280; font-weight: 400; border-bottom: 2px solid #e2e4e9; }
  tbody tr:nth-child(even) td { background: #fafafb; }
  tr:hover td { background: #f5f0ff; }
  td.valor { text-align: right; font-weight: 400; font-variant-numeric: tabular-nums; color: #1f2430; }
  a.arquivo { color: #1f2430; text-decoration: none; font-weight: 400; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
  a.arquivo:hover { text-decoration: underline; }
  .empty { padding: 48px; text-align: center; color: #9ca3af; font-size: 13px; }
  .empty svg { display: block; margin: 0 auto 10px; color: #c4c8d0; }
  .btn-print { display: flex; align-items: center; gap: 7px; padding: 9px 16px; border: 1px solid #d8dae0; border-radius: 10px; background: #fff; color: #1f2430; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-print:hover { background: #f4f5f7; }
  @media print {
    @page { margin: 10mm; }
    .aviso, .filters-bar, .toolbar, .tabs, td .arquivo, th:last-child, td:last-child { display: none !important; }
    body { background: #fff; margin: 0; }
    header { box-shadow: none; padding: 10px 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .info-bar { padding: 10px 0; border-bottom: none; }
    main { padding: 0; }
    table { box-shadow: none; width: 100%; }
  }
</style>
</head>
<body>
<header>
  <div class="header-row">
    ${headerLogo}
    <div>
      <h1>${escapeHtml(nomeHeader)} — Mídia Legislativa</h1>
      <p>Competência: ${escapeHtml(mesNome)}/${exercicio}</p>
    </div>
  </div>
</header>
<div class="aviso">
  ${svgIcon('alertTriangle', 16)}
  <span><b>Importante:</b> extraia todo o conteúdo do ZIP para uma pasta antes de abrir este arquivo
  (botão direito no .zip → "Extrair Tudo"). Se abrir direto de dentro do ZIP, os links
  "Visualizar arquivo" não vão funcionar, porque os PDFs não são extraídos junto.</span>
</div>
<div class="info-bar">
  <div>${svgIcon('user', 18)}<span><b>Gerado por</b><span class="value">${escapeHtml(geradoPor)}</span></span></div>
  <div>${svgIcon('clock', 18)}<span><b>Gerado em</b><span class="value">${escapeHtml(formatDataHoraBR(geradoEm))}</span></span></div>
</div>
<div class="tabs" id="tabs"></div>
<div class="filters-bar" id="filtersBar">
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
<div class="toolbar">
  <div class="search-wrap"><span class="search-icon">${svgIcon('search', 15)}</span><input id="search" type="text" placeholder="Buscar…" /></div>
  <button type="button" class="btn-print" id="printBtn">${svgIcon('printer', 16)}<span>Imprimir</span></button>
</div>
<main id="main">
  <table>
    <thead id="thead"></thead>
    <tbody id="tbody"></tbody>
  </table>
  <div class="empty" id="empty" style="display:none">${svgIcon('inbox', 32)}Nenhum documento encontrado.</div>
</main>
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
    cols.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.label;
      if (col.key === 'valorFmt') th.style.textAlign = 'right';
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

    tbodyEl.innerHTML = '';
    rows.forEach(function (e) {
      var tr = document.createElement('tr');
      cols.forEach(function (col) {
        var td = document.createElement('td');
        var v = e[col.key];
        if (col.key === 'valorFmt') {
          td.className = 'valor';
          td.textContent = v == null || v === '' ? '—' : String(v);
        } else {
          td.textContent = v == null || v === '' ? '—' : String(v);
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
