import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UNICODE_NOTE_FILE_NAME,
  UNICODE_NOTE_MARKER,
  createUnicodeAuditFixture,
} from './create-unicode-notebook-fixture.mjs';

const roots = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('Unicode notebook audit fixture', () => {
  it('creates a code-point UTF-8 note and binds marker plus manifest SHA', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'jotluck-unicode-fixture-'));
    roots.push(root);

    const fixture = await createUnicodeAuditFixture(root);
    const noteBytes = readFileSync(fixture.notePath);
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'));
    const { manifestSha256, ...manifestPayload } = manifest;

    expect(UNICODE_NOTE_FILE_NAME).toBe('中文 文件.mdx');
    expect(UNICODE_NOTE_MARKER).toBe('中文 文件 UTF-8 marker');
    expect(fixture.note.codePoints).toEqual([20013, 25991, 32, 25991, 20214, 46, 109, 100, 120]);
    expect(noteBytes.toString('utf8')).toContain(UNICODE_NOTE_MARKER);
    expect(manifest).toMatchObject({
      schema: 'jotluck.unicode-audit-fixture.v2',
      notebookRoot: fixture.notebookRoot,
      marker: UNICODE_NOTE_MARKER,
      note: {
        fileName: UNICODE_NOTE_FILE_NAME,
        bytes: noteBytes.byteLength,
        sha256: createHash('sha256').update(noteBytes).digest('hex'),
      },
    });
    expect(manifestSha256).toBe(
      createHash('sha256').update(JSON.stringify(manifestPayload), 'utf8').digest('hex'),
    );
    expect(manifestSha256).toBe(fixture.manifestSha256);
  });
});
