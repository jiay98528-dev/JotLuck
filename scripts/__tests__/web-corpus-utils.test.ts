import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  assertApprovedWebSources,
  buildCleanDocument,
  cleanFragment,
  detectFragmentLanguage,
  extractReadableText,
  findForbiddenCorpusText,
  fragmentText,
  isAllowedCollectionUrl,
  scrubPrivacy,
} from '../web-corpus-utils';
import {
  atomicReplaceFiles,
  auditFullModel,
  buildProfileSources,
  buildVerifiedBaseline,
  buildWebLocalSourcesFromReport,
  distillTrainingTable,
  selectNestedTrainingSample,
  runTraining,
  scanSource,
  serialize,
  type TrainingTable,
  type TrainingBuild,
  WEB_LOCAL_MAX_BYTES,
  WEB_LOCAL_MIN_COUNT,
} from '../train-baseline';
import { runSyntheticCorpusGenerator } from '../generate-autocomplete-synthetic-corpus';
import { AUTOCOMPLETE_MODEL_EVALUATOR_VERSION } from '../autocomplete-model-evaluator';

beforeAll(() => {
  runSyntheticCorpusGenerator([], { log: () => undefined });
});

describe('web corpus privacy scrubbing', () => {
  it('fails closed when a fragment contains a phone number', () => {
    const result = scrubPrivacy(
      '这个段落用于说明处理步骤，号码13812345678已经被移除，后续只保留通用语义。',
    );

    expect(result.action).toBe('drop');
    expect(result.text).not.toContain('13812345678');
    expect(result.hits).toContain('phone');
    expect(result.reason).toBe('privacy-hit');
  });

  it('fails closed instead of emitting an organization placeholder', () => {
    const result = scrubPrivacy('示例科技有限公司提供的流程说明只保留通用写法，用于训练短句补全。');

    expect(result.action).toBe('drop');
    expect(result.text).not.toContain('某机构');
    expect(result.text).not.toContain('有限公司');
  });

  it('drops fragments that contain multiple privacy entity classes', () => {
    const result = scrubPrivacy('作者：张三 在示例科技有限公司表示，这段内容不应该进入训练片段。');

    expect(result.action).toBe('drop');
    expect(result.reason).toBe('privacy-hit');
  });

  it('removes byline and account patterns', () => {
    const result = scrubPrivacy(
      '作者：李雷 这是一段关于工作记录方法的说明，@private_user 不应该被保留。',
    );

    expect(result.action).toBe('drop');
    expect(result.text).not.toContain('李雷');
    expect(result.text).not.toContain('@private_user');
  });

  it('removes English person and organization names', () => {
    const result = scrubPrivacy(
      'John Gruber and GitHub are mentioned in this technical paragraph for context only.',
    );

    expect(result.action).toBe('drop');
    expect(result.text).not.toContain('John Gruber');
    expect(result.text).not.toContain('GitHub');
  });

  it('removes English single-name contexts and possessive surnames', () => {
    const result = scrubPrivacy(
      'This paragraph mentions a comment by John and compares Gruber’s syntax rule in a generic way.',
    );

    expect(result.action).toBe('drop');
    expect(result.text).not.toContain('John');
    expect(result.text).not.toContain('Gruber');
  });

  it('rejects obfuscated email addresses', () => {
    const result = scrubPrivacy(
      'For additional details contact private.user (at) example (dot) com before continuing.',
    );

    expect(result.action).toBe('drop');
    expect(result.hits).toContain('obfuscated-email');
  });

  it('uses high-confidence release checks without flagging ordinary prose', () => {
    expect(
      findForbiddenCorpusText('This value is grouped by category and written by design.'),
    ).toEqual([]);
    expect(findForbiddenCorpusText('邮箱：private@example.com')).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'privacy', rule: 'email' })]),
    );
  });
});

describe('web corpus fragmentation and extraction', () => {
  it('cuts long text into bounded same-paragraph fragments', () => {
    const text =
      '第一段说明今日任务的背景和目标，需要记录当前状态、风险和下一步安排。第二句继续说明验收方法，强调只保留短文本片段，避免跨段拼接形成长续写。';
    const fragments = fragmentText(text, 20, 60);

    expect(fragments.length).toBeGreaterThan(1);
    expect(fragments.every((fragment) => fragment.length >= 20 && fragment.length <= 60)).toBe(
      true,
    );
  });

  it('drops boilerplate fragments', () => {
    const result = cleanFragment('版权所有 2026 示例网站 保留所有权利 ICP备案号 123456');

    expect(result.action).toBe('drop');
    expect(result.reason).toBe('boilerplate');
  });

  it('drops license boilerplate fragments', () => {
    const result = cleanFragment('This page is licensed under a Creative Commons license.');

    expect(result.action).toBe('drop');
    expect(result.reason).toBe('boilerplate');
  });

  it('drops obvious mixed-language fragments after scrubbing', () => {
    const result = cleanFragment(
      '这个段落混入 many english words from website content and should not train ghost text.',
    );

    expect(result.action).toBe('drop');
    expect(result.reason).toBe('mixed-language');
  });

  it('classifies fragment language for training reports', () => {
    expect(detectFragmentLanguage('当前状态需要继续确认下一步计划。')).toBe('zh');
    expect(detectFragmentLanguage('Current status needs a short follow up note.')).toBe('en');
  });

  it('uses deterministic fragment order for clean documents', () => {
    const fragments = [
      '第一段用于记录当前状态。',
      '第二段用于记录下一步。',
      '第三段用于记录风险。',
    ];

    expect(buildCleanDocument(fragments)).toBe(buildCleanDocument(fragments));
  });

  it('extracts article text and removes navigation chrome', () => {
    const html = `
      <nav>登录 注册 首页</nav>
      <article>
        <h1>正文标题</h1>
        <p>这是一个用于测试正文抽取的段落，内容应该保留，并且可以进入后续碎片化流程。</p>
      </article>
      <footer>ICP备 版权所有</footer>
    `;

    const text = extractReadableText(html);

    expect(text).toContain('正文标题');
    expect(text).toContain('内容应该保留');
    expect(text).not.toContain('登录 注册');
    expect(text).not.toContain('ICP备');
  });
});

describe('web corpus training profiles', () => {
  const baseSources = [
    {
      id: 'notes',
      path: 'note-patterns-zh/',
      weightMilli: 4000,
      category: 'notes',
      language: 'zh' as const,
      kind: 'curated' as const,
      minDocumentFrequency: 2,
      description: 'base notes',
    },
    {
      id: 'cache',
      path: '_web-cache/_clean/should-not-release.md',
      weightMilli: 1000,
      category: 'web',
      language: 'zh' as const,
      kind: 'web' as const,
      minDocumentFrequency: 3,
      description: 'accidental local cache',
    },
  ];

  it('keeps release profile away from web cache paths', () => {
    const sources = buildProfileSources(baseSources, 'release');

    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe('note-patterns-zh/');
  });

  it('uses only clean web-local files from the collection report', () => {
    const webSources = buildWebLocalSourcesFromReport({
      sources: [
        {
          cleanPath: '_web-cache/_raw/raw-page.html',
          category: 'raw',
          weight: 1,
          fragmentsKept: 10,
        },
        {
          sourceId: 'approved-note',
          cleanPath: '_web-cache/_clean/zh-cn/zh-note/page.md',
          category: 'zh-note',
          language: 'zh-CN',
          weight: 1.2,
          fragmentsKept: 8,
          licenseId: 'CC-BY-4.0',
          licenseEvidence: 'https://example.test/license',
          cleanSha256: 'a'.repeat(64),
        },
        {
          cleanPath: null,
          category: 'empty',
          weight: 1,
          fragmentsKept: 0,
        },
      ],
    });

    expect(webSources).toEqual([
      {
        id: 'approved-note',
        path: '_web-cache/_clean/zh-cn/zh-note/page.md',
        weightMilli: 1200,
        description: 'Approved clean web corpus (zh-note)',
        category: 'zh-note',
        language: 'zh',
        kind: 'web',
        minDocumentFrequency: 3,
      },
    ]);
  });

  it('sets the web-local compact hard limit to 6MB', () => {
    expect(WEB_LOCAL_MAX_BYTES).toBe(6 * 1024 * 1024);
  });

  it('requires a transition to appear in at least three web documents', () => {
    expect(WEB_LOCAL_MIN_COUNT).toBe(3);
  });

  it('scans web-local clean files fragment by fragment without cross-fragment ngrams', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'JotLuck-web-corpus-'));
    const cleanDir = path.join(root, '_web-cache', '_clean', 'zh-cn', 'note');
    fs.mkdirSync(cleanDir, { recursive: true });
    const filePath = path.join(cleanDir, 'sample.md');
    fs.writeFileSync(filePath, 'abcd\n\nefgh\n', 'utf-8');

    const { table } = scanSource(filePath, 1, 4);

    expect([...table.keys()].some((ctx) => ctx.includes('\n\n'))).toBe(false);
  });

  it('skips mixed-language clean fragments when requested', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'JotLuck-web-corpus-'));
    const cleanDir = path.join(root, '_web-cache', '_clean', 'zh-cn', 'note');
    fs.mkdirSync(cleanDir, { recursive: true });
    const filePath = path.join(cleanDir, 'sample.md');
    fs.writeFileSync(
      filePath,
      '这个片段用于记录当前状态和下一步计划。\n\n这个片段 mixes many english words and should be skipped.\n',
      'utf-8',
    );

    const result = scanSource(filePath, 1, 4, { skipMixed: true });

    expect(result.languageDistribution.mixed).toBe(0);
    expect(result.skippedMixedFragments).toBe(1);
    expect([...result.table.keys()].join('')).not.toContain('mix');
  });
});

describe('web corpus provenance and collection boundaries', () => {
  it('fails closed when an enabled source has no approved license evidence', () => {
    expect(() =>
      assertApprovedWebSources({
        version: 1,
        sources: [
          {
            id: 'unverified',
            url: 'https://example.test/docs/',
            category: 'docs',
            language: 'en',
            license: { status: 'unverified' },
          },
        ],
      }),
    ).toThrow(/missing approved license provenance/);
  });

  it('restricts collection to same-origin, allowed, non-account paths', () => {
    const source = {
      url: 'https://example.test/docs/',
      category: 'docs',
      language: 'en',
      allowPathPrefixes: ['/docs/'],
    };

    expect(isAllowedCollectionUrl('https://example.test/docs/guide', source)).toBe(true);
    expect(isAllowedCollectionUrl('https://example.test/login', source)).toBe(false);
    expect(isAllowedCollectionUrl('https://other.test/docs/guide', source)).toBe(false);
  });
});

describe('verified model serialization', () => {
  it('selects every byte tier as a deterministic prefix of one category-balanced order', () => {
    const items = [
      { id: 'a-1', category: 'a', bytes: 10 },
      { id: 'a-2', category: 'a', bytes: 10 },
      { id: 'a-3', category: 'a', bytes: 10 },
      { id: 'b-1', category: 'b', bytes: 10 },
      { id: 'b-2', category: 'b', bytes: 10 },
      { id: 'b-3', category: 'b', bytes: 10 },
    ];

    const small = selectNestedTrainingSample(items, 30);
    const large = selectNestedTrainingSample([...items].reverse(), 50);
    const repeated = selectNestedTrainingSample(items, 30);

    expect(small.selected).toEqual(repeated.selected);
    expect(large.selected.slice(0, small.selected.length)).toEqual(small.selected);
    expect(new Set(small.selected.map((item) => item.category))).toEqual(new Set(['a', 'b']));
    expect(selectNestedTrainingSample(items, 100)).toMatchObject({
      availableBytes: 60,
      realizedBytes: 60,
      insufficient: true,
    });
  });

  it('serializes Unicode code points deterministically with positive integer counts', () => {
    const table = new Map([
      [
        '中文😀A',
        new Map([
          ['。', 2000],
          ['！', 1000],
        ]),
      ],
      ['abcd', new Map([['e', 3000]])],
    ]);
    const serialized = serialize(table);

    expect(serialized).not.toContain('\ufffd');
    expect(auditFullModel(serialized, table, 4)).toEqual([]);
    expect(serialized.split('\n')).toEqual([...serialized.split('\n')].sort());
  });

  it('atomically replaces a group of model artifacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'JotLuck-atomic-model-'));
    const model = path.join(root, 'model.txt');
    const manifest = path.join(root, 'manifest.json');
    fs.writeFileSync(model, 'old-model', 'utf8');
    fs.writeFileSync(manifest, 'old-manifest', 'utf8');

    atomicReplaceFiles([
      { target: model, content: 'new-model' },
      { target: manifest, content: 'new-manifest' },
    ]);

    expect(fs.readFileSync(model, 'utf8')).toBe('new-model');
    expect(fs.readFileSync(manifest, 'utf8')).toBe('new-manifest');
    expect(
      fs.readdirSync(root).some((entry) => entry.includes('.tmp-') || entry.includes('.bak-')),
    ).toBe(false);
  });

  it('applies configured document frequency and a deterministic global byte budget', () => {
    const transition = (
      sourceId: string,
      documents: string[],
      minDocumentFrequency: number,
      count: number,
    ) => ({
      count,
      documentsBySource: new Map([[sourceId, new Set(documents)]]),
      minDocumentFrequencyBySource: new Map([[sourceId, minDocumentFrequency]]),
    });
    const table: TrainingTable = new Map([
      ['aaaa', new Map([['x', transition('strict', ['a', 'b'], 3, 9000)]])],
      ['bbbb', new Map([['y', transition('normal', ['c', 'd'], 2, 1000)]])],
      ['cccc', new Map([['z', transition('strong', ['e', 'f', 'g'], 3, 3000)]])],
    ]);
    const oneEntryBudget = Buffer.byteLength(
      serialize(new Map([['cccc', new Map([['z', 3000]])]])),
      'utf8',
    );

    const first = distillTrainingTable(table, 3, oneEntryBudget);
    const second = distillTrainingTable(table, 3, oneEntryBudget);

    expect([...first.model.keys()]).toEqual(['cccc']);
    expect(first.budget).toMatchObject({
      candidateEntries: 2,
      retainedEntries: 1,
      evictedEntries: 1,
      retainedBytes: oneEntryBudget,
    });
    expect(first.budget.candidateBytes).toBeGreaterThan(first.budget.retainedBytes);
    expect(first.budget.retainedBytes).toBeLessThanOrEqual(oneEntryBudget);
    expect(serialize(first.model)).toBe(serialize(second.model));
  });

  it('serializes independent document support instead of repeated in-document occurrences', () => {
    const transition = (count: number, documents: string[]) => ({
      count,
      documentsBySource: new Map([['project', new Set(documents)]]),
      minDocumentFrequencyBySource: new Map([['project', 2]]),
      weightMilliBySource: new Map([['project', 1000]]),
    });
    const table: TrainingTable = new Map([
      [
        'same',
        new Map([
          ['x', transition(100_000, ['a', 'b'])],
          ['y', transition(3_000, ['c', 'd', 'e'])],
        ]),
      ],
    ]);

    const result = distillTrainingTable(table, 3, 1024);

    expect(result.model.get('same')).toEqual(
      new Map([
        ['y', 3000],
        ['x', 2000],
      ]),
    );
  });

  it('prefers lower-entropy contexts when support and byte budget are comparable', () => {
    const transition = (documents: string[], count = 2000) => ({
      count,
      documentsBySource: new Map([['project', new Set(documents)]]),
      minDocumentFrequencyBySource: new Map([['project', 2]]),
    });
    const table: TrainingTable = new Map([
      ['calm', new Map([['x', transition(['a', 'b'])]])],
      [
        'noisy',
        new Map([
          ['x', transition(['a', 'b'], 1000)],
          ['y', transition(['a', 'b'], 1000)],
        ]),
      ],
    ]);
    const calmBytes = Buffer.byteLength(serialize(new Map([['calm', new Map([['x', 2000]])]])));
    const noisyBytes = Buffer.byteLength(
      serialize(
        new Map([
          [
            'noisy',
            new Map([
              ['x', 1000],
              ['y', 1000],
            ]),
          ],
        ]),
      ),
    );

    const result = distillTrainingTable(table, 3, Math.max(calmBytes, noisyBytes));

    expect([...result.model.keys()]).toEqual(['calm']);
    expect(result.budget.meanRetainedEntropyPpm).toBe(0);
    expect(result.budget.meanEvictedEntropyPpm).toBe(1_000_000);
  });
});

describe('verified baseline governance', () => {
  let releaseCandidate: TrainingBuild;
  let evidenceRoot = '';
  let evidencePath = '';
  let validEvidence: Record<string, unknown>;

  beforeAll(() => {
    releaseCandidate = buildVerifiedBaseline({
      profile: 'release',
      dryRun: true,
      allowVerifiedDegraded: false,
      trainingPoolBytes: 104_858,
      testDocumentLimit: 512,
    });
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    evidenceRoot = fs.mkdtempSync(path.join(repositoryRoot, 'scripts', '__tests__', '.quality-'));
    evidencePath = path.join(evidenceRoot, 'quality.json');
    validEvidence = {
      schemaVersion: 1,
      profile: 'release',
      modelSha256: releaseCandidate.report.modelSha256,
      trainingInputHash: releaseCandidate.report.inputManifestHash,
      holdoutSha256: releaseCandidate.report.holdoutQuality.holdoutSha256,
      evaluatorVersion: AUTOCOMPLETE_MODEL_EVALUATOR_VERSION,
      learningCurveSha256: 'b'.repeat(64),
      opportunities: 220,
      triggerRate: 0.368,
      usableRate: 0.368,
      falseTriggerRate: 0,
      mixedCandidateRate: 0,
      p90Ms: 105,
    };
  }, 120_000);

  afterAll(() => {
    if (evidenceRoot) fs.rmSync(evidenceRoot, { recursive: true, force: true });
  });

  it('builds a deterministic candidate but fails closed without quality evidence', () => {
    const build = releaseCandidate;
    const notePatterns = build.report.sourceInputs.find(
      (source) => source.id === 'curated-note-patterns-zh',
    );

    expect(notePatterns?.files).toBe(10);
    expect(build.report.trainingHoldoutOverlap).toBe(0);
    expect(build.report.fullModelFindings).toEqual([]);
    expect(build.report.rawExactDuplicateRate).toBeLessThanOrEqual(0.01);
    expect(build.report.residualExactDuplicateRate).toBeLessThanOrEqual(0.01);
    expect(build.report.residualNearDuplicateRate).toBeLessThanOrEqual(0.03);
    expect(
      Math.max(
        ...Object.values(build.report.categoryDistribution).map(
          ({ ratio }) => Number.parseFloat(ratio) / 100,
        ),
      ),
    ).toBeLessThanOrEqual(0.4);
    expect(build.manifest).toMatchObject({
      schemaVersion: 2,
      serialization: 'sectioned-jsonl-hex-v4',
      minNgramN: 2,
      wordNgramOrders: [1, 2],
      countScale: 1000,
      verifiedOnly: true,
      runtimeEligible: true,
      hardLimitPassed: true,
      softTargetPassed: true,
      qualityGatePassed: false,
      releaseEligible: false,
      degradedReason: 'holdout-quality-gate-not-passed',
    });
    expect(build.report.holdoutQuality).toMatchObject({ provided: false, passed: false });
    expect(build.report.governance.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Holdout quality evidence is required')]),
    );
  }, 300_000);

  it('does not let the degraded flag replace official assets without quality evidence', () => {
    expect(() =>
      runTraining(
        ['--profile', 'web-local', '--allow-verified-degraded', '--training-pool-bytes', '104858'],
        { testDocumentLimit: 512 },
      ),
    ).toThrow(/official assets were not replaced/);
  }, 120_000);

  it('marks a degraded candidate as ineligible without quality evidence', () => {
    const build = buildVerifiedBaseline({
      profile: 'web-local',
      dryRun: true,
      allowVerifiedDegraded: true,
      trainingPoolBytes: 104_858,
      testDocumentLimit: 512,
    });
    expect(build.manifest).toMatchObject({
      verifiedOnly: true,
      hardLimitPassed: true,
      softTargetPassed: true,
      qualityGatePassed: false,
      releaseEligible: false,
      degradedReason: 'holdout-quality-gate-not-passed',
    });
  }, 120_000);

  it('accepts quality evidence bound to the exact model, input, holdout, and profile', () => {
    fs.writeFileSync(evidencePath, JSON.stringify(validEvidence), 'utf8');
    const verified = buildVerifiedBaseline({
      profile: 'release',
      dryRun: true,
      allowVerifiedDegraded: false,
      qualityReportPath: evidencePath,
      trainingPoolBytes: 104_858,
      testDocumentLimit: 512,
    });

    expect(verified.report.holdoutQuality).toMatchObject({
      provided: true,
      passed: true,
      opportunities: 220,
    });
    expect(verified.manifest.qualityGatePassed).toBe(true);
    expect(verified.manifest.releaseEligible).toBe(true);
    expect(verified.manifest).toMatchObject({
      holdoutSha256: validEvidence.holdoutSha256,
      evaluatorVersion: validEvidence.evaluatorVersion,
      learningCurveSha256: validEvidence.learningCurveSha256,
      qualityEvidenceSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(verified.report.governance.errors).toEqual([]);
  }, 120_000);

  it('rejects quality evidence bound to a different model', () => {
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({ ...validEvidence, modelSha256: '0'.repeat(64) }),
      'utf8',
    );
    const mismatched = buildVerifiedBaseline({
      profile: 'release',
      dryRun: true,
      allowVerifiedDegraded: false,
      qualityReportPath: evidencePath,
      trainingPoolBytes: 104_858,
      testDocumentLimit: 512,
    });
    expect(mismatched.report.holdoutQuality.passed).toBe(false);
    expect(mismatched.report.holdoutQuality.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('different model SHA-256')]),
    );
  }, 120_000);
});
