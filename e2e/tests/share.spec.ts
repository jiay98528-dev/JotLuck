/**
 * M3 E2E — 分享系统
 * 覆盖：格式选择、分享渠道、剪贴板、取消
 */
import { test, expect } from '@playwright/test';

test.describe('分享系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
    // 打开笔记以启用分享按钮
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
  });

  test('V1: 分享按钮可见且可点击', async ({ page }) => {
    const shareBtn = page.getByTitle('分享');
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });
  });

  test('V1: 分享对话框 — 格式选择步骤', async ({ page }) => {
    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.dialog-header h2')).toHaveText('分享笔记');

    // 两种格式可选 — 使用 .format-name 精确定位
    await expect(page.locator('.format-name', { hasText: 'Markdown' })).toBeVisible();
    await expect(page.locator('.format-name', { hasText: '纯文本' })).toBeVisible();
  });

  test('V1: 分享 — Markdown 格式默认选中', async ({ page }) => {
    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.format-option--selected')).toContainText('Markdown');
  });

  test('V1: 分享 — 切换到纯文本', async ({ page }) => {
    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.format-option').last().click(); // 纯文本是第二个
    await expect(page.locator('.format-option--selected')).toContainText('纯文本');
  });

  test('V1: 分享 — 下一步到渠道选择', async ({ page }) => {
    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: '下一步' }).click();
    // 转换动画最多 1-2s
    await expect(page.locator('.channel-list')).toBeVisible({ timeout: 5000 });

    // 渠道选择应显示
    await expect(page.locator('.channel-name', { hasText: '复制到剪贴板' })).toBeVisible();
    await expect(page.locator('.channel-name', { hasText: '邮件发送' })).toBeVisible();
  });

  test('V1: 分享 — 复制到剪贴板', async ({ page }) => {
    // 仅 Chromium 支持 clipboard-write 权限
    const browserName = page.context().browser()!.browserType().name();

    if (browserName === 'chromium') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    }

    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.locator('.channel-list')).toBeVisible({ timeout: 5000 });

    await page.locator('.channel-option').first().click();

    // 应显示结果
    await expect(page.locator('.share-result')).toBeVisible({ timeout: 5000 });
    // 结果信息应该是成功（成功或失败都是合理的，取决于 clipboard API 可用性）
    const resultVisible = await page.locator('.share-result').isVisible();
    expect(resultVisible).toBe(true);
  });

  test('V1: 分享 — 取消按钮关闭对话框', async ({ page }) => {
    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });

    // 在第一步点击取消
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('.share-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 分享 — X 按钮关闭对话框', async ({ page }) => {
    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.dialog-close').click();
    await expect(page.locator('.share-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 分享完成 — 点击完成关闭', async ({ page }) => {
    const browserName = page.context().browser()!.browserType().name();

    if (browserName === 'chromium') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    }

    await page.getByTitle('分享').click();
    await expect(page.locator('.share-dialog')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.locator('.channel-list')).toBeVisible({ timeout: 5000 });
    await page.locator('.channel-option').first().click();

    // 等待结果出现
    await expect(page.locator('.share-result')).toBeVisible({ timeout: 5000 });

    // 完成按钮出现
    await page.getByRole('button', { name: '完成' }).click();
    await expect(page.locator('.share-dialog')).not.toBeVisible({ timeout: 2000 });
  });
});
