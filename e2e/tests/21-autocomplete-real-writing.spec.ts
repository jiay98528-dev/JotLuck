import { expect, test, type Page } from '@playwright/test';

interface WritingCheckpoint {
  marker: string;
}

interface WritingCase {
  id: string;
  title: string;
  text: string;
  checkpoints: WritingCheckpoint[];
}

interface WritingStats {
  opportunities: number;
  triggers: number;
  accepted: number;
  falseTriggers: number;
  mixedTriggers: number;
  totalChars: number;
  latencies: number[];
}

const CASES: WritingCase[] = [
  {
    id: 'diary-evening',
    title: '日记与生活记录',
    text: '今天主要想记录一下晚饭后的散步。天气没有想象中闷，路边的灯亮得很早，风从小区门口吹过来时带着一点潮气。我认为，真正让人放松的不是走了多远，而是终于不用急着回答任何问题。回到家以后，我把桌面重新收拾了一遍，水杯、书和便签都放回原来的位置。晚上写下这些小事，是为了提醒自己，平静也需要被认真保存。',
    checkpoints: [
      { marker: '今天' },
      { marker: '晚饭后的' },
      { marker: '路边的灯' },
      { marker: '我认为' },
      { marker: '走了多远' },
      { marker: '回到家以后' },
      { marker: '晚上写下' },
    ],
  },
  {
    id: 'reading-note',
    title: '读书笔记',
    text:
      '这本书最有价值的部分并不是结论，而是作者怎样把一个普通问题拆成可以观察的层次。原因是因为很多判断在刚出现时都显得理所当然，只有放回具体场景里，才能看见它背后的代价。换句话说，读书笔记不应该只是摘抄金句，还要记录自己在哪个地方停下来、怀疑了什么、准备怎样验证。读完这一章后，我更想保留的是问题本身。' +
      '第二天再看这段笔记时，我会把例子补充得更具体一些。比如这个观点可以怎样解释一次会议讨论，也可以怎样解释一次写作卡顿。这样的补充会让笔记从单纯的摘录，变成之后还能继续使用的材料。',
    checkpoints: [
      { marker: '这本书最有价值' },
      { marker: '结论' },
      { marker: '原因是' },
      { marker: '具体场景' },
      { marker: '换句话说' },
      { marker: '摘抄金句' },
      { marker: '读完这一章' },
    ],
  },
  {
    id: 'project-review',
    title: '项目复盘',
    text:
      '当前需要把补全功能的目标重新收窄，不再追求一次给出完整句子，而是优先补出短词、连接词和稳定短语。问题在于边界一旦放宽，模型会把训练语料里的泛用表达带到所有场景里，用户看到的就是重复和污染。接下来需要把真实写作样本加入验收，把触发率、接受率和误触发率分开记录。团队可以先看指标，再决定是否继续扩语料。' +
      '这次复盘还要记录每一类失败样本出现的位置，尤其是句中光标、混合语言和标题行附近的误触发。只有把问题拆开，后续优化才不会变成单纯堆数据，也不会为了追求命中率牺牲安静度。',
    checkpoints: [
      { marker: '当前' },
      { marker: '完整句子' },
      { marker: '问题在于' },
      { marker: '所有场景' },
      { marker: '接下来' },
      { marker: '误触发率' },
      { marker: '团队' },
    ],
  },
  {
    id: 'essay-city',
    title: '随笔散文',
    text:
      '最近一直觉得城市的声音有两种，一种来自道路、地铁和施工围挡，另一种来自人们停下来时短暂的沉默。前者提醒我们生活还在推动，后者提醒我们并不总要被推动。因此，写一段随笔时我更愿意从细节开始，而不是急着给出态度。窗外的树影落在墙上，像一页被反复翻动的纸，留下的不是答案，而是当天的温度。' +
      '如果继续写下去，我大概会写到傍晚的楼梯、便利店门口的灯和路人收起伞时的动作。这些细节不一定有明确意义，却能让一段文字保持呼吸，也让读者知道作者真的在那里停留过。',
    checkpoints: [
      { marker: '最近' },
      { marker: '城市的声音' },
      { marker: '道路' },
      { marker: '后者提醒' },
      { marker: '因此' },
      { marker: '窗外的树影' },
      { marker: '当天的温度' },
    ],
  },
  {
    id: 'technical-note',
    title: '技术笔记',
    text:
      '这次排查的线索比较清楚，日志先出现请求超时，随后缓存命中率下降，最后编辑器开始出现短暂卡顿。需要注意的是，单个指标不能直接说明根因，必须把时间顺序和用户操作放在一起看。临时修复可以先降低刷新频率，但长期方案还是要减少无意义的重复计算。复盘时最好把触发条件写清楚，方便下次快速定位。' +
      '另外，所有临时开关都应该写明默认值、回滚方式和影响范围。否则下一次排查时，团队很容易忘记某个开关曾经被打开，新的症状就会和旧的调试痕迹混在一起，增加判断成本。',
    checkpoints: [
      { marker: '这次排查' },
      { marker: '日志' },
      { marker: '缓存命中率' },
      { marker: '需要注意' },
      { marker: '时间顺序' },
      { marker: '临时修复' },
      { marker: '复盘时' },
    ],
  },
  {
    id: 'meeting-minutes',
    title: '会议纪要',
    text:
      '本次会议主要讨论版本收口和验收节奏。大家确认先处理稳定性问题，再安排真实写作场景的回归测试。也就是说，指标通过并不等于体验通过，必须保留人工手写记录。最后，负责人会在明天整理一份清单，列出还需要补充的语料类别、测试边界和风险项。' +
      '会议还提醒大家把自动化结论和人工观察分开写，避免用单一分数掩盖具体问题。对于文字补全这种功能，用户是否愿意接受候选，比候选是否频繁出现更重要，因此验收记录必须保留拒绝原因。',
    checkpoints: [
      { marker: '本次会议主要' },
      { marker: '版本收口' },
      { marker: '验收节奏' },
      { marker: '也就是说' },
      { marker: '人工手写' },
      { marker: '最后' },
      { marker: '风险项' },
    ],
  },
  {
    id: 'learning-log',
    title: '学习记录',
    text:
      '今天主要复习了几个容易混淆的概念，包括上下文窗口、候选排序和反馈学习。单独看每个词都不难，真正困难的是把它们放在一个连续输入的场景里理解。从这个角度看，好的补全系统不是一直说话，而是在用户刚好需要一点提示时出现。下次复习时，我会用自己的例子重新解释一遍。' +
      '我准备把这些概念画成一张流程图：先看光标所在位置，再看语法块，再看候选来源，最后才决定是否显示。这样复习时不会只背术语，而是能解释为什么某些场景应该保持沉默。',
    checkpoints: [
      { marker: '今天' },
      { marker: '几个容易混淆' },
      { marker: '上下文窗口' },
      { marker: '连续输入' },
      { marker: '从这个角度看' },
      { marker: '一点提示' },
      { marker: '下次复习时' },
    ],
  },
  {
    id: 'operation-review',
    title: '运营复盘',
    text:
      '活动结束后先看报名人数，再看实际到场和后续咨询。表面上数据增长不错，但是，渠道成本也明显升高，不能只看单一指标。关键在于能否把高意向用户留下来，并且让下一次触达更有针对性。复盘报告里应该分开写亮点、问题和下一步动作，这样团队讨论会更聚焦。' +
      '如果下次继续做同类活动，应该提前定义转化口径，并把渠道、内容和跟进节奏放到同一张表里。这样讨论时不会只争论哪个渠道更好，而是能看到每一步到底损耗在哪里，也能更快调整预算。',
    checkpoints: [
      { marker: '活动结束后' },
      { marker: '实际到场' },
      { marker: '但是' },
      { marker: '渠道成本' },
      { marker: '关键在于' },
      { marker: '复盘报告里' },
      { marker: '下一步动作' },
    ],
  },
  {
    id: 'product-thought',
    title: '产品思考',
    text:
      '一个本地笔记工具最重要的承诺，是用户不用担心内容被锁进某个服务里。同时，功能也不能因为追求复杂而打扰写作本身。这说明，补全应该像输入法一样短、轻、可忽略，而不是像聊天机器人一样主动展开。产品判断的难点在于取舍：少做一点，可能反而让用户更愿意长期使用。' +
      '从这个角度看，默认体验应该把安静放在第一位。用户愿意接受的候选通常不是最聪明的句子，而是刚好省掉一点重复输入的短语。工具越克制，用户越容易相信它不会抢走写作节奏。',
    checkpoints: [
      { marker: '本地笔记工具' },
      { marker: '服务里' },
      { marker: '同时' },
      { marker: '写作本身' },
      { marker: '这说明' },
      { marker: '聊天机器人' },
      { marker: '产品判断的难点' },
    ],
  },
  {
    id: 'weekly-plan',
    title: '周计划',
    text:
      '本周先完成自动化评测，再安排人工手写验收。接下来需要把失败样本分类，区分没有触发、触发但不可用、以及候选太打扰这三类情况。除此之外，还要检查英文场景是否被中文短语污染。周五之前如果指标稳定，就把方案写进规格文档，并保留下一阶段接入本地模型的评估入口。' +
      '周计划还要留出半天处理测试脚本维护，因为真实写作样本会随着功能目标变化而过期。每次调整规则以后，都要重新确认样本是否还代表用户实际输入，否则指标会越来越像训练集成绩。',
    checkpoints: [
      { marker: '本周先完成' },
      { marker: '自动化评测' },
      { marker: '接下来' },
      { marker: '失败样本分类' },
      { marker: '三类情况' },
      { marker: '周五之前' },
      { marker: '规格文档' },
    ],
  },
];

test.describe('autocomplete real Chinese writing score', () => {
  test.setTimeout(120000);

  test('scores input-method style completion without internal seeding', async ({ page }) => {
    const crashErrors = collectGhostCrashErrors(page);
    const stats: WritingStats = {
      opportunities: 0,
      triggers: 0,
      accepted: 0,
      falseTriggers: 0,
      mixedTriggers: 0,
      totalChars: 0,
      latencies: [],
    };

    await openAppWithoutInternalBridge(page);

    for (const item of CASES) {
      await replaceEditorTextByKeyboard(page, '');
      let cursor = 0;

      for (const checkpoint of item.checkpoints) {
        const checkpointEnd =
          item.text.indexOf(checkpoint.marker, cursor) + checkpoint.marker.length;
        expect(checkpointEnd, `${item.id} checkpoint ${checkpoint.marker}`).toBeGreaterThanOrEqual(
          cursor + checkpoint.marker.length,
        );

        await page.keyboard.type(item.text.slice(cursor, checkpointEnd), { delay: 1 });
        cursor = checkpointEnd;
        stats.opportunities += 1;

        const startedAt = Date.now();
        const suggestion = await readGhostText(page, 520);
        if (!suggestion) continue;

        stats.triggers += 1;
        stats.latencies.push(Date.now() - startedAt);

        if (/^[A-Za-z]/.test(suggestion.trim())) stats.mixedTriggers += 1;

        if (isUsableChineseSuggestion(item.text.slice(cursor), suggestion)) {
          await page.keyboard.press('Tab');
          cursor += suggestion.length;
          stats.accepted += 1;
        } else {
          stats.falseTriggers += 1;
          await page.keyboard.press('Escape');
        }
      }

      await page.keyboard.type(item.text.slice(cursor), { delay: 1 });
      stats.totalChars += item.text.length;
      await expect(page.locator('.split-left .cm-content')).toContainText(
        item.text.slice(Math.max(0, item.text.length - 24)),
        { timeout: 3000 },
      );
    }

    const triggerRate = round(stats.triggers / stats.opportunities);
    const usableRate = round(stats.accepted / stats.opportunities);
    const falseTriggerRate = round(stats.falseTriggers / stats.opportunities);
    const ghostsPer100Chars = round((stats.triggers / stats.totalChars) * 100);
    const p90 = percentile(stats.latencies, 0.9);

    console.log(
      JSON.stringify(
        {
          cases: CASES.length,
          opportunities: stats.opportunities,
          triggers: stats.triggers,
          accepted: stats.accepted,
          falseTriggers: stats.falseTriggers,
          mixedTriggers: stats.mixedTriggers,
          triggerRate,
          usableRate,
          falseTriggerRate,
          ghostsPer100Chars,
          p90,
        },
        null,
        2,
      ),
    );

    expect(crashErrors).toEqual([]);
    expect(stats.mixedTriggers).toBe(0);
    expect(falseTriggerRate).toBeLessThanOrEqual(0.15);
    expect(triggerRate).toBeGreaterThanOrEqual(0.3);
    expect(triggerRate).toBeLessThanOrEqual(0.55);
    expect(usableRate).toBeGreaterThanOrEqual(0.15);
    expect(usableRate).toBeLessThanOrEqual(0.35);
    expect(p90).toBeLessThanOrEqual(230);
  });
});

async function openAppWithoutInternalBridge(page: Page): Promise<void> {
  await page.goto(process.env.MARKLUCK_E2E_BASE_URL ?? 'http://localhost:5173', {
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
  if (text) await page.keyboard.type(text, { delay: 1 });
}

async function readGhostText(page: Page, timeout: number): Promise<string> {
  const ghost = page.locator('.cm-ghost-text');
  await expect(ghost)
    .toBeVisible({ timeout })
    .catch(() => undefined);
  if (!(await ghost.isVisible().catch(() => false))) return '';
  return (await ghost.textContent()) ?? '';
}

function isUsableChineseSuggestion(remainingText: string, suggestion: string): boolean {
  if (!suggestion || /[\r\n]/.test(suggestion)) return false;
  if (suggestion.length > 12) return false;
  if (/^[A-Za-z]/.test(suggestion.trim())) return false;
  if (
    /^(的|了|在|和|与|及|或|而|但|并|就|都|很|更|再|也|还|又|把|被|对|为|以)$/u.test(suggestion)
  ) {
    return false;
  }
  return remainingText.startsWith(suggestion);
}

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

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
