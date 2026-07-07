import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildCleanDocument,
  cleanFragment,
  detectFragmentLanguage,
  extractReadableText,
  fragmentText,
  scrubPrivacy,
} from '../web-corpus-utils';
import {
  buildProfileSources,
  buildWebLocalSourcesFromReport,
  scanSource,
  WEB_LOCAL_MAX_BYTES,
  WEB_LOCAL_MIN_COUNT,
} from '../train-baseline';

describe('web corpus privacy scrubbing', () => {
  it('removes phone numbers without keeping the original value', () => {
    const result = scrubPrivacy(
      '这个段落用于说明处理步骤，号码13812345678已经被移除，后续只保留通用语义。',
    );

    expect(result.action).toBe('keep');
    expect(result.text).not.toContain('13812345678');
    expect(result.hits).toContain('phone');
  });

  it('replaces company-like entities with a generic token', () => {
    const result = scrubPrivacy('示例科技有限公司提供的流程说明只保留通用写法，用于训练短句补全。');

    expect(result.action).toBe('keep');
    expect(result.text).toContain('某机构');
    expect(result.text).not.toContain('有限公司');
  });

  it('drops fragments that contain multiple privacy entity classes', () => {
    const result = scrubPrivacy('作者：张三 在示例科技有限公司表示，这段内容不应该进入训练片段。');

    expect(result.action).toBe('drop');
    expect(result.reason).toBe('multiple-privacy-hits');
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
      path: 'note-patterns-zh/',
      weight: 4,
      description: 'base notes',
    },
    {
      path: '_web-cache/_clean/should-not-release.md',
      weight: 1,
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
          cleanPath: '_web-cache/_clean/zh-cn/zh-note/page.md',
          category: 'zh-note',
          language: 'zh-CN',
          weight: 1.2,
          fragmentsKept: 8,
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
        path: '_web-cache/_clean/zh-cn/zh-note/page.md',
        weight: 1.2,
        description: 'Local-only scrubbed web fragments (zh-note)',
        category: 'zh-note',
        language: 'zh',
        localOnly: true,
        maxFragments: 900,
      },
    ]);
  });

  it('sets the web-local compact hard limit to 6MB', () => {
    expect(WEB_LOCAL_MAX_BYTES).toBe(6 * 1024 * 1024);
  });

  it('uses a weighted min-count for the larger web-local compact model', () => {
    expect(WEB_LOCAL_MIN_COUNT).toBe(0.85);
  });

  it('scans web-local clean files fragment by fragment without cross-fragment ngrams', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markluck-web-corpus-'));
    const cleanDir = path.join(root, '_web-cache', '_clean', 'zh-cn', 'note');
    fs.mkdirSync(cleanDir, { recursive: true });
    const filePath = path.join(cleanDir, 'sample.md');
    fs.writeFileSync(filePath, 'abcd\n\nefgh\n', 'utf-8');

    const { table } = scanSource(filePath, 1, 4);

    expect([...table.keys()].some((ctx) => ctx.includes('\n\n'))).toBe(false);
  });

  it('skips mixed-language clean fragments when requested', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markluck-web-corpus-'));
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
