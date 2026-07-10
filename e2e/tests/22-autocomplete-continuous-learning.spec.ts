import { expect, test, type Page } from '@playwright/test';

interface LearningStats {
  opportunities: number;
  triggers: number;
  accepted: number;
  falseTriggers: number;
  weakLayerTriggers: number;
}

const ROUNDS = [
  '今天的项目记录需要确认接口边界。今天的项目记录需要确认验收范围。接下来需要整理失败样本，并把拒绝原因写清楚。',
  '今天的项目记录需要确认接口边界。今天的项目记录需要确认验收范围。接下来需要整理失败样本，并把拒绝原因写清楚。',
  '今天的项目记录需要确认接口边界。今天的项目记录需要确认验收范围。接下来需要整理失败样本，并把拒绝原因写清楚。',
  '今天的项目记录需要确认接口边界。今天的项目记录需要确认验收范围。接下来需要整理失败样本，并把拒绝原因写清楚。',
  '今天的项目记录需要确认接口边界。今天的项目记录需要确认验收范围。接下来需要整理失败样本，并把拒绝原因写清楚。',
];

const MARKERS = ['今天的项目记录', '需要确认', '接下来需要', '失败样本', '拒绝原因'];

test.describe('autocomplete continuous local learning', () => {
  test.setTimeout(90000);

  test('improves personal completion after repeated accepted use', async ({ page }) => {
    const crashErrors = collectGhostCrashErrors(page);
    await openApp(page);
    await page.evaluate(() => {
      localStorage.removeItem('jotluck:autocomplete:learningSignals:v1');
      localStorage.removeItem('jotluck:autocomplete:providerMetrics:v2');
      localStorage.removeItem('jotluck:ngram:v2');
      localStorage.removeItem('jotluck:ngram:short:v1');
      localStorage.removeItem('jotluck:ngram:meta');
      localStorage.removeItem('jotluck:autocomplete:acceptedLexicon:v1');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('jotluck:scope:')) localStorage.removeItem(key);
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openApp(page);

    const cold: LearningStats = createStats();
    const learned: LearningStats = createStats();

    for (let round = 0; round < ROUNDS.length; round++) {
      const stats = round < 2 ? cold : learned;
      const text = ROUNDS[round];
      await replaceEditorTextByKeyboard(page, '');
      let cursor = 0;

      for (const marker of MARKERS) {
        const markerIndex = text.indexOf(marker, cursor);
        if (markerIndex < 0) continue;
        const checkpointEnd = markerIndex + marker.length;
        await page.keyboard.type(text.slice(cursor, checkpointEnd), { delay: 1 });
        cursor = checkpointEnd;
        stats.opportunities++;

        const suggestion = await readGhostText(page, 520);
        if (!suggestion) continue;
        stats.triggers++;

        const prediction = await readPrediction(page);
        if (prediction?.sourceLayer === 'fallback' || prediction?.sourceLayer === 'l3') {
          stats.weakLayerTriggers++;
        }

        if (text.slice(cursor).startsWith(suggestion)) {
          await page.keyboard.press('Tab');
          cursor += suggestion.length;
          stats.accepted++;
        } else {
          stats.falseTriggers++;
          await page.keyboard.press('Escape');
        }
      }

      await page.keyboard.type(text.slice(cursor), { delay: 1 });
      await expect(page.locator('.cm-content').first()).toContainText(text.slice(-18), {
        timeout: 3000,
      });
    }

    const coldUsableRate = rate(cold.accepted, cold.opportunities);
    const learnedUsableRate = rate(learned.accepted, learned.opportunities);
    const coldWeakRate = rate(cold.weakLayerTriggers, Math.max(1, cold.triggers));
    const learnedWeakRate = rate(learned.weakLayerTriggers, Math.max(1, learned.triggers));
    const learnedFalseRate = rate(learned.falseTriggers, learned.opportunities);

    console.log(
      JSON.stringify(
        {
          cold,
          learned,
          coldUsableRate,
          learnedUsableRate,
          coldWeakRate,
          learnedWeakRate,
          learnedFalseRate,
        },
        null,
        2,
      ),
    );

    expect(crashErrors).toEqual([]);
    expect(learnedUsableRate).toBeGreaterThanOrEqual(coldUsableRate + 0.05);
    expect(learnedFalseRate).toBeLessThanOrEqual(rate(cold.falseTriggers, cold.opportunities));
    expect(learnedWeakRate).toBeLessThanOrEqual(coldWeakRate);
  });
});

function createStats(): LearningStats {
  return {
    opportunities: 0,
    triggers: 0,
    accepted: 0,
    falseTriggers: 0,
    weakLayerTriggers: 0,
  };
}

function rate(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 1000 : 0;
}

async function openApp(page: Page): Promise<void> {
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
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    const bookmark = page.locator('.wing-bookmark-dot').first();
    await expect(bookmark).toBeVisible({ timeout: 5000 });
    await bookmark.click();
  }

  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 5000 });
}

async function replaceEditorTextByKeyboard(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press('Backspace');
  if (text) await page.keyboard.type(text, { delay: 1 });
}

async function readGhostText(page: Page, timeoutMs: number): Promise<string> {
  const ghost = page.locator('.cm-ghost-text').first();
  try {
    await expect(ghost).toBeVisible({ timeout: timeoutMs });
    return ((await ghost.textContent()) ?? '').trim();
  } catch {
    return '';
  }
}

async function readPrediction(
  page: Page,
): Promise<{ sourceLayer?: string; providerId?: string } | null> {
  return page.evaluate(() => {
    const prediction = window.__jotluck_e2e?.editor?.getPrediction?.();
    return prediction
      ? { sourceLayer: prediction.sourceLayer, providerId: prediction.providerId }
      : null;
  });
}

function collectGhostCrashErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('CodeMirror plugin crashed') || text.includes('cm-ghost-text')) {
      errors.push(text);
    }
  });
  page.on('pageerror', (error) => {
    const text = error.message;
    if (text.includes('CodeMirror plugin crashed') || text.includes('cm-ghost-text')) {
      errors.push(text);
    }
  });
  return errors;
}
