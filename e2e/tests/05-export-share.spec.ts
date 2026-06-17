/**
 * 05-export-share.spec.ts — 导出与分享 E2E 测试
 *
 * 覆盖：导出对话框打开/关闭/格式选择/导出动作、
 *       分享对话框打开/关闭/格式选项
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  openExportDialog,
  typeInEditor,
  waitForAutoSave,
} from '../helpers/test-utils';

test.describe('导出与分享', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    // 确保有内容可导出
    await typeInEditor(page, '# 测试导出\n\n这是一段用于导出测试的 Markdown 内容。');
    await waitForAutoSave(page);
  });

  // ── Export Dialog ──────────────────────────────────────

  test('01-点击顶栏导出按钮打开导出对话框', async ({ page }) => {
    const exportBtn = page.locator('.topbar-btn--export');
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // 导出对话框出现
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.modal-overlay .modal-header h2')).toHaveText('导出笔记');
  });

  test('02-导出对话框显示格式选项', async ({ page }) => {
    await openExportDialog(page);

    // 验证导出对话框可见
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // 验证 6 种格式卡片
    const formatCards = page.locator('.format-card');
    await expect(formatCards.first()).toBeVisible();
    await expect(formatCards).toHaveCount(6);

    const expectedFormats = ['PDF', 'DOCX', 'XLSX', 'CSV', 'TXT', 'HTML'];
    for (const fmt of expectedFormats) {
      await expect(page.locator('.format-card', { hasText: fmt })).toBeVisible();
    }

    // 验证选项开关存在
    await expect(page.locator('.toggle-row', { hasText: 'YAML Frontmatter' })).toBeVisible();
    await expect(page.locator('.toggle-row', { hasText: '代码行号' })).toBeVisible();
    await expect(page.locator('.toggle-row', { hasText: 'Wiki 链接' })).toBeVisible();

    // 验证 footer 按钮
    await expect(page.locator('.modal-footer button', { hasText: '取消' })).toBeVisible();
    await expect(page.locator('.modal-footer button', { hasText: '导出' })).toBeVisible();
  });

  test('03-Escape键关闭导出对话框', async ({ page }) => {
    await openExportDialog(page);
    await expect(page.locator('.modal-overlay')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  test('04-点击覆盖层背景关闭导出对话框', async ({ page }) => {
    await openExportDialog(page);
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // 点击 overlay 边缘区域（而非 modal-card 内部）
    const overlay = page.locator('.modal-overlay');
    await overlay.click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  // ── Share Dialog ───────────────────────────────────────

  test('05-点击顶栏分享按钮打开分享对话框', async ({ page }) => {
    const shareBtn = page.locator('.topbar-btn--share');
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();

    // 分享对话框出现
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.modal-overlay .modal-header h2')).toHaveText('分享笔记');
  });

  test('06-分享对话框显示格式选项', async ({ page }) => {
    await page.locator('.topbar-btn--share').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 标题
    await expect(page.locator('#share-dialog-title')).toHaveText('分享笔记');

    // 步骤指示器
    await expect(page.locator('.step-dots')).toBeVisible();
    await expect(page.locator('.step-dots .dot.active')).toHaveCount(1);

    // 格式卡片
    const optionCards = page.locator('.option-card');
    await expect(optionCards.first()).toBeVisible();
    await expect(optionCards).toHaveCount(4);

    const expectedFormats = ['Markdown', '纯文本', 'HTML', 'PDF'];
    for (const fmt of expectedFormats) {
      await expect(page.locator('.option-card', { hasText: fmt })).toBeVisible();
    }

    // 步骤标签
    await expect(page.locator('.step-label')).toHaveText('选择导出格式');

    // footer 按钮
    await expect(page.locator('.modal-footer button', { hasText: '取消' })).toBeVisible();
    await expect(page.locator('.modal-footer button', { hasText: '下一步' })).toBeVisible();
  });

  test('07-Escape键关闭分享对话框', async ({ page }) => {
    await page.locator('.topbar-btn--share').click();
    await expect(page.locator('.modal-overlay')).toBeVisible();
    // 确认是分享对话框
    await expect(page.locator('#share-dialog-title')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  // ── Export Action ──────────────────────────────────────

  test('08-选择格式后触发导出动作', async ({ page }) => {
    await openExportDialog(page);
    await expect(page.locator('.modal-overlay')).toBeVisible();

    // 默认选中 PDF，点击导出
    await expect(page.locator('.format-card.selected')).toContainText('PDF');

    // 选择 DOCX 格式
    await page.locator('.format-card', { hasText: 'DOCX' }).click();
    await expect(page.locator('.format-card.selected')).toContainText('DOCX');

    // 点击导出按钮触发导出
    await page.locator('.modal-footer button', { hasText: '导出' }).click();

    // 导出过程中/完成后应有状态反馈（spinner 或成功/失败状态）
    // 等待至少一种状态出现
    const exportStatus = page.locator('.export-status, .spinner, .checkmark, .error-icon');
    await expect(exportStatus.first()).toBeVisible({ timeout: 10000 });

    // 最终应该看到成功状态（在 mock/web 环境下导出较快）
    const successOrClose = page.locator('.modal-footer button:has-text("关闭"), .success-text');
    await expect(successOrClose.first()).toBeVisible({ timeout: 10000 });
  });
});
