/**
 * M3 E2E — 导出系统
 * 覆盖：6种导出格式、对话框交互、frontmatter开关、取消
 */
import { test, expect } from '@playwright/test';

test.describe('导出系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
    // 打开笔记以启用导出按钮
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
  });

  test('V1: 导出按钮可见且可点击', async ({ page }) => {
    const exportBtn = page.getByTitle('导出');
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });
  });

  test('V1: 导出对话框标题和格式选项', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.dialog-header h2')).toHaveText('导出笔记');

    // 6 种格式全部显示
    const formatCards = page.locator('.format-card');
    await expect(formatCards).toHaveCount(6);

    const expectedFormats = ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'];
    for (const fmt of expectedFormats) {
      await expect(page.locator('.format-card', { hasText: fmt })).toBeVisible();
    }
  });

  test('V1: 选择导出格式 — 高亮选中状态', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });

    // 默认 PDF 选中
    await expect(page.locator('.format-card--selected')).toContainText('PDF');

    // 选择 DOCX
    await page.locator('.format-card', { hasText: 'DOCX' }).click();
    await expect(page.locator('.format-card--selected')).toContainText('DOCX');
  });

  test('V1: frontmatter 复选框切换', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });

    const checkbox = page.getByRole('checkbox', { name: /YAML frontmatter/i });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked(); // 默认勾选

    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });

  test('V1: 导出对话框 — 取消按钮关闭', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('.export-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 导出对话框 — X 按钮关闭', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.dialog-close').click();
    await expect(page.locator('.export-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 导出对话框 — 覆盖层点击关闭', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.dialog-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('.export-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 导出按钮触发 — 显示进度状态', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });

    // 点击导出
    await page.locator('.btn--primary', { hasText: '导出' }).click();

    // 应显示进度状态（可能很快完成）
    // 等待进度或完成状态出现
    await page.waitForTimeout(1000);
    const progressOrDone = page.locator('.progress-spinner, .export-success, .export-error');
    await expect(progressOrDone).toBeVisible({ timeout: 3000 });
  });

  test('V1: 每种格式都可以选择', async ({ page }) => {
    await page.getByTitle('导出').click();
    await expect(page.locator('.export-dialog')).toBeVisible({ timeout: 3000 });

    const formats = ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'];
    for (const fmt of formats) {
      await page.locator('.format-card', { hasText: fmt }).click();
      await page.waitForTimeout(100);
      await expect(page.locator('.format-card--selected')).toContainText(fmt);
    }
  });
});
