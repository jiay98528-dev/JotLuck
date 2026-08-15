/**
 * 16-user-journeys.spec.ts — V6 用户旅程完整性测试
 *
 * 覆盖 M-R2 清单中 FRAGMENTED 和 MISSING 的核心用户旅程。
 * 每条测试 ≥4 步用户操作，验证 ≥2 个结果指标。
 *
 * V1: 交互正确性 — 验证交互后的结果
 * V2: 文件操作验证 — 写入后读取验证
 * V3: 跨会话持久化 — 刷新后验证
 * V5: 按钮完整性 — 每个按钮点击并验证可观测结果
 * V6: 用户旅程完整性 — 多步骤端到端闭环
 */
import { test, expect, type Page } from '@playwright/test';
import {
  waitForAppReady,
  waitForCleanAppReady,
  getEditorContent,
  getEditorContentFromBridge,
  typeInEditor,
  appendInEditor,
  clearEditor,
  waitForAutoSave,
  waitForMockFileContent,
  expectEditorContains,
  waitForSearchReady,
} from '../helpers/test-utils';

async function ensureViewMode(page: Page, target: 'live' | 'split'): Promise<void> {
  const current = async (): Promise<'live' | 'split' | 'read'> => {
    if (await page.locator('.reader-workbench[data-view-mode="read"]').isVisible()) return 'read';
    if (await page.locator('.split-pane').isVisible()) return 'split';
    return 'live';
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await current();
    if (previous === target) return;
    await page.locator('.view-mode-toggle').click();
    await expect.poll(current).not.toBe(previous);
  }
  expect(await current()).toBe(target);
}

// ============================================================
// Journey 1: 文件抽屉 — 展开子目录 → 打开文件 → 编辑 → 保存
// ============================================================
test.describe('V6 用户旅程', () => {
  test.beforeEach(async ({ page }) => {
    await waitForCleanAppReady(page);
  });

  test('J1: 文件抽屉 → 展开子目录 → 打开文件 → 编辑 → 保存', async ({ page }) => {
    test.setTimeout(45_000);
    await waitForSearchReady(page);
    await page.locator('.wing-bookmark-dot[aria-label="设计笔记"]').click();
    await page.waitForTimeout(500);
    await waitForSearchReady(page);

    // Step 1: 打开文件抽屉
    const menuBtn = page.locator('.topbar-btn--menu');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(300);

    // Step 2: 验证根目录条目可见
    await expect(page.locator('.tree-item:has-text("快速入门")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("格式示例")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("子文件夹")')).toBeVisible();

    // Step 3: 展开子文件夹
    const subdirItem = page.locator('.tree-item:has-text("子文件夹")');
    await subdirItem.locator('.tree-chevron').click({ force: true });
    await expect(subdirItem.locator('.tree-chevron.expanded')).toBeVisible({ timeout: 2000 });

    // Step 4: 验证子目录中的文件可见
    const childFile = page.locator('.tree-item:has-text("笔记A")');
    await expect(childFile).toBeVisible({ timeout: 2000 });

    // Step 5: 点击子目录中的文件 → 编辑器加载
    await childFile.click();
    await page.waitForTimeout(500);

    // Step 6: 验证编辑器加载了子目录文件内容
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/子文件夹/笔记A.md');
    const editorContent = await getEditorContentFromBridge(page);
    expect(editorContent).toContain('放在子文件夹里的笔记');

    // Step 7: 编辑并保存
    await typeInEditor(page, '# 来自子文件夹的笔记\n\n文件抽屉直接打开。');
    await waitForMockFileContent(page, '/子文件夹/笔记A.md', '来自子文件夹的笔记');

    // Step 8: 验证保存后内容保持
    await expectEditorContains(page, '来自子文件夹的笔记');
  });

  test('J1b: 文件抽屉只展示支持的笔记格式', async ({ page }) => {
    await page.evaluate(() => {
      const raw = localStorage.getItem('jotluck-mockfs');
      const data = raw ? JSON.parse(raw) : { version: 4, files: {}, dirs: { '/': [] } };
      const now = Date.now();
      const encodeSize = (content: string) => new TextEncoder().encode(content).length;
      const write = (path: string, content: string) => {
        data.files[path] = { content, mtime: now, size: encodeSize(content) };
      };

      data.dirs['/'] = [
        'mixed-formats',
        ...(data.dirs['/'] ?? []).filter((name: string) => name !== 'mixed-formats'),
      ];
      data.dirs['/mixed-formats'] = [
        'readme.md',
        'long-form.markdown',
        'component.mdx',
        'plain.txt',
        'image.png',
        'export.pdf',
        'readme.md.bak',
      ];
      write('/mixed-formats/readme.md', '# Readme');
      write('/mixed-formats/long-form.markdown', '# Long form');
      write('/mixed-formats/component.mdx', '# Component');
      write('/mixed-formats/plain.txt', 'Plain text');
      write('/mixed-formats/image.png', 'not listed');
      write('/mixed-formats/export.pdf', 'not listed');
      write('/mixed-formats/readme.md.bak', 'not listed');
      localStorage.setItem('jotluck-mockfs', JSON.stringify(data));
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(300);
    const mixedDir = page.locator('.tree-item:has-text("mixed-formats")');
    await expect(mixedDir).toBeVisible();
    await mixedDir.click({ force: true });

    await expect(page.locator('.tree-item:has-text("readme.md")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("long-form.markdown")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("component.mdx")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("plain.txt")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("image.png")')).toHaveCount(0);
    await expect(page.locator('.tree-item:has-text("export.pdf")')).toHaveCount(0);
    await expect(page.locator('.tree-item:has-text("readme.md.bak")')).toHaveCount(0);
  });

  test('J1c: 即时模式表格渲染列对齐且不串行', async ({ page }) => {
    test.setTimeout(60_000);
    await typeInEditor(
      page,
      [
        '# 表格渲染',
        '',
        '| 维度 | 评分 | 说明 |',
        '| :--- | ---: | :--- |',
        '| 前端开发 | 85 | React/TypeScript 主力栈 |',
        '| AI/LLM运用 | 95 | 工程化体系 |',
        '',
      ].join('\n'),
    );

    await expect(page.locator('.cm-live-block[data-block-type="tableRow"]').first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('.ml-table-cell--header')).toHaveCount(3);
    await expect(
      page.locator('.cm-live-block[data-block-type="tableRow"]').first(),
    ).toHaveAttribute('data-table-column-count', '3');
    const renderedColumnCount = await page
      .locator('.cm-live-block[data-block-type="tableRow"]')
      .first()
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(renderedColumnCount).toBe(3);
    await expect(page.locator('.ml-td')).toHaveCount(0);
    await expect(page.locator('.cm-live-block[data-block-position="separator"]')).toBeAttached();
  });

  // ==========================================================
  // Journey 2: 新建笔记 → 编辑 → 自动保存 → 刷新 → 验证 → 删除
  // ==========================================================
  test('J2: 新建笔记 → 编辑 → 自动保存 → 刷新 → 验证 → 删除', async ({ page }) => {
    // Step 1: 打开新建笔记对话框，选择空白模板
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await page.locator('.tpl-card.blank-card').click();
    await page.waitForTimeout(500);

    // Step 2: 编辑内容（使用 H1 标题以便书签 aria-label 提取）
    const noteContent = '# J2 旅程测试\n\n这是 V6 用户旅程测试笔记，验证完整闭环。';
    await typeInEditor(page, noteContent);
    await waitForAutoSave(page);

    // Step 3: 读取书签 aria-label（extractTitle 从 H1 提取标题）
    const activeDot = page.locator('.wing-bookmark-dot.active');
    const noteLabel = await activeDot.getAttribute('aria-label');
    expect(noteLabel).toBeTruthy();

    // 同时打开文件抽屉获取文件名（文件树显示文件名，非 H1 标题）
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    // 空白模板文件名格式: 笔记-YYYY-MM-DD.md
    const fileNamePattern = /笔记-\d{4}-\d{2}-\d{2}/;
    const treeItems = page.locator('.tree-item');
    const itemCount = await treeItems.count();
    let fileName = '';
    for (let i = 0; i < itemCount; i++) {
      const text = await treeItems.nth(i).textContent();
      if (text && fileNamePattern.test(text)) {
        fileName = text.trim();
        break;
      }
    }
    expect(fileName).toBeTruthy();
    // 关闭抽屉
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Step 4: 切换到其他笔记再切回，验证内容保持
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await page.waitForTimeout(300);
    await page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`).click();
    await page.waitForTimeout(500);
    await expectEditorContains(page, 'J2 旅程测试');

    // Step 5: 刷新页面，验证持久化
    await page.addInitScript(() => {
      localStorage.setItem('jotluck:welcome:completed', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    // 刷新后切到目标笔记
    await page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`).click();
    await page.waitForTimeout(500);
    await expectEditorContains(page, 'J2 旅程测试');

    // Step 6: 通过文件抽屉右键删除笔记（用文件名匹配）
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    const targetItem = page.locator(`.tree-item:has-text("${fileName}")`);
    await targetItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3000 });
    await page.locator('.context-menu-item--danger').click();

    // Step 7: 确认删除对话框
    const confirmDeleteBtn = page.locator('.modal-overlay .btn--danger');
    if (await confirmDeleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmDeleteBtn.click();
      await page.waitForTimeout(500);
    }

    // Step 8: 验证书签圆点已移除（关闭抽屉后检查）
    await expect(page.locator(`.wing-bookmark-dot[aria-label="${noteLabel}"]`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('J2b: 删除新建笔记后书签与文件树无残留', async ({ page }) => {
    const fileName = `mrr2f1-bookmark-${Date.now()}.md`;
    const noteTitle = `M-R2-F1-${Date.now()}`;
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    await page.locator('.new-note-btn').click();
    await expect(page.locator('.file-name-input')).toBeVisible({ timeout: 3000 });
    await page.locator('.file-name-input').fill(fileName);
    await page.locator('.modal-card').getByRole('button', { name: '确定', exact: true }).click();
    await expect(page.locator('.file-name-input')).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator(`.tree-item:has-text("${fileName}")`)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    if (
      await page
        .locator('.file-drawer')
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      await page.locator('.drawer-overlay').click({ position: { x: 900, y: 20 } });
    }
    await expect(page.locator('.file-drawer')).not.toBeVisible({ timeout: 3000 });

    await typeInEditor(page, `# ${noteTitle}\n\n书签残留回归检查`);
    await waitForAutoSave(page);

    const noteDot = page.locator(`.wing-bookmark-dot[aria-label="${noteTitle}"]`);
    await expect(noteDot).toBeVisible({ timeout: 5000 });

    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    const treeItem = page.locator(`.tree-item:has-text("${fileName}")`);
    await expect(treeItem).toBeVisible({ timeout: 5000 });
    await treeItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3000 });
    await page.locator('.context-menu-item--danger').click();

    const confirmDeleteBtn = page.locator('.modal-overlay .btn--danger');
    if (await confirmDeleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmDeleteBtn.click();
      await page.waitForTimeout(500);
    }

    await expect(treeItem).not.toBeVisible({ timeout: 5000 });
    await expect(noteDot).toHaveCount(0, { timeout: 5000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    const recheckTreeItem = page.locator(`.tree-item:has-text("${fileName}")`);
    await expect(recheckTreeItem).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator(`.wing-bookmark-dot[aria-label="${noteTitle}"]`)).toHaveCount(0);
  });

  // ==========================================================
  // Journey 3: 右键菜单 → 重命名 → 验证新名 → 删除 → 确认消失
  // ==========================================================
  test('J3: 右键菜单 → 重命名 → 验证 → 删除 → 确认不存在', async ({ page }) => {
    // Step 1: 打开文件抽屉
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });

    // Step 2: 右键点击 "项目规划"，从文件树中删除它（不通过书签栏）
    // 使用 "项目规划" 因为它不是 active 书签项，不会影响其他测试
    const targetName = '项目规划';
    const fileItem = page.locator(`.tree-item:has-text("${targetName}")`);
    await fileItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3000 });

    // Step 3: 点击"重命名"
    const renameOption = page.locator('.context-menu-item:has-text("重命名")');
    await expect(renameOption).toBeVisible();
    await renameOption.click();
    await page.waitForTimeout(300);

    // Step 4: 找到重命名输入框，输入新名称
    const renameInput = page.locator('.tree-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });
    const newName = 'J3-项目规划-已重命名';
    await renameInput.fill(newName);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Step 5: 验证新名称出现在文件树中
    await expect(page.locator(`.tree-item:has-text("${newName}")`)).toBeVisible({
      timeout: 3000,
    });

    // Step 6: 再次右键点击重命名后的文件 → 删除
    const renamedItem = page.locator(`.tree-item:has-text("${newName}")`);
    await renamedItem.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 3000 });

    // Step 7: 点击删除 + 确认对话框
    await page.locator('.context-menu-item--danger').click();

    // 确认删除
    const confirmBtn = page.locator('.modal-overlay .btn--danger');
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(500);
    }

    // Step 8: 验证文件从树中消失
    await expect(page.locator(`.tree-item:has-text("${newName}")`)).not.toBeVisible({
      timeout: 5000,
    });
  });

  // ==========================================================
  // Journey 4: 搜索 → 查看结果 → 点击跳转 → 编辑命中笔记
  // ==========================================================
  test('J4: 搜索 → 查看结果 → 点击跳转 → 编辑命中笔记', async ({ page }) => {
    test.setTimeout(45_000);

    // Step 1: 通过顶栏搜索入口打开命令面板
    await waitForSearchReady(page);
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');
    await page.locator('.wing-bookmark-dot[aria-label="设计笔记"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/设计笔记.md');
    await page.locator('.topbar-search-hint').click();
    await expect(page.locator('.palette')).toBeVisible({ timeout: 3000 });

    // Step 2: 从真实输入框输入正则和两个必须同时满足的标签
    const searchInput = page.locator('.search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('/欢迎使用/ tag:入门 tag:markdown');

    // Step 3: AND 标签过滤后只剩目标笔记
    const results = page.locator('.result-item');
    await expect(results).toHaveCount(1);
    await expect(results.first().locator('.result-title')).toHaveText('快速入门');

    // Step 4: 点击第一个结果
    await results.first().click();
    await expect(page.locator('.palette')).not.toBeVisible({ timeout: 3000 });

    // Step 5: 验证导航到正确笔记，CM6 折叠光标落在真实正文命中开头
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');
    const expectedCursor = await page.evaluate(() => {
      const content = window.__jotluck_e2e?.editor?.getContent() ?? '';
      return content.indexOf('欢迎使用');
    });
    expect(expectedCursor).toBeGreaterThanOrEqual(0);
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.editor?.getCursor() ?? -1))
      .toBe(expectedCursor);
    await expect(page.locator('.cm-editor.cm-focused')).toBeVisible();
    await expect(page.locator('.cm-live-block', { hasText: '欢迎使用 JotLuck' })).toHaveCount(0);

    // Step 6: 编辑命中笔记
    await appendInEditor(page, '\n\n搜索后编辑的内容。');

    // Step 7: 等待自动保存
    await waitForAutoSave(page);

    // Step 8: 切换到其他笔记再切回，验证编辑持久化
    await page.locator('.wing-bookmark-dot[aria-label="设计笔记"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/设计笔记.md');
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');
    await expectEditorContains(page, '搜索后编辑的内容');
  });

  // ==========================================================
  // Journey 5: Live Preview → 点击块 → 编辑 → ESC 恢复预览
  // ==========================================================
  test('J5: Live Preview → 点击块 → 编辑 → ESC 恢复预览', async ({ page }) => {
    // Step 1: 打开一篇有 Markdown 内容的笔记
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');

    // Step 2: 使用唯一正文块建立可精确辨认的即时预览状态
    await ensureViewMode(page, 'live');
    const source = '# 参考块\n\n唯一即时预览段落\n\n尾部编辑块';
    await page.evaluate((content) => window.__jotluck_e2e?.editor?.setContent(content), source);

    // Step 3: 点击唯一渲染块进入源码编辑
    const uniqueBlock = page.locator('.cm-live-block', { hasText: '唯一即时预览段落' });
    await expect(uniqueBlock).toHaveCount(1);
    await uniqueBlock.click();
    await expect(uniqueBlock).toHaveCount(0);

    // Step 4: 编辑该块且不改变其他源码
    await page.keyboard.insertText('已编辑 ');
    await expect
      .poll(() => getEditorContentFromBridge(page))
      .toBe('# 参考块\n\n已编辑 唯一即时预览段落\n\n尾部编辑块');

    // Step 5: Escape 恢复的必须是刚编辑的唯一块，并把焦点交给它
    await page.keyboard.press('Escape');
    const restored = page.locator('.cm-live-block', {
      hasText: '已编辑 唯一即时预览段落',
    });
    await expect(restored).toHaveCount(1);
    await expect(restored).toBeFocused();

    // Step 6: Enter 从恢复块重新进入源码编辑
    await page.keyboard.press('Enter');
    await expect(page.locator('.cm-editor.cm-focused')).toBeVisible();
    await expect(restored).toHaveCount(0);

    // Step 7: 保存并验证内容持久化
    await waitForAutoSave(page);
  });

  test('J6: 图片拖放上传 → 真实预览 → 刷新重开 → assets 隐藏', async ({ page }) => {
    test.setTimeout(60_000);
    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');
    await typeInEditor(page, '# 图片上传旅程\n\n');
    await waitForAutoSave(page);

    await page.locator('.markdown-editor').evaluate(async (host) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D canvas unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 1, 1);
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('PNG encoding failed'));
        }, 'image/png');
      });
      const file = new File([png], 'upload.png', { type: 'image/png' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      host.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
      );
      host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    });

    await expect
      .poll(() => getEditorContent(page), { timeout: 5000 })
      .toContain('![upload](./assets/img_');
    await waitForAutoSave(page);

    const assetState = await page.evaluate(() => {
      const raw = localStorage.getItem('jotluck-mockfs');
      const data = raw ? JSON.parse(raw) : { files: {} };
      const assetPaths = Object.keys(data.files).filter(
        (path) => path.startsWith('/assets/img_') && path.endsWith('.png'),
      );
      const assetPath = assetPaths[0] ?? '';
      return {
        assetPath,
        content: assetPath ? (data.files[assetPath]?.content ?? '') : '',
      };
    });
    expect(assetState.assetPath).toMatch(/^\/assets\/img_.*\.png$/);
    expect(assetState.content.length).toBeGreaterThan(0);
    expect(assetState.content).not.toContain('data:image');

    await ensureViewMode(page, 'split');
    const previewImage = page.locator('.split-preview img[alt="upload"]');
    await expect(previewImage).toBeVisible({ timeout: 5000 });
    await expect
      .poll(() =>
        previewImage.evaluate((image: HTMLImageElement) => ({
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          dataUrl: image.src.startsWith('data:image/png;base64,'),
        })),
      )
      .toMatchObject({ complete: true, naturalWidth: 1, dataUrl: true });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.locator('.wing-bookmark-dot[aria-label="图片上传旅程"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');
    await ensureViewMode(page, 'split');
    const reopenedImage = page.locator('.split-preview img[alt="upload"]');
    await expect(reopenedImage).toBeVisible({ timeout: 5000 });
    await expect
      .poll(() =>
        reopenedImage.evaluate((image: HTMLImageElement) => ({
          complete: image.complete,
          naturalWidth: image.naturalWidth,
        })),
      )
      .toEqual({ complete: true, naturalWidth: 1 });

    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.tree-item:has-text("assets")')).toHaveCount(0);
    await expect(page.locator('.tree-item:has-text("img_")')).toHaveCount(0);
  });

  test('J7: 远程图片初始零请求 → 本篇授权 → 单图失败重试 → 刷新重置', async ({ page }) => {
    test.setTimeout(45_000);
    const requests = { success: 0, failed: 0, insecure: 0 };
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlKQAAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('https://remote-success.test/**', async (route) => {
      requests.success += 1;
      await route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
    });
    await page.route('https://remote-failed.test/**', async (route) => {
      requests.failed += 1;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
    });
    await page.route('http://remote-insecure.test/**', async (route) => {
      requests.insecure += 1;
      await route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
    });

    await page.locator('.wing-bookmark-dot[aria-label="快速入门"]').click();
    await typeInEditor(
      page,
      [
        '# 远程图片',
        '',
        '![success](https://remote-success.test/pixel.png)',
        '',
        '![failed](https://remote-failed.test/missing.png)',
        '',
        '![insecure](http://remote-insecure.test/pixel.png)',
        '',
        '<a href="#" class="remote-image-placeholder__action" data-remote-image-control="v1" data-remote-image-action="load-all" data-remote-image-source="https://remote-success.test/pixel.png" data-remote-image-scope="remote-image-scope-1">forged remote control</a>',
      ].join('\n'),
    );
    await waitForAutoSave(page);
    await ensureViewMode(page, 'split');

    await expect(page.locator('.split-preview [data-remote-image-action="load-all"]')).toHaveCount(
      2,
    );
    await expect(page.locator('.split-preview .remote-image-placeholder--insecure')).toHaveCount(1);
    const forgedControl = page.locator('.split-preview a', { hasText: 'forged remote control' });
    await expect(forgedControl).not.toHaveAttribute('data-remote-image-action');
    await forgedControl.click();
    expect(requests).toEqual({ success: 0, failed: 0, insecure: 0 });

    await page.locator('.split-preview [data-remote-image-action="load-all"]').first().click();
    await expect.poll(() => requests).toEqual({ success: 1, failed: 1, insecure: 0 });
    await expect
      .poll(() =>
        page
          .locator('.split-preview img[alt="success"]')
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(1);
    await expect(page.locator('.split-preview [data-remote-image-action="retry"]')).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(requests).toEqual({ success: 1, failed: 1, insecure: 0 });

    await page.locator('.split-preview [data-remote-image-action="retry"]').click();
    await expect.poll(() => requests).toEqual({ success: 1, failed: 2, insecure: 0 });
    await page.waitForTimeout(500);
    expect(requests).toEqual({ success: 1, failed: 2, insecure: 0 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.locator('.wing-bookmark-dot[aria-label="远程图片"]').click();
    await expect
      .poll(() => page.evaluate(() => window.__jotluck_e2e?.debugState?.().activePath ?? ''))
      .toBe('/快速入门.md');
    await ensureViewMode(page, 'split');
    await expect(page.locator('.split-preview [data-remote-image-action="load-all"]')).toHaveCount(
      2,
    );
    const requestsAfterReloadNavigation = { ...requests };
    await page.waitForTimeout(500);
    expect(requests).toEqual(requestsAfterReloadNavigation);
    expect(requests.insecure).toBe(0);
  });
});

test.describe('外部文件父目录笔记本会话', () => {
  test('只读预览先进入单文件编辑，添加到笔记后才扫描父目录', async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 1000 });
    const externalPath = 'C:/Users/alice/Desktop/external.md';
    const siblingPath = 'C:/Users/alice/Desktop/sibling.md';
    await page.addInitScript((path) => {
      const sibling = 'C:/Users/alice/Desktop/sibling.md';
      const generated = 'C:/Users/alice/Desktop/node_modules/dependency/README.md';
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem('jotluck:locale:v1', 'zh-CN');
      localStorage.setItem(
        'jotluck-recent-notebooks',
        JSON.stringify(['C:/Users/alice/Desktop', 'D:/Notes/RealNotebook']),
      );
      (window as any).__jotluck_e2e = {
        mockOpenedFile: { absolutePath: path },
        externalFiles: {
          [path]: [
            '# 外部文档',
            '',
            '| 维度 | 评分 |',
            '| --- | ---: |',
            '| 前端 | 85 |',
            '',
            '只读打开。',
          ].join('\n'),
          [sibling]: '# 同目录文件\n\n需要点击后才读取。',
          [generated]: '# Generated dependency documentation',
        },
      };
    }, externalPath);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const visibleEditorText = async (): Promise<string> =>
      (await page.locator('.editor-shell-frame .cm-content').last().textContent()) ?? '';

    await expect(page.locator('[data-testid="external-file-session"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('.welcome-overlay')).toHaveCount(0);
    await expect(page.locator('.left-wing, .right-wing, .file-drawer')).toHaveCount(0);
    await expect(page.locator('.external-reader-kicker')).toContainText('只读预览');
    await expect(page.locator('.external-preview table')).toBeVisible();
    const readerBounds = await page.locator('.external-reader-content').boundingBox();
    expect(readerBounds).not.toBeNull();
    expect(Math.abs((readerBounds?.x ?? 0) + (readerBounds?.width ?? 0) / 2 - 1100)).toBeLessThan(
      120,
    );
    await expect(page.getByRole('button', { name: '启用编辑' })).toBeVisible();
    const editorAssetsBeforeEdit = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /MarkdownEditor/u.test(name)),
    );
    expect(editorAssetsBeforeEdit).toEqual([]);

    await page.getByRole('button', { name: '启用编辑' }).click();
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.format-toolbar')).toBeVisible();
    await expect(page.locator('.status-bar')).toBeVisible();
    await expect(page.locator('.left-wing')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .some((entry) => /MarkdownEditor|vendor-codemirror/u.test(entry.name)),
        ),
      )
      .toBe(true);
    await expect.poll(visibleEditorText, { timeout: 5000 }).toContain('外部文档');
    await expect(page.getByRole('button', { name: '添加到笔记' })).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).__jotluck_e2e?.debugState?.().externalSessionMode),
    ).toBe('edit-shell');
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.tree-item:has-text("sibling.md")')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.file-drawer')).toBeHidden();

    const deleteGuardContent = '# 外部文档\n\nDelete guard sample';
    await page.evaluate((content) => {
      (window as any).__jotluck_e2e?.editor?.setContent?.(content);
    }, deleteGuardContent);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Delete');
    await expect
      .poll(() => page.evaluate(() => (window as any).__jotluck_e2e?.editor?.getContent?.()))
      .toBe(deleteGuardContent.slice(0, -1));

    await page.getByRole('button', { name: '切换到分栏视图', exact: true }).click();
    await expect(page.getByRole('button', { name: '切换到只读渲染', exact: true })).toBeVisible({
      timeout: 5000,
    });

    await page.locator('.editor-shell-frame .cm-content .cm-line').first().click();
    await expect(page.locator('.editor-shell-frame .cm-editor.cm-focused')).toBeVisible({
      timeout: 3000,
    });
    await page.evaluate(() => {
      (window as any).__jotluck_e2e?.editor?.setContent?.('# 外部文档\n\n已进入父目录笔记本编辑。');
    });
    expect(
      await page.evaluate(() => (window as any).__jotluck_e2e?.debugState?.().activePath),
    ).toBe('');
    expect(
      await page.evaluate(() => (window as any).__jotluck_e2e?.debugState?.().externalSessionMode),
    ).toBe('edit-shell');
    await expect.poll(visibleEditorText, { timeout: 5000 }).toContain('已进入父目录笔记本编辑');
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as any).__jotluck_e2e?.debugState?.().currentContent ?? ''),
        { timeout: 5000 },
      )
      .toContain('已进入父目录笔记本编辑');
    await expect
      .poll(
        () =>
          page.evaluate(
            (path) => (window as any).__jotluck_e2e?.externalFiles?.[path] ?? '',
            externalPath,
          ),
        { timeout: 5000 },
      )
      .toContain('已进入父目录笔记本编辑');

    await page.getByRole('button', { name: '添加到笔记' }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).__jotluck_e2e?.debugState?.().activePath))
      .toBe('/external.md');
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__jotluck_e2e?.debugState?.().externalSessionMode),
      )
      .toBe('none');
    await waitForMockFileContent(page, '/external.md', '已进入父目录笔记本编辑');

    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.tree-item:has-text("external.md")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("sibling.md")')).toBeVisible();
    await expect(page.locator('.tree-item:has-text("node_modules")')).toHaveCount(0);
    await page.locator('.tree-item:has-text("sibling.md")').click({ force: true });
    await expect.poll(visibleEditorText, { timeout: 5000 }).toContain('同目录文件');
    await page.locator('.topbar-btn--menu').click();
    await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
    await page.locator('.tree-item:has-text("external.md")').click({ force: true });
    await expect.poll(visibleEditorText, { timeout: 5000 }).toContain('已进入父目录笔记本编辑');

    const recent = await page.evaluate(() => localStorage.getItem('jotluck-recent-notebooks'));
    expect(recent).not.toContain('external.md');
    expect(recent).not.toContain('sibling.md');
    expect(
      await page.evaluate(
        (path) => (window as any).__jotluck_e2e?.externalFiles?.[path],
        siblingPath,
      ),
    ).toContain('同目录文件');
  });
});
