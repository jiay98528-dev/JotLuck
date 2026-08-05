import { beforeEach, describe, expect, it } from 'vitest';
import { MarkdownPredictor } from '../../MarkdownPredictor';
import { serialize, type NGramTable } from '@/utils/ngram-engine';
import { scopedCompletionStorageKey } from '../learning-repository';

function table(context: string, next: string, count: number): NGramTable {
  return new Map([[context, new Map([[next, count]])]]);
}

function legacyV4Model(): string {
  return [
    '# jotluck-personal-ngram-v4',
    '[long]',
    serialize(table('abcd', 'x', 4)),
    '[short2]',
    serialize(table('cd', 'x', 4)),
    '[short3]',
    serialize(table('bcd', 'x', 4)),
  ].join('\n');
}

describe('personal completion persistence v5', () => {
  beforeEach(() => localStorage.clear());

  it('migrates v4 acceptance into a 0.5-weight legacyAccepted partition', () => {
    const scope = 'workspace-v5';
    const oldModelKey = scopedCompletionStorageKey(scope, 'ngram:v4');
    const oldMetaKey = scopedCompletionStorageKey(scope, 'meta:v4');
    const oldLexiconKey = scopedCompletionStorageKey(scope, 'acceptedLexicon:v1');
    const modelKey = scopedCompletionStorageKey(scope, 'ngram:v5');
    const metaKey = scopedCompletionStorageKey(scope, 'meta:v5');
    const lexiconKey = scopedCompletionStorageKey(scope, 'acceptedLexicon:v2');
    localStorage.setItem(oldModelKey, legacyV4Model());
    localStorage.setItem(
      oldMetaKey,
      JSON.stringify({ schemaVersion: 4, docs: 1, totalEntries: 3, lastSave: 10 }),
    );
    localStorage.setItem(oldLexiconKey, JSON.stringify(['legacy phrase']));

    const predictor = new MarkdownPredictor(4);
    predictor.setStorageScope(scope);

    expect(localStorage.getItem(modelKey)).toContain('[legacy-long]');
    expect(JSON.parse(localStorage.getItem(metaKey) ?? '{}')).toMatchObject({
      schemaVersion: 5,
      migratedFrom: 4,
      totalEntries: 0,
      legacyAcceptedEntries: 3,
    });
    expect(localStorage.getItem(oldModelKey)).toBeNull();
    expect(localStorage.getItem(oldMetaKey)).toBeNull();
    expect(localStorage.getItem(oldLexiconKey)).toBeNull();
    expect(localStorage.getItem(lexiconKey)).toBeNull();

    const effective = (
      predictor as unknown as { getPersonalLongTable(): NGramTable }
    ).getPersonalLongTable();
    expect(effective.get('abcd')?.get('x')).toBe(2);
  });

  it('persists only retained-compatible direct training into the retained partition', () => {
    const scope = 'workspace-retained';
    const predictor = new MarkdownPredictor(4);
    predictor.setStorageScope(scope);
    predictor.acceptCompletion('abcd', ' owner review');

    const model = localStorage.getItem(scopedCompletionStorageKey(scope, 'ngram:v5'));
    const lexicon = localStorage.getItem(scopedCompletionStorageKey(scope, 'acceptedLexicon:v2'));
    expect(model).toContain('[retained-long]');
    expect(model).toContain('[legacy-long]');
    expect(lexicon).toContain('owner');
  });
});
