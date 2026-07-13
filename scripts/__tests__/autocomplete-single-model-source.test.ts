import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error See scripts/verify-autocomplete-v2s-evidence.mjs.
import { inspectAutocompletePublicState } from '../verify-autocomplete-v2s-evidence.mjs';

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('autocomplete public model source', () => {
  it('keeps the unpublished checkout in an explicit disabled state', () => {
    const state = inspectAutocompletePublicState(REPOSITORY_ROOT);
    expect(['legacy-failclosed', 'missing']).toContain(state.kind);
    expect(state).toMatchObject({ v2rFiles: [], canonicalEntries: [] });
    if (state.kind === 'legacy-failclosed') {
      expect(state.legacyFiles).toEqual([
        'baseline-ngram.web-local.compact.manifest.json',
        'baseline-ngram.web-local.compact.txt',
      ]);
    }
  });

  it.each([
    ['old and new coexist', (root: string) => writeLegacy(root)],
    [
      'orphan asset',
      (root: string) =>
        fs.writeFileSync(path.join(root, 'packages/app/public/autocomplete/orphan.bin'), 'orphan'),
    ],
    [
      'duplicate hash alias',
      (root: string) =>
        fs.writeFileSync(
          path.join(root, 'packages/app/public/autocomplete/duplicate.bin'),
          'asset',
        ),
    ],
    [
      'stopped V2R residue',
      (root: string) =>
        fs.writeFileSync(
          path.join(root, 'packages/app/public/public-phrase-transformer-v1.int8.onnx'),
          'stopped',
        ),
    ],
  ])('rejects %s in the complete public directory set', (_label, mutate) => {
    const root = createV2SPublicState();
    mutate(root);
    expect(inspectAutocompletePublicState(root).kind).toBe('invalid');
  });

  it('makes the V2S publisher the only script allowed to turn a candidate into public files', () => {
    const scriptFiles = walkFiles(path.join(REPOSITORY_ROOT, 'scripts')).filter(
      (file) =>
        /\.(?:ts|mjs)$/u.test(file) &&
        !file.includes(`${path.sep}__tests__${path.sep}`) &&
        !file.includes(`${path.sep}frozen-v1-fb46b1e${path.sep}`),
    );
    const candidateToPublicWriters = scriptFiles
      .filter((file) => {
        const source = fs.readFileSync(file, 'utf8');
        return (
          source.includes('prepareAutocompleteV2SPublication') &&
          /\b(?:writeFileSync|renameSync|copyFileSync)\s*\(/u.test(source)
        );
      })
      .map((file) => path.relative(REPOSITORY_ROOT, file).replaceAll('\\', '/'));
    expect(candidateToPublicWriters).toEqual(['scripts/publish-autocomplete-v2s-final.ts']);

    const candidateDirectory = path.join(REPOSITORY_ROOT, 'scripts/autocomplete-v2s');
    if (fs.existsSync(candidateDirectory)) {
      for (const file of walkFiles(candidateDirectory).filter((item) =>
        /\.(?:ts|mjs|py)$/u.test(item),
      )) {
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(
          /packages[\\/]app[\\/]public|V2S_CANONICAL_MANIFEST/u,
        );
      }
    }
  });

  it('keeps stopped V2R runtime dependencies out of the production package', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPOSITORY_ROOT, 'packages/app/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies?.['onnxruntime-web']).toBeUndefined();
    for (const removedRuntime of [
      'public-engine-backend.ts',
      'public-engine-onnx-runtime.ts',
      'public-engine.worker.ts',
    ]) {
      expect(
        fs.existsSync(
          path.join(REPOSITORY_ROOT, 'packages/app/src/services/completion', removedRuntime),
        ),
      ).toBe(false);
    }
  });

  it('keeps the stopped V2S factory out of the production predictor dependency graph', () => {
    const predictor = fs.readFileSync(
      path.join(REPOSITORY_ROOT, 'packages/app/src/services/MarkdownPredictor.ts'),
      'utf8',
    );
    expect(predictor).not.toContain('createCanonicalPublicV2sEngine');
    expect(predictor).not.toContain("from './completion/public-v2s-factory'");
    expect(predictor).toContain('this.initialPublicEngine');
  });

  it('keeps stopped public-model commands out of root scripts and RC routing', () => {
    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const activeRootCommands = Object.entries(rootPackage.scripts ?? {})
      .filter(([name]) => /autocomplete|baseline/u.test(name))
      .map(([name, command]) => `${name}:${command}`)
      .join('\n');
    expect(activeRootCommands).not.toMatch(/v2r|train-baseline|publish-autocomplete-final/u);
    expect(activeRootCommands).toContain('autocomplete-v2s');
    expect(activeRootCommands).toContain('publish-autocomplete-v2s-final');

    const workflowSources = walkFiles(path.join(REPOSITORY_ROOT, '.github/workflows'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(workflowSources).not.toMatch(
      /verify-autocomplete-evidence|train-autocomplete-learning-curve|autocomplete-v2r-rc/u,
    );
    expect(workflowSources).toContain('publish-autocomplete-v2s-final');
    expect(workflowSources).toContain('verify-autocomplete-v2s-evidence');
  });
});

function createV2SPublicState(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jotluck-single-model-'));
  temporaryRoots.push(root);
  const publicDir = path.join(root, 'packages/app/public/autocomplete');
  fs.mkdirSync(publicDir, { recursive: true });
  const hash = 'a'.repeat(64);
  const assetFile = `public-v2s-mkn-v1.${hash}.bin`;
  fs.writeFileSync(path.join(publicDir, assetFile), 'asset');
  fs.writeFileSync(
    path.join(publicDir, 'autocomplete-public.manifest.json'),
    JSON.stringify({ asset: { file: assetFile } }),
  );
  return root;
}

function writeLegacy(root: string): void {
  const publicDir = path.join(root, 'packages/app/public');
  fs.writeFileSync(path.join(publicDir, 'baseline-ngram.web-local.compact.txt'), 'legacy');
  fs.writeFileSync(path.join(publicDir, 'baseline-ngram.web-local.compact.manifest.json'), '{}');
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name === '_web-cache') return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}
