import { describe, expect, it } from 'vitest';
import {
  containsSensitiveCompletionText,
  decideCompletionLearningAdmission,
} from '../learning-admission';

describe('completion learning admission', () => {
  it('persists only ordinary workspace prose', () => {
    expect(
      decideCompletionLearningAdmission({
        sessionKind: 'workspace',
        blockType: 'paragraph',
        mode: 'predictive',
        contextText: '本周需要',
        insertedText: '完成复盘',
      }),
    ).toEqual({ admission: 'persist', reason: 'workspace-prose' });

    expect(
      decideCompletionLearningAdmission({
        sessionKind: 'temporary',
        blockType: 'paragraph',
        mode: 'predictive',
        contextText: 'temporary note',
        insertedText: ' continuation',
      }).admission,
    ).toBe('memoryOnly');
  });

  it.each([
    ['structured', 'paragraph', 'structured'],
    ['code', 'code', 'predictive'],
    ['frontmatter', 'frontmatter', 'predictive'],
  ] as const)('skips %s completions', (_label, blockType, mode) => {
    expect(
      decideCompletionLearningAdmission({
        sessionKind: 'workspace',
        blockType,
        mode,
        contextText: 'context',
        insertedText: 'text',
      }).admission,
    ).toBe('skip');
  });

  it('detects common local secret forms without uploading or learning them', () => {
    expect(containsSensitiveCompletionText('api_key = sk-test_123456789012345')).toBe(true);
    expect(containsSensitiveCompletionText('密码：correct-horse-battery')).toBe(true);
    expect(containsSensitiveCompletionText('ordinary writing text')).toBe(false);
  });
});
