import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// Carrega variaveis do .env do root
try {
  const envFile = resolve(process.cwd(), '../../.env');
  const content = readFileSync(envFile, 'utf-8');
  // Parse simples KEY=VALUE
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && val && !process.env[key]) {
        process.env[key] = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }
} catch {
  // sem .env no root
}

// Default: testes e2e desligam o throttler (NAO estao testando throttling).
// O spec dedicado de throttling redefine para '' no beforeAll, antes de
// carregar AppModule, religando o guard para aquele unico arquivo.
if (process.env.THROTTLE_DISABLED === undefined) {
  process.env.THROTTLE_DISABLED = '1';
}

export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    // e2e roda serial: compartilha estado do banco
    fileParallelism: false,
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
});