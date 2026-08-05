import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __test } from '../../e2e/tauri/installed-app-evidence-adapters.mjs';
import catalog from '../../spec/release/required-cases/installed-app-v2.json';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('fixed installed-app evidence adapters', () => {
  it('maps every required case to one unique fixed adapter', () => {
    const expected = catalog.cases.map((entry) => entry.adapter).sort();
    expect(__test.adapterNames()).toEqual(expected);
    expect(new Set(expected).size).toBe(catalog.cases.length);
  });

  it('rejects unknown adapters and definitions that do not require an execution log', () => {
    expect(() =>
      __test.assertDefinition({
        id: 'UNKNOWN-01',
        adapter: 'arbitrary-command',
        requiredArtifactKinds: ['execution-log', 'screenshot'],
      }),
    ).toThrow(/unknown adapter/u);
    expect(() =>
      __test.assertDefinition({
        id: catalog.cases[0].id,
        adapter: catalog.cases[0].adapter,
        requiredArtifactKinds: ['screenshot'],
      }),
    ).toThrow(/required artifact kinds/u);
  });

  it('accepts one unambiguous candidate and rejects duplicate installers', () => {
    const root = makeCandidate();
    expect(__test.discoverCandidate(root)).toMatchObject({ root: path.resolve(root) });
    writeFileSync(path.join(root, 'duplicate-setup.exe'), 'duplicate');
    expect(() => __test.discoverCandidate(root)).toThrow(/exactly one installer/u);
  });

  it('requires an adapter action log beside every WebDriver observation', () => {
    const webdriverCases = catalog.cases.filter((entry) =>
      entry.requiredArtifactKinds.includes('webdriver-trace'),
    );
    expect(webdriverCases.length).toBeGreaterThan(0);
    expect(
      webdriverCases.every((entry) => entry.requiredArtifactKinds.includes('adapter-action-log')),
    ).toBe(true);
  });

  it('covers all eight installer extensions and emits real binary document fixtures', async () => {
    expect(__test.supportedExtensions()).toEqual([
      '.md',
      '.markdown',
      '.mdx',
      '.txt',
      '.docx',
      '.pdf',
      '.xlsx',
      '.xls',
    ]);
    expect(__test.progIdForExtension('.md')).toBe('JotLuck.Note');
    expect(__test.progIdForExtension('.docx')).toBe('JotLuck.DocumentImport');

    const root = makeTemporaryRoot('jotluck-document-fixtures-');
    const signatures = new Map([
      ['.docx', '504b'],
      ['.pdf', '2550'],
      ['.xlsx', '504b'],
      ['.xls', 'd0cf'],
    ]);
    for (const [extension, signature] of signatures) {
      const target = path.join(root, `fixture${extension}`);
      const fixture = await __test.createSupportedFixture(target, extension, `marker-${extension}`);
      expect(fixture.binary).toBe(true);
      expect(readFileSync(target).subarray(0, 2).toString('hex')).toBe(signature);
    }
    const imageDocx = path.join(root, 'fixture-with-image.docx');
    const imageFixture = await __test.createSupportedFixture(
      imageDocx,
      '.docx',
      'marker-image-docx',
      { includeImage: true },
    );
    expect(imageFixture.binary).toBe(true);
    expect(readFileSync(imageDocx).subarray(0, 2).toString('hex')).toBe('504b');
    expect(readFileSync(imageDocx).byteLength).toBeGreaterThan(
      readFileSync(path.join(root, 'fixture.docx')).byteLength,
    );
  });

  it('accepts only a quoted JotLuck executable plus a quoted percent-one placeholder', () => {
    expect(
      __test.isQuotedJotLuckOpenCommand('"C:\\Program Files\\JotLuck\\JotLuck.exe" "%1"'),
    ).toBe(true);
    expect(__test.isQuotedJotLuckOpenCommand('"C:\\Program Files\\JotLuck\\JotLuck.exe"')).toBe(
      false,
    );
    expect(
      __test.isQuotedJotLuckOpenCommand(
        'C:\\Program Files\\JotLuck\\JotLuck.exe "C:\\note with spaces.md"',
      ),
    ).toBe(false);
  });

  it('binds registry commands and installed bytes to the exact packaged application', () => {
    expect(
      __test.openCommandTargetsApplication(
        '"C:\\Program Files\\JotLuck\\JotLuck.exe" "%1"',
        'c:\\program files\\jotluck\\JotLuck.exe',
      ),
    ).toBe(true);
    expect(
      __test.openCommandTargetsApplication(
        '"D:\\Other\\JotLuck.exe" "%1"',
        'C:\\Program Files\\JotLuck\\JotLuck.exe',
      ),
    ).toBe(false);
    expect(() =>
      __test.assertMatchingExecutableIdentities(
        { bytes: 10, sha256: 'a'.repeat(64) },
        { bytes: 10, sha256: 'b'.repeat(64) },
      ),
    ).toThrow(/does not match/u);
  });

  it('falls back to the Shell PID when UI Automation fails before observing a process', () => {
    expect(__test.resolveAssociationProcessId(undefined, { processId: 73 })).toBe(73);
    expect(__test.resolveAssociationProcessId({ process: { Id: 91 } }, { processId: 73 })).toBe(91);
  });

  it('bounds and sanitizes circular WebDriver command results', () => {
    const result = { sessionId: 'session-1' };
    result.self = result;
    expect(__test.sanitizeTraceValue(result)).toEqual({
      sessionId: 'session-1',
      self: { circularReference: true },
    });
  });
});

function makeCandidate() {
  const root = makeTemporaryRoot('jotluck-adapter-candidate-');
  mkdirSync(path.join(root, 'bundle', 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'JotLuck_0.1.0-preview_x64-setup.exe'), 'installer');
  writeFileSync(path.join(root, 'JotLuck.exe'), 'application');
  writeFileSync(path.join(root, 'bundle', 'dist', 'index.html'), '<main>JotLuck</main>');
  return root;
}

function makeTemporaryRoot(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}
