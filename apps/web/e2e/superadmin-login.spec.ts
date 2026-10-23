import { expect, test } from '@playwright/test';

/** Login da area restrita: cartao centralizado, sem rolagem, sem fotos e sem dizer o que e. */
for (const tela of [
  { nome: 'notebook', width: 1366, height: 625 },
  { nome: 'celular', width: 390, height: 740 },
]) {
  test(`login do superadmin centralizado e sem rolagem (${tela.nome})`, async ({ page }) => {
    await page.setViewportSize({ width: tela.width, height: tela.height });
    await page.goto('/superadmin/login');
    await expect(page.getByRole('heading', { name: 'Área restrita' })).toBeVisible();
    await expect(page).toHaveTitle('Acesso restrito');

    const semRolagem = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
    expect(semRolagem).toBe(true);

    const cartao = await page.getByRole('heading', { name: 'Área restrita' }).locator('xpath=ancestor::div[contains(@class,"rounded-[16px]")][1]').boundingBox();
    expect(cartao).not.toBeNull();
    const centroX = cartao!.x + cartao!.width / 2;
    const centroY = cartao!.y + cartao!.height / 2;
    expect(Math.abs(centroX - tela.width / 2)).toBeLessThan(12);
    expect(Math.abs(centroY - tela.height / 2)).toBeLessThan(40);

    expect(await page.locator('img').count()).toBe(0);
    await expect(page.locator('body')).not.toContainText(/superadmin/i);
    await expect(page.getByRole('button', { name: 'Mostrar senha' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'JEOS SISTEMAS E ASSESSORIAS LTDA' })).toHaveAttribute('href', 'https://www.jeossistemas.com');
  });
}
