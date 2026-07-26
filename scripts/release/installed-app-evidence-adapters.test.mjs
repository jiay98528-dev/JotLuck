import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
});

function makeCandidate() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jotluck-adapter-candidate-'));
  roots.push(root);
  mkdirSync(path.join(root, 'bundle', 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'JotLuck_0.1.0-preview_x64-setup.exe'), 'installer');
  writeFileSync(path.join(root, 'JotLuck.exe'), 'application');
  writeFileSync(path.join(root, 'bundle', 'dist', 'index.html'), '<main>JotLuck</main>');
  return root;
}
