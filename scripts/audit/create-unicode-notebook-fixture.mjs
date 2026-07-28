import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const UNICODE_NOTE_FILE_NAME = `${String.fromCodePoint(
  0x4e2d,
  0x6587,
)} ${String.fromCodePoint(0x6587, 0x4ef6)}.mdx`;
export const UNICODE_NOTE_MARKER = '中文 文件 UTF-8 marker';
export const UNICODE_NOTE_CONTENT = `# Unicode WebView smoke\n\nmarker: ${UNICODE_NOTE_MARKER}\n`;
export const UNICODE_NOTEBOOK_NAME = 'JotLuck UTF8 Smoke Notebook';

export async function createUnicodeAuditFixture(outputRoot) {
  const root = resolve(outputRoot);
  const notebookRoot = resolve(root, UNICODE_NOTEBOOK_NAME);
  const notePath = resolve(notebookRoot, UNICODE_NOTE_FILE_NAME);
  const manifestPath = resolve(root, 'unicode-fixture.manifest.json');
  if (!notePath.startsWith(`${notebookRoot}\\`) && !notePath.startsWith(`${notebookRoot}/`)) {
    throw new Error('unicode fixture note escaped its notebook root');
  }

  await mkdir(notebookRoot, { recursive: true });
  await writeFile(notePath, UNICODE_NOTE_CONTENT, { encoding: 'utf8', flag: 'wx' });
  const bytes = await readFile(notePath);
  const manifestPayload = {
    schema: 'jotluck.unicode-audit-fixture.v2',
    notebookName: UNICODE_NOTEBOOK_NAME,
    notebookRoot,
    marker: UNICODE_NOTE_MARKER,
    note: {
      fileName: UNICODE_NOTE_FILE_NAME,
      codePoints: Array.from(UNICODE_NOTE_FILE_NAME, (value) => value.codePointAt(0)),
      contentUtf8: UNICODE_NOTE_CONTENT,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
  const manifest = {
    ...manifestPayload,
    manifestSha256: sha256Json(manifestPayload),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return { ...manifest, manifestPath, notePath };
}

export function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const outputRoot = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (!outputRoot)
    throw new Error('usage: node create-unicode-notebook-fixture.mjs --output <directory>');
  process.stdout.write(`${JSON.stringify(await createUnicodeAuditFixture(outputRoot), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
