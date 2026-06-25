/**
 * 12-cheatsheet.spec.ts — Markdown 速查表 E2E 测试
 *
 * 覆盖：速查表展开/折叠、拖拽移动、内容显示
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady } from '../helpers/test-utils';

test.describe('Markdown 速查表', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('01-速查表药丸按钮可见', async ({ page }) => {
    const pill = page.locator('.cheatsheet-pill');
    await expect(pill).toBeVisible({ timeout: 5000 });
  });

  test('02-速查表药丸显示"?"和"语法"文字', async ({ page }) => {
    const pill = page.locator('.cheatsheet-pill');
    const text = await pill.textContent();
    expect(text).toMatch(/语法|\?/);
  });

  test('03-点击药丸展开速查表', async ({ page }) => {
    const pill = page.locator('.cheatsheet-pill');
    await pill.click();
    await page.waitForTimeout(400);

    // 卡片应该可见
    const card = page.locator('.cheatsheet-card');
    await expect(card).toBeVisible({ timeout: 2000 });
  });

  test('04-展开后速查表根容器有 is-expanded 类', async ({ page }) => {
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);

    const cheatsheet = page.locator('.cheatsheet');
    await expect(cheatsheet).toHaveClass(/is-expanded/);
  });

  test('05-速查表包含语法章节', async ({ page }) => {
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);

    const sections = page.locator('.cheatsheet-section, .section-label');
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('06-速查表包含代码示例', async ({ page }) => {
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);

    const entries = page.locator('.section-entry code, .cheatsheet-section code');
    const count = await entries.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('07-点击折叠按钮收起速查表', async ({ page }) => {
    // 展开
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);
    await expect(page.locator('.cheatsheet-card')).toBeVisible({ timeout: 2000 });

    // 折叠
    const collapseBtn = page.locator('.collapse-btn, [aria-label="收起语法参考"]');
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(400);

      // 卡片应该隐藏或有 is-expanded 类被移除
      const cheatsheet = page.locator('.cheatsheet');
      const hasExpanded = await cheatsheet.evaluate((el) => el.classList.contains('is-expanded'));
      expect(hasExpanded).toBe(false);
    }
  });

  test('08-速查表有关闭/折叠按钮', async ({ page }) => {
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);

    // 应该有关闭或折叠按钮
    await expect(
      page.locator('.collapse-btn, [aria-label*="收起"], [aria-label*="关闭"]'),
    ).toBeVisible({ timeout: 3000 });
  });
});

test.describe('速查表拖拽', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('09-速查表有拖拽手柄', async ({ page }) => {
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);

    const handle = page.locator('.drag-handle');
    await expect(handle).toBeVisible({ timeout: 2000 });
  });

  test('10-拖拽手柄有正确标签', async ({ page }) => {
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);

    const handle = page.locator('.drag-handle');
    const ariaLabel = await handle.getAttribute('aria-label');
    expect(ariaLabel).toMatch(/拖拽|drag/i);
  });

  test('11-速查表拖拽后仍可见', async ({ page }) => {
    await page.locator('.cheatsheet-pill').click();
    await page.waitForTimeout(400);

    const handle = page.locator('.drag-handle');
    await expect(handle).toBeVisible();

    // 模拟拖拽
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 100, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);

      // 速查表卡片仍然可见
      await expect(page.locator('.cheatsheet-card')).toBeVisible({ timeout: 2000 });
    }
  });
});
