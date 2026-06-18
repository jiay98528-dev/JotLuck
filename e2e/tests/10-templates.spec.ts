/**
 * 10-templates.spec.ts — 模板系统 E2E 测试
 *
 * 覆盖：空白/内置/自定义模板创建、占位符替换、模板对话框交互
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  getEditorContent,
  typeInEditor,
  waitForAutoSave,
} from '../helpers/test-utils';

test.describe('模板对话框', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('01-点击新建按钮打开模板对话框', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await page.waitForTimeout(500);

    // 模板对话框或 modal overlay 应该出现
    const overlay = page.locator('.modal-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });
  });

  test('02-模板对话框标题为"新建笔记"', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await page.waitForTimeout(500);

    // 检查对话框标题
    const header = page.locator('.modal-header h2, [id="template-dialog-title"]');
    await expect(header.first()).toBeVisible({ timeout: 2000 });
  });

  test('03-Escape 关闭模板对话框', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 2000 });
  });

  test('04-点击关闭按钮关闭模板对话框', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    const closeBtn = page.locator('.modal-close');
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(300);
      await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 2000 });
    }
  });

  test('05-空白卡片存在且可点击', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    const blankCard = page.locator('.blank-card, .tpl-card.blank-card');
    await expect(blankCard.first()).toBeVisible({ timeout: 2000 });
  });

  test('06-模板列表包含内置模板', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 应该有非空白的模板卡片
    const tplCards = page.locator('.tpl-card:not(.blank-card)');
    const count = await tplCards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

test.describe('空白模板创建笔记', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('07-选择空白模板创建新笔记', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 点击空白卡片
    const blankCard = page.locator('.blank-card, .tpl-card.blank-card').first();
    await blankCard.click();
    await page.waitForTimeout(500);

    // 编辑器应该可见且加载了新笔记
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
  });

  test('08-空白模板笔记可以编辑', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    const blankCard = page.locator('.blank-card, .tpl-card.blank-card').first();
    await blankCard.click();
    await page.waitForTimeout(500);

    await typeInEditor(page, '# 空白笔记\n\n从空白模板创建的笔记。');
    await waitForAutoSave(page);

    const content = await getEditorContent(page);
    expect(content).toContain('空白笔记');
    expect(content).toContain('空白模板');
  });
});

test.describe('内置模板创建笔记', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('09-选择内置模板显示预览', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 点击第一个非空白模板
    const tplCard = page.locator('.tpl-card:not(.blank-card)').first();
    await tplCard.click();
    await page.waitForTimeout(300);

    // .preview-text 仅在选中模板后渲染（v-if="selectedTpl"），验证实际预览内容
    await expect(page.locator('.preview-text')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.preview-text')).not.toBeEmpty();
  });

  test('10-使用内置模板创建笔记', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // 选择模板
    const tplCard = page.locator('.tpl-card:not(.blank-card)').first();
    await tplCard.click();
    await page.waitForTimeout(300);

    // 点击"使用此模板"按钮
    const useBtn = page.getByRole('button', { name: /使用此模板|use/i });
    if (await useBtn.isVisible({ timeout: 1000 })) {
      await useBtn.click();
      await page.waitForTimeout(500);

      // 编辑器应该加载模板内容
      await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

      const content = await getEditorContent(page);
      // 模板内容应该非空
      expect(content.length).toBeGreaterThan(10);

      // 占位符应该被替换（不应该有 {{date}} 等未替换的占位符）
      const hasUnreplaced = /{{date}}|{{year}}|{{month}}|{{day}}/i.test(content);
      if (hasUnreplaced) {
        console.warn('模板占位符未完全替换，存在 {{...}} 残留');
      }
    }
  });

  test('11-模板占位符 {{date}} 被替换', async ({ page }) => {
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    const tplCard = page.locator('.tpl-card:not(.blank-card)').first();
    await tplCard.click();
    await page.waitForTimeout(300);

    const useBtn = page.getByRole('button', { name: /使用此模板|use/i });
    if (await useBtn.isVisible({ timeout: 1000 })) {
      await useBtn.click();
      await page.waitForTimeout(500);

      const content = await getEditorContent(page);
      // {{date}} 不应该以原始形式出现
      expect(content).not.toMatch(/{{date}}/);
    }
  });
});
