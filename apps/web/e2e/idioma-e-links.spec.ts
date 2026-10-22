import { expect, test } from '@playwright/test';

/** Palavras em ingles que nao podem aparecer na interface. */
const PROIBIDAS = [
  'Dashboard',
  'Login',
  'Logout',
  'Sign in',
  'Password',
  'Settings',
  'Loading',
  'Submit',
  'Cancel',
  'Users',
  'Error',
  'Not Found',
  'Unauthorized',
  'Forbidden',
  'Save',
  'Delete',
  'Search',
];

const PAGINAS_PUBLICAS = ['/superadmin/login', '/verificar', '/'];

for (const caminho of PAGINAS_PUBLICAS) {
  test(`sem palavras em inglês em ${caminho}`, async ({ page }) => {
    await page.goto(caminho);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const texto = await page.locator('body').innerText();
    for (const p of PROIBIDAS) {
      expect(texto, `"${p}" em ${caminho}`).not.toMatch(new RegExp(`\b${p}\b`));
    }
  });
}

for (const caminho of ['/', '/verificar']) {
  test(`nenhum link para a área restrita em ${caminho}`, async ({ page }) => {
    await page.goto(caminho);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    expect(await page.locator('a[href*="/superadmin"]').count()).toBe(0);
  });
}

test('a área restrita não é indexada', async ({ page }) => {
  await page.goto('/superadmin/login');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
