import { expect, test, type Page } from '@playwright/test';
import { ensureEditorReady, waitForAppReady } from '../helpers/test-utils';

interface ProbeCase {
  id: string;
  input: string;
  expected?: string;
  language: 'zh' | 'en';
}

type ScenarioCategory = 'prose' | 'essay' | 'fiction' | 'software';

interface ScenarioProbeCase extends ProbeCase {
  category: ScenarioCategory;
  expectedPattern?: RegExp;
  maxLength?: number;
}

interface ProbeResult extends ProbeCase {
  suggestion: string;
  latencyMs: number | null;
  score: number;
  mixedLanguage: boolean;
  providerId?: string;
  sourceLayer?: string;
}

interface ScenarioProbeResult extends ScenarioProbeCase {
  suggestion: string;
  latencyMs: number | null;
  score: number;
  mixedLanguage: boolean;
  crossLine: boolean;
  tooLong: boolean;
  lowValue: boolean;
  providerId?: string;
  sourceLayer?: string;
}

interface Summary {
  hitRate: number;
  accuracyScore: number;
  p50: number;
  p90: number;
  mixedLanguage: number;
}

interface ScenarioGroup {
  category: ScenarioCategory;
  label: string;
  minHitRate: number;
  minAccuracyScore: number;
  probes: ScenarioProbeCase[];
  negativeInputs: string[];
}

interface ScenarioSummary extends Summary {
  category: ScenarioCategory;
  label: string;
  sceneScore: number;
  styleRate: number;
  falseTriggerRate: number;
  crossLine: number;
  tooLong: number;
  lowValue: number;
}

const ZH_PROBES: ProbeCase[] = [
  { id: 'zh-01', input: '这是我', expected: '最喜欢', language: 'zh' },
  { id: 'zh-02', input: '这是', expected: '一个', language: 'zh' },
  { id: 'zh-03', input: '我喜欢', expected: '的', language: 'zh' },
  { id: 'zh-04', input: '最喜欢', expected: '的事情', language: 'zh' },
  { id: 'zh-05', input: '第一条', expected: '：', language: 'zh' },
  { id: 'zh-06', input: '第二条', expected: '：', language: 'zh' },
  { id: 'zh-07', input: '第三条', expected: '：', language: 'zh' },
  { id: 'zh-08', input: '今天记录', expected: '一下', language: 'zh' },
  { id: 'zh-09', input: '今天主要', expected: '完成', language: 'zh' },
  { id: 'zh-10', input: '今天计划', expected: '先', language: 'zh' },
  { id: 'zh-11', input: '明天计划', expected: '继续', language: 'zh' },
  { id: 'zh-12', input: '本周计划', expected: '完成', language: 'zh' },
  { id: 'zh-13', input: '本周复盘', expected: '一下', language: 'zh' },
  { id: 'zh-14', input: '复盘结论', expected: '是', language: 'zh' },
  { id: 'zh-15', input: '任务进度', expected: '正常', language: 'zh' },
  { id: 'zh-16', input: '完成情况', expected: '正常', language: 'zh' },
  { id: 'zh-17', input: '当前进展', expected: '正常', language: 'zh' },
  { id: 'zh-18', input: '当前问题', expected: '是', language: 'zh' },
  { id: 'zh-19', input: '主要问题', expected: '是', language: 'zh' },
  { id: 'zh-20', input: '主要风险', expected: '在于', language: 'zh' },
  { id: 'zh-21', input: '风险处理', expected: '需要', language: 'zh' },
  { id: 'zh-22', input: '后续安排', expected: '是', language: 'zh' },
  { id: 'zh-23', input: '待确认', expected: '事项', language: 'zh' },
  { id: 'zh-24', input: '需要补充', expected: '说明', language: 'zh' },
  { id: 'zh-25', input: '需要跟进', expected: '一下', language: 'zh' },
  { id: 'zh-26', input: '需要优化', expected: '的是', language: 'zh' },
  { id: 'zh-27', input: '需要处理', expected: '的问题', language: 'zh' },
  { id: 'zh-28', input: '需要记录', expected: '一下', language: 'zh' },
  { id: 'zh-29', input: '原因分析', expected: '如下', language: 'zh' },
  { id: 'zh-30', input: '问题原因', expected: '可能', language: 'zh' },
  { id: 'zh-31', input: '解决方案', expected: '是', language: 'zh' },
  { id: 'zh-32', input: '处理结果', expected: '正常', language: 'zh' },
  { id: 'zh-33', input: '验收结果', expected: '通过', language: 'zh' },
  { id: 'zh-34', input: '测试结果', expected: '通过', language: 'zh' },
  { id: 'zh-35', input: '会议记录', expected: '如下', language: 'zh' },
  { id: 'zh-36', input: '会议目标', expected: '是', language: 'zh' },
  { id: 'zh-37', input: '会议纪要', expected: '如下', language: 'zh' },
  { id: 'zh-38', input: '行动项', expected: '是', language: 'zh' },
  { id: 'zh-39', input: '结论如下', expected: '：', language: 'zh' },
  { id: 'zh-40', input: '风险在于', expected: '可能', language: 'zh' },
  { id: 'zh-41', input: '原因是', expected: '当前', language: 'zh' },
  { id: 'zh-42', input: '结论如下', expected: '：', language: 'zh' },
  { id: 'zh-43', input: '需要确认', expected: '一下', language: 'zh' },
  { id: 'zh-44', input: '当前状态', expected: '正常', language: 'zh' },
  { id: 'zh-45', input: '下一步', expected: '是', language: 'zh' },
  { id: 'zh-46', input: '为了', expected: '更好', language: 'zh' },
  { id: 'zh-47', input: '可以', expected: '继续', language: 'zh' },
  { id: 'zh-48', input: '项目', expected: '进度', language: 'zh' },
  { id: 'zh-49', input: '需要', expected: '注意', language: 'zh' },
  { id: 'zh-50', input: '目前', expected: '已经', language: 'zh' },
];

const EN_PROBES: ProbeCase[] = [
  { id: 'en-01', input: 'This ', expected: 'note covers', language: 'en' },
  { id: 'en-02', input: 'The ', expected: 'main point', language: 'en' },
  { id: 'en-03', input: 'When ', expected: 'needed next', language: 'en' },
  { id: 'en-04', input: 'Users ', expected: 'can edit', language: 'en' },
  { id: 'en-05', input: 'Project ', expected: 'status note', language: 'en' },
  { id: 'en-06', input: 'Meeting ', expected: 'notes draft', language: 'en' },
  { id: 'en-07', input: 'Daily ', expected: 'note entry', language: 'en' },
  { id: 'en-08', input: 'Status ', expected: 'update note', language: 'en' },
  { id: 'en-09', input: 'Next ', expected: 'step today', language: 'en' },
  { id: 'en-10', input: 'Action ', expected: 'items list', language: 'en' },
  { id: 'en-11', input: 'Current ', expected: 'state now', language: 'en' },
  { id: 'en-12', input: 'Risk ', expected: 'needs review', language: 'en' },
  { id: 'en-13', input: 'The risk ', expected: 'needs review', language: 'en' },
  { id: 'en-14', input: 'The goal ', expected: 'is clear', language: 'en' },
  { id: 'en-15', input: 'The result ', expected: 'is ready', language: 'en' },
  { id: 'en-16', input: 'The issue ', expected: 'needs review', language: 'en' },
  { id: 'en-17', input: 'We need ', expected: 'to confirm', language: 'en' },
  { id: 'en-18', input: 'Need to ', expected: 'confirm', language: 'en' },
  { id: 'en-19', input: 'Follow up ', expected: 'on owner', language: 'en' },
  { id: 'en-20', input: 'Technical ', expected: 'note draft', language: 'en' },
  { id: 'en-21', input: 'Release ', expected: 'notes draft', language: 'en' },
  { id: 'en-22', input: 'Test ', expected: 'result ok', language: 'en' },
  { id: 'en-23', input: 'Review ', expected: 'notes list', language: 'en' },
  { id: 'en-24', input: 'Markdown', expected: ' syntax', language: 'en' },
  { id: 'en-25', input: 'document', expected: 'ation', language: 'en' },
  { id: 'en-26', input: 'project ', expected: 'status note', language: 'en' },
  { id: 'en-27', input: 'meeting ', expected: 'notes draft', language: 'en' },
  { id: 'en-28', input: 'daily ', expected: 'note entry', language: 'en' },
  { id: 'en-29', input: 'next ', expected: 'step today', language: 'en' },
  { id: 'en-30', input: 'technical ', expected: 'note draft', language: 'en' },
];

const STRUCTURED_PROBES = [
  { input: '#', expected: '标题' },
  { input: '##', expected: '标题' },
  { input: '###', expected: '标题' },
  { input: '-', expected: '[ ] ' },
  { input: '*', expected: '[ ] ' },
  { input: '>', expected: '引用' },
  { input: '**粗', expected: '**' },
  { input: '*斜', expected: '*' },
  { input: '`code', expected: '`' },
  { input: '__强调', expected: '__' },
  { input: '第一条、第一天\n第二条、第二天\n', expected: '第三条、第三天' },
  { input: '第一条：我喜欢开车出去玩\n第二条：我喜欢去公园逛街\n', expected: '第三条：' },
  { input: '第一条：我喜欢开车出去玩\n第二条：我喜欢去公园逛街\n第三', expected: '条：' },
  { input: '1. first item\n2. second item\n', expected: '3. ' },
  { input: '1. first item\n2. second item\n3', expected: '. ' },
  { input: '第一天；第一步\n第二天；第二步\n', expected: '第三天；第三步' },
];

const NEGATIVE_PROBES = [
  '这是。\n',
  '今天完成。\n',
  '第一条：内容\n第三条：内容\n',
  '第一条：内容\n第二条：内容\n\n',
  '第一条：内容\n第二项：内容\n',
  'This is 中文',
  '项目 update',
  'abc 中文',
  'cookie',
  'copyright',
  'read more',
  'sign up',
  '的',
  '了',
  '在',
  '和',
  '```\n这是',
  '---\ntitle: test\n---',
  '普通文本中间',
  '无规律空行\n',
];

const DOMAIN_SEED_EXCERPTS = [
  '窗外有鸟叫声，窗外有鸟叫声，窗外有鸟叫声，清晨的光落在桌面上。',
  '风从远处吹来，风从远处吹来，风从远处吹来，夜色慢慢落下。',
  '雨水打在窗沿上，雨水打在窗沿上，雨水打在窗沿上，空气变得安静。',
  '这种安静让人愿意多停一会儿，这种安静让人愿意多停一会儿。',
  '我总觉得这件事值得再想一遍，我总觉得这件事值得再想一遍。',
  '其实我想说的是，很多选择并不复杂，真正困难的是坚持执行。',
  '最近几天一直在想写作和记录的关系，最近几天一直在想写作和记录的关系。',
  '写作本质上是一种翻译，把模糊感受翻译成可以检查的句子。',
  '好的决策往往来自足够具体的观察，好的决策往往来自足够具体的观察。',
  '这件事的难度在于边界不清楚，需要先把问题拆开。',
  '门外传来很轻的脚步声，门外传来很轻的脚步声，灯还亮着。',
  '他停下脚步，看见窗边的灯还亮着，他停下脚步，看见窗边的灯还亮着。',
  '雨水顺着屋檐落下，雨水顺着屋檐落下，街道显得很空。',
  '她没有回答，只是把信放回抽屉里，她没有回答，只是把信放回抽屉里。',
  '故事开始于一个普通的清晨，故事开始于一个普通的清晨。',
  '那盏灯还亮着，像是在等一个迟到的人。',
  'Project status is ready for review. Project status is ready for review.',
  'The main risk is configuration drift before release. The main risk is configuration drift before release.',
  'When debugging the issue, record the input state first. When debugging the issue, record the input state first.',
  'Test result is passing after the cache reset. Test result is passing after the cache reset.',
  '错误处理逻辑需要保持一致，错误处理逻辑需要保持一致。',
  '单元测试结果已经通过，单元测试结果已经通过。',
  '部署前需要确认配置，部署前需要确认配置。',
  '接口定义需要保持稳定，接口定义需要保持稳定。',
];

const SCENARIO_GROUPS: ScenarioGroup[] = [
  {
    category: 'prose',
    label: '散文',
    minHitRate: 0.8,
    minAccuracyScore: 85,
    probes: [
      {
        id: 'prose-01',
        category: 'prose',
        input: '窗外有鸟',
        expectedPattern: /叫声/u,
        language: 'zh',
      },
      {
        id: 'prose-02',
        category: 'prose',
        input: '风从远处',
        expectedPattern: /吹来/u,
        language: 'zh',
      },
      {
        id: 'prose-03',
        category: 'prose',
        input: '夜色慢慢',
        expectedPattern: /落下/u,
        language: 'zh',
      },
      {
        id: 'prose-04',
        category: 'prose',
        input: '雨水打在',
        expectedPattern: /窗沿/u,
        language: 'zh',
      },
      {
        id: 'prose-05',
        category: 'prose',
        input: '这种安静',
        expectedPattern: /让人/u,
        language: 'zh',
      },
      {
        id: 'prose-06',
        category: 'prose',
        input: '清晨的光',
        expectedPattern: /落在/u,
        language: 'zh',
      },
    ],
    negativeInputs: ['夕阳渐落。\n', '风从远处\n\n', '一个字', 'a'],
  },
  {
    category: 'essay',
    label: '随笔',
    minHitRate: 0.8,
    minAccuracyScore: 85,
    probes: [
      {
        id: 'essay-01',
        category: 'essay',
        input: '我总觉得',
        expectedPattern: /这件事/u,
        language: 'zh',
      },
      {
        id: 'essay-02',
        category: 'essay',
        input: '其实我想',
        expectedPattern: /说的是/u,
        language: 'zh',
      },
      {
        id: 'essay-03',
        category: 'essay',
        input: '最近几天',
        expectedPattern: /一直/u,
        language: 'zh',
      },
      {
        id: 'essay-04',
        category: 'essay',
        input: '写作本质',
        expectedPattern: /上是/u,
        language: 'zh',
      },
      {
        id: 'essay-05',
        category: 'essay',
        input: '好的决策',
        expectedPattern: /往往/u,
        language: 'zh',
      },
      {
        id: 'essay-06',
        category: 'essay',
        input: '这件事的',
        expectedPattern: /难度/u,
        language: 'zh',
      },
    ],
    negativeInputs: ['今天我又。\n', '其实我想The', '最近几天 update', '我'],
  },
  {
    category: 'fiction',
    label: '小说',
    minHitRate: 0.75,
    minAccuracyScore: 80,
    probes: [
      {
        id: 'fiction-01',
        category: 'fiction',
        input: '门外传来',
        expectedPattern: /很轻|脚步/u,
        language: 'zh',
      },
      {
        id: 'fiction-02',
        category: 'fiction',
        input: '他停下脚',
        expectedPattern: /步/u,
        language: 'zh',
      },
      {
        id: 'fiction-03',
        category: 'fiction',
        input: '雨水顺着',
        expectedPattern: /屋檐|落下/u,
        language: 'zh',
      },
      {
        id: 'fiction-04',
        category: 'fiction',
        input: '她没有回答',
        expectedPattern: /只是|把信/u,
        language: 'zh',
      },
      {
        id: 'fiction-05',
        category: 'fiction',
        input: '故事开始于',
        expectedPattern: /一个|普通/u,
        language: 'zh',
      },
      {
        id: 'fiction-06',
        category: 'fiction',
        input: '那盏灯还',
        expectedPattern: /亮着/u,
        language: 'zh',
      },
    ],
    negativeInputs: ['第一章\n\n', '他说：“\n', '他笑着说 the', '故事结束。\n'],
  },
  {
    category: 'software',
    label: '软件开发',
    minHitRate: 0.75,
    minAccuracyScore: 80,
    probes: [
      {
        id: 'software-01',
        category: 'software',
        input: 'Project status ',
        expectedPattern: /is ready/i,
        language: 'en',
      },
      {
        id: 'software-02',
        category: 'software',
        input: 'The main risk ',
        expectedPattern: /is configuration/i,
        language: 'en',
      },
      {
        id: 'software-03',
        category: 'software',
        input: 'When debugging ',
        expectedPattern: /the issue/i,
        language: 'en',
      },
      {
        id: 'software-04',
        category: 'software',
        input: '错误处理逻辑',
        expectedPattern: /需要保持/u,
        language: 'zh',
      },
      {
        id: 'software-05',
        category: 'software',
        input: '单元测试结果',
        expectedPattern: /已经通过/u,
        language: 'zh',
      },
      {
        id: 'software-06',
        category: 'software',
        input: '部署前需要',
        expectedPattern: /确认配置/u,
        language: 'zh',
      },
      {
        id: 'software-07',
        category: 'software',
        input: '接口定义需要',
        expectedPattern: /保持稳定/u,
        language: 'zh',
      },
    ],
    negativeInputs: ['```\nconst value', 'function 函数', 'read more', 'sign up'],
  },
];

test.describe('autocomplete quality score', () => {
  test.describe.configure({ timeout: 120000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'markluck:autocomplete:settings',
        JSON.stringify({
          enabled: true,
          aggressiveness: 'balanced',
          backgroundTraining: true,
          maxSuggestionLength: 12,
          minConfidence: 0.18,
          showDebugStats: true,
        }),
      );
      localStorage.setItem('markluck:autocomplete:enabled', 'true');
    });
    await waitForAppReady(page);
    await ensureEditorReady(page);
  });

  test('scores Chinese, English, structured, negative, and manual-regression probes', async ({
    page,
  }) => {
    const zhResults = await runProbeSet(page, ZH_PROBES);
    const enResults = await runProbeSet(page, EN_PROBES);
    const structuredResults = await runStructuredProbes(page);
    const negativeResults = await runNegativeProbes(page);
    const manual = await runManualRegression(page);
    const zhSummary = summarize(zhResults);
    const enSummary = summarize(enResults);
    const structuredScore = Math.round(
      (structuredResults.filter((result) => result.ok).length / structuredResults.length) * 100,
    );
    const negativeFalseTriggerRate =
      negativeResults.filter((result) => result.suggestion).length / negativeResults.length;
    const enLowInformationRate =
      enResults.filter((result) => result.suggestion && isLowValueSuggestion(result.suggestion))
        .length / enResults.length;
    const totalScore = Math.round(
      zhSummary.accuracyScore * 0.35 +
        enSummary.accuracyScore * 0.2 +
        structuredScore * 0.2 +
        manual.score * 0.15 +
        (100 - negativeFalseTriggerRate * 100) * 0.1,
    );

    console.log(
      JSON.stringify(
        {
          totalScore,
          zh: zhSummary,
          en: enSummary,
          enLowInformationRate: round(enLowInformationRate),
          structured: { score: structuredScore, count: structuredResults.length },
          negative: {
            falseTriggerRate: round(negativeFalseTriggerRate),
            count: negativeResults.length,
          },
          manual,
          layers: summarizeLayers([...zhResults, ...enResults]),
          mixedLanguage: [...zhResults, ...enResults].filter((result) => result.mixedLanguage)
            .length,
          zhLowScoreSamples: zhResults.filter((result) => result.score < 85),
          enLowScoreSamples: enResults.filter((result) => result.score < 85),
          negativeTriggers: negativeResults.filter((result) => result.suggestion),
          structuredFailures: structuredResults.filter((result) => !result.ok),
          manualFailures: manual.failures,
        },
        null,
        2,
      ),
    );

    expect(ZH_PROBES.length).toBeGreaterThanOrEqual(50);
    expect(EN_PROBES.length).toBeGreaterThanOrEqual(30);
    expect(STRUCTURED_PROBES.length).toBeGreaterThanOrEqual(15);
    expect(NEGATIVE_PROBES.length).toBeGreaterThanOrEqual(20);
    expect(totalScore).toBeGreaterThanOrEqual(88);
    expect(zhSummary.hitRate).toBeGreaterThanOrEqual(0.88);
    expect(zhSummary.accuracyScore).toBeGreaterThanOrEqual(85);
    expect(enSummary.hitRate).toBeGreaterThanOrEqual(0.7);
    expect(enSummary.accuracyScore).toBeGreaterThanOrEqual(75);
    expect(enLowInformationRate).toBeLessThanOrEqual(0.1);
    expect(structuredScore).toBeGreaterThanOrEqual(95);
    expect(manual.score).toBeGreaterThanOrEqual(95);
    expect(negativeFalseTriggerRate).toBeLessThanOrEqual(0.05);
    expect(zhSummary.mixedLanguage + enSummary.mixedLanguage).toBe(0);
    expect(Math.max(zhSummary.p90, enSummary.p90)).toBeLessThanOrEqual(230);
  });

  test('scores prose, essay, fiction, and software-development scenarios', async ({ page }) => {
    await seedCompletionCorpus(page, DOMAIN_SEED_EXCERPTS);
    await warmUpAutocomplete(page);

    const reports: Array<{
      summary: ScenarioSummary;
      samples: Array<{
        id: string;
        input: string;
        suggestion: string;
        providerId?: string;
        sourceLayer?: string;
        score: number;
        latencyMs: number | null;
      }>;
      negativeTriggers: Array<{ input: string; suggestion: string }>;
    }> = [];

    for (const group of SCENARIO_GROUPS) {
      const results = await runScenarioProbeSet(page, group.probes);
      const negativeResults = await runScenarioNegativeProbes(page, group.negativeInputs);
      const summary = summarizeScenario(group, results, negativeResults);
      reports.push({
        summary,
        samples: results.map((result) => ({
          id: result.id,
          input: result.input,
          suggestion: result.suggestion,
          providerId: result.providerId,
          sourceLayer: result.sourceLayer,
          score: result.score,
          latencyMs: result.latencyMs,
        })),
        negativeTriggers: negativeResults.filter((result) => result.suggestion),
      });
    }

    const interactionResults = await runScenarioInteractionProbes(page, SCENARIO_GROUPS);
    const overallScore = Math.round(
      reports.reduce((sum, report) => sum + report.summary.sceneScore, 0) / reports.length,
    );

    console.log(
      JSON.stringify(
        {
          scenarioScore: overallScore,
          scenarios: reports,
          layers: summarizeLayers(reports.flatMap((report) => report.samples)),
          interactions: interactionResults,
        },
        null,
        2,
      ),
    );

    expect(SCENARIO_GROUPS.length).toBe(4);
    expect(overallScore).toBeGreaterThanOrEqual(85);
    expect(interactionResults.every((result) => result.escapeOk && result.acceptOk)).toBe(true);
    const scenarioLatencies = reports.flatMap((report) =>
      report.samples
        .map((sample) => sample.latencyMs)
        .filter((value): value is number => value !== null),
    );
    expect(percentile(scenarioLatencies, 0.9)).toBeLessThanOrEqual(230);
    for (const [index, group] of SCENARIO_GROUPS.entries()) {
      const report = reports[index];
      expect(report).toBeDefined();
      const summary = report!.summary;
      expect(group.probes.length).toBeGreaterThanOrEqual(6);
      expect(group.negativeInputs.length).toBeGreaterThanOrEqual(4);
      expect(summary.hitRate).toBeGreaterThanOrEqual(group.minHitRate);
      expect(summary.accuracyScore).toBeGreaterThanOrEqual(group.minAccuracyScore);
      expect(summary.sceneScore).toBeGreaterThanOrEqual(82);
      expect(summary.styleRate).toBeGreaterThanOrEqual(0.9);
      expect(summary.falseTriggerRate).toBeLessThanOrEqual(0.05);
      expect(summary.mixedLanguage).toBe(0);
      expect(summary.crossLine).toBe(0);
      expect(summary.tooLong).toBe(0);
      expect(summary.lowValue).toBe(0);
      expect(summary.p50).toBeLessThanOrEqual(230);
    }
  });

  test('reports layered ablation attribution modes', async ({ page }) => {
    const reports = [];

    await setAblationMode(page, 'provider-only');
    reports.push(await runAblationProbe(page, 'provider-only', 'This '));

    await setAblationMode(page, 'l1-only');
    reports.push(await runAblationProbe(page, 'l1-only', 'repeatable phrase repeatable '));

    await setAblationMode(page, 'l2-only');
    await seedCompletionCorpus(page, ['custom layer target custom layer target']);
    reports.push(await runAblationProbe(page, 'l2-only', 'custom layer '));

    await setAblationMode(page, 'l3-only');
    reports.push(await runAblationProbe(page, 'l3-only', 'Project '));

    await setAblationMode(page, 'full-stack');
    reports.push(await runAblationProbe(page, 'full-stack', 'Project '));

    console.log(JSON.stringify({ ablation: reports }, null, 2));

    expect(reports.map((report) => report.mode)).toEqual([
      'provider-only',
      'l1-only',
      'l2-only',
      'l3-only',
      'full-stack',
    ]);
    expect(reports.some((report) => report.sourceLayer === 'l1')).toBe(true);
    expect(reports.some((report) => report.sourceLayer === 'l2')).toBe(true);
    expect(reports.every((report) => report.suggestion === '' || report.sourceLayer)).toBe(true);
  });
});

async function runProbeSet(page: Page, probes: ProbeCase[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const probe of probes) {
    results.push(await runProbe(page, probe));
  }
  return results;
}

async function runProbe(page: Page, probe: ProbeCase): Promise<ProbeResult> {
  await replaceEditorText(page, probe.input);
  const startedAt = Date.now();
  const suggestion = await waitForGhostText(page);
  const latencyMs = suggestion ? Date.now() - startedAt : null;
  const prediction = suggestion ? await getPredictionMeta(page) : {};

  return {
    ...probe,
    suggestion,
    latencyMs,
    providerId: prediction.providerId,
    sourceLayer: prediction.sourceLayer,
    score: scoreProbe(probe, suggestion),
    mixedLanguage:
      probe.language === 'zh'
        ? /^[A-Za-z]/.test(suggestion.trim())
        : /[\u3400-\u9fff]/u.test(suggestion),
  };
}

async function runScenarioProbeSet(
  page: Page,
  probes: ScenarioProbeCase[],
): Promise<ScenarioProbeResult[]> {
  const results: ScenarioProbeResult[] = [];
  for (const probe of probes) {
    results.push(await runScenarioProbe(page, probe));
  }
  return results;
}

async function runScenarioProbe(
  page: Page,
  probe: ScenarioProbeCase,
): Promise<ScenarioProbeResult> {
  await replaceEditorText(page, probe.input);
  const startedAt = Date.now();
  const suggestion = await waitForGhostText(page);
  const latencyMs = suggestion ? Date.now() - startedAt : null;
  const prediction = suggestion ? await getPredictionMeta(page) : {};

  return {
    ...probe,
    suggestion,
    latencyMs,
    providerId: prediction.providerId,
    sourceLayer: prediction.sourceLayer,
    score: scoreScenarioProbe(probe, suggestion),
    mixedLanguage: isMixedLanguageSuggestion(probe.language, suggestion),
    crossLine: /[\r\n]/.test(suggestion),
    tooLong: suggestion.length > (probe.maxLength ?? 12),
    lowValue: isLowValueSuggestion(suggestion),
  };
}

async function runScenarioNegativeProbes(
  page: Page,
  inputs: string[],
): Promise<Array<{ input: string; suggestion: string }>> {
  const results: Array<{ input: string; suggestion: string }> = [];
  for (const input of inputs) {
    await replaceEditorText(page, input);
    const suggestion = await waitForOptionalGhostText(page, 450);
    results.push({ input, suggestion });
  }
  return results;
}

async function runScenarioInteractionProbes(
  page: Page,
  groups: ScenarioGroup[],
): Promise<
  Array<{
    category: ScenarioCategory;
    escapeProbeId: string;
    acceptProbeId: string;
    suggestion: string;
    afterEscape: string;
    contentAfterEscape: string;
    clearedAfterEscape: boolean;
    escapeOk: boolean;
    acceptOk: boolean;
  }>
> {
  const results: Array<{
    category: ScenarioCategory;
    escapeProbeId: string;
    acceptProbeId: string;
    suggestion: string;
    afterEscape: string;
    contentAfterEscape: string;
    clearedAfterEscape: boolean;
    escapeOk: boolean;
    acceptOk: boolean;
  }> = [];

  for (const group of groups) {
    const escapeProbe = group.probes[0]!;
    const acceptProbe = group.probes[1] ?? escapeProbe;

    await resetAutocompleteModelCache(page);
    await page.reload();
    await waitForAppReady(page);
    await ensureEditorReady(page);
    await seedCompletionCorpus(page, DOMAIN_SEED_EXCERPTS);

    await replaceEditorText(page, acceptProbe.input);
    const acceptedSuggestion = await waitForGhostText(page);
    await page.keyboard.press('Tab');
    const acceptOk = await waitForContentToInclude(
      page,
      `${acceptProbe.input}${acceptedSuggestion}`,
    );

    await resetAutocompleteModelCache(page);
    await page.reload();
    await waitForAppReady(page);
    await ensureEditorReady(page);
    await seedCompletionCorpus(page, DOMAIN_SEED_EXCERPTS);

    await replaceEditorText(page, escapeProbe.input);
    const escapeSuggestion = await waitForGhostText(page);
    await page.keyboard.press('Escape');
    const clearedAfterEscape = await waitForGhostToClear(page);
    await page.waitForTimeout(250);
    const afterEscape = await readVisibleGhostText(page);
    const contentAfterEscape = await getEditorContentFromBridge(page);

    results.push({
      category: group.category,
      escapeProbeId: escapeProbe.id,
      acceptProbeId: acceptProbe.id,
      suggestion: acceptedSuggestion || escapeSuggestion,
      afterEscape,
      contentAfterEscape,
      clearedAfterEscape,
      escapeOk:
        !!escapeSuggestion &&
        clearedAfterEscape &&
        !afterEscape &&
        contentAfterEscape === escapeProbe.input,
      acceptOk: !!acceptedSuggestion && acceptOk,
    });
  }

  return results;
}

async function runStructuredProbes(
  page: Page,
): Promise<Array<{ input: string; expected: string; suggestion: string; ok: boolean }>> {
  const results: Array<{ input: string; expected: string; suggestion: string; ok: boolean }> = [];
  for (const probe of STRUCTURED_PROBES) {
    await replaceEditorText(page, probe.input);
    const suggestion = await waitForGhostText(page);
    results.push({
      input: probe.input,
      expected: probe.expected,
      suggestion,
      ok: suggestion === probe.expected,
    });
  }
  return results;
}

async function seedCompletionCorpus(page: Page, excerpts: string[]): Promise<void> {
  await page.evaluate((items) => {
    window.__markluck_e2e?.editor?.seedCompletionCorpus?.(items);
  }, excerpts);
}

async function setAblationMode(
  page: Page,
  mode: 'full-stack' | 'provider-only' | 'l1-only' | 'l2-only' | 'l3-only',
): Promise<void> {
  await page.evaluate((nextMode) => {
    window.__markluck_e2e?.editor?.setCompletionAblationMode?.(nextMode);
  }, mode);
}

async function runAblationProbe(
  page: Page,
  mode: 'full-stack' | 'provider-only' | 'l1-only' | 'l2-only' | 'l3-only',
  input: string,
): Promise<{
  mode: string;
  input: string;
  suggestion: string;
  providerId?: string;
  sourceLayer?: string;
}> {
  await replaceEditorText(page, input);
  const suggestion = await waitForOptionalGhostText(page, 1000);
  const prediction = suggestion ? await getPredictionMeta(page) : {};
  return {
    mode,
    input,
    suggestion,
    providerId: prediction.providerId,
    sourceLayer: prediction.sourceLayer,
  };
}

async function warmUpAutocomplete(page: Page): Promise<void> {
  await replaceEditorText(page, '窗外有鸟');
  await waitForGhostText(page);
  await replaceEditorText(page, '');
}

async function getEditorContentFromBridge(page: Page): Promise<string> {
  return page.evaluate(() => window.__markluck_e2e?.editor?.getContent?.() ?? '');
}

async function getPredictionMeta(
  page: Page,
): Promise<{ providerId?: string; sourceLayer?: string }> {
  return page.evaluate(() => {
    const prediction = window.__markluck_e2e?.editor?.getPrediction?.();
    return {
      providerId: prediction?.providerId,
      sourceLayer: prediction?.sourceLayer,
    };
  });
}

async function resetAutocompleteModelCache(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith('markluck:autocomplete:') &&
        key !== 'markluck:autocomplete:settings' &&
        key !== 'markluck:autocomplete:enabled'
      ) {
        localStorage.removeItem(key);
      }
    }
  });
}

async function waitForContentToInclude(
  page: Page,
  expected: string,
  timeout = 1200,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await getEditorContentFromBridge(page)).includes(expected)) return true;
    await page.waitForTimeout(50);
  }
  return false;
}

async function runNegativeProbes(
  page: Page,
): Promise<Array<{ input: string; suggestion: string }>> {
  const results: Array<{ input: string; suggestion: string }> = [];
  for (const input of NEGATIVE_PROBES) {
    await replaceEditorText(page, input);
    const suggestion = await waitForOptionalGhostText(page, 450);
    results.push({ input, suggestion });
  }
  return results;
}

async function runManualRegression(page: Page): Promise<{
  score: number;
  hits: number;
  total: number;
  failures: Array<{ input: string; expected: string; suggestion: string }>;
}> {
  const probes = [
    { input: '这是我', expected: '最喜欢' },
    {
      input: '第一条：我喜欢开车出去玩\n第二条：我喜欢去公园逛街\n',
      expected: '第三条：',
    },
    {
      input: '第一条：我喜欢开车出去玩\n第二条：我喜欢去公园逛街\n第三',
      expected: '条：',
    },
    {
      input: '第一条、第一天\n第二条、第二天\n',
      expected: '第三条、第三天',
    },
  ];
  let hits = 0;
  const failures: Array<{ input: string; expected: string; suggestion: string }> = [];
  for (const probe of probes) {
    await replaceEditorText(page, probe.input);
    const suggestion = await waitForGhostText(page);
    if (suggestion === probe.expected) {
      hits++;
    } else {
      failures.push({ ...probe, suggestion });
    }
  }
  return { score: Math.round((hits / probes.length) * 100), hits, total: probes.length, failures };
}

async function replaceEditorText(page: Page, text: string): Promise<void> {
  await page.evaluate((content) => {
    window.__markluck_e2e?.editor?.setContent?.(content);
  }, text);
  await expect(page.locator('.cm-content')).toBeFocused();
  await expect(page.locator('.cm-ghost-text'))
    .not.toBeVisible({ timeout: 300 })
    .catch(() => {});
}

async function waitForGhostText(page: Page): Promise<string> {
  return waitForOptionalGhostText(page, 1000);
}

async function waitForOptionalGhostText(page: Page, timeout: number): Promise<string> {
  const ghost = page.locator('.cm-ghost-text');
  let suggestion = '';
  await expect(ghost)
    .toBeVisible({ timeout })
    .then(async () => {
      suggestion = (await ghost.textContent()) ?? '';
    })
    .catch(() => undefined);
  return suggestion;
}

async function waitForGhostToClear(page: Page, timeout = 600): Promise<boolean> {
  return expect(page.locator('.cm-ghost-text'))
    .not.toBeVisible({ timeout })
    .then(() => true)
    .catch(() => false);
}

async function readVisibleGhostText(page: Page): Promise<string> {
  const ghost = page.locator('.cm-ghost-text');
  if (!(await ghost.isVisible().catch(() => false))) return '';
  return (await ghost.textContent()) ?? '';
}

function scoreProbe(probe: ProbeCase, suggestion: string): number {
  if (!suggestion) return 0;
  if (probe.expected && suggestion === probe.expected) return 100;
  if (probe.expected && isExpectedOverlap(probe.expected, suggestion)) return 90;
  if (suggestion.includes('\n')) return 0;
  if (probe.language === 'zh') {
    if (/^[A-Za-z]/.test(suggestion.trim())) return 0;
    return /[\u3400-\u9fff]/u.test(suggestion) ? 75 : 40;
  }
  if (/[\u3400-\u9fff]/u.test(suggestion)) return 0;
  if (/^[A-Za-z][A-Za-z\s]{0,16}$/.test(suggestion.trim())) return 75;
  return 50;
}

function scoreScenarioProbe(probe: ScenarioProbeCase, suggestion: string): number {
  if (!suggestion) return 0;
  if (/[\r\n]/.test(suggestion)) return 0;
  if (suggestion.length > (probe.maxLength ?? 12)) return 0;
  if (isMixedLanguageSuggestion(probe.language, suggestion)) return 0;
  if (isLowValueSuggestion(suggestion)) return 0;
  if (probe.expected && suggestion === probe.expected) return 100;
  if (probe.expectedPattern) {
    probe.expectedPattern.lastIndex = 0;
    if (probe.expectedPattern.test(suggestion)) return 100;
  }
  if (probe.language === 'zh') return /[\u3400-\u9fff]/u.test(suggestion) ? 80 : 40;
  if (/^[A-Za-z][A-Za-z\s.,:;-]{0,20}$/.test(suggestion.trim())) return 80;
  return 50;
}

function isExpectedOverlap(expected: string, suggestion: string): boolean {
  const normalizedExpected = expected.trim();
  const normalizedSuggestion = suggestion.trim();
  if (!normalizedExpected || !normalizedSuggestion) return false;
  return (
    normalizedExpected.includes(normalizedSuggestion) ||
    normalizedSuggestion.includes(normalizedExpected)
  );
}

function summarizeLayers(
  results: Array<{ providerId?: string; sourceLayer?: string; suggestion?: string }>,
): {
  providers: Record<string, number>;
  layers: Record<string, number>;
} {
  const providers: Record<string, number> = {};
  const layers: Record<string, number> = {};
  for (const result of results) {
    if (!result.suggestion) continue;
    const provider = result.providerId ?? 'unknown';
    const layer = `${provider}:${result.sourceLayer ?? 'unknown'}`;
    providers[provider] = (providers[provider] ?? 0) + 1;
    layers[layer] = (layers[layer] ?? 0) + 1;
  }
  return { providers, layers };
}

function summarizeScenario(
  group: ScenarioGroup,
  results: ScenarioProbeResult[],
  negativeResults: Array<{ input: string; suggestion: string }>,
): ScenarioSummary {
  const base = summarize(results);
  const falseTriggerRate = round(
    negativeResults.filter((result) => result.suggestion).length / negativeResults.length,
  );
  const styleFailures = results.filter(
    (result) =>
      !result.suggestion ||
      result.mixedLanguage ||
      result.crossLine ||
      result.tooLong ||
      result.lowValue,
  ).length;
  const styleRate = round((results.length - styleFailures) / results.length);
  const sceneScore = Math.round(
    base.hitRate * 100 * 0.3 +
      base.accuracyScore * 0.45 +
      styleRate * 100 * 0.15 +
      (100 - falseTriggerRate * 100) * 0.1,
  );

  return {
    ...base,
    category: group.category,
    label: group.label,
    sceneScore,
    styleRate,
    falseTriggerRate,
    crossLine: results.filter((result) => result.crossLine).length,
    tooLong: results.filter((result) => result.tooLong).length,
    lowValue: results.filter((result) => result.lowValue).length,
  };
}

function isMixedLanguageSuggestion(language: ProbeCase['language'], suggestion: string): boolean {
  const trimmed = suggestion.trim();
  if (!trimmed) return false;
  return language === 'zh' ? /^[A-Za-z]/.test(trimmed) : /[\u3400-\u9fff]/u.test(trimmed);
}

function isLowValueSuggestion(suggestion: string): boolean {
  const trimmed = suggestion.trim();
  if (!trimmed) return false;
  if (/^[的了在和与及或而但并就都很更再也还又把被对为以中上下一是有用个]$/u.test(trimmed)) {
    return true;
  }
  const words = trimmed.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (
    words.length === 1 &&
    /^(and|or|but|the|a|an|to|of|in|on|for|with|is|are|was|were|can|status|note|notes|step|items|state|main)$/i.test(
      words[0],
    )
  ) {
    return true;
  }
  return /\b(cookie|copyright|all rights reserved|login|sign up|read more|subscribe)\b/i.test(
    trimmed,
  );
}

function summarize(results: ProbeResult[]): Summary {
  const latencies = results
    .map((result) => result.latencyMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    hitRate: round(results.filter((result) => result.suggestion).length / results.length),
    accuracyScore: Math.round(
      results.reduce((sum, result) => sum + result.score, 0) / results.length,
    ),
    p50: percentile(latencies, 0.5),
    p90: percentile(latencies, 0.9),
    mixedLanguage: results.filter((result) => result.mixedLanguage).length,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.floor(values.length * p));
  return values[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
