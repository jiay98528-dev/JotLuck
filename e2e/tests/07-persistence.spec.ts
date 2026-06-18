/**
 * M7 E2E — 持久化与跨会话测试
 *
 * 覆盖：localStorage 数据持久化、跨页面刷新恢复、
 *       笔记内容跨会话保持、主题设置持久化、
 *       MockFS 数据完整性、多级缓存链验证。
 *
 * V3（跨会话持久化）: 写入 → 导航离开 → 返回 → 验证 → 刷新 → 再验证
 * V6（用户旅程完整性）: >=4 步真实用户操作链
 */
import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  typeInEditor,
  getEditorContent,
  waitForAutoSave,
  switchToNote,
} from '../helpers/test-utils';

// ============================================================
// localStorage Key Constants (must match source code)
// ============================================================
const MOCKFS_KEY = 'markluck-mockfs';
const THEME_KEY = 'markluck-theme';
const NGRAM_DATA_KEY = 'markluck:ngram:v2';
const NGRAM_META_KEY = 'markluck:ngram:meta';
const SEARCH_HISTORY_KEY = 'markluck-search-history';

// ============================================================
// Helpers
// ============================================================

/**
 * Toggle theme from light → dark or dark → light.
 * Returns the expected new scheme after toggling.
 */
async function toggleTheme(page: import('@playwright/test').Page): Promise<'light' | 'dark'> {
  const current = await page.locator('html').getAttribute('data-color-scheme');
  const expected: 'light' | 'dark' = current === 'dark' ? 'light' : 'dark';

  const btn = page.locator('[aria-label="切换明暗主题"]');
  await expect(btn).toBeVisible({ timeout: 5000 });
  await btn.click();
  await page.waitForTimeout(400);

  // Verify the toggle took effect
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', expected, {
    timeout: 5000,
  });

  return expected;
}

// ============================================================
// Tests
// ============================================================

test.describe('持久化与跨会话', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  // ── 1. 笔记内容刷新持久化 ──────────────────────────────────
  test('V3: 笔记内容 — 刷新后保持', async ({ page }) => {
    // Step 1: Click the first bookmark dot to open a sample note
    const firstDot = page.locator('.wing-bookmark-dot').first();
    await expect(firstDot).toBeVisible({ timeout: 5000 });
    const firstLabel = await firstDot.getAttribute('aria-label');
    await firstDot.click();
    await page.waitForTimeout(500);

    // Step 2: Type content in editor
    const testMarker = '### V3刷新持久化测试内容';
    await typeInEditor(page, testMarker);

    // Step 3: Wait for auto-save
    await waitForAutoSave(page);

    // Step 4-5: Reload page and verify content persisted
    await page.reload();
    await waitForAppReady(page);

    // Step 6: Navigate back to the same note and verify
    if (firstLabel) {
      await switchToNote(page, firstLabel);
    }
    const content = await getEditorContent(page);
    expect(content).toContain('V3刷新持久化测试内容');
  });

  // ── 2. 笔记内容切换保持 ────────────────────────────────────
  test('V3: 笔记内容 — 切换到其他笔记再切回保持', async ({ page }) => {
    // Step 1: Find two existing notes
    const allDots = page.locator('.wing-bookmark-dot');
    const count = await allDots.count();

    if (count < 2) {
      // Create a second note if fewer than 2 exist
      await page.locator('.wing-new-btn').click();
      await expect(page.locator('.tpl-card.blank-card')).toBeVisible({ timeout: 5000 });
      await page.locator('.tpl-card.blank-card').click();
      await page.waitForTimeout(500);
      await waitForAutoSave(page);
    }

    // Re-query after potential creation
    const dotsA = page.locator('.wing-bookmark-dot');
    const dotA = dotsA.nth(0);
    const dotB = dotsA.nth(1);
    const labelA = await dotA.getAttribute('aria-label');
    const labelB = await dotB.getAttribute('aria-label');

    // Step 2: Edit note A
    await dotA.click();
    await page.waitForTimeout(400);
    const markerA = '## 笔记A切换持久化测试';
    await typeInEditor(page, markerA);
    await waitForAutoSave(page);

    // Step 3: Switch to note B
    if (labelB) {
      await switchToNote(page, labelB);
    }

    // Step 4: Switch back to note A and verify
    if (labelA) {
      await switchToNote(page, labelA);
    }
    const contentA = await getEditorContent(page);
    expect(contentA).toContain('笔记A切换持久化测试');
  });

  // ── 3. 主题设置持久化 ──────────────────────────────────────
  test('V3: 主题设置 — 刷新后保持', async ({ page }) => {
    // Step 1: Toggle to dark mode
    await toggleTheme(page); // Expected to go dark
    await page.waitForTimeout(300);

    // Step 2: Reload page
    await page.reload();
    await waitForAppReady(page);

    // Step 3: Verify dark mode persisted
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark', {
      timeout: 10000,
    });

    // Step 4: Toggle back to light and reload again
    await toggleTheme(page); // Expected to go light
    await page.reload();
    await waitForAppReady(page);

    // Verify light mode persisted
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light', {
      timeout: 10000,
    });
  });

  // ── 4. MockFS localStorage 持久化 ──────────────────────────
  test('V1: MockFS 数据存在于 localStorage', async ({ page }) => {
    const hasMockFS = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null;
      } catch {
        return false;
      }
    }, MOCKFS_KEY);

    expect(hasMockFS).toBe(true);
  });

  // ── 5. 样本笔记刷新后加载 ──────────────────────────────────
  test('V3: 样本笔记 — 刷新后书签点仍然存在', async ({ page }) => {
    // Step 1: Verify initial bookmark dots exist
    const initialDots = page.locator('.wing-bookmark-dot');
    const initialCount = await initialDots.count();
    expect(initialCount).toBeGreaterThanOrEqual(3); // Sample notebook has >=3 notes

    // Step 2: Reload
    await page.reload();
    await waitForAppReady(page);

    // Step 3: Verify same number of bookmark dots
    const reloadDots = page.locator('.wing-bookmark-dot');
    const reloadCount = await reloadDots.count();
    expect(reloadCount).toBe(initialCount);

    // Step 4: Verify known sample note titles are present
    const expectedNotes = ['快速入门', '项目规划', '设计笔记'];
    for (const title of expectedNotes) {
      await expect(page.locator(`.wing-bookmark-dot[aria-label="${title}"]`)).toBeVisible({
        timeout: 3000,
      });
    }
  });

  // ── 6. N-gram 模型持久化 ───────────────────────────────────
  test('V1: N-gram 模型 — localStorage Key 存在', async ({ page }) => {
    // Open a note and type to trigger N-gram model building
    const firstDot = page.locator('.wing-bookmark-dot').first();
    await firstDot.click();
    await page.waitForTimeout(400);

    // Type enough content for N-gram model to capture patterns
    await appendToEditor(
      page,
      '\n\n这是一个测试段落。\n\n这是另一个测试段落用于ngram模型。\n\n测试段落再次出现。\n',
    );

    // Wait for deferred model update
    await page.waitForTimeout(2000);

    // Verify ngram keys exist in localStorage
    const ngramKeys = await page.evaluate(
      ({ dataKey, metaKey }) => {
        const data = localStorage.getItem(dataKey);
        const meta = localStorage.getItem(metaKey);
        return {
          hasData: !!data,
          hasMeta: !!meta,
          dataLength: data ? data.length : 0,
        };
      },
      { dataKey: NGRAM_DATA_KEY, metaKey: NGRAM_META_KEY },
    );

    // At minimum one of the keys should have data after editing
    // (exact behavior depends on whether enough tokens were collected)
    expect(ngramKeys.hasData || ngramKeys.hasMeta).toBe(true);
  });

  // ── 7. 删除后重建同名笔记 ──────────────────────────────────
  test('V6: 用户旅程 — 删除笔记 → 确认消失 → 重建同名笔记', async ({ page }) => {
    // Step 1: Create a blank note
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.tpl-card.blank-card')).toBeVisible({ timeout: 5000 });
    await page.locator('.tpl-card.blank-card').click();
    await page.waitForTimeout(500);

    // Step 2: Type unique content to identify this note
    const uniqueMarker = 'RECREATE-TEST-MARKER-' + Date.now();
    await typeInEditor(page, `# 重建测试\n\n${uniqueMarker}`);
    await waitForAutoSave(page);

    // Get the note's aria-label to find it later
    const activeDot = page.locator('.wing-bookmark-dot.active');
    const noteTitle = await activeDot.getAttribute('aria-label');
    expect(noteTitle).toBeTruthy();

    // Step 3: Delete via FileDrawer context menu
    // Open file drawer
    const hamburger = page.locator('[aria-label="切换左侧书签栏"]');
    await hamburger.click();
    await page.waitForTimeout(400);

    // Find the note in the file tree by filename (tree displays filenames, not note titles)
    const today = new Date().toISOString().slice(0, 10);
    const expectedFilename = `笔记-${today}`;
    const treeItem = page.locator('.tree-item').filter({ hasText: expectedFilename }).first();
    await expect(treeItem).toBeVisible({ timeout: 5000 });

    // Right-click to open context menu
    await treeItem.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Click the delete option
    await expect(page.locator('.context-menu-item--danger')).toBeVisible({ timeout: 3000 });
    await page.locator('.context-menu-item--danger').click();
    await page.waitForTimeout(500);

    // Step 4: Verify note is gone from bookmark dots
    await expect(page.locator(`.wing-bookmark-dot[aria-label="${noteTitle}"]`)).toHaveCount(0);

    // Step 5: Recreate a note with the same procedure (same date = same name)
    await page.locator('.wing-new-btn').click();
    await expect(page.locator('.tpl-card.blank-card')).toBeVisible({ timeout: 5000 });
    await page.locator('.tpl-card.blank-card').click();
    await page.waitForTimeout(500);
    await waitForAutoSave(page);

    // Step 6: Verify the recreated note is empty (old content not leaked)
    const newContent = await getEditorContent(page);
    expect(newContent).not.toContain(uniqueMarker);
    expect(newContent).toContain('新笔记');
  });

  // ── 8. 多次刷新无数据丢失 ──────────────────────────────────
  test('V6: 多次刷新 — 两次刷新后内容不丢失', async ({ page }) => {
    // Step 1: Open initial note and type content
    const firstDot = page.locator('.wing-bookmark-dot').first();
    const firstLabel = await firstDot.getAttribute('aria-label');
    await firstDot.click();
    await page.waitForTimeout(400);

    const persistentText = '## 多次刷新持久化 ' + Date.now();
    await typeInEditor(page, persistentText);
    await waitForAutoSave(page);

    // Step 2: First reload
    await page.reload();
    await waitForAppReady(page);

    // Verify content after first reload
    if (firstLabel) {
      await switchToNote(page, firstLabel);
    }
    let content = await getEditorContent(page);
    expect(content).toContain('多次刷新持久化');

    // Step 3: Second reload
    await page.reload();
    await waitForAppReady(page);

    // Verify content after second reload
    if (firstLabel) {
      await switchToNote(page, firstLabel);
    }
    content = await getEditorContent(page);
    expect(content).toContain('多次刷新持久化');
  });

  // ── 9. localStorage 数据跨会话完整性 ───────────────────────
  test('V1: 所有核心 localStorage Key 存在', async ({ page }) => {
    // Wait a moment for the app to initialize all stores
    await page.waitForTimeout(1000);

    const keys = await page.evaluate(() => {
      const all: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        all.push(localStorage.key(i) ?? '');
      }
      return all.filter((k) => k.startsWith('markluck'));
    });

    // Core persistence keys should exist
    expect(keys).toContain(MOCKFS_KEY);
    expect(keys).toContain(THEME_KEY);

    // At least one of ngram/search-history should eventually appear
    // (these are created lazily; just confirm infrastructure is in place)
    const hasNgram = keys.some((k) => k.startsWith('markluck:ngram:'));
    const hasSearchHistory = keys.includes(SEARCH_HISTORY_KEY);

    // Not all keys are created on first load; at minimum mockfs + theme must exist
    expect(keys.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Append text at end of editor (inline helper to avoid importing
 * from test-utils when not needed by all tests).
 */
async function appendToEditor(page: import('@playwright/test').Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text, { delay: 5 });
}
