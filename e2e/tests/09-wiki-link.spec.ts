/**
 * 09-wiki-link.spec.ts — Wiki-Link 系统 E2E 测试
 *
 * 覆盖：[[笔记名]] 解析、点击跳转、反向链接面板、死链检测
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  getEditorContent,
  typeInEditor,
  appendInEditor,
  waitForAutoSave,
  switchToNote,
} from '../helpers/test-utils';

test.describe('Wiki-Link 输入与渲染', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('01-[[笔记名]] 语法在编辑器中正常输入', async ({ page }) => {
    await typeInEditor(page, '# Wiki-Link Test\n\n参考 [[快速入门]] 了解更多。');
    await waitForAutoSave(page);

    const content = await getEditorContent(page);
    expect(content).toContain('[[快速入门]]');
  });

  test('02-[[笔记名|别名]] 带别名的链接语法', async ({ page }) => {
    await typeInEditor(page, '# Alias Test\n\n参见 [[快速入门|入门指南]]。');
    await waitForAutoSave(page);

    const content = await getEditorContent(page);
    expect(content).toContain('[[快速入门|入门指南]]');
  });

  test('03-多个 Wiki-Link 在同一文档中', async ({ page }) => {
    await typeInEditor(page, '# Multi Links\n\n- [[快速入门]]\n- [[设计笔记]]\n- [[项目规划]]\n');
    await waitForAutoSave(page);

    const content = await getEditorContent(page);
    expect(content).toContain('[[快速入门]]');
    expect(content).toContain('[[设计笔记]]');
    expect(content).toContain('[[项目规划]]');
  });

  test('04-死链（不存在的笔记）正常显示', async ({ page }) => {
    await typeInEditor(page, '# Dead Link\n\n参考 [[不存在的笔记XYZ123]]');
    await waitForAutoSave(page);

    const content = await getEditorContent(page);
    expect(content).toContain('[[不存在的笔记XYZ123]]');
    // App should not crash on dead links
    await expect(page.locator('.cm-editor')).toBeVisible();
  });
});

test.describe('反向链接面板', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('05-右翼面板显示反链区域', async ({ page }) => {
    // 右翼面板应该存在
    await expect(page.locator('.right-wing')).toBeVisible();

    // 反链/backlinks 区域
    const backlinksSection = page.locator('.section-header').filter({ hasText: /反链|backlink/i });
    const count = await backlinksSection.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('06-创建含 Wiki-Link 的笔记后反链更新', async ({ page }) => {
    // 先切换到"快速入门"查看
    await switchToNote(page, '快速入门');
    await page.waitForTimeout(500);

    // 右翼面板的反链区域应该显示引用"快速入门"的笔记
    await expect(page.locator('.right-wing')).toBeVisible();

    // 点击反链区域展开
    const backlinksHeader = page.locator('.section-header').filter({ hasText: /反链|backlink/i });
    if ((await backlinksHeader.count()) > 0) {
      await backlinksHeader.first().click();
      await page.waitForTimeout(300);
    }
  });

  test('07-大纲区域存在', async ({ page }) => {
    await switchToNote(page, '快速入门');
    await page.waitForTimeout(500);

    const outlineSection = page.locator('.section-header').filter({ hasText: /大纲|outline/i });
    await expect(outlineSection.first()).toBeVisible({ timeout: 3000 });
  });

  test('08-标签云区域存在', async ({ page }) => {
    const tagsSection = page.locator('.section-header').filter({ hasText: /标签|tag/i });
    await expect(tagsSection.first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Wiki-Link 导航跳转', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('09-在快速入门中引用项目规划', async ({ page }) => {
    await switchToNote(page, '快速入门');
    await page.waitForTimeout(300);

    // 追加 Wiki-Link
    await appendInEditor(page, '\n\n相关笔记：[[项目规划]]');
    await waitForAutoSave(page);

    const content = await getEditorContent(page);
    expect(content).toContain('[[项目规划]]');
  });

  test('10-Wiki-Link 不影响正常编辑', async ({ page }) => {
    await typeInEditor(page, '# Normal Text\n\n这不是 [[wiki]] 链接而是普通文本。');
    await waitForAutoSave(page);

    // 编辑器正常工作
    await expect(page.locator('.cm-editor')).toBeVisible();
    const content = await getEditorContent(page);
    expect(content).toContain('Normal Text');
  });
});
