/**
 * 04-theme-settings-panels.spec.ts — 主题切换、设置对话框、右侧面板 E2E 测试
 *
 * 覆盖：明暗主题切换、主题持久化、设置对话框打开/关闭、
 *       右侧翼面板的目录/反向链接/标签云、面板折叠/展开
 */
import { test, expect } from '@playwright/test';
import { waitForAppReady } from '../helpers/test-utils';

// ============================================================
// 主题切换
// ============================================================
test.describe('主题切换', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('01-点击主题按钮切换明暗主题', async ({ page }) => {
    const themeBtn = page.locator('.topbar-btn--theme');
    await expect(themeBtn).toBeVisible();

    // 获取当前 scheme
    const beforeScheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-color-scheme'),
    );
    expect(beforeScheme).toBeDefined();

    // 点击切换
    await themeBtn.click();
    await page.waitForTimeout(300);

    const afterScheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-color-scheme'),
    );
    expect(afterScheme).toBeDefined();
    expect(afterScheme).not.toBe(beforeScheme);

    // 再次点击应回到原 scheme
    await themeBtn.click();
    await page.waitForTimeout(300);

    const backScheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-color-scheme'),
    );
    expect(backScheme).toBe(beforeScheme);
  });

  test('02-主题设置持久化到 localStorage', async ({ page }) => {
    const themeBtn = page.locator('.topbar-btn--theme');

    // 先确保是 light
    await page.evaluate(() => localStorage.setItem('markluck-theme', 'light'));
    await page.reload();
    await waitForAppReady(page);

    // 切换到 dark
    await themeBtn.click();
    await page.waitForTimeout(300);

    const storedTheme = await page.evaluate(() => localStorage.getItem('markluck-theme'));
    expect(storedTheme).toBe('dark');

    const htmlScheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-color-scheme'),
    );
    expect(htmlScheme).toBe('dark');
  });

  test('03-页面刷新后主题保持不变', async ({ page }) => {
    const themeBtn = page.locator('.topbar-btn--theme');

    // 切换到 dark
    await themeBtn.click();
    await page.waitForTimeout(300);

    const beforeReload = await page.evaluate(() =>
      document.documentElement.getAttribute('data-color-scheme'),
    );
    expect(beforeReload).toBe('dark');

    // 刷新页面
    await page.reload();
    await waitForAppReady(page);

    const afterReload = await page.evaluate(() =>
      document.documentElement.getAttribute('data-color-scheme'),
    );
    expect(afterReload).toBe('dark');

    // localStorage 应仍然保持 dark
    const storedTheme = await page.evaluate(() => localStorage.getItem('markluck-theme'));
    expect(storedTheme).toBe('dark');
  });

  test('04-主题按钮有正确的 ARIA 标签', async ({ page }) => {
    const themeBtn = page.locator('.topbar-btn--theme');
    await expect(themeBtn).toHaveAttribute('aria-label', '切换明暗主题');
    await expect(themeBtn).toHaveAttribute('title', '切换明暗主题');
  });
});

// ============================================================
// 设置对话框
// ============================================================
test.describe('设置对话框', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('05-点击设置按钮打开设置对话框', async ({ page }) => {
    const settingsBtn = page.locator('.wing-settings-btn');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // 模态覆盖层 + 模态卡片应可见
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.modal-card')).toBeVisible();

    // 标题应显示"设置"
    await expect(page.locator('.modal-card .modal-header h2')).toHaveText('设置');
  });

  test('06-按 Escape 关闭设置对话框', async ({ page }) => {
    // 打开对话框
    const settingsBtn = page.locator('.wing-settings-btn');
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 按 Escape 关闭
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  test('07-点击关闭按钮关闭设置对话框', async ({ page }) => {
    const settingsBtn = page.locator('.wing-settings-btn');
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 点击关闭按钮 (×)
    await page.locator('.modal-close').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  test('08-点击遮罩层关闭设置对话框', async ({ page }) => {
    const settingsBtn = page.locator('.wing-settings-btn');
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 点击遮罩层（modal-overlay 非 modal-card 区域）
    await page.locator('.modal-overlay').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  test('09-设置对话框包含导航标签页', async ({ page }) => {
    const settingsBtn = page.locator('.wing-settings-btn');
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 导航栏应存在
    await expect(page.locator('.settings-nav')).toBeVisible();
    // 至少有一个标签页
    const navItems = page.locator('.settings-nav .nav-item');
    const count = await navItems.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('10-设置按钮有正确的 title 属性', async ({ page }) => {
    const settingsBtn = page.locator('.wing-settings-btn');
    await expect(settingsBtn).toHaveAttribute('title', '设置');
  });

  test('11-重复打开/关闭设置对话框不产生异常', async ({ page }) => {
    const settingsBtn = page.locator('.wing-settings-btn');

    // 打开 → 关闭 → 打开 → 关闭
    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });

    await settingsBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });
});

// ============================================================
// 右侧翼面板 — 内容区段
// ============================================================
test.describe('右侧翼面板内容', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('12-右侧翼面板可见', async ({ page }) => {
    await expect(page.locator('.right-wing')).toBeVisible({ timeout: 3000 });
  });

  test('13-右侧面板包含目录 (outline) 区段', async ({ page }) => {
    // 目录区段默认打开
    const outlineBody = page.locator('.section-body--outline');
    await expect(outlineBody).toBeVisible({ timeout: 3000 });
  });

  test('14-右侧面板包含反向链接 (backlinks) 区段', async ({ page }) => {
    // backlinks 区段存在，默认折叠所以 body 不可见，但 header 应可见
    const backlinksHeader = page.locator('.section-header').filter({ hasText: '反链' });
    await expect(backlinksHeader).toBeVisible({ timeout: 3000 });
  });

  test('15-右侧面板包含标签云 (tags) 区段', async ({ page }) => {
    // 标签区段默认打开
    const tagsBody = page.locator('.section-body--tags');
    await expect(tagsBody).toBeVisible({ timeout: 3000 });
  });

  test('16-标签区域可见且包含标签容器', async ({ page }) => {
    await expect(page.locator('.section-body--tags')).toBeVisible({ timeout: 3000 });

    // 标签云容器可见（即使没有标签也有空容器）
    const tagsArea = page.locator('.section-body--tags');
    await expect(tagsArea).toBeVisible();
  });

  test('17-右侧面板有三个区段标题', async ({ page }) => {
    const headers = page.locator('.section-header');
    const count = await headers.count();
    expect(count).toBe(3);
  });
});

// ============================================================
// 右侧翼面板 — 折叠/展开
// ============================================================
test.describe('右侧翼面板折叠展开', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('18-点击区段标题可折叠该区段', async ({ page }) => {
    // 目录区段默认打开，找到其 header 并点击折叠
    const outlineHeader = page.locator('.section-header').filter({ hasText: '大纲' });
    await expect(outlineHeader).toBeVisible();

    // 确认打开
    await expect(page.locator('.section-body--outline')).toBeVisible();

    // 点击折叠
    await outlineHeader.click();
    await page.waitForTimeout(400);

    // 目录 body 应不可见
    await expect(page.locator('.section-body--outline')).not.toBeVisible({
      timeout: 2000,
    });
  });

  test('19-点击区段标题可展开该区段', async ({ page }) => {
    // 反向链接默认折叠，找到其 header 并点击展开
    const backlinksHeader = page.locator('.section-header').filter({ hasText: '反链' });
    await expect(backlinksHeader).toBeVisible();

    // 确认折叠
    await expect(page.locator('.section-body--backlinks')).not.toBeVisible();

    // 点击展开
    await backlinksHeader.click();
    await page.waitForTimeout(400);

    // 反向链接 body 应可见
    await expect(page.locator('.section-body--backlinks')).toBeVisible({
      timeout: 2000,
    });
  });

  test('20-再次点击已展开的区段将其折叠', async ({ page }) => {
    const backlinksHeader = page.locator('.section-header').filter({ hasText: '反链' });

    // 展开
    await backlinksHeader.click();
    await page.waitForTimeout(400);
    await expect(page.locator('.section-body--backlinks')).toBeVisible();

    // 再次点击折叠
    await backlinksHeader.click();
    await page.waitForTimeout(400);
    await expect(page.locator('.section-body--backlinks')).not.toBeVisible({
      timeout: 2000,
    });
  });
});
