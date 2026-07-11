import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateWorkspaceFinalV2, type WorkspaceFinalHoldout } from '../workspace-final-holdout';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadFrozenHoldout(): WorkspaceFinalHoldout {
  return JSON.parse(
    readFileSync(path.join(root, 'scripts/corpus/workspace-conditioned-final-v2.json'), 'utf8'),
  ) as WorkspaceFinalHoldout;
}

function makeStructurallyDiverseFixture(): WorkspaceFinalHoldout {
  const holdout = structuredClone(loadFrozenHoldout());
  for (const [index, support] of holdout.supportDocuments.entries()) {
    support.text = String.fromCodePoint(0x3400 + index).repeat(6);
  }
  return holdout;
}

function replaceCompletionCheckpoints(
  target: WorkspaceFinalHoldout['targets'][number],
  suffixes: readonly string[],
): void {
  let completionIndex = 0;
  for (const checkpoint of target.checkpoints) {
    if (checkpoint.expectedBehavior === 'silence') {
      checkpoint.cursorOffset = target.text.length;
      checkpoint.expectedSuffix = '';
      continue;
    }
    const suffix = suffixes[completionIndex++]!;
    checkpoint.cursorOffset = target.text.indexOf(suffix);
    checkpoint.expectedSuffix = suffix;
  }
}

describe('workspace-conditioned final-v2 governance', () => {
  it('accepts the frozen release holdout with all governance limits bound', () => {
    const holdout = loadFrozenHoldout();
    const audit = validateWorkspaceFinalV2(holdout);
    expect(audit).toMatchObject({
      targetDocuments: 50,
      checkpoints: 200,
      languageCheckpoints: { zh: 100, en: 100 },
      silenceCheckpoints: 50,
      exactContinuationDuplicates: 0,
      supportContinuationOverlaps: 0,
      sharedLongNgramPairs: 0,
    });
    expect(audit.maxStructuralTemplateRatio).toBeLessThanOrEqual(0.1);
  });

  it('fails closed when support documents repeat one structural template', () => {
    const holdout = loadFrozenHoldout();
    holdout.supportDocuments.forEach((support, index) => {
      support.text =
        support.language === 'zh'
          ? `关于样本${index}的记录来自位置${index}。交接说明建议核对事项${index}，并把时刻写在页首；另一位记录者补充不同细节。`
          : `Sample ${index} came from station ${index}. The handoff asks staff to check item ${index}, record the time first, and add different field details.`;
    });
    expect(() => validateWorkspaceFinalV2(holdout)).toThrow(/structural-template dominance/u);
  });

  it('rejects copied continuations and diagnostic datasets', () => {
    const holdout = makeStructurallyDiverseFixture();
    const copied = structuredClone(holdout);
    const checkpoint = copied.targets[0]!.checkpoints.find(
      (item) => item.expectedBehavior === 'complete',
    )!;
    copied.supportDocuments[0]!.text = checkpoint.expectedSuffix;
    expect(() => validateWorkspaceFinalV2(copied)).toThrow(/continuation leakage/u);

    const diagnostic = { ...holdout, releaseEvidence: false } as unknown as WorkspaceFinalHoldout;
    expect(() => validateWorkspaceFinalV2(diagnostic)).toThrow(/identity is invalid/u);
  });

  it('rejects a sixth target that reuses a sentence skeleton with different slot values', () => {
    const holdout = makeStructurallyDiverseFixture();
    const target = holdout.targets.find((item) => item.id === 'zh-02-target')!;
    target.text =
      '本次果园盘点发生在西侧仓门。记录者先核对木箱数量，随后确认标签日期仍整齐可见。这份简短记录意味着后勤组能够安排明日搬运。';
    replaceCompletionCheckpoints(target, [
      '果园盘点发生在西侧仓门',
      '核对木箱数量，随后确认标签日期',
      '后勤组能够安排明日搬运',
    ]);

    expect(() => validateWorkspaceFinalV2(holdout)).toThrow(/structural-template dominance/u);
  });

  it('rejects a long fragment copied into an otherwise unrelated target', () => {
    const holdout = makeStructurallyDiverseFixture();
    const target = holdout.targets.find((item) => item.id === 'en-02-target')!;
    target.text +=
      ' This harbor inspection took place at the eastern pier. The observer documented it.';

    expect(() => validateWorkspaceFinalV2(holdout)).toThrow(/shared long n-gram/u);
  });
});
