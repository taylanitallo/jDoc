import { FUSO_ORGAO } from '@jdoc/shared';

/**
 * Datas sempre no fuso de Fortaleza, nunca no do navegador nem em UTC.
 * Aceita Date, ISO completo (`2026-10-22T13:00:00Z`) ou data pura
 * (`2026-10-22`) — esta ultima e lida como meio-dia em Fortaleza, para nao
 * escorregar para o dia anterior.
 */
type Entrada = Date | string | number | null | undefined;

function paraDate(v: Entrada): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00-03:00`);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmtDia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_ORGAO, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtDiaHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO_ORGAO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_ORGAO, hour: '2-digit', minute: '2-digit' });
const fmtIso = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_ORGAO, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 22/10/2026 */
export function fmtDate(v: Entrada, vazio = '—'): string {
  const d = paraDate(v);
  return d ? fmtDia.format(d) : vazio;
}

/** 22/10/2026 13:45 */
export function fmtDateTime(v: Entrada, vazio = '—'): string {
  const d = paraDate(v);
  return d ? fmtDiaHora.format(d).replace(',', '') : vazio;
}

/** 13:45 */
export function fmtTime(v: Entrada, vazio = '—'): string {
  const d = paraDate(v);
  return d ? fmtHora.format(d) : vazio;
}

/** Data (YYYY-MM-DD) de um instante, em Fortaleza. */
export function isoDateFortaleza(v: Entrada): string | null {
  const d = paraDate(v);
  return d ? fmtIso.format(d) : null;
}

/** Hoje (YYYY-MM-DD) em Fortaleza. Nunca `new Date().toISOString().slice(0, 10)`. */
export function todayFortaleza(agora: Date = new Date()): string {
  return fmtIso.format(agora);
}

/** "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", ou a data. */
export function fmtRelative(v: Entrada, agora: Date = new Date(), vazio = '—'): string {
  const d = paraDate(v);
  if (!d) return vazio;
  const seg = Math.round((agora.getTime() - d.getTime()) / 1000);
  if (seg < 0) return fmtDateTime(d);
  if (seg < 60) return 'agora';
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const hoje = todayFortaleza(agora);
  const dia = isoDateFortaleza(d);
  if (dia === hoje) return `há ${h} h`;
  const ontem = todayFortaleza(new Date(agora.getTime() - 86_400_000));
  if (dia === ontem) return `ontem às ${fmtTime(d)}`;
  const dias = Math.floor(h / 24);
  if (dias < 7) return `há ${Math.max(dias, 2)} dias`;
  return fmtDate(d);
}

/** Duracao em ms legivel: "320 ms", "1,4 s", "2 min 5 s". */
export function fmtDuracao(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
  const min = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${min} min ${s} s` : `${min} min`;
}
