/**
 * M4 E2E — 模板系统
 * 覆盖：内置模板、空白笔记、自定义模板、占位符替换
 */
import { test, expect } from '@playwright/test';

test.describe('模板系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
  });

  test('V1: 新建笔记按钮打开模板对话框', async ({ page }) => {
    const newNoteBtn = page.getByTitle('新建笔记（从模板）');
    await expect(newNoteBtn).toBeVisible();
    await newNoteBtn.click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });
  });

  test('V1: 模板对话框标题和内置模板', async ({ page }) => {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.dialog-header h2')).toHaveText('选择模板');

    // 3 个内置模板
    const builtins = ['日记', '会议纪要', '周报'];
    for (const name of builtins) {
      await expect(page.locator('.template-card', { hasText: name })).toBeVisible();
    }
  });

  test('V1: 选择模板 — 高亮选中状态', async ({ page }) => {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    // 点击"日记"
    await page.locator('.template-card', { hasText: '日记' }).click();
    await expect(page.locator('.template-card--selected')).toContainText('日记');

    // 预览区应显示内容
    const preview = page.locator('.preview-box');
    await expect(preview).toBeVisible({ timeout: 2000 });
    const previewText = await preview.textContent();
    expect(previewText).toBeTruthy();
  });

  test('V1: 使用模板创建笔记 — 占位符替换', async ({ page }) => {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    // 选择"日记"模板
    await page.locator('.template-card', { hasText: '日记' }).click();
    await page.getByRole('button', { name: '使用模板' }).click();

    // 编辑器应打开并加载内容
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 检查占位符已替换 ({{date}} 应替换为日期格式)
    const content = await page.locator('.cm-content').innerText();
    expect(content).not.toContain('{{date}}');
    // 应包含日期格式 (YYYY-MM-DD)
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(content).not.toContain('{{year}}');
    expect(content).not.toContain('{{month}}');
    expect(content).not.toContain('{{day}}');
  });

  test('V1: 空白笔记 — 快速创建无模板笔记', async ({ page }) => {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: '空白笔记' }).click();

    // 编辑器打开，内容可能包含默认标题
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.editor-file-name')).toBeVisible({ timeout: 5000 });
  });

  test('V1: 模板对话框 — 取消按钮关闭', async ({ page }) => {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.locator('.template-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 模板对话框 — X 按钮关闭', async ({ page }) => {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.dialog-close').click();
    await expect(page.locator('.template-dialog')).not.toBeVisible({ timeout: 2000 });
  });

  test('V1: 创建笔记后 — 文件树中出现新文件', async ({ page }) => {
    // 记录创建前的文件数
    const beforeCount = await page.locator('.node-item--file').count();

    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: '空白笔记' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 等待保存完成 + 文件树更新
    await expect(page.locator('.status-saved')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(800);

    const afterCount = await page.locator('.node-item--file').count();
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1);
  });

  test('V4: 模板占位符 — {{date}} 替换为今日日期', async ({ page }) => {
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.template-card', { hasText: '日记' }).click();
    await page.getByRole('button', { name: '使用模板' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    const content = await page.locator('.cm-content').innerText();

    // {{date}} 应被替换为 YYYY-MM-DD 格式
    const dateMatch = content.match(/\d{4}-\d{2}-\d{2}/);
    expect(dateMatch).toBeTruthy();

    // {{week}} 应被替换为中文字符 (周一~周日)
    expect(content).toMatch(/周[一二三四五六日]/);
  });

  test('V1: 保存当前笔记为自定义模板 — 从已打开的笔记', async ({ page }) => {
    // 先打开欢迎笔记
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 打开模板对话框
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    // 检查"保存为自定义模板"区域
    await expect(page.locator('.save-as-template')).toBeVisible({ timeout: 2000 });

    // 点击"保存为自定义模板"
    await page.locator('.btn--small', { hasText: '保存为自定义模板' }).click();

    // 表单应出现
    await expect(page.locator('input[placeholder="模板名称"]')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('input[placeholder="模板描述（可选）"]')).toBeVisible();

    // 填写名称
    await page.locator('input[placeholder="模板名称"]').fill('E2E测试模板');
    await page.locator('input[placeholder="模板描述（可选）"]').fill('自动化测试创建');

    // 保存
    await page.locator('.save-form-actions .btn--primary').click();

    // 自定义模板列表应出现新模板
    await expect(page.locator('.template-card', { hasText: 'E2E测试模板' })).toBeVisible({
      timeout: 3000,
    });
  });

  test('V3: 自定义模板持久化 — 刷新后仍存在', async ({ page }) => {
    // 创建自定义模板
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.btn--small', { hasText: '保存为自定义模板' }).click();
    await page.locator('input[placeholder="模板名称"]').fill('持久化模板');
    await page.locator('.save-form-actions .btn--primary').click();
    await expect(page.locator('.template-card', { hasText: '持久化模板' })).toBeVisible({
      timeout: 3000,
    });

    // 关闭对话框
    await page.locator('.dialog-close').click();
    await page.waitForTimeout(300);

    // 刷新
    await page.reload();
    await page.locator('#markluck-app').waitFor({ timeout: 15000 });
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    // 重新打开模板对话框
    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    // 自定义模板应仍存在
    await expect(page.locator('.template-card', { hasText: '持久化模板' })).toBeVisible({
      timeout: 3000,
    });
  });

  test('V1: 删除自定义模板', async ({ page }) => {
    // 先创建一个
    await page.locator('.node-name', { hasText: '欢迎.md' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });

    await page.getByTitle('新建笔记（从模板）').click();
    await expect(page.locator('.template-dialog')).toBeVisible({ timeout: 3000 });

    await page.locator('.btn--small', { hasText: '保存为自定义模板' }).click();
    await page.locator('input[placeholder="模板名称"]').fill('待删除模板');
    await page.locator('.save-form-actions .btn--primary').click();
    await expect(page.locator('.template-card', { hasText: '待删除模板' })).toBeVisible({
      timeout: 3000,
    });

    // 点击删除
    const deleteBtn = page.locator('.template-delete', { hasText: '×' });
    await expect(deleteBtn).toBeVisible({ timeout: 2000 });
    await deleteBtn.click();

    await page.waitForTimeout(300);
    // 模板应从列表消失
    await expect(page.locator('.template-card', { hasText: '待删除模板' })).toHaveCount(0);
  });
});
