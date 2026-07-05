import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * Config de build do desktop (Electron + Vite + React).
 * - main:     processo principal, saida CommonJS em out/main/main.js
 * - preload:  ponte blindada, saida CommonJS obrigatoria (sandbox nao suporta ESM)
 * - renderer: SPA React, raiz no diretorio do app (index.html)
 */
export default defineConfig({
  main: {
    // Externaliza deps (@jdoc/shared, zod) — resolvidas em runtime como CJS,
    // sem o rollup tentar bundlar/tracejar os named exports do dist do shared.
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/main.ts' },
      rollupOptions: { output: { entryFileNames: 'main.js' } },
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
      rollupOptions: { input: 'index.html' },
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
