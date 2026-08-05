import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPLETION_SETTINGS } from '../../CompletionSettings';
import {
  createPublicFreeContextCapsule,
  isPublicEngineContextCapsule,
  serializePublicFreeContextCapsule,
} from '../public-free-context-capsule';
import type { CompletionContext } from '../types';

function context(): CompletionContext {
  return {
    doc: '今天先完成运行时',
    documentFrom: 0,
    documentRevision: 3,
    cursorPos: 8,
    localCursorPos: 8,
    line: {
      text: '今天先完成运行时',
      beforeCursor: '今天先完成运行时',
      from: 0,
      to: 8,
      cursorColumn: 8,
    },
    syntax: { type: 'general', prefix: '' },
    settings: DEFAULT_COMPLETION_SETTINGS,
    indexData: null,
    n: 4,
    disabled: false,
    emptyLine: false,
    atEndOfLine: true,
    languageHint: 'zh',
    blockType: 'paragraph',
    paragraphBeforeCursor: '今天先完成运行时',
    paragraphStart: 0,
    sentencePrefix: '今天先完成运行时',
    recentTokens: [],
    contextSnapshot: {
      documentRevision: 3,
      cursor: 8,
      nodePath: ['Paragraph', 'Document'],
      blockType: 'paragraph',
      headingTrail: ['计划', '执行'],
      line: null,
      currentParagraph: {
        from: 0,
        to: 8,
        text: '今天先完成运行时',
        truncatedBefore: false,
        truncatedAfter: false,
      },
      previousParagraph: {
        from: 0,
        to: 3,
        text: '上一段',
        truncatedBefore: false,
        truncatedAfter: false,
      },
      documentWindow: {
        from: 0,
        to: 8,
        text: '今天先完成运行时',
        truncatedBefore: false,
        truncatedAfter: false,
      },
      syntax: { type: 'general', prefix: '' },
      languageHint: 'zh',
      disabled: false,
      emptyLine: false,
      atEndOfLine: true,
      compositionStable: true,
    },
  };
}

describe('public free decoder context capsule', () => {
  it('matches the Rust golden and carries content without path metadata', () => {
    const capsule = createPublicFreeContextCapsule(context(), '检索内容');
    expect(serializePublicFreeContextCapsule(capsule)).toBe(
      '<heading>计划</heading>\n<heading>执行</heading>\n<previous>上一段</previous>\n<retrieval>检索内容</retrieval>\n<current>今天先完成运行时</current>',
    );
    expect(capsule).not.toHaveProperty('path');
    expect(isPublicEngineContextCapsule(capsule)).toBe(true);
  });

  it('bounds hostile large segments before crossing the worker boundary', () => {
    const capsule = createPublicFreeContextCapsule(context(), '检索'.repeat(20_000));
    expect(
      new TextEncoder().encode(serializePublicFreeContextCapsule(capsule)).byteLength,
    ).toBeLessThanOrEqual(16 * 1024);
    expect(capsule.maxTokens).toBe(256);
  });
});
