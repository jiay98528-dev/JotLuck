import { expect, test, type Page } from '@playwright/test';

interface BlackboxCase {
  id: string;
  title: string;
  input: string;
  expected: string;
  language: 'zh' | 'en';
}

const CASES: BlackboxCase[] = [
  {
    id: 'zh-product-meeting',
    title: 'Chinese product manager meeting notes',
    input:
      '# 产品例会\n\n' +
      '会议结论是需要确认负责人和截止时间。\n' +
      '会议结论是需要确认负责人和截止时间。\n' +
      '会议结论是',
    expected: '需要确认负责人和截止时间。',
    language: 'zh',
  },
  {
    id: 'zh-clinic-follow-up',
    title: 'Chinese doctor follow-up note',
    input:
      '# 随访记录\n\n' +
      '今日随访重点是观察症状变化和用药反应。\n' +
      '今日随访重点是观察症状变化和用药反应。\n' +
      '今日随访重点是',
    expected: '观察症状变化和用药反应。',
    language: 'zh',
  },
  {
    id: 'zh-class-feedback',
    title: 'Chinese teacher class feedback',
    input:
      '# 课堂反馈\n\n' +
      '本节课需要加强阅读理解和课堂表达。\n' +
      '本节课需要加强阅读理解和课堂表达。\n' +
      '本节课需要',
    expected: '加强阅读理解和课堂表达。',
    language: 'zh',
  },
  {
    id: 'zh-contract-review',
    title: 'Chinese lawyer contract review',
    input:
      '# 合同审阅\n\n' +
      '主要风险在于付款节点和违约责任约定。\n' +
      '主要风险在于付款节点和违约责任约定。\n' +
      '主要风险在于',
    expected: '付款节点和违约责任约定。',
    language: 'zh',
  },
  {
    id: 'zh-campaign-review',
    title: 'Chinese operations campaign review',
    input:
      '# 活动复盘\n\n' +
      '复盘重点是报名转化率和渠道投放成本。\n' +
      '复盘重点是报名转化率和渠道投放成本。\n' +
      '复盘重点是',
    expected: '报名转化率和渠道投放成本。',
    language: 'zh',
  },
  {
    id: 'en-release-triage',
    title: 'English software engineer release triage',
    input:
      '# Release triage\n\n' +
      'Release risk is configuration drift before the final check.\n' +
      'Release risk is configuration drift before the final check.\n' +
      'Release risk is',
    expected: 'configuration drift before the final check.',
    language: 'en',
  },
  {
    id: 'en-experiment-log',
    title: 'English researcher experiment log',
    input:
      '# Experiment log\n\n' +
      'The observation suggests a stronger baseline is required.\n' +
      'The observation suggests a stronger baseline is required.\n' +
      'The observation suggests',
    expected: 'a stronger baseline is required.',
    language: 'en',
  },
  {
    id: 'en-customer-follow-up',
    title: 'English customer success follow-up',
    input:
      '# Customer follow-up\n\n' +
      'Next step is to confirm the migration window and owner.\n' +
      'Next step is to confirm the migration window and owner.\n' +
      'Next step is',
    expected: 'to confirm the migration window and owner.',
    language: 'en',
  },
  {
    id: 'en-travel-plan',
    title: 'English travel itinerary',
    input:
      '# Kyoto itinerary\n\n' +
      'Morning plan includes temple visits and a quiet lunch nearby.\n' +
      'Morning plan includes temple visits and a quiet lunch nearby.\n' +
      'Morning plan includes',
    expected: 'temple visits and a quiet lunch nearby.',
    language: 'en',
  },
  {
    id: 'en-market-memo',
    title: 'English financial analyst market memo',
    input:
      '# Market memo\n\n' +
      'Key driver is demand softness and margin pressure.\n' +
      'Key driver is demand softness and margin pressure.\n' +
      'Key driver is',
    expected: 'demand softness and margin pressure.',
    language: 'en',
  },
];

test.describe('autocomplete blackbox regression', () => {
  test('Chinese blackbox fixtures are stored as readable UTF-8', () => {
    const source = CASES.map((item) => item.input).join('\n');
    expect(source).toContain('产品例会');
    expect(source).toContain('会议结论是');
    expect(source).not.toMatch(/[ÃÂ�]|杩|鍙|鎴|绗|涓/u);
  });

  for (const item of CASES) {
    test(`${item.id}: ${item.title}`, async ({ page }) => {
      const crashErrors = collectGhostCrashErrors(page);
      await openAppWithoutInternalBridge(page);
      await replaceEditorTextByKeyboard(page, item.input);

      const startedAt = Date.now();
      const ghost = page.locator('.cm-ghost-text');
      await expect(ghost).toBeVisible({ timeout: 3000 });
      const visibleLatency = Date.now() - startedAt;
      const suggestion = ((await ghost.textContent()) ?? '').trimStart();

      expect(suggestion).not.toBe('');
      expect(suggestion).not.toContain('可以');
      if (item.language === 'en') expect(suggestion).not.toMatch(/[\u3400-\u9fff]/u);
      expect(item.expected).toContain(suggestion);
      expect(visibleLatency).toBeLessThanOrEqual(230);

      await page.keyboard.press('Tab');
      await expect(page.locator('.cm-content')).toContainText(item.expected, { timeout: 3000 });

      await replaceEditorTextByKeyboard(page, item.input);
      await expect(ghost).toBeVisible({ timeout: 3000 });
      await page.locator('.split-left .cm-content').click();
      await page.keyboard.press('Escape');
      await expect(ghost).not.toBeVisible({ timeout: 1000 });
      expect(crashErrors).toEqual([]);
    });
  }
});

function collectGhostCrashErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isGhostCrash(text)) errors.push(text);
  });
  page.on('pageerror', (error) => {
    const text = error.message;
    if (isGhostCrash(text)) errors.push(text);
  });
  return errors;
}

function isGhostCrash(text: string): boolean {
  return (
    text.includes('CodeMirror plugin crashed') ||
    text.includes('Calls to EditorView.update are not allowed while an update is in progress')
  );
}

async function openAppWithoutInternalBridge(page: Page): Promise<void> {
  await page.goto(process.env.JOTLUCK_E2E_BASE_URL ?? 'http://localhost:5173', {
    waitUntil: 'domcontentloaded',
  });

  const welcome = page.locator('.welcome-overlay');
  if (await welcome.isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.locator('.welcome-skip-link').click();
    await expect(welcome).not.toBeVisible({ timeout: 3000 });
  }

  if (
    !(await page
      .locator('.cm-content')
      .isVisible()
      .catch(() => false))
  ) {
    const bookmark = page.locator('.wing-bookmark-dot').first();
    await expect(bookmark).toBeVisible({ timeout: 5000 });
    await bookmark.click();
  }

  if (
    !(await page
      .locator('.split-left .cm-content')
      .isVisible()
      .catch(() => false))
  ) {
    await page.locator('.shell-action--view-toggle').click();
  }

  await expect(page.locator('.split-left .cm-content')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10000 });
}

async function replaceEditorTextByKeyboard(page: Page, text: string): Promise<void> {
  const editor = page.locator('.split-left .cm-content');
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 1 });
}
