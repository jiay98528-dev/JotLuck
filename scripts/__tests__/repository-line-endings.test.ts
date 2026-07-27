import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const patchFiles = ['patches/minimatch@5.1.9.patch', 'patches/minimatch@9.0.9.patch'];

describe('repository line-ending contract', () => {
  it('materializes every tracked text file with LF bytes', () => {
    const entries = execFileSync('git', ['ls-files', '--eol'], {
      cwd: root,
      encoding: 'utf8',
    })
      .split(/\r?\n/u)
      .filter(Boolean);
    const nonLfText = entries.filter(
      (entry) => /\bi\/(?:lf|crlf|mixed)\b/u.test(entry) && !/\bw\/lf\b/u.test(entry),
    );
    expect(
      nonLfText,
      `tracked text files not materialized as LF:\n${nonLfText.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps pnpm patch files free of carriage returns', () => {
    for (const relative of patchFiles) {
      const content = readFileSync(path.join(root, relative));
      expect(content.includes(13), `${relative} contains CR bytes`).toBe(false);
    }
  });

  it('keeps every unified-diff hunk header consistent with its body', () => {
    for (const relative of patchFiles) {
      const lines = readFileSync(path.join(root, relative), 'utf8').split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const header = lines[index].match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u);
        if (!header) continue;
        const headerLine = lines[index];
        const expectedOld = header[1] === undefined ? 1 : Number(header[1]);
        const expectedNew = header[2] === undefined ? 1 : Number(header[2]);
        let actualOld = 0;
        let actualNew = 0;
        for (index += 1; index < lines.length; index += 1) {
          const line = lines[index];
          if (line.startsWith('@@ ') || line.startsWith('diff --git ')) {
            index -= 1;
            break;
          }
          if (line.startsWith(' ') || line.startsWith('-')) actualOld += 1;
          if (line.startsWith(' ') || line.startsWith('+')) actualNew += 1;
        }
        expect(
          { actualOld, actualNew },
          `${relative} has an invalid hunk header: ${headerLine}`,
        ).toEqual({ actualOld: expectedOld, actualNew: expectedNew });
      }
    }
  });
});
