import { z } from 'zod';

/**
 * Tema de cor por usuario (Padrao JEOS, "Minha conta > Aparencia").
 * Prioridade: escolha do usuario -> cor da marca do orgao -> Cosmos.
 */
export const COR_PADRAO = '#2547eb';
export const HEX_COR = /^#[0-9a-fA-F]{6}$/;

export const MODOS_TEMA = ['light', 'dark', 'system'] as const;
export type ModoTema = (typeof MODOS_TEMA)[number];

export const uiThemeSchema = z
  .object({
    /** null = usar a cor do orgao (ou o padrao). */
    color: z.string().regex(HEX_COR, 'Cor inválida (use #RRGGBB)').nullable(),
    mode: z.enum(MODOS_TEMA),
  })
  .strict();
export type UiTheme = z.infer<typeof uiThemeSchema>;

/** PUT .../auth/preferences — null volta a usar a cor do orgao. */
export const preferenciasSchema = z.object({ uiTheme: uiThemeSchema.nullable() }).strict();
export type PreferenciasInput = z.infer<typeof preferenciasSchema>;

export interface PresetTema {
  id: string;
  nome: string;
  descricao: string;
  cor: string;
  /** Duas cores de apoio mostradas nas bolinhas do cartao. */
  apoio: [string, string];
  tags: string[];
}

export const PRESETS_TEMA: PresetTema[] = [
  { id: 'cosmos', nome: 'Cosmos', descricao: 'Azul institucional, o padrão do sistema.', cor: '#2547eb', apoio: ['#93b4fd', '#0f172a'], tags: ['Padrão', 'Sóbrio'] },
  { id: 'floresta', nome: 'Floresta & Céu', descricao: 'Verde vivo com toques de azul-claro.', cor: '#16a34a', apoio: ['#7dd3fc', '#052e16'], tags: ['Natureza', 'Leve'] },
  { id: 'esperanca', nome: 'Esperança & Ouro', descricao: 'Verde bandeira com detalhes dourados.', cor: '#15803d', apoio: ['#facc15', '#052e16'], tags: ['Brasil', 'Clássico'] },
  { id: 'paixao', nome: 'Paixão & Solar', descricao: 'Vermelho intenso com laranja solar.', cor: '#b91c1c', apoio: ['#fb923c', '#2a0a0a'], tags: ['Vibrante', 'Quente'] },
  { id: 'forca', nome: 'Força & Confiança', descricao: 'Vinho profundo, sério e elegante.', cor: '#991b1b', apoio: ['#fca5a5', '#1f0707'], tags: ['Elegante', 'Sóbrio'] },
  { id: 'oceano', nome: 'Oceano', descricao: 'Azul-petróleo calmo e fresco.', cor: '#0369a1', apoio: ['#67e8f9', '#082f49'], tags: ['Calmo', 'Fresco'] },
  { id: 'noite', nome: 'Noite', descricao: 'Grafite escuro, discreto e neutro.', cor: '#111827', apoio: ['#9ca3af', '#030712'], tags: ['Neutro', 'Discreto'] },
];

/** Cores rapidas do seletor de cor personalizada. */
export const CORES_RAPIDAS = ['#2547eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0369a1', '#475569'];

export const ESCALA_MARCA = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

type Hsl = { h: number; s: number; l: number };

function hexParaHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslParaHex({ h, s, l }: Hsl): string {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lum = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n: number) => lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

export type EscalaMarca = Record<(typeof ESCALA_MARCA)[number], string>;

/**
 * Gera a escala brand-50..950 com a cor escolhida no 600 (mesma matiz,
 * variando a luminosidade). No escuro o 600 nunca fica abaixo de 45% de
 * luminosidade (botao sumiria no fundo) e os tons 50/100 viram fundos escuros.
 */
export function gerarEscalaMarca(hex: string, escuro = false): EscalaMarca {
  const base = hexParaHsl(HEX_COR.test(hex) ? hex : COR_PADRAO);
  const l600 = escuro ? Math.max(base.l, 45) : base.l;
  const s = base.s;
  const claro = (l: number, sat = s) => hslParaHex({ h: base.h, s: Math.min(sat, 92), l });
  const tom = (delta: number) => hslParaHex({ h: base.h, s, l: Math.max(6, Math.min(97, l600 + delta)) });
  return {
    50: escuro ? claro(13, s * 0.45) : claro(97),
    100: escuro ? claro(19, s * 0.5) : claro(93),
    200: escuro ? claro(26, s * 0.55) : claro(86),
    300: escuro ? claro(36, s * 0.65) : claro(Math.max(76, l600 + 22)),
    400: tom(14),
    500: tom(7),
    600: tom(0),
    700: tom(-8),
    800: tom(-15),
    900: tom(-21),
    950: tom(-30),
  };
}

/** Fundo da sidebar: mesma matiz, pouca saturacao, bem escuro. */
export function corSidebar(hex: string, escuro = false): string {
  const base = hexParaHsl(HEX_COR.test(hex) ? hex : COR_PADRAO);
  return hslParaHex({ h: base.h, s: Math.min(base.s * 0.55, 48), l: escuro ? 9 : 12 });
}

/** Cor efetiva: usuario -> orgao -> padrao. */
export function corEfetiva(usuario: string | null | undefined, orgao: string | null | undefined): string {
  if (usuario && HEX_COR.test(usuario)) return usuario;
  if (orgao && HEX_COR.test(orgao)) return orgao;
  return COR_PADRAO;
}

/** CSS que sobrescreve os tokens brand-* e --sidebar-bg (claro e escuro). */
export function cssTemaMarca(hex: string): string {
  const linhas = (escuro: boolean) => {
    const esc = gerarEscalaMarca(hex, escuro);
    const vars = ESCALA_MARCA.map((k) => `--color-brand-${k}:${esc[k]}`);
    vars.push(`--sidebar-bg:${corSidebar(hex, escuro)}`);
    return vars.join(';');
  };
  return `:root{${linhas(false)}}html.dark{${linhas(true)}}`;
}
