/**
 * MarkdownPredictor 单元测试
 *
 * 覆盖: 纯函数(extractContext/getLineAt/isInFencedCode/isInFrontmatter/detectOpenFormat),
 *       语法上下文检测, 结构化预测, getGhostText融合决策,
 *       持久化(save/load/closeDocument/forceEliminate),
 *       边界(constructor/loadBaseline/initialize/ingestExcerpts),
 *       acceptCompletion/rejectCompletion/scanOpenedDocument
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACCEPTED_LEXICON_STORAGE_KEY,
  configureBaselineLoaderForTests,
  MarkdownPredictor,
  resetBaselineLoaderForTests,
  type PredictorIndexData,
} from '../MarkdownPredictor';
import { loadCompletionMetrics } from '../completion/metrics';
import { learningSignalsStorageKey } from '../completion/learning-signals';
import { flushCompletionStorageMutationsForTests } from '../completion/learning-repository';
import {
  HybridRetrievalService,
  LocalHybridRetrievalBackend,
  type HybridRetrievalBackend,
} from '../completion/hybrid-retrieval-backend';
import type { HybridRetrievalResponse } from '../completion/hybrid-retrieval-types';
import {
  PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
  PUBLIC_ENGINE_PROTOCOL_VERSION,
  createEmptyPublicEngineAssetDiagnostics,
  type CompletionPublicEngine,
} from '../completion/public-engine-types';

// ---- helpers ----
const SCOPED_NGRAM_KEY = 'jotluck:scope:unscoped:autocomplete:ngram:v4';
const SCOPED_NGRAM_META_KEY = 'jotluck:scope:unscoped:autocomplete:meta:v4';
const SCOPED_ACCEPTED_LEXICON_KEY = 'jotluck:scope:unscoped:autocomplete:acceptedLexicon:v1';
const TEST_BASELINE_HASH = 'a'.repeat(64);
const TEST_PUBLIC_ENGINE_ID = 'test-public-engine';

function baselineManifest(model: string, entryCount: number) {
  return JSON.stringify({
    schemaVersion: 1,
    profile: 'web-local',
    modelFile: 'baseline-ngram.web-local.compact.txt',
    serialization: 'jsonl-hex-v3-fixed-int',
    order: 'lexicographic-context-hex',
    ngramN: 4,
    modelBytes: new TextEncoder().encode(model).byteLength,
    entryCount,
    sha256: TEST_BASELINE_HASH,
    trainingInputHash: 'b'.repeat(64),
    verifiedOnly: true,
    runtimeEligible: true,
    qualityGatePassed: true,
    releaseEligible: true,
    hardLimitPassed: true,
  });
}

function createPredictor(n: number = 4): MarkdownPredictor {
  return new MarkdownPredictor(n);
}

/** Mock index data with predefined titles/tags/paths */
function mockIndexData(overrides: Partial<PredictorIndexData> = {}): PredictorIndexData {
  return {
    getAllNoteTitles: () => ['Hello World', 'React Guide', 'TypeScript Notes', '项目笔记'],
    getAllTags: () => ['react', 'typescript', 'frontend', 'backend'],
    matchFilePaths: (prefix: string) => {
      const paths = ['images/photo.png', 'docs/readme.md', 'docs/api.md'];
      return paths.filter((p) => p.startsWith(prefix));
    },
    ...overrides,
  };
}

function setupLocalStorageMock() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k]);
    }),
  });
  return store;
}

// Access private methods for pure-function testing
function priv(p: MarkdownPredictor) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return p as any;
}

// ---- tests ----

describe('MarkdownPredictor', () => {
  // ============ 纯函数 (private helpers) ============

  describe('extractContext (private)', () => {
    it('提取光标前 n 个字符', () => {
      const p = createPredictor(4);
      const ctx = priv(p).extractContext(6, 'hello world');
      expect(ctx).toBe('llo '); // slice(2, 6)
    });

    it('光标在文档开头返回短上下文', () => {
      const p = createPredictor(4);
      const ctx = priv(p).extractContext(2, 'hi');
      expect(ctx).toBe('hi'); // start=0, slice(0,2)
    });

    it('光标在 n 边界返回恰好 n 字符', () => {
      const p = createPredictor(4);
      const ctx = priv(p).extractContext(4, '12345678');
      expect(ctx).toBe('1234');
    });
  });

  describe('getLineAt (private)', () => {
    const doc = 'line1\nline2\nline3';

    it('第一行', () => {
      const p = createPredictor();
      const line = priv(p).getLineAt(0, doc);
      expect(line).not.toBeNull();
      expect(line!.text).toBe('line1');
      expect(line!.from).toBe(0);
    });

    it('中间行', () => {
      const p = createPredictor();
      const line = priv(p).getLineAt(8, doc); // 'l' of line2
      expect(line!.text).toBe('line2');
      expect(line!.from).toBe(6);
      expect(line!.to).toBe(11);
    });

    it('最后一行（无尾随换行）', () => {
      const p = createPredictor();
      const line = priv(p).getLineAt(14, doc); // last char
      expect(line!.text).toBe('line3');
    });

    it('文档以换行结尾时返回新的空行', () => {
      const p = createPredictor();
      const line = priv(p).getLineAt('line1\n'.length, 'line1\n');
      expect(line!.text).toBe('');
      expect(line!.from).toBe('line1\n'.length);
    });

    it('位置在换行符上返回该行', () => {
      const p = createPredictor();
      // position 5 is '\n' after "line1" — getLineAt checks pos >= lineStart && pos <= i+1
      // lineStart=0, i=5 → pos=5 is >=0 && <=6 → returns "line1"
      const line = priv(p).getLineAt(5, doc);
      expect(line).not.toBeNull();
    });

    it('空字符串返回空行对象', () => {
      const p = createPredictor();
      const line = priv(p).getLineAt(0, '');
      // getLineAt returns { text: '', from: 0, to: 0 } for empty doc
      expect(line).not.toBeNull();
      expect(line!.text).toBe('');
      expect(line!.from).toBe(0);
    });
  });

  describe('isInFencedCode (private)', () => {
    it('在代码块内返回 true', () => {
      const p = createPredictor();
      const doc = 'before\n```\ncode here\n```\nafter';
      const result = priv(p).isInFencedCode(10, doc); // inside "code here"
      expect(result).toBe(true);
    });

    it('在代码块外返回 false', () => {
      const p = createPredictor();
      const doc = '```\ncode\n```\nafter';
      const result = priv(p).isInFencedCode(20, doc); // in "after"
      expect(result).toBe(false);
    });

    it('在 fence 行本身上返回 true', () => {
      const p = createPredictor();
      const doc = '```\ncode\n```';
      const result = priv(p).isInFencedCode(0, doc); // first ```
      expect(result).toBe(true);
    });

    it('无代码块返回 false', () => {
      const p = createPredictor();
      const result = priv(p).isInFencedCode(5, 'normal text');
      expect(result).toBe(false);
    });
  });

  describe('isInFrontmatter (private)', () => {
    it('在 frontmatter 内返回 true', () => {
      const p = createPredictor();
      const doc = '---\ntitle: test\ndate: 2025\n---\n# Content';
      const result = priv(p).isInFrontmatter(10, doc);
      expect(result).toBe(true);
    });

    it('兼容 CRLF frontmatter', () => {
      const p = createPredictor();
      const doc = '---\r\ntitle: test\r\ndate: 2025\r\n---\r\n# Content';
      expect(priv(p).isInFrontmatter(10, doc)).toBe(true);
    });

    it('frontmatter 外返回 false', () => {
      const p = createPredictor();
      const doc = '---\ntitle: test\n---\n# Content';
      const result = priv(p).isInFrontmatter(30, doc); // in "# Content"
      expect(result).toBe(false);
    });

    it('无 frontmatter 返回 false', () => {
      const p = createPredictor();
      const result = priv(p).isInFrontmatter(5, '# Just a heading');
      expect(result).toBe(false);
    });
  });

  describe('detectOpenFormat (private)', () => {
    it('** 未闭合返回 **', () => {
      const p = createPredictor();
      const result = priv(p).detectOpenFormat('**bold text', 11);
      expect(result).toBe('**');
    });

    it('** 已闭合返回 null', () => {
      const p = createPredictor();
      const result = priv(p).detectOpenFormat('**bold** text', 13);
      expect(result).toBe(null);
    });

    it('* 未闭合返回 *（排除 ** 中的）', () => {
      const p = createPredictor();
      const result = priv(p).detectOpenFormat('*italic text', 12);
      expect(result).toBe('*');
    });

    it('` 未闭合返回 `', () => {
      const p = createPredictor();
      const result = priv(p).detectOpenFormat('`code here', 10);
      expect(result).toBe('`');
    });

    it('__ 未闭合返回 __', () => {
      const p = createPredictor();
      const result = priv(p).detectOpenFormat('__underline text', 15);
      expect(result).toBe('__');
    });

    it('无未闭合格式返回 null', () => {
      const p = createPredictor();
      const result = priv(p).detectOpenFormat('plain text here', 14);
      expect(result).toBe(null);
    });
  });

  // ============ 语法上下文检测 ============

  describe('detectSyntaxContext', () => {
    it('检测 Wiki-link 上下文', () => {
      const p = createPredictor();
      const doc = 'See [[Hello'; // length 11: S(0)e(1)e(2) (3)[(4)[(5)H(6)e(7)l(8)l(9)o(10)
      // cursor at end (position 11) so beforeCursor includes full "Hello"
      const ctx = p.detectSyntaxContext(11, doc);
      expect(ctx.type).toBe('wiki-link');
      expect(ctx.prefix).toBe('Hello');
    });

    it('检测 Tag 上下文 (#)', () => {
      const p = createPredictor();
      const doc = 'Tags: #react'; // T(0)a(1)g(2)s(3):(4) (5)#(6)r(7)e(8)a(9)c(10)t(11)
      const ctx = p.detectSyntaxContext(12, doc);
      expect(ctx.type).toBe('tag');
      expect(ctx.prefix).toBe('react');
    });

    it('检测 File-path 上下文', () => {
      const p = createPredictor();
      const doc = '![alt](images/'; // length 14: cursor at end=14
      const ctx = p.detectSyntaxContext(14, doc);
      expect(ctx.type).toBe('file-path');
      expect(ctx.prefix).toBe('images/');
    });

    it('检测 Markdown 格式闭合上下文', () => {
      const p = createPredictor();
      const doc = 'This is **bold text';
      const ctx = p.detectSyntaxContext(18, doc);
      expect(ctx.type).toBe('markdown-format');
      expect(ctx.openMarker).toBe('**');
    });

    it('无特殊上下文返回 general', () => {
      const p = createPredictor();
      const doc = 'Just typing some notes';
      const ctx = p.detectSyntaxContext(10, doc);
      expect(ctx.type).toBe('general');
    });

    it('行首 # 后跟空格不算 tag（是标题）', () => {
      const p = createPredictor();
      const doc = '# Heading';
      const ctx = p.detectSyntaxContext(3, doc);
      // "# H" matches /#{1,6}\s/ so tag regex falls through; should be general
      // Actually, the tag regex check is line.text.trimStart() match /^#{1,6}\s/
      // "# Heading" matches → returns general
      expect(ctx.type).toBe('general');
    });
  });

  describe('isDisabledContext', () => {
    it('代码块内禁用', () => {
      const p = createPredictor();
      const doc = '```\ncode\n```';
      expect(p.isDisabledContext(5, doc)).toBe(true);
    });

    it('frontmatter 内禁用', () => {
      const p = createPredictor();
      const doc = '---\ntitle: test\n---\ntext';
      expect(p.isDisabledContext(5, doc)).toBe(true);
    });

    it('CRLF frontmatter 内禁用', () => {
      const p = createPredictor();
      const doc = '---\r\ntitle: test\r\n---\r\ntext';
      expect(p.isDisabledContext(8, doc)).toBe(true);
    });

    it('空行禁用', () => {
      const p = createPredictor();
      const doc = 'line one\n\nline three';
      expect(p.isDisabledContext(9, doc)).toBe(true); // empty line at the second newline
    });

    it('正常文本不禁用', () => {
      const p = createPredictor();
      const doc = 'Normal text here';
      expect(p.isDisabledContext(5, doc)).toBe(false);
    });
  });

  // ============ 结构化预测 ============

  describe('结构化预测 (via getGhostText)', () => {
    it('Wiki-link 预测补全标题和闭合 ]]', () => {
      const p = createPredictor(4);
      p.setIndexData(mockIndexData());
      // cursor after "[[Hello" → should predict " World]]"
      const doc = 'See [[Hello';
      const result = p.getGhostText(10, doc); // cursor at end of "[[Hello"
      // For wiki-link type, confidence > 0.8 → returns structured directly
      expect(result).not.toBeNull();
      expect(result!.source).toBe('structured');
      expect(result!.syntaxType).toBe('wiki-link');
      expect(result!.text).toContain(']]');
    });

    it('Tag 预测补全标签', () => {
      const p = createPredictor(4);
      p.setIndexData(mockIndexData());
      const doc = 'tag: #reac';
      const result = p.getGhostText(10, doc);
      expect(result).not.toBeNull();
      if (result) {
        expect(result!.source).toBe('structured');
        expect(result!.syntaxType).toBe('tag');
      }
    });

    it('File-path 预测补全路径和闭合 )', () => {
      const p = createPredictor(4);
      p.setIndexData(mockIndexData());
      const doc = '![img](docs/';
      const result = p.getGhostText(12, doc);
      expect(result).not.toBeNull();
      if (result) {
        expect(result!.source).toBe('structured');
        expect(result!.syntaxType).toBe('file-path');
      }
    });

    it('Format-closure ** 预测闭合标记', () => {
      const p = createPredictor(4);
      // No index data needed for format closure
      const doc = '**bold text';
      const result = p.getGhostText(11, doc);
      expect(result).not.toBeNull();
      if (result) {
        expect(result!.source).toBe('structured');
        expect(result!.syntaxType).toBe('markdown-format');
      }
    });

    it('Format-closure * 预测', () => {
      const p = createPredictor(4);
      const doc = 'Hey *italic';
      const result = p.getGhostText(10, doc);
      expect(result).not.toBeNull();
      if (result) {
        expect(result!.source).toBe('structured');
      }
    });

    it('Format-closure ` 预测', () => {
      const p = createPredictor(4);
      const doc = 'Use `code';
      const result = p.getGhostText(9, doc);
      expect(result).not.toBeNull();
      if (result) {
        expect(result!.source).toBe('structured');
      }
    });

    it('Format-closure __ 预测', () => {
      const p = createPredictor(4);
      const doc = 'Some __underline';
      const result = p.getGhostText(15, doc);
      expect(result).not.toBeNull();
      if (result) {
        expect(result!.source).toBe('structured');
      }
    });

    it('无 indexData 时 Wiki-link 返回 null', () => {
      const p = createPredictor(4);
      // No setIndexData called
      const doc = 'See [[Hello';
      const result = p.getGhostText(10, doc);
      if (result) {
        // Without index data, structured prediction returns null
        // But with enough context (>=4 chars), N-gram might still work
        expect(result!.source).not.toBe('structured');
      }
      // Should not crash
    });
  });

  // ============ getGhostText 融合决策 ============

  it('provider pipeline exposes providerId on structured completions', () => {
    const p = createPredictor(4);
    p.setIndexData(mockIndexData());
    const result = p.getGhostText('[[Hello'.length, '[[Hello');
    expect(result?.source).toBe('structured');
    expect(result?.providerId).toBe('wiki-link');
    expect(result?.learnable).toBe(false);
  });

  it('file-path ghost only accepts prefix matches, not fuzzy includes matches', () => {
    const p = createPredictor(4);
    p.setIndexData(
      mockIndexData({
        matchFilePaths: (prefix: string) => {
          const paths = ['docs/readme.md', 'readme-local.md'];
          return paths.filter((path) => path.toLowerCase().includes(prefix.toLowerCase()));
        },
      }),
    );

    const doc = '[x](read';
    const result = p.getGhostText(doc.length, doc);

    expect(result?.source).toBe('structured');
    expect(result?.syntaxType).toBe('file-path');
    expect(result?.text).toBe('me-local.md)');
  });

  describe('sequence pattern completion', () => {
    it('infers the next Chinese multi-token sequence on a new line', () => {
      const p = createPredictor(4);
      const doc = '第一条、第一天\n第二条、第二天\n';
      const result = p.getGhostText(doc.length, doc);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('第三条、第三天');
      expect(result!.providerId).toBe('sequence-pattern');
      expect(result!.source).toBe('structured');
      expect(result!.learnable).toBe(false);
    });

    it('infers only the sequence prefix when previous lines contain prose', () => {
      const p = createPredictor(4);
      const doc = '第一条：我喜欢开车出去玩\n第二条：我喜欢去公园逛街\n';
      const result = p.getGhostText(doc.length, doc);

      expect(result?.text).toBe('第三条：');
      expect(result?.providerId).toBe('sequence-pattern');
    });

    it('completes the remaining sequence text when the user already typed a prefix', () => {
      const p = createPredictor(4);
      const doc = '第一条：我喜欢开车出去玩\n第二条：我喜欢去公园逛街\n第三';
      const result = p.getGhostText(doc.length, doc);

      expect(result?.text).toBe('条：');
      expect(result?.providerId).toBe('sequence-pattern');
    });

    it('infers ordered list numbering without copying item content', () => {
      const p = createPredictor(4);
      const doc = '1. first item\n2. second item\n';
      const result = p.getGhostText(doc.length, doc);

      expect(result?.text).toBe('3. ');
      expect(result?.providerId).toBe('sequence-pattern');
    });

    it('completes ordered list punctuation when the next number is partially typed', () => {
      const p = createPredictor(4);
      const doc = '1. first item\n2. second item\n3';
      const result = p.getGhostText(doc.length, doc);

      expect(result?.text).toBe('. ');
      expect(result?.providerId).toBe('sequence-pattern');
    });

    it('does not cross a blank line when inferring a sequence', () => {
      const p = createPredictor(4);
      const doc = '第一条：内容\n第二条：内容\n\n';

      expect(p.getGhostText(doc.length, doc)).toBeNull();
    });

    it('rejects non-contiguous sequence jumps', () => {
      const p = createPredictor(4);
      const doc = '第一条：内容\n第三条：内容\n';

      expect(p.getGhostText(doc.length, doc)).toBeNull();
    });
  });

  describe('line echo completion', () => {
    it('echoes the repeated Chinese line suffix from the current document', () => {
      const p = createPredictor(4);
      const doc =
        '# 产品例会\n\n' +
        '会议结论是需要确认负责人和截止时间。\n' +
        '会议结论是需要确认负责人和截止时间。\n' +
        '会议结论是';
      const result = p.getGhostText(doc.length, doc);

      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('line-echo');
      expect(result!.text).toBe('需要确认负责人和截止时间');
    });

    it('rejects a repeated English suffix when the first complete word exceeds the ghost limit', () => {
      const p = createPredictor(4);
      const doc =
        '# Release triage\n\n' +
        'Release risk is configuration drift before the final check.\n' +
        'Release risk is configuration drift before the final check.\n' +
        'Release risk is';
      const result = p.getGhostText(doc.length, doc);

      expect(result).toBeNull();
    });

    it.each([
      ['今日随访重点是观察症状变化和用药反应。', '今日随访重点是'],
      ['本节课需要加强阅读理解和课堂表达。', '本节课需要'],
      ['主要风险在于付款节点和违约责任约定。', '主要风险在于'],
      ['复盘重点是报名转化率和渠道投放成本。', '复盘重点是'],
      ['The observation suggests a stronger baseline is required.', 'The observation suggests'],
      ['Next step is to confirm the migration window and owner.', 'Next step is'],
      ['Morning plan includes temple visits and a quiet lunch nearby.', 'Morning plan includes'],
      ['Key driver is demand softness and margin pressure.', 'Key driver is'],
    ])('echoes repeated domain lines: %s', (line, prefix) => {
      const p = createPredictor(4);
      const doc = `# Diagnostic\n\n${line}\n${line}\n${prefix}`;
      const result = p.getGhostText(doc.length, doc);

      expect(result).toMatchObject({ providerId: 'line-echo' });
      expect(line.slice(prefix.length)).toContain(result!.text.trimEnd());
    });

    it('does not cross blank lines when echoing repeated text', () => {
      const p = createPredictor(4);
      const doc =
        '会议结论是需要确认负责人和截止时间。\n\n' +
        '会议结论是需要确认负责人和截止时间。\n' +
        '会议结论是';

      expect(p.getGhostText(doc.length, doc)?.providerId).not.toBe('line-echo');
    });

    it('does not echo when the repeated suffixes disagree', () => {
      const p = createPredictor(4);
      const doc = '会议结论是需要确认负责人。\n' + '会议结论是需要确认截止时间。\n' + '会议结论是';

      expect(p.getGhostText(doc.length, doc)?.providerId).not.toBe('line-echo');
    });
  });

  describe('input-method-style writing completion', () => {
    it('returns short phrase-slot suggestions in Chinese paragraph context', () => {
      const p = createPredictor(4);
      const doc = '我认为';
      const result = p.getGhostText(doc.length, doc);

      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('phrase-slot');
      expect(result!.text).toBe('，');
      expect(result!.text.length).toBeLessThanOrEqual(8);
    });

    it('boosts phrase-slot confidence after real Chinese sentence punctuation', () => {
      const p = createPredictor(4);
      const baseDoc = '原因是';
      const boostedDoc = '今天先记录项目复盘。团队讨论风险边界，也确认下一步安排。原因是';

      const base = p.getGhostText(baseDoc.length, baseDoc);
      const boosted = p.getGhostText(boostedDoc.length, boostedDoc);

      expect(base?.providerId).toBe('phrase-slot');
      expect(boosted?.providerId).toBe('phrase-slot');
      expect(boosted!.confidence).toBeGreaterThan(base!.confidence);
    });

    it('does not trigger phrase slots in mixed-language context', () => {
      const p = createPredictor(4);
      const doc = '今天 review 我认为';

      expect(p.getGhostText(doc.length, doc)?.providerId).not.toBe('phrase-slot');
    });

    it('does not trigger phrase slots inside fenced code', () => {
      const p = createPredictor(4);
      const doc = '```\n我认为';

      expect(p.getGhostText(doc.length, doc)).toBeNull();
    });

    it('uses current document lexicon for short term completion', () => {
      const p = createPredictor(4);
      p.scanOpenedDocument('项目复盘需要记录转化成本。\n转化成本需要持续观察。\n');
      const doc = '转化';
      const result = p.getGhostText(doc.length, doc);

      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('lexicon');
      expect(result!.text).toContain('成本');
      expect(result!.text.length).toBeLessThanOrEqual(8);
    });

    it('uses recent note titles as lexicon candidates', () => {
      const p = createPredictor(4);
      p.setIndexData({
        ...mockIndexData(),
        getAllNoteTitles: () => [],
        getRecentNoteTitles: () => ['转化成本复盘'],
      });
      const doc = '转化';
      const result = p.getGhostText(doc.length, doc);

      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('lexicon');
      expect(result!.text).toContain('成本');
    });

    it('learns accepted lexicon terms locally and reuses them', () => {
      setupLocalStorageMock();
      const p = createPredictor(4);
      p.acceptCompletion('项目', '转化成本');
      const doc = '转化';
      const result = p.getGhostText(doc.length, doc);

      expect(result).not.toBeNull();
      expect(result!.providerId).toBe('lexicon');
      expect(result!.text).toBe('成本');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        SCOPED_ACCEPTED_LEXICON_KEY,
        expect.any(String),
      );
      vi.unstubAllGlobals();
    });

    it('clears accepted lexicon and local training storage together', () => {
      setupLocalStorageMock();
      const p = createPredictor(4);
      p.acceptCompletion('项目', '转化成本');
      p.ingestDocument('note.md', '项目复盘需要记录转化成本。转化成本需要持续观察。');

      expect(localStorage.getItem(SCOPED_NGRAM_KEY)).not.toBeNull();
      expect(localStorage.getItem(SCOPED_ACCEPTED_LEXICON_KEY)).not.toBeNull();

      p.clearLearningData();

      expect(localStorage.removeItem).toHaveBeenCalledWith(SCOPED_NGRAM_KEY);
      expect(localStorage.removeItem).toHaveBeenCalledWith(SCOPED_NGRAM_META_KEY);
      expect(localStorage.removeItem).toHaveBeenCalledWith(SCOPED_ACCEPTED_LEXICON_KEY);
      expect(localStorage.removeItem).toHaveBeenCalledWith(ACCEPTED_LEXICON_STORAGE_KEY);
      expect(localStorage.getItem(SCOPED_NGRAM_KEY)).toBeNull();
      expect(localStorage.getItem(SCOPED_ACCEPTED_LEXICON_KEY)).toBeNull();
      vi.unstubAllGlobals();
    });

    it('suppresses the same provider after repeated rejection in the same context', () => {
      const p = createPredictor(4);
      const doc = '原因是';
      const first = p.getGhostText(doc.length, doc);
      expect(first?.providerId).toBe('phrase-slot');

      p.rejectCompletion('原因是', first!.text);
      expect(p.getGhostText(doc.length, doc)?.providerId).toBe('phrase-slot');

      p.rejectCompletion('原因是', first!.text);
      expect(p.getGhostText(doc.length, doc)?.providerId).not.toBe('phrase-slot');
    });

    it('suppresses the rejected text in the current paragraph only', () => {
      const p = createPredictor(4);
      const firstDoc = '原因是';
      const first = p.getGhostText(firstDoc.length, firstDoc);
      expect(first?.providerId).toBe('phrase-slot');

      p.rejectCompletion('原因是', first!.text);
      p.getGhostText(firstDoc.length, firstDoc);
      p.rejectCompletion('原因是', first!.text);

      const sameParagraph = '这里还需要继续说明。原因是';
      expect(p.getGhostText(sameParagraph.length, sameParagraph)?.text).not.toBe(first!.text);

      const nextParagraph = '这里还需要继续说明。\n\n原因是';
      expect(p.getGhostText(nextParagraph.length, nextParagraph)?.text).toBe(first!.text);
    });
  });

  describe('layered autocomplete attribution', () => {
    beforeEach(() => {
      setupLocalStorageMock();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('marks L1/L2/L3 ngram candidates with sourceLayer', () => {
      const p = createPredictor(2);
      priv(p).l1 = new Map([['o ', new Map([['x', 1]])]]);
      expect(p.getGhostText(3, 'go ')?.sourceLayer).toBe('l1');

      priv(p).l1 = new Map();
      priv(p).l2 = new Map([['o ', new Map([['y', 1]])]]);
      expect(p.getGhostText(3, 'go ')?.sourceLayer).toBe('l2');

      priv(p).l2 = new Map();
      priv(p).l3Word = new Map([['go', new Map([['z', 1]])]]);
      expect(p.getGhostText(3, 'go ')?.sourceLayer).toBe('l3');
    });

    it('prefers L1 over L3 when confidence is close', () => {
      const p = createPredictor(2);
      priv(p).l1 = new Map([
        [
          'o ',
          new Map([
            ['x', 6],
            ['q', 4],
          ]),
        ],
      ]);
      priv(p).l3Word = new Map([
        [
          'go',
          new Map([
            ['z', 7],
            ['q', 3],
          ]),
        ],
      ]);

      const result = p.getGhostText(3, 'go ');
      expect(result?.text).toBe('x');
      expect(result?.sourceLayer).toBe('l1');
    });

    it('allows L3 to win when confidence is clearly higher than L1', () => {
      const p = createPredictor(2);
      priv(p).l1 = new Map([
        [
          'o ',
          new Map([
            ['x', 6],
            ['q', 4],
          ]),
        ],
      ]);
      priv(p).l3Word = new Map([
        [
          'go',
          new Map([
            ['z', 8],
            ['q', 2],
          ]),
        ],
      ]);

      const result = p.getGhostText(3, 'go ');
      expect(result?.text).toBe('z');
      expect(result?.sourceLayer).toBe('l3');
    });

    it('marks short predictions and fixed fallbacks with sourceLayer', () => {
      const p = createPredictor(4);
      priv(p).shortL1 = new Map([['项目', new Map([['复', 1]])]]);
      expect(p.getGhostText(2, '项目')?.sourceLayer).toBe('short-l1');

      priv(p).shortL1 = new Map();
      priv(p).shortL2 = new Map([['项目', new Map([['进', 1]])]]);
      expect(p.getGhostText(2, '项目')?.sourceLayer).toBe('short-l2');

      const fallbackPredictor = createPredictor(4);
      const fallbackDoc = 'This ';
      expect(fallbackPredictor.getGhostText(fallbackDoc.length, fallbackDoc)?.sourceLayer).toBe(
        'fallback',
      );
    });

    it('records metrics by provider and source layer', () => {
      const p = createPredictor(2);
      priv(p).l1 = new Map([['ab', new Map([['x', 1]])]]);

      const result = p.getGhostText(2, 'ab');
      expect(result?.sourceLayer).toBe('l1');
      p.acceptCompletion('ab', result!.text);
      p.rejectCompletion('ab', result!.text);

      const metrics = loadCompletionMetrics();
      expect(metrics.providers.ngram?.shown).toBe(1);
      expect(metrics.providers.ngram?.accepted).toBe(1);
      expect(metrics.providers.ngram?.rejected).toBe(1);
      expect(metrics.layers['ngram:l1']?.shown).toBe(1);
      expect(metrics.layers['ngram:l1']?.accepted).toBe(1);
      expect(metrics.layers['ngram:l1']?.rejected).toBe(1);
      expect(metrics.syntaxTypes['ngram:l1:general']?.shown).toBe(1);
      expect(metrics.syntaxTypes['ngram:l1:general']?.accepted).toBe(1);
      expect(metrics.syntaxTypes['ngram:l1:general']?.rejected).toBe(1);
    });

    it('persists learning signals and exposes a boost for accepted strong contexts', () => {
      const p = createPredictor(2);
      priv(p).l1 = new Map([['ab', new Map([['x', 1]])]]);

      const first = p.getGhostText(2, 'ab');
      expect(first?.text).toBe('x');
      p.acceptCompletion('ab', first!.text);

      const second = p.getGhostText(2, 'ab');
      expect(second?.text).toBe('x');
      p.acceptCompletion('ab', second!.text);

      const third = p.getGhostText(2, 'ab');
      expect(third?.learningBoost).toBeGreaterThan(0);
      expect(localStorage.getItem(learningSignalsStorageKey())).toContain('accepted');
    });

    it('applies persistent learning penalty to repeatedly rejected weak fallback contexts', () => {
      const p = createPredictor(4);
      const doc = 'Risk ';

      const first = p.getGhostText(doc.length, doc);
      expect(first?.sourceLayer).toBe('fallback');
      p.rejectCompletion('Risk', first!.text);

      const second = p.getGhostText(doc.length, doc);
      expect(second?.sourceLayer).toBe('fallback');
      p.rejectCompletion('Risk', second!.text);

      const fresh = createPredictor(4);
      const result = fresh.getGhostText(doc.length, doc);
      expect(result?.learningPenalty).toBeGreaterThan(0);
    });

    it('does not write low-information weak fallback acceptances into L2 ngram history', () => {
      const p = createPredictor(4);
      priv(p).lastPredictionProviderId = 'short-english';
      priv(p).lastPredictionSourceLayer = 'fallback';
      priv(p).lastPredictionSyntaxType = 'short-en';
      priv(p).lastPredictionInformationScore = 0.2;

      p.acceptCompletion('This ', 'note');

      expect(priv(p).l2.size).toBe(0);
      expect(localStorage.getItem(SCOPED_ACCEPTED_LEXICON_KEY)).toContain('note');
    });

    it('clears learning signals with local learning data', () => {
      const p = createPredictor(2);
      priv(p).l1 = new Map([['ab', new Map([['x', 1]])]]);

      const result = p.getGhostText(2, 'ab');
      p.acceptCompletion('ab', result!.text);
      expect(localStorage.getItem(learningSignalsStorageKey())).not.toBeNull();

      p.clearLearningData();
      expect(localStorage.getItem(learningSignalsStorageKey())).toBeNull();
    });

    it('lets high-information L1 candidates beat weak fallback candidates', () => {
      const p = createPredictor(4);
      const doc = 'This ';
      priv(p).l1 = new Map([
        ['his ', new Map([['l', 6]])],
        ['is l', new Map([['o', 6]])],
        ['s lo', new Map([['c', 6]])],
        [' loc', new Map([['a', 6]])],
        ['loca', new Map([['l', 6]])],
      ]);

      const result = p.getGhostText(doc.length, doc);
      expect(result?.providerId).toBe('ngram');
      expect(result?.sourceLayer).toBe('l1');
      expect(result?.text).toBe('local');
    });

    it('does not let low-information L3 fragments beat useful fallback phrases', () => {
      const p = createPredictor(4);
      const doc = 'Risk ';
      priv(p).l3 = new Map([['isk ', new Map([['is', 1]])]]);

      const result = p.getGhostText(doc.length, doc);
      expect(result?.providerId).toBe('short-english');
      expect(result?.sourceLayer).toBe('fallback');
      expect(result?.text).toBe('needs review');
    });
  });

  describe('getGhostText 融合决策', () => {
    it('禁用上下文返回 null', () => {
      const p = createPredictor(4);
      const doc = '---\ntitle: x\n---\ntext';
      // cursor inside frontmatter
      const result = p.getGhostText(8, doc);
      expect(result).toBeNull();
    });

    it('上下文少于 2 字符返回 null', () => {
      const p = createPredictor(4);
      const result = p.getGhostText(1, 'a'); // cursor at pos 1, ctx="a" length=1 < 2
      expect(result).toBeNull();
    });

    it('结构化预测置信度高时优先返回', () => {
      const p = createPredictor(4);
      p.setIndexData(mockIndexData());
      // Scan some content to build L1 N-gram data
      p.scanOpenedDocument('hello world hello world hello world');
      const doc = '[[Hello';
      const result = p.getGhostText(7, doc);
      // Should get structured wiki-link prediction (confidence > 0.8)
      expect(result).not.toBeNull();
      expect(result!.source).toBe('structured');
    });

    it('一般文本触发 N-gram 预测', () => {
      const p = createPredictor(4);
      // Train with repeated pattern
      p.scanOpenedDocument(
        'The quick brown fox jumps. The quick brown fox runs. The quick brown fox sleeps.',
      );
      // Also load into L2 so there's data
      p.ingestExcerpts(['The quick brown fox jumps. The quick brown fox runs.']);
      const doc = 'The quick brown ';
      const result = p.getGhostText(16, doc);
      // With enough context, ngram prediction should produce something
      if (result) {
        expect(result!.source).toBe('ngram');
      }
    });
  });

  describe('offline completion quality gates', () => {
    it('returns a short Chinese fallback for 2-character contexts', () => {
      const p = createPredictor(4);
      const doc = '这是';
      const result = p.getGhostText(doc.length, doc);
      expect(result).not.toBeNull();
      expect(result!.text.length).toBeGreaterThan(0);
      expect(result!.text.length).toBeLessThanOrEqual(6);
      expect(result!.syntaxType).toBe('short-zh');
    });

    it('filters English fragments in Chinese context', () => {
      const p = createPredictor(4);
      p.ingestExcerpts(['用户输入alphabeta 用户输入alphabeta 用户输入alphabeta']);
      const doc = '用户输入';
      const result = p.getGhostText(doc.length, doc);
      expect(result?.text ?? '').not.toMatch(/^[A-Za-z]/);
    });

    it('filters Chinese fragments in English context', () => {
      const p = createPredictor(4);
      p.ingestExcerpts(['When the line 文件大小 When the line 文件大小 When the line 文件大小']);
      const doc = 'When ';
      const result = p.getGhostText(doc.length, doc);
      expect(result?.text ?? '').not.toMatch(/[\u3400-\u9fff]/u);
    });

    it('uses the nearest English segment in mixed technical writing without emitting mixed text', async () => {
      const { scanWordText } = await import('@/utils/word-ngram-engine');
      const p = createPredictor(4);
      priv(p).l3Word = scanWordText('API result before. API result before.');
      const doc = '这里的 API ';

      expect(p.getGhostText(doc.length, doc)).toMatchObject({
        text: 'result',
        sourceLayer: 'l3',
        syntaxType: 'word-en',
      });
    });

    it('rejects polluted English history that would produce CJK after "is"', () => {
      const p = createPredictor(4);
      p.ingestExcerpts([
        'Release risk is可以 Release risk is可以 Release risk is可以 Release risk is可以',
      ]);
      const doc = 'Release risk is';
      const result = p.getGhostText(doc.length, doc);
      expect(result?.text ?? '').not.toMatch(/[\u3400-\u9fff]/u);
    });

    it('does not use generic 可以 as a fixed conclusion fallback', () => {
      const p = createPredictor(4);
      const doc = '结论是';
      const result = p.getGhostText(doc.length, doc);
      expect(result?.text ?? '').not.toBe('可以');
    });

    it('keeps common note phrase fallbacks available', () => {
      const p = createPredictor(4);
      const doc = '下一步';
      const result = p.getGhostText(doc.length, doc);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('继续');
      expect(result!.syntaxType).toBe('phrase-slot');
    });

    it('keeps common English short fallbacks available', () => {
      const p = createPredictor(4);
      const doc = 'Project ';
      const result = p.getGhostText(doc.length, doc);
      expect(result).not.toBeNull();
      expect(result!.text).toBe('status note');
      expect(result!.syntaxType).toBe('short-en');
    });

    it('keeps software English short fallbacks ahead of generic ngram prose', () => {
      const p = createPredictor(4);
      p.ingestExcerpts([
        'When debugging the can use noise. When debugging the can use noise. When debugging the can use noise.',
      ]);

      const debugDoc = 'When debugging ';
      const debugResult = p.getGhostText(debugDoc.length, debugDoc);
      expect(debugResult).not.toBeNull();
      expect(debugResult!.text).toBe('the issue');
      expect(debugResult!.syntaxType).toBe('short-en');

      const statusDoc = 'Project status ';
      const statusResult = p.getGhostText(statusDoc.length, statusDoc);
      expect(statusResult).not.toBeNull();
      expect(statusResult!.text).toBe('is ready');
      expect(statusResult!.syntaxType).toBe('short-en');
    });

    it('suppresses web CTA contexts from N-gram suggestions', () => {
      const p = createPredictor(4);
      p.ingestExcerpts([
        'read more and then continue read more and then continue read more and then continue',
        'sign up date and follow sign up date and follow sign up date and follow',
      ]);

      expect(p.getGhostText('read more'.length, 'read more')).toBeNull();
      expect(p.getGhostText('sign up'.length, 'sign up')).toBeNull();
    });

    it('respects settings.enabled=false', () => {
      const p = createPredictor(4);
      p.configure({ enabled: false });
      expect(p.getGhostText(2, '这是')).toBeNull();
    });

    it('suppresses prose suggestions after sentence punctuation', () => {
      const p = createPredictor(2);
      p.scanOpenedDocument('这是。继续\n这是。继续\n这是。继续\n');
      const doc = '这是。';
      expect(p.getGhostText(doc.length, doc)).toBeNull();
    });

    it('suppresses non-structured suggestions that would cross lines', () => {
      const p = createPredictor(4);
      p.scanOpenedDocument('abcd\nabcd\nabcd\nabcd\n');
      const doc = 'abcd';
      expect(p.getGhostText(doc.length, doc)).toBeNull();
    });
  });

  // ============ 持久化 ============

  describe('持久化: save / load / closeDocument', () => {
    beforeEach(() => {
      setupLocalStorageMock();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('scanOpenedDocument + closeDocument 不把正文写入 Personal L2', () => {
      const p = createPredictor(4);
      p.setIndexData(mockIndexData());
      const rep = Array.from({ length: 20 }, () => 'hello world').join(' ');
      p.scanOpenedDocument(rep);
      p.closeDocument();

      expect(priv(p).l2.size).toBe(0);
      expect(localStorage.getItem(SCOPED_NGRAM_KEY)).toBeNull();
    });

    it('loadFromLocalStorage 只恢复显式接受形成的 Personal L2', () => {
      const p1 = createPredictor(4);
      p1.acceptCompletion('hell', 'o world');

      const p2 = createPredictor(4);
      priv(p2).loadFromLocalStorage();
      expect(priv(p2).l2.size).toBeGreaterThan(0);
    });

    it('serializes concurrent-tab acceptance events without losing either update', async () => {
      vi.stubGlobal('navigator', {
        locks: {
          request: vi.fn(async (_name: string, callback: () => unknown) => callback()),
        },
      });
      const first = createPredictor(4);
      const second = createPredictor(4);

      first.acceptCompletion('aaaa', ' first');
      second.acceptCompletion('bbbb', ' second');
      await flushCompletionStorageMutationsForTests();

      const reloaded = createPredictor(4);
      priv(reloaded).loadFromLocalStorage();
      expect(priv(reloaded).l2.has('aaaa')).toBe(true);
      expect(priv(reloaded).l2.has('bbbb')).toBe(true);
    });

    it('isolates personal learning and clearing between workspace scopes', async () => {
      const predictor = createPredictor(4);
      predictor.setStorageScope('workspace-a');
      predictor.acceptCompletion('aaaa', ' first');
      await flushCompletionStorageMutationsForTests();

      predictor.setStorageScope('workspace-b');
      expect(priv(predictor).l2.has('aaaa')).toBe(false);
      predictor.acceptCompletion('bbbb', ' second');
      await flushCompletionStorageMutationsForTests();

      predictor.setStorageScope('workspace-a');
      expect(priv(predictor).l2.has('aaaa')).toBe(true);
      expect(priv(predictor).l2.has('bbbb')).toBe(false);
      predictor.clearLearningData();
      await flushCompletionStorageMutationsForTests();

      predictor.setStorageScope('workspace-b');
      expect(priv(predictor).l2.has('bbbb')).toBe(true);
    });

    it('does not reload a stale personal snapshot while a newer acceptance is pending', async () => {
      const releases: Array<() => void> = [];
      vi.stubGlobal('navigator', {
        locks: {
          request: vi.fn(async (name: string, callback: () => unknown) => {
            if (!name.includes(':personal:')) return callback();
            await new Promise<void>((resolve) => releases.push(resolve));
            return callback();
          }),
        },
      });
      const predictor = createPredictor(4);

      predictor.acceptCompletion('aaaa', ' first');
      await vi.waitFor(() => expect(releases).toHaveLength(1));
      releases.shift()?.();
      await flushCompletionStorageMutationsForTests();

      predictor.acceptCompletion('bbbb', ' second');
      expect(predictor.getGhostText(4, 'bbbb')).toMatchObject({
        text: ' second',
        sourceLayer: 'l2',
      });
      await vi.waitFor(() => expect(releases).toHaveLength(1));
      releases.shift()?.();
      await flushCompletionStorageMutationsForTests();
    });

    it('initialize 在 L3 不可用时仍恢复 Personal L2', async () => {
      const p1 = createPredictor(4);
      p1.acceptCompletion('test', ' content');

      const p2 = createPredictor(4);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new Error('no network'))),
      );
      await p2.initialize();
      expect(priv(p2).l2.size).toBeGreaterThan(0);
      vi.unstubAllGlobals();
      setupLocalStorageMock();
    });

    it('v4 migration discards aggregated n-gram but preserves the legal accepted lexicon', () => {
      localStorage.setItem('jotluck:ngram:v2', 'legacy aggregated body');
      localStorage.setItem('jotluck:ngram:short:v1', 'legacy short body');
      localStorage.setItem('jotluck:ngram:meta', JSON.stringify({ schemaVersion: 2 }));
      localStorage.setItem(ACCEPTED_LEXICON_STORAGE_KEY, JSON.stringify(['owner review']));

      const p = createPredictor(4);
      p.setStorageScope('notebook-a');
      priv(p).loadFromLocalStorage();

      expect(priv(p).l2.size).toBe(0);
      expect(priv(p).personalShort2.size).toBe(0);
      expect(priv(p).personalShort3.size).toBe(0);
      expect(priv(p).acceptedLexicon).toEqual(['owner review']);
      expect(localStorage.getItem('jotluck:ngram:v2')).toBeNull();
      expect(localStorage.getItem(ACCEPTED_LEXICON_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem('jotluck:scope:notebook-a:autocomplete:acceptedLexicon:v1')).toBe(
        JSON.stringify(['owner review']),
      );
    });

    it('forceEliminate 在 5000 entries 下 200ms 内覆盖 long/short2/short3', () => {
      const p = createPredictor(4);
      const long = new Map<string, Map<string, number>>();
      const short2 = new Map<string, Map<string, number>>();
      const short3 = new Map<string, Map<string, number>>();
      for (let index = 0; index < 4000; index++) {
        long.set(`x${index.toString(36).padStart(3, '0')}`, new Map([['a', 1]]));
      }
      for (let index = 0; index < 500; index++) {
        short2.set(String.fromCodePoint(0x4e00 + index, 0x600 + index), new Map([['甲', 1]]));
        short3.set(
          String.fromCodePoint(0x4e00 + index, 0x600 + index, 0x900 + index),
          new Map([['乙', 1]]),
        );
      }
      priv(p).l2 = long;
      priv(p).personalShort2 = short2;
      priv(p).personalShort3 = short3;
      priv(p).rebuildPersonalShortTable();

      const startedAt = performance.now();
      priv(p).forceEliminate(1024);
      const elapsed = performance.now() - startedAt;

      expect(elapsed).toBeLessThanOrEqual(200);
      expect(priv(p).l2.size).toBeLessThan(4000);
      expect(priv(p).personalShort2.size).toBeLessThan(500);
      expect(priv(p).personalShort3.size).toBeLessThan(500);
    });
  });

  // ============ 边界 ============

  describe('边界', () => {
    afterEach(() => {
      resetBaselineLoaderForTests();
      vi.unstubAllGlobals();
    });

    it('constructor 设置 n 值', () => {
      const p = createPredictor(5);
      expect(priv(p).n).toBe(5);
    });

    it('默认 constructor n=4', () => {
      const p = new MarkdownPredictor();
      expect(priv(p).n).toBe(4);
    });

    it('loadBaseline fetch 失败时不崩溃', async () => {
      const p = createPredictor(4);
      const fetcher = vi.fn(() => Promise.reject(new Error('network error')));
      configureBaselineLoaderForTests({ fetcher: fetcher as unknown as typeof fetch, cache: null });
      await p.loadBaseline();
      expect(priv(p).l3.size).toBe(0);
    });

    it('loadBaseline fetch 成功时加载基准数据', async () => {
      const p = createPredictor(4);
      const { serialize, scanText } = await import('@/utils/ngram-engine');
      const table = scanText('hello world', 4);
      const compact = serialize(table);
      const manifest = baselineManifest(compact, table.size);
      const fetcher = vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(url.endsWith('.manifest.json') ? manifest : compact),
        } as Response),
      );
      configureBaselineLoaderForTests({
        fetcher: fetcher as unknown as typeof fetch,
        cache: null,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });
      await p.loadBaseline();
      expect(fetcher).toHaveBeenCalledWith('/baseline-ngram.web-local.compact.manifest.json');
      expect(fetcher).toHaveBeenCalledWith('/baseline-ngram.web-local.compact.txt');
      expect(priv(p).l3.size).toBeGreaterThan(0);
      expect(priv(p).entryFlags.size).toBe(0);
    });

    it('rejects an unreleased sectioned candidate in the production loader', async () => {
      const { mergeInto, scanText } = await import('@/utils/ngram-engine');
      const { scanWordText, serializeBaselineTables } = await import('@/utils/word-ngram-engine');
      const character = scanText('这是测试完成', 4);
      mergeInto(character, scanText('这是测试完成', 3));
      mergeInto(character, scanText('这是测试完成', 2));
      const word = scanWordText('Compare the result before release.');
      const compact = serializeBaselineTables({ character, word });
      const manifest = JSON.stringify({
        schemaVersion: 2,
        profile: 'web-local',
        modelFile: 'baseline-ngram.web-local.compact.txt',
        serialization: 'sectioned-jsonl-hex-v4',
        order: 'section-profile-context-hex',
        ngramN: 4,
        minNgramN: 2,
        wordNgramOrders: [1, 2],
        countScale: 1000,
        modelBytes: new TextEncoder().encode(compact).byteLength,
        entryCount: character.size + word.size,
        characterEntryCount: character.size,
        wordEntryCount: word.size,
        sha256: TEST_BASELINE_HASH,
        trainingInputHash: 'b'.repeat(64),
        verifiedOnly: true,
        runtimeEligible: true,
        qualityGatePassed: false,
        releaseEligible: false,
        hardLimitPassed: true,
      });
      const fetcher = vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(url.endsWith('.manifest.json') ? manifest : compact),
        } as Response),
      );
      configureBaselineLoaderForTests({
        fetcher: fetcher as unknown as typeof fetch,
        cache: null,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });
      const predictor = createPredictor(4);

      await predictor.loadBaseline();

      expect(priv(predictor).l3.size).toBe(0);
      expect(priv(predictor).l3Word.size).toBe(0);
      expect(predictor.getBaselineParseDiagnostics().chunks).toBe(0);
      expect(predictor.getLoadedBaselineIdentity()).toBeNull();
    });

    it('does not fall through to a second public model when the canonical model fails', async () => {
      const p = createPredictor(4);
      const fetchSpy = vi.fn(() => Promise.resolve({ ok: false } as Response));
      configureBaselineLoaderForTests({
        fetcher: fetchSpy as unknown as typeof fetch,
        cache: null,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });
      await p.loadBaseline();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith('/baseline-ngram.web-local.compact.manifest.json');
      expect(priv(p).l3.size).toBe(0);
    });

    it('rejects an oversized manifest before downloading its model body', async () => {
      const oversizedManifest = JSON.stringify({
        ...JSON.parse(baselineManifest('x', 1)),
        modelBytes: 7 * 1024 * 1024,
      });
      const fetcher = vi.fn((url: string) => {
        if (url === '/baseline-ngram.web-local.compact.manifest.json') {
          return Promise.resolve({ ok: true, text: async () => oversizedManifest } as Response);
        }
        return Promise.resolve({ ok: false } as Response);
      });
      configureBaselineLoaderForTests({
        fetcher: fetcher as unknown as typeof fetch,
        cache: null,
      });

      const predictor = createPredictor(4);
      await predictor.loadBaseline();

      expect(fetcher).not.toHaveBeenCalledWith('/baseline-ngram.web-local.compact.txt');
      expect(predictor.getLoadedBaselineIdentity()).toBeNull();
    });

    it('does not silently load a governance-ineligible legacy baseline', async () => {
      const ineligibleManifest = JSON.stringify({
        ...JSON.parse(baselineManifest('x', 1)),
        runtimeEligible: false,
      });
      const fetcher = vi.fn((url: string) => {
        if (url === '/baseline-ngram.web-local.compact.manifest.json') {
          return Promise.resolve({ ok: true, text: async () => ineligibleManifest } as Response);
        }
        return Promise.resolve({ ok: false } as Response);
      });
      configureBaselineLoaderForTests({
        fetcher: fetcher as unknown as typeof fetch,
        cache: null,
      });

      await createPredictor(4).loadBaseline();

      expect(fetcher).not.toHaveBeenCalledWith('/baseline-ngram.web-local.compact.txt');
    });

    it('rejects a manifest-valid model whose context length does not match n', async () => {
      const { serialize, scanText } = await import('@/utils/ngram-engine');
      const compact = serialize(scanText('short context model', 2));
      const manifest = baselineManifest(compact, scanText('short context model', 2).size);
      const fetcher = vi.fn((url: string) => {
        if (url.includes('web-local')) {
          return Promise.resolve({
            ok: true,
            text: async () => (url.endsWith('.manifest.json') ? manifest : compact),
          } as Response);
        }
        return Promise.resolve({ ok: false } as Response);
      });
      configureBaselineLoaderForTests({
        fetcher: fetcher as unknown as typeof fetch,
        cache: null,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });
      const predictor = createPredictor(4);

      await predictor.loadBaseline();

      expect(priv(predictor).l3.size).toBe(0);
    });

    it('writes a verified network baseline through the injectable cache adapter', async () => {
      const { serialize, scanText } = await import('@/utils/ngram-engine');
      const table = scanText('cache baseline works', 4);
      const compact = serialize(table);
      const manifest = baselineManifest(compact, table.size);
      const cache = { read: vi.fn(async () => null), write: vi.fn(async () => undefined) };
      const fetcher = vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(url.endsWith('.manifest.json') ? manifest : compact),
        } as Response),
      );
      configureBaselineLoaderForTests({
        fetcher: fetcher as unknown as typeof fetch,
        cache,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });

      await createPredictor(4).loadBaseline();
      expect(cache.write).toHaveBeenCalledTimes(1);
      expect(cache.read).not.toHaveBeenCalled();
    });

    it('uses and revalidates cached baseline when network fails', async () => {
      const { serialize, scanText } = await import('@/utils/ngram-engine');
      const table = scanText('offline cache baseline works', 4);
      const compact = serialize(table);
      const manifest = baselineManifest(compact, table.size);
      const cache = {
        read: vi.fn(async () => ({ manifest, model: compact })),
        write: vi.fn(async () => undefined),
      };
      configureBaselineLoaderForTests({
        fetcher: vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
        cache,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });
      const predictor = createPredictor(4);

      await predictor.loadBaseline();
      expect(priv(predictor).l3.size).toBe(table.size);
      expect(cache.read).toHaveBeenCalledTimes(1);
    });

    it('rejects a bad cached canonical model without consulting another model path', async () => {
      const cache = {
        read: vi.fn(async () => ({ manifest: baselineManifest('broken', 1), model: 'broken' })),
        write: vi.fn(async () => undefined),
      };
      configureBaselineLoaderForTests({
        fetcher: vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
        cache,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });
      const predictor = createPredictor(4);

      await predictor.loadBaseline();
      expect(priv(predictor).l3.size).toBe(0);
      expect(cache.read).toHaveBeenCalledTimes(1);
    });

    it('shares one verified L3 load across predictor instances', async () => {
      const { serialize, scanText } = await import('@/utils/ngram-engine');
      const table = scanText('application singleton baseline', 4);
      const compact = serialize(table);
      const manifest = baselineManifest(compact, table.size);
      const fetcher = vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          text: () => Promise.resolve(url.endsWith('.manifest.json') ? manifest : compact),
        } as Response),
      );
      configureBaselineLoaderForTests({
        fetcher: fetcher as unknown as typeof fetch,
        cache: null,
        sha256: async () => TEST_BASELINE_HASH,
        minEntryCount: 1,
      });

      await Promise.all([createPredictor(4).loadBaseline(), createPredictor(4).loadBaseline()]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('initialize 恢复 Personal L2 且架构停止态不探测公共模型', async () => {
      setupLocalStorageMock();
      const p1 = createPredictor(4);
      p1.acceptCompletion('hell', 'o world');

      // Verify storage has data before proceeding
      const stored = localStorage.getItem(SCOPED_NGRAM_KEY);
      expect(stored).not.toBeNull();
      expect(stored!.length).toBeGreaterThan(0);

      const fetchSpy = vi.fn(() => Promise.reject(new Error('no baseline')));
      vi.stubGlobal('fetch', fetchSpy);

      const p2 = createPredictor(4);
      await p2.initialize();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(priv(p2).l2.size).toBeGreaterThan(0);

      vi.unstubAllGlobals();
    });

    it('ingestExcerpts 仅添加标题 lexicon，不进入 N2 或 Personal L2', () => {
      const p = createPredictor(4);
      p.ingestExcerpts(['Release Notes']);
      expect(priv(p).excerptLexicon).toContain('Release Notes');
      expect(priv(p).notebookLong.size).toBe(0);
      expect(priv(p).notebookShort2.size).toBe(0);
      expect(priv(p).notebookShort3.size).toBe(0);
      expect(priv(p).l2.size).toBe(0);
    });

    it('ingestExcerpts 跳过过短的摘录', () => {
      const p = createPredictor(4);
      p.ingestExcerpts(['x']);
      expect(priv(p).excerptLexicon).toEqual([]);
    });

    it('setIndexData 存储引用', () => {
      const p = createPredictor(4);
      const data = mockIndexData();
      p.setIndexData(data);
      expect(priv(p).indexData).toBe(data);
    });
  });

  // ============ accept / reject / scan ============

  describe('acceptCompletion / rejectCompletion / scanOpenedDocument', () => {
    it('acceptCompletion 学习并更新 L1+L2', () => {
      const p = createPredictor(4);
      p.scanOpenedDocument('hello');
      const l1Before = priv(p).l1.size;
      p.acceptCompletion('hell', 'o world');
      // L1 should grow
      expect(priv(p).l1.size).toBeGreaterThanOrEqual(l1Before);
    });

    it('acceptCompletion can record structured acceptance without learning', () => {
      setupLocalStorageMock();
      try {
        const p = createPredictor(4);
        p.setIndexData(mockIndexData());
        const result = p.getGhostText('[[Hello'.length, '[[Hello');
        const l2Before = priv(p).l2.size;

        p.acceptCompletion('ello', result?.text ?? '', { learn: false });

        expect(priv(p).l2.size).toBe(l2Before);
        const metrics = loadCompletionMetrics();
        expect(metrics.providers['wiki-link']?.accepted).toBe(1);
        expect(metrics.layers['wiki-link:provider']?.accepted).toBe(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('rejectCompletion 降级权重不抛出', () => {
      const p = createPredictor(4);
      p.scanOpenedDocument('hello world');
      // Rejecting a known context
      expect(() => p.rejectCompletion('hell', 'o')).not.toThrow();
    });

    it('scanOpenedDocument 构建 L1 表', () => {
      const p = createPredictor(4);
      p.scanOpenedDocument('hello world, hello universe');
      expect(priv(p).l1.size).toBeGreaterThan(0);
    });

    it('scanOpenedDocument 替换而非累加旧 L1', () => {
      const p = createPredictor(4);
      p.scanOpenedDocument('first document text here');
      const size1 = priv(p).l1.size;
      p.scanOpenedDocument('second doc'); // should replace, not merge
      const size2 = priv(p).l1.size;
      // Smaller doc → smaller table
      expect(size2).toBeLessThan(size1);
    });
  });

  describe('Notebook N2 budgets', () => {
    it('rejects oversized synchronous N2 work and exposes bounded diagnostics', () => {
      const p = createPredictor(4);
      p.replaceDocumentContribution('/large.md', '界'.repeat(30_000));

      expect(p.hasDocumentContribution('/large.md')).toBe(true);
      expect(p.getNotebookModelDiagnostics()).toMatchObject({
        documentCount: 1,
        inputBytes: 0,
        entryCount: 0,
        budgetRejections: 1,
        longTasksOver50Ms: 0,
      });
    });
  });

  describe('Completion Engine V2 async request', () => {
    it('exposes read-only production diagnostics without recording shown or learning events', async () => {
      const p = new MarkdownPredictor(
        4,
        new HybridRetrievalService({ backend: new LocalHybridRetrievalBackend() }),
      );
      p.setStorageScope('diagnostic-scope');
      p.replaceDocumentContribution('/a.md', 'Project plan needs careful review.');
      p.replaceDocumentContribution('/b.md', 'Project plan needs careful review.');
      await vi.waitFor(() => expect(p.getHybridRetrievalHealth().pendingMutations).toBe(0));
      const metricsBefore = JSON.stringify(loadCompletionMetrics('diagnostic-scope'));
      const signalsBefore = localStorage.getItem(learningSignalsStorageKey('diagnostic-scope'));

      const first = await p.requestGhostTextWithDiagnostics('Project plan'.length, 'Project plan');
      const second = await p.requestGhostTextWithDiagnostics('Project plan'.length, 'Project plan');

      expect(first.result).toMatchObject({
        text: ' needs',
        providerId: 'hybrid-retrieval-en',
      });
      expect(first.result?.feedbackToken).toBeUndefined();
      expect(first.rankedCandidates.length).toBeLessThanOrEqual(8);
      expect(first.rankedCandidates[0]?.providerId).toBe('hybrid-retrieval-en');
      expect(first.resolverTrace.rawCandidates).toBeGreaterThan(0);
      expect(first.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(first.hybrid).toMatchObject({ attempted: true, timedOut: false, fellBack: false });
      expect(first.hybrid.health).toMatchObject({
        backendKind: 'local-test',
        workspaceScope: 'diagnostic-scope',
        status: 'ready',
      });
      expect(second.result?.text).toBe(first.result?.text);
      expect(JSON.stringify(loadCompletionMetrics('diagnostic-scope'))).toBe(metricsBefore);
      expect(localStorage.getItem(learningSignalsStorageKey('diagnostic-scope'))).toBe(
        signalsBefore,
      );
    });

    it('reports an actual Hybrid deadline fallback through the production request path', async () => {
      const backend: HybridRetrievalBackend = {
        execute(request): Promise<HybridRetrievalResponse> {
          if (request.operation === 'query') {
            return new Promise(() => undefined);
          }
          return Promise.resolve({
            operation: request.operation,
            changed: true,
            documentCount: 0,
            revision: 0,
          });
        },
        dispose() {},
      };
      const p = new MarkdownPredictor(4, new HybridRetrievalService({ backend }));

      const diagnostics = await p.requestGhostTextWithDiagnostics(
        'Project plan'.length,
        'Project plan',
        { deadlineMs: 1 },
      );

      expect(diagnostics.hybrid).toMatchObject({
        attempted: true,
        timedOut: true,
        fellBack: true,
      });
      expect(Number.isFinite(diagnostics.elapsedMs)).toBe(true);
      expect(diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('merges workspace phrase retrieval before the common Resolver', async () => {
      const p = new MarkdownPredictor(
        4,
        new HybridRetrievalService({ backend: new LocalHybridRetrievalBackend() }),
      );
      p.setStorageScope('workspace-v2');
      p.replaceDocumentContribution('/a.md', '项目计划需要复核风险。');
      p.replaceDocumentContribution('/b.md', '项目计划需要复核风险。');
      await vi.waitFor(() => expect(p.getHybridRetrievalHealth().pendingMutations).toBe(0));

      const result = await p.requestGhostText('项目计划'.length, '项目计划');

      expect(result).toMatchObject({
        text: '需要复核风险。',
        providerId: 'hybrid-retrieval-zh',
        sourceLayer: 'notebook',
        syntaxType: 'phrase-retrieval',
      });
    });

    it('keeps hybrid notebook retrieval out of non-L2 ablation modes', async () => {
      const execute = vi.fn(
        async (request: Parameters<HybridRetrievalBackend['execute']>[0]) =>
          ({
            operation: request.operation,
            ...(request.operation === 'query'
              ? { candidates: [], committedRevision: 0, pendingMutations: 0, warming: false }
              : { changed: true, documentCount: 0, revision: 0 }),
          }) as HybridRetrievalResponse,
      );
      const backend: HybridRetrievalBackend = { execute, dispose() {} };
      const p = new MarkdownPredictor(4, new HybridRetrievalService({ backend }));
      p.setAblationMode('l3-only');

      await p.requestGhostText('项目计划'.length, '项目计划');

      expect(execute.mock.calls.some(([request]) => request.operation === 'query')).toBe(false);
    });

    it('does not carry notebook retrieval across an empty paragraph', async () => {
      const execute = vi.fn(
        async (request: Parameters<HybridRetrievalBackend['execute']>[0]) =>
          ({
            operation: request.operation,
            ...(request.operation === 'query'
              ? { candidates: [], committedRevision: 0, pendingMutations: 0, warming: false }
              : { changed: true, documentCount: 0, revision: 0 }),
          }) as HybridRetrievalResponse,
      );
      const backend: HybridRetrievalBackend = { execute, dispose() {} };
      const p = new MarkdownPredictor(4, new HybridRetrievalService({ backend }));
      const doc = '风从远处\n\n';

      await p.requestGhostText(doc.length, doc);

      expect(execute.mock.calls.some(([request]) => request.operation === 'query')).toBe(false);
    });

    it('returns no async result after cancellation', async () => {
      const p = createPredictor(4);
      const controller = new AbortController();
      controller.abort('superseded');

      await expect(
        p.requestGhostText('项目计划'.length, '项目计划', { signal: controller.signal }),
      ).resolves.toBeNull();
    });

    it('drops an old-workspace request instead of attributing it to the new scope', async () => {
      let resolveQuery: ((response: HybridRetrievalResponse) => void) | null = null;
      const backend: HybridRetrievalBackend = {
        execute(request): Promise<HybridRetrievalResponse> {
          if (request.operation === 'query') {
            return new Promise((resolve) => {
              resolveQuery = resolve;
            });
          }
          return Promise.resolve({
            operation: request.operation,
            changed: true,
            documentCount: 0,
            revision: 0,
          });
        },
        dispose() {},
      };
      const p = new MarkdownPredictor(4, new HybridRetrievalService({ backend }));
      p.setStorageScope('workspace-a');
      const pending = p.requestGhostText('下一步'.length, '下一步');
      await vi.waitFor(() => expect(resolveQuery).not.toBeNull());

      p.setStorageScope('workspace-b');
      const resolve = resolveQuery as ((response: HybridRetrievalResponse) => void) | null;
      resolve?.({
        operation: 'query',
        candidates: [],
        committedRevision: 0,
        pendingMutations: 0,
        warming: false,
      });

      await expect(pending).resolves.toBeNull();
      expect(loadCompletionMetrics('workspace-b').providers['phrase-slot']?.shown ?? 0).toBe(0);
    });

    it('drops retrieval candidates that finish after the soft deadline', async () => {
      let now = 0;
      const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
      try {
        const backend: HybridRetrievalBackend = {
          execute(request): Promise<HybridRetrievalResponse> {
            if (request.operation === 'query') {
              now = 10;
              return Promise.resolve({
                operation: 'query',
                candidates: [
                  {
                    text: '需要确认。',
                    confidence: 0.9,
                    support: 2,
                    documentSupport: 2,
                    providerId: 'hybrid-retrieval-zh',
                    sourceLayer: 'notebook',
                  },
                ],
                committedRevision: 0,
                pendingMutations: 0,
                warming: false,
              });
            }
            return Promise.resolve({
              operation: request.operation,
              changed: true,
              documentCount: 0,
              revision: 0,
            });
          },
          dispose() {},
        };
        const p = new MarkdownPredictor(4, new HybridRetrievalService({ backend }));

        const result = await p.requestGhostText('下一步'.length, '下一步', { deadlineMs: 5 });

        expect(result?.providerId).not.toBe('hybrid-retrieval-zh');
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('keeps the single public engine slot unbound by default', async () => {
      const predictor = new MarkdownPredictor();

      await expect(predictor.warmupPublicEngine()).resolves.toBe(false);
      expect(predictor.getPublicEngineDiagnostics()).toBeNull();

      await predictor.dispose();
    });

    it('merges an explicitly injected public candidate through the existing resolver', async () => {
      const generate = vi.fn<CompletionPublicEngine['generate']>(async (request) => ({
        protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
        engineEpoch: request.engineEpoch,
        workspaceScope: request.workspaceScope,
        documentVersion: request.documentVersion,
        cursorPos: request.cursorPos,
        candidates: [
          {
            candidateId: 'candidate-en-review',
            text: ' reviewed',
            confidence: 0.96,
            modelScore: 0.94,
            gateScore: 0.98,
            language: 'en',
          },
        ],
      }));
      const publicEngine: CompletionPublicEngine = {
        id: TEST_PUBLIC_ENGINE_ID,
        protocolVersion: PUBLIC_ENGINE_PROTOCOL_VERSION,
        sourceKind: 'ngram',
        maxOutputCodePoints: PUBLIC_ENGINE_MAX_OUTPUT_CODE_POINTS,
        warmup: async () => true,
        generate,
        diagnostics: () => ({
          engineId: TEST_PUBLIC_ENGINE_ID,
          backendKind: 'worker',
          status: 'ready',
          epoch: 1,
          profile: 'web-local',
          lastError: null,
          warmupDurationMs: 1,
          lastInferenceDurationMs: 1,
          visibleInferenceP90Ms: 1,
          generateRequests: 1,
          generatedCandidates: 1,
          cancellations: 0,
          deadlineExpirations: 0,
          lateResponses: 0,
          invalidResponses: 0,
          workerErrors: 0,
          assets: createEmptyPublicEngineAssetDiagnostics(),
        }),
        dispose: () => undefined,
      };
      const p = new MarkdownPredictor(4, undefined, publicEngine);
      p.setAblationMode('l3-only');
      await expect(p.warmupPublicEngine()).resolves.toBe(true);

      const diagnostics = await p.requestGhostTextWithDiagnostics(
        'Project plan'.length,
        'Project plan',
      );

      expect(diagnostics.result).toMatchObject({
        text: ' reviewed',
        providerId: TEST_PUBLIC_ENGINE_ID,
        source: 'ngram',
        sourceLayer: 'l3',
      });
      expect(diagnostics.publicEngine).toMatchObject({
        attempted: true,
        fellBack: false,
        usedEngineId: TEST_PUBLIC_ENGINE_ID,
      });
      expect(generate).toHaveBeenCalledOnce();
      await p.dispose();
    });

    it('binds feedback to the shown prediction token instead of mutable last-prediction state', () => {
      setupLocalStorageMock();
      try {
        const p = createPredictor(4);
        p.setIndexData(mockIndexData());
        const wiki = p.getGhostText('[[Hello'.length, '[[Hello');
        const tag = p.getGhostText('#rea'.length, '#rea');

        expect(wiki?.feedbackToken).toBeTruthy();
        expect(tag?.feedbackToken).toBeTruthy();
        p.acceptCompletion('ello', wiki?.text ?? '', {
          learn: false,
          feedbackToken: wiki?.feedbackToken,
        });

        const metrics = loadCompletionMetrics();
        expect(metrics.providers['wiki-link']?.accepted).toBe(1);
        expect(metrics.providers['tag']?.accepted ?? 0).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('does not fall back to the latest candidate when an explicit feedback token is invalid', () => {
      setupLocalStorageMock();
      try {
        const p = createPredictor(4);
        p.setIndexData(mockIndexData());
        p.getGhostText('[[Hello'.length, '[[Hello');
        p.getGhostText('#rea'.length, '#rea');

        p.acceptCompletion('ello', ' World]]', {
          learn: false,
          feedbackToken: 'missing-token',
        });

        const metrics = loadCompletionMetrics();
        expect(metrics.providers['wiki-link']?.accepted ?? 0).toBe(0);
        expect(metrics.providers['tag']?.accepted ?? 0).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
