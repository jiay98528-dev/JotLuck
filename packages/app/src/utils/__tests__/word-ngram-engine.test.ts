import { describe, expect, it } from 'vitest';
import { createParseDiagnostics, scanText } from '../ngram-engine';
import {
  deserializeBaselineTables,
  deserializeBaselineTablesAsync,
  deserializeWordTable,
  predictWordCompletion,
  predictWordCompletions,
  scanWordText,
  serializeBaselineTables,
  serializeWordTable,
  wordContext,
  WORD_OTHER_MASS,
} from '../word-ngram-engine';

describe('word-ngram-engine', () => {
  it('trains word bigrams/trigrams and predicts only after a word boundary', () => {
    const table = scanWordText(
      Array.from({ length: 4 }, () => 'Compare the result before release.').join('\n'),
    );
    const doc = 'Compare the ';

    expect(predictWordCompletion(table, doc.length, doc, 2, 0.1)?.text).toBe('result before');
    expect(predictWordCompletion(table, doc.length - 1, doc.slice(0, -1), 2, 0.1)).toBeNull();
  });

  it('returns deterministic top-k word branches while keeping the top-1 facade', () => {
    const table = new Map([
      [
        wordContext(['compare', 'the']),
        new Map([
          ['result', 10],
          ['owner', 9],
          ['status', 8],
          ['scope', 7],
        ]),
      ],
    ]);
    const doc = 'Compare the ';

    expect(predictWordCompletions(table, doc.length, doc, 1, 0.1, 3)).toEqual([
      expect.objectContaining({ text: 'result', support: 10, totalSupport: 34 }),
      expect.objectContaining({ text: 'owner', support: 9, totalSupport: 34 }),
      expect.objectContaining({ text: 'status', support: 8, totalSupport: 34 }),
    ]);
    expect(predictWordCompletion(table, doc.length, doc, 1, 0.1)?.text).toBe('result');
  });

  it('uses the longest available word context and keeps serialization deterministic', () => {
    const table = scanWordText(
      'record the result now\ncompare the result later\nrecord the owner now\nrecord the result now',
    );
    const serialized = serializeWordTable(table);
    const restored = deserializeWordTable(serialized);

    expect(serializeWordTable(restored)).toBe(serialized);
    expect(restored.get(wordContext(['record', 'the']))?.get('result')).toBe(2);
  });

  it('round-trips a sectioned baseline while keeping legacy character assets readable', () => {
    const character = scanText('这是一个测试这是一个验证', 4);
    const word = scanWordText('verify the result before release');
    const compact = serializeBaselineTables({ character, word });
    const restored = deserializeBaselineTables(compact);
    const legacy = deserializeBaselineTables(
      serializeBaselineTables({ character, word: new Map() })
        .split('\n[word]\n')[0]!
        .replace('# jotluck-baseline-v4\n[character]\n', ''),
    );

    expect(restored?.character.size).toBe(character.size);
    expect(restored?.word.size).toBe(word.size);
    expect(legacy?.character.size).toBe(character.size);
  });

  it('parses both baseline sections in bounded asynchronous chunks', async () => {
    const character = scanText('异步分段模型测试异步分段模型验证', 4);
    const word = scanWordText('verify the candidate model before release');
    const compact = serializeBaselineTables({ character, word });

    const restored = await deserializeBaselineTablesAsync(compact, 1);

    expect(restored?.character.size).toBe(character.size);
    expect(restored?.word.size).toBe(word.size);
  });

  it('reports header, character, and word parse work through one diagnostic object', async () => {
    const character = scanText('解析诊断覆盖字符模型和词模型'.repeat(10), 4);
    const word = scanWordText('verify the candidate model before release '.repeat(10));
    const compact = serializeBaselineTables({ character, word });
    const diagnostics = createParseDiagnostics();
    let tick = 0;

    await deserializeBaselineTablesAsync(compact, {
      chunkLines: 1,
      diagnostics,
      now: () => tick++ * 5,
    });

    expect(diagnostics.chunks).toBeGreaterThan(2);
    expect(diagnostics.lines).toBe(character.size + word.size);
    expect(diagnostics.maxChunkMs).toBe(5);
    expect(diagnostics.totalMs).toBeGreaterThan(diagnostics.maxChunkMs);
    expect(diagnostics.longTasksOver50Ms).toBe(0);
  });

  it('rejects corrupt word entries instead of coercing invalid counts', () => {
    const contextHex = new TextEncoder()
      .encode('compare\u001fthe')
      .reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '');
    const nextHex = new TextEncoder()
      .encode('result')
      .reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '');

    expect(deserializeWordTable(JSON.stringify([contextHex, [[nextHex, 1.5]]])).size).toBe(0);
  });

  it('round-trips hidden word mass without offering it as text', () => {
    const table = new Map([
      [
        wordContext(['compare', 'the']),
        new Map([
          ['result', 6],
          [WORD_OTHER_MASS, 4],
        ]),
      ],
    ]);
    const restored = deserializeWordTable(serializeWordTable(table));
    const doc = 'Compare the ';

    expect(restored.get(wordContext(['compare', 'the']))?.get(WORD_OTHER_MASS)).toBe(4);
    expect(predictWordCompletion(restored, doc.length, doc, 1, 0.15)?.text).toBe('result');
  });
});
