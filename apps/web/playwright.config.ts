import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de tela (Padrao JEOS, criterios de aceite). Sobe o front em modo
 * desenvolvimento se nao houver um rodando em http://localhost:3000.
 *   pnpm --filter @jdoc/web exec playwright install chromium   (uma vez)
 *   pnpm --filter @jdoc/web test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', locale: 'pt-BR', timezoneId: 'America/Fortaleza' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 180_000 },
});
