import { test, expect } from '@playwright/test';

test('app loads and displays heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('MarkLuck');
  await expect(page.locator('p')).toContainText('M0 scaffold ready');
});
