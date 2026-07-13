import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { measureAutocompleteV2RBundle } from '../measure-autocomplete-v2r-bundle';
import { sha256, V2R_REPOSITORY_ROOT } from '../autocomplete-v2r';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('V2R production bundle measurement', () => {
  it('binds exactly one candidate asset copy and counts the complete JavaScript tree', async () => {
    const fixture = await createFixture();
    const output = await measureAutocompleteV2RBundle({
      workspaceRoot: fixture.root,
      candidateDir: fixture.candidateRelative,
      distDir: fixture.distRelative,
    });
    const report = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;

    expect(report).toMatchObject({
      schema: 'jotluck.autocomplete.v2r-bundle-size.v1',
      measurementMethod: 'candidate-assets-plus-entire-app-js-upper-bound',
      entireAppJavaScriptBytes: 13,
      candidateRuntimeCopies: 1,
      candidateModelCopies: 1,
      candidatePhraseBankCopies: 1,
      candidateMetadataCopies: 1,
      stockWasmAssets: 0,
      passed: true,
    });
    expect(report.conservativeStaticDeltaUpperBoundBytes).toBe(
      (report.candidateAssetBytes as number) + 13,
    );

    await expect(
      measureAutocompleteV2RBundle({
        workspaceRoot: fixture.root,
        candidateDir: fixture.candidateRelative,
        distDir: fixture.distRelative,
      }),
    ).resolves.toBe(output);

    await writeFile(
      path.join(fixture.root, fixture.distRelative, 'assets', 'app.js'),
      'changed-javascript',
    );
    await expect(
      measureAutocompleteV2RBundle({
        workspaceRoot: fixture.root,
        candidateDir: fixture.candidateRelative,
        distDir: fixture.distRelative,
      }),
    ).rejects.toThrow('already exists with different content');
  });

  it('fails closed when the production build contains a stock WASM runtime', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.root, fixture.distRelative, 'stock.wasm'), 'stock-runtime');

    await expect(
      measureAutocompleteV2RBundle({
        workspaceRoot: fixture.root,
        candidateDir: fixture.candidateRelative,
        distDir: fixture.distRelative,
      }),
    ).rejects.toThrow(/stockWasm=1/u);
  });
});

async function createFixture(): Promise<{
  root: string;
  candidateRelative: string;
  distRelative: string;
}> {
  const parent = path.join(V2R_REPOSITORY_ROOT, 'scripts/corpus/_web-cache');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'v2r-bundle-test-'));
  temporaryRoots.push(root);

  const candidateRelative = 'scripts/corpus/_web-cache/autocomplete-v2r/candidates/candidate';
  const phraseRelative =
    'scripts/corpus/_web-cache/autocomplete-v2r/training/8192/phrase-bank.jsonl';
  const distRelative = 'packages/app/dist';
  const candidateDir = path.join(root, candidateRelative);
  const phrasePath = path.join(root, phraseRelative);
  const distDir = path.join(root, distRelative);
  await Promise.all([
    mkdir(candidateDir, { recursive: true }),
    mkdir(path.dirname(phrasePath), { recursive: true }),
    mkdir(path.join(distDir, 'assets'), { recursive: true }),
  ]);

  const assets = {
    model: Buffer.from('int8-onnx-model'),
    phraseBank: Buffer.from('{"id":0,"text":" next step"}\n'),
    metadata: Buffer.from('{"schemaVersion":1}\n'),
    runtime: Buffer.from('reduced-wasm-runtime'),
  };
  await Promise.all([
    writeFile(path.join(candidateDir, 'model.int8.onnx'), assets.model),
    writeFile(phrasePath, assets.phraseBank),
    writeFile(path.join(candidateDir, 'runtime-metadata.json'), assets.metadata),
    writeFile(path.join(candidateDir, 'ort-wasm-simd-threaded.reduced.wasm'), assets.runtime),
    writeFile(path.join(distDir, 'public-phrase-transformer-v1.int8.onnx'), assets.model),
    writeFile(path.join(distDir, 'public-phrase-transformer-v1.phrases.jsonl'), assets.phraseBank),
    writeFile(path.join(distDir, 'public-phrase-transformer-v1.metadata.json'), assets.metadata),
    writeFile(path.join(distDir, 'ort-wasm-simd-threaded.v2r.wasm'), assets.runtime),
    writeFile(path.join(distDir, 'assets', 'app.js'), '12345678'),
    writeFile(path.join(distDir, 'assets', 'worker.mjs'), '12345'),
  ]);
  await writeFile(
    path.join(candidateDir, 'training-report.json'),
    `${JSON.stringify({
      schema: 'jotluck.autocomplete.v2r-training-report.v1',
      candidateEligible: true,
      assets: {
        int8: { sha256: sha256(assets.model) },
        phraseBank: { path: phraseRelative, sha256: sha256(assets.phraseBank) },
        metadata: { sha256: sha256(assets.metadata) },
      },
    })}\n`,
    'utf8',
  );
  return { root, candidateRelative, distRelative };
}
