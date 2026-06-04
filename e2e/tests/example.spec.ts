import { test, expect } from '@playwright/test';

test('app loads and displays MarkLuck heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('MarkLuck', { timeout: 15000 });
  await expect(page.getByText('选择左侧一条笔记开始编辑')).toBeVisible({ timeout: 15000 });
});
