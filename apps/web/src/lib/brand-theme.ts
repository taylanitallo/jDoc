import { corEfetiva, cssTemaMarca } from '@jdoc/shared';

/**
 * Aplica o tema de cor (tokens brand-* e --sidebar-bg) num `<style id="brand-theme">`
 * no `<head>`. As telas nao mudam de classe: tudo continua em `brand-*`.
 *
 * O CSS gerado fica em cache no localStorage por escopo (slug do orgao ou
 * `superadmin`), e o script inline do layout raiz (`SCRIPT_TEMA_MARCA`) o
 * aplica antes da primeira pintura — recarregar nao pisca a cor padrao.
 */
const STYLE_ID = 'brand-theme';
const PREFIXO_CACHE = 'jdoc-brand-css:';

/** Escopo do tema pela URL: `/superadmin/...` ou `/<slug>/...`. */
export function escopoTema(pathname: string): string | null {
  const primeiro = pathname.split('/')[1] ?? '';
  return primeiro && primeiro !== 'verificar' ? primeiro : null;
}

export function aplicarTemaMarca(escopo: string, corUsuario: string | null | undefined, corOrgao?: string | null): void {
  const css = cssTemaMarca(corEfetiva(corUsuario, corOrgao));
  injetar(css);
  try {
    localStorage.setItem(PREFIXO_CACHE + escopo, css);
  } catch {
    // modo privado: so nao fica em cache
  }
}

/** Prévia ao clicar num preset (nao grava cache). */
export function previaTemaMarca(cor: string): void {
  injetar(cssTemaMarca(cor));
}

/** Telas de login/acesso nao usam o tema do usuario. */
export function removerTemaMarca(): void {
  document.getElementById(STYLE_ID)?.remove();
}

function injetar(css: string): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/**
 * Script inline (layout raiz) que aplica o CSS em cache antes da pintura.
 * Fora das telas de login, recuperacao de senha e da verificacao publica.
 */
export const SCRIPT_TEMA_MARCA = `
(function(){try{
  var p=location.pathname, s=p.split('/')[1]||'';
  if(/\\/(login|esqueci-senha|redefinir-senha|legislacao|privacidade)(\\/|$)/.test(p)||!s||s==='verificar')return;
  var css=localStorage.getItem('${PREFIXO_CACHE}'+s);
  if(css){var el=document.createElement('style');el.id='${STYLE_ID}';el.textContent=css;document.head.appendChild(el);}
}catch(_){}})();
`;
