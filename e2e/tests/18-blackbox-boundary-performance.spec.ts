import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  ensureEditorReady,
  getEditorContent,
  waitForAppReady,
  waitForSearchReady,
} from '../helpers/test-utils';

type RuntimeEvent = {
  type: 'console-error' | 'console-warning' | 'pageerror' | 'requestfailed';
  text: string;
  url?: string;
};

type StoredFile = {
  content: string;
  mtime: number;
  size: number;
};

type MockFsData = {
  version: number;
  files: Record<string, StoredFile>;
  dirs: Record<string, string[]>;
};

const MOCK_FS_KEY = 'jotluck-mockfs';
const MOCK_FS_VERSION = 4;
const STARTUP_READY_BUDGET_MS = 3000;
const LARGE_WORKSPACE_DRAWER_BUDGET_MS = 5000;
const LARGE_WORKSPACE_SEARCH_BUDGET_MS = 800;
const LARGE_DOCUMENT_VIEW_SWITCH_BUDGET_MS = 1000;

const ALLOWED_WARNINGS = [
  /Download the Vue Devtools extension/i,
  /ResizeObserver loop/i,
  /was preloaded using link preload/i,
];

function installRuntimeObservationGate(page: Page, browserName = '') {
  const events: RuntimeEvent[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      events.push({ type: 'console-error', text: message.text(), url: message.location().url });
    }
    if (message.type() === 'warning') {
      events.push({ type: 'console-warning', text: message.text(), url: message.location().url });
    }
  });

  page.on('pageerror', (error) => {
    events.push({ type: 'pageerror', text: error.message });
  });

  page.on('requestfailed', (request) => {
    events.push({
      type: 'requestfailed',
      text: request.failure()?.errorText ?? 'request failed',
      url: request.url(),
    });
  });

  return {
    async assertClean(testInfo: TestInfo) {
      await testInfo.attach('runtime-observation.json', {
        body: JSON.stringify(events, null, 2),
        contentType: 'application/json',
      });

      const unexpected = events.filter((event) => {
        if (event.type === 'console-warning') {
          return !ALLOWED_WARNINGS.some((pattern) => pattern.test(event.text));
        }
        if (
          event.type === 'requestfailed' &&
          /(net::ERR_ABORTED|NS_BINDING_ABORTED)/i.test(event.text) &&
          /localhost:5173\/(src|@vite|node_modules|@fs|assets)\//.test(event.url ?? '')
        ) {
          return false;
        }
        if (
          event.type === 'console-error' &&
          browserName === 'firefox' &&
          event.text === 'Error' &&
          /localhost:5173\/assets\/vendor-vue-.*\.js$/.test(event.url ?? '')
        ) {
          return false;
        }
        return true;
      });

      expect(unexpected).toEqual([]);
    },
    events,
  };
}

function storedFile(content: string, mtime: number): StoredFile {
  return {
    content,
    mtime,
    size: content.length,
  };
}

function buildLargeWorkspace(fileCount: number): MockFsData {
  const now = Date.now();
  const files: Record<string, StoredFile> = {
    '/README.md': storedFile('# Blackbox Workspace\n\nperf-token-root', now),
    '/cluster/deep/duplicate.md': storedFile('# Duplicate\n\nMarkdown duplicate file', now),
    '/cluster/deep/duplicate.txt': storedFile('Plain text duplicate file', now),
    '/cluster/deep/image.png': storedFile('not a note', now),
    '/cluster/deep/export.pdf': storedFile('not a note', now),
  };
  const clusterEntries: string[] = ['deep'];

  for (let index = 0; index < fileCount; index += 1) {
    const id = index.toString().padStart(3, '0');
    const path = `/cluster/note-${id}.md`;
    const unicodeLine =
      index === fileCount - 1
        ? 'unicode: \\u4e2d\\u6587 \\u200b \\u202e rtl-marker \\ud83d\\ude80'
        : 'unicode: ascii fixture line';
    files[path] = storedFile(
      [
        `# Perf Note ${id}`,
        '',
        `perf-needle-${id}`,
        `tag-${index % 17}`,
        unicodeLine,
        `[[Perf Note ${(index + 1).toString().padStart(3, '0')}]]`,
      ].join('\n'),
      now - index,
    );
    clusterEntries.push(`note-${id}.md`);
  }

  return {
    version: MOCK_FS_VERSION,
    files,
    dirs: {
      '/': ['README.md', 'cluster'],
      '/cluster': clusterEntries,
      '/cluster/deep': ['duplicate.md', 'duplicate.txt', 'image.png', 'export.pdf'],
    },
  };
}

function buildLargeDocumentWorkspace(lineCount: number): MockFsData {
  const now = Date.now();
  const tableRows = Array.from({ length: 80 }, (_, index) => `| row-${index} | ${index} |`);
  const nested = Array.from({ length: 12 }, (_, index) => `${'  '.repeat(index)}- nested-${index}`);
  const lines = Array.from(
    { length: lineCount },
    (_, index) =>
      `Line ${index.toString().padStart(5, '0')} with wiki [[Perf Note]] and #tag${index % 23}`,
  );
  const content = [
    '# Blackbox Large Note',
    '',
    'A'.repeat(12_000),
    '',
    '| column | value |',
    '| --- | ---: |',
    ...tableRows,
    '',
    ...nested,
    '',
    '```ts',
    'export const large = true;',
    '```',
    '',
    ...lines,
  ].join('\n');

  return {
    version: MOCK_FS_VERSION,
    files: {
      '/large-note.md': storedFile(content, now),
      '/small-note.md': storedFile('# Small Note\n\nsmall note', now - 1),
    },
    dirs: {
      '/': ['large-note.md', 'small-note.md'],
    },
  };
}

async function seedMockFs(page: Page, data: MockFsData): Promise<void> {
  await page.addInitScript(
    ({ key, fixture }) => {
      localStorage.setItem('jotluck:welcome:completed', '1');
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify(fixture));
      }
    },
    { key: MOCK_FS_KEY, fixture: data },
  );
}

async function openFileDrawer(page: Page): Promise<void> {
  await page.locator('.topbar-btn--menu').click();
  await expect(page.locator('.file-drawer')).toBeVisible({ timeout: 3000 });
}

async function closeOverlayIfOpen(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

async function waitForEditableShell(page: Page): Promise<void> {
  await expect(page.locator('.welcome-overlay')).toHaveCount(0);
  await expect(page.locator('#jotluck-app')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
}

async function selectTreeItem(page: Page, label: string): Promise<void> {
  const item = page.locator(`.tree-item:has-text("${label}")`).first();
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click({ force: true });
}

async function switchView(page: Page): Promise<void> {
  const toggle = page.locator('.view-mode-toggle');
  await expect(toggle).toBeVisible({ timeout: 5000 });
  await toggle.click();
}

test.describe('blackbox boundary and performance release gate', () => {
  test('B1 runtime observation gate stays clean during cold startup to editable shell', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Startup performance budget is calibrated for Chromium.');

    const gate = installRuntimeObservationGate(page);
    await waitForAppReady(page);

    const startedAt = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForEditableShell(page);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(STARTUP_READY_BUDGET_MS);
    await page.locator('.cm-content').click();
    await page.keyboard.insertText(' startup-gate-alive');
    await expect
      .poll(() => getEditorContent(page), { timeout: 3000 })
      .toContain('startup-gate-alive');

    await testInfo.attach('startup-performance.json', {
      body: JSON.stringify({ elapsedMs, budgetMs: STARTUP_READY_BUDGET_MS }, null, 2),
      contentType: 'application/json',
    });
    await gate.assertClean(testInfo);
  });

  test('B2 300-note workspace opens drawer and search result within performance budgets', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium',
      'Large-workspace performance budget is calibrated for Chromium.',
    );

    await seedMockFs(page, buildLargeWorkspace(300));
    const gate = installRuntimeObservationGate(page);
    await waitForAppReady(page);
    await waitForSearchReady(page);

    const drawerStartedAt = Date.now();
    await openFileDrawer(page);
    await selectTreeItem(page, 'cluster');
    await expect(page.locator('.tree-item:has-text("note-299.md")')).toBeVisible({
      timeout: LARGE_WORKSPACE_DRAWER_BUDGET_MS,
    });
    const drawerElapsedMs = Date.now() - drawerStartedAt;
    expect(drawerElapsedMs).toBeLessThan(LARGE_WORKSPACE_DRAWER_BUDGET_MS);

    await expect(page.locator('.tree-item:has-text("image.png")')).toHaveCount(0);
    await expect(page.locator('.tree-item:has-text("export.pdf")')).toHaveCount(0);
    await closeOverlayIfOpen(page);

    await page.locator('.topbar-search-hint').click();
    await expect(page.locator('.palette')).toBeVisible({ timeout: 3000 });
    const searchStartedAt = Date.now();
    await page.locator('.search-input').fill('perf-needle-299');
    await expect(page.locator('.result-item').first()).toContainText('Perf Note 299', {
      timeout: LARGE_WORKSPACE_SEARCH_BUDGET_MS,
    });
    const searchElapsedMs = Date.now() - searchStartedAt;
    expect(searchElapsedMs).toBeLessThan(LARGE_WORKSPACE_SEARCH_BUDGET_MS);

    await testInfo.attach('large-workspace-performance.json', {
      body: JSON.stringify(
        {
          drawerElapsedMs,
          drawerBudgetMs: LARGE_WORKSPACE_DRAWER_BUDGET_MS,
          searchElapsedMs,
          searchBudgetMs: LARGE_WORKSPACE_SEARCH_BUDGET_MS,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await gate.assertClean(testInfo);
  });

  test('B3 large document switches view and remains editable after 200-character input', async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium',
      'Large-document performance budget is calibrated for Chromium.',
    );

    await seedMockFs(page, buildLargeDocumentWorkspace(10_000));
    const gate = installRuntimeObservationGate(page);
    await waitForAppReady(page);

    await openFileDrawer(page);
    await selectTreeItem(page, 'large-note.md');
    await expect
      .poll(() => getEditorContent(page), { timeout: 5000 })
      .toContain('Blackbox Large Note');

    const switchStartedAt = Date.now();
    await switchView(page);
    await expect(page.locator('.split-preview, .cm-live-block').first()).toBeVisible({
      timeout: LARGE_DOCUMENT_VIEW_SWITCH_BUDGET_MS,
    });
    const switchElapsedMs = Date.now() - switchStartedAt;
    expect(switchElapsedMs).toBeLessThan(LARGE_DOCUMENT_VIEW_SWITCH_BUDGET_MS);

    await switchView(page);
    await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5000 });
    const marker = `\n${'x'.repeat(200)} blackbox-input-marker`;
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(marker);
    await expect
      .poll(() => getEditorContent(page), { timeout: 5000 })
      .toContain('blackbox-input-marker');

    await testInfo.attach('large-document-performance.json', {
      body: JSON.stringify(
        {
          switchElapsedMs,
          switchBudgetMs: LARGE_DOCUMENT_VIEW_SWITCH_BUDGET_MS,
          insertedCharacters: marker.length,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await gate.assertClean(testInfo);
  });

  test('B4 rapid edit-switch-refresh preserves the edited note without cross-file corruption', async ({
    page,
    browserName,
  }, testInfo) => {
    await seedMockFs(page, buildLargeWorkspace(24));
    const gate = installRuntimeObservationGate(page, browserName);
    await waitForAppReady(page);
    await openFileDrawer(page);
    await selectTreeItem(page, 'cluster');
    await selectTreeItem(page, 'note-005.md');
    await expect.poll(() => getEditorContent(page), { timeout: 5000 }).toContain('Perf Note 005');

    const editMarker = `race-marker-${Date.now()}`;
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(`\n${editMarker}`);

    await page.locator('.wing-bookmark-dot[aria-label="Perf Note 006"]').click();
    await page.locator('.wing-bookmark-dot[aria-label="Perf Note 005"]').click();
    await expect.poll(() => getEditorContent(page), { timeout: 10000 }).toContain(editMarker);
    await page.waitForLoadState('networkidle');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await page.locator('.wing-bookmark-dot[aria-label="Perf Note 005"]').click();
    await expect.poll(() => getEditorContent(page), { timeout: 10000 }).toContain(editMarker);

    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem('jotluck-mockfs');
      const data = raw ? (JSON.parse(raw) as MockFsData) : undefined;
      return {
        note005: data?.files['/cluster/note-005.md']?.content ?? '',
        note006: data?.files['/cluster/note-006.md']?.content ?? '',
      };
    });
    expect(persisted.note005).toContain(editMarker);
    expect(persisted.note006).not.toContain(editMarker);

    await testInfo.attach('rapid-switch-persistence.json', {
      body: JSON.stringify({ editMarker, persisted }, null, 2),
      contentType: 'application/json',
    });
    await gate.assertClean(testInfo);
  });

  test('B5 corrupted MockFS storage recovers to an editable notebook without page crash', async ({
    page,
  }, testInfo) => {
    const runtimeEvents: RuntimeEvent[] = [];
    page.on('pageerror', (error) => runtimeEvents.push({ type: 'pageerror', text: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        runtimeEvents.push({
          type: message.type() === 'error' ? 'console-error' : 'console-warning',
          text: message.text(),
          url: message.location().url,
        });
      }
    });

    await page.addInitScript((key) => {
      localStorage.setItem('jotluck:welcome:completed', '1');
      localStorage.setItem(key, '{ invalid json');
    }, MOCK_FS_KEY);

    await waitForAppReady(page);
    await ensureEditorReady(page);
    await page.locator('.cm-content').click();
    await page.keyboard.insertText(' corrupted-storage-recovered');
    await expect
      .poll(() => getEditorContent(page), { timeout: 3000 })
      .toContain('corrupted-storage-recovered');

    const pageErrors = runtimeEvents.filter((event) => event.type === 'pageerror');
    const unexpectedConsoleErrors = runtimeEvents.filter(
      (event) =>
        event.type === 'console-error' &&
        !event.text.includes('[MockFSService] localStorage data is invalid'),
    );
    expect(pageErrors).toEqual([]);
    expect(unexpectedConsoleErrors).toEqual([]);

    await testInfo.attach('corrupted-storage-observation.json', {
      body: JSON.stringify(runtimeEvents, null, 2),
      contentType: 'application/json',
    });
  });
});
