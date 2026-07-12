
import { readFileSync } from 'node:fs';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Config de build do desktop (Electron + Vite + React).
 * - main:     processo principal, saida CommonJS em out/main/main.js
 * - preload:  ponte blindada, saida CommonJS obrigatoria (sandbox nao suporta ESM)
 * - renderer: SPA React, raiz no diretorio do app (index.html)
 */

/**
 * Em monorepo pnpm o electron-builder so copia pro app.asar as deps DIRETAS
 * listadas no package.json, sem seguir os symlinks do virtual store pra
 * pegar as dependencias transitivas delas — ja quebrou 2x em producao
 * ("Cannot find module 'fs-extra'" via electron-updater, depois "Cannot
 * find module '@signpdf/placeholder-pdfkit010'" via @signpdf/placeholder-
 * plain). Em vez de excluir pacote por pacote da externalizacao (whack-a-
 * mole a cada nova lib pura-JS adicionada), bundla tudo que nao precisa
 * ficar de fora, eliminando a resolucao de node_modules em runtime.
 *
 * Ficam de fora do bundle (continuam externalizadas, resolvidas via
 * node_modules em runtime):
 * - keytar: nativa de verdade (carrega um .node), nao da pra bundlar —
 *   tambem tem entrada em `asarUnpack` no electron-builder.yml.
 * - @jdoc/shared: workspace package com barrel export (__exportStar) — o
 *   commonjs plugin do rollup nao extrai os named exports corretamente se
 *   ele for bundlado junto; funciona bem externalizado.
 */
const KEEP_EXTERNAL = new Set(['keytar', '@jdoc/shared']);
const pkgJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  dependencies?: Record<string, string>;
};
const bundledDeps = Object.keys(pkgJson.dependencies ?? {}).filter((dep) => !KEEP_EXTERNAL.has(dep));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledDeps })],
    build: {
      lib: { entry: 'electron/main.ts' },
      // format: 'cjs' + extensao .cjs obrigatorios (nao so preload): o
      // package.json tem "type": "module", entao um main.js ESM tentando
      // importar estaticamente uma dep externalizada em CJS (@jdoc/shared)
      // aciona um bug do proprio Node no interop ESM/CJS
      // (cjsPreparseModuleExports lanca "Cannot read properties of
      // undefined (reading 'exports')") — o app morre no boot, antes de
      // qualquer linha de main.ts rodar, sem log nem crash dialog. A
      // extensao .cjs forca o Node a tratar o arquivo como CommonJS
      // incondicionalmente, ignorando o "type": "module" do package.json
      // (so o format:'cjs' com extensao .js NAO e suficiente).
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'main.cjs' } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/preload.ts' },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.js' } },
    },
  },
  renderer: {
    root: '.',
    build: {
      // Duas entradas separadas no renderer: o app principal
      // (`index.html` + `src/main.tsx`) e o modal nativo de atualizacao
      // (`assets/update-modal/index.html` + `src/assets/update-modal/update-modal.tsx`),
      // carregado pelo electron-updater via `loadFile`.
      rollupOptions: {
        input: {
          main: 'index.html',
          'update-modal': 'assets/update-modal/index.html',
        },
      },
      // @jdoc/shared e um symlink de workspace (path real fora de node_modules);
      // incluir explicitamente faz o plugin CJS processar o __exportStar do dist,
      // expondo os named exports para o bundle do renderer.
      commonjsOptions: { include: [/node_modules/, /packages[\\/]shared/] },
    },
    // O dev server (vite dev) nao usa o commonjsOptions acima (isso e so prod build) —
    // ele serve modulos via ESM nativo do navegador e por padrao NAO pre-bundla pacotes
    // linkados do workspace (symlink), entao o dist CJS do @jdoc/shared quebra com
    // "does not provide an export named ...". optimizeDeps.include forca o esbuild a
    // pre-bundlar (e converter CJS->ESM) esse pacote tambem em dev.
    optimizeDeps: { include: ['@jdoc/shared'] },
    plugins: [react()],
  },
});
