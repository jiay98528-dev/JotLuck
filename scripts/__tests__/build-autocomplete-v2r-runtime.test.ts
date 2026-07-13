import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sha256 } from '../autocomplete-v2r/common';
import { V2R_REPOSITORY_ROOT } from '../autocomplete-v2r/workspace';
import { buildAutocompleteV2RRuntime } from '../build-autocomplete-v2r-runtime';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('V2R reduced-operator runtime build', () => {
  it('rejects absolute and traversal candidate directories before reading assets', async () => {
    await expect(buildAutocompleteV2RRuntime({ candidateDir: '../outside' })).rejects.toThrow(
      /repository-relative V2R cache path/u,
    );
    await expect(
      buildAutocompleteV2RRuntime({ candidateDir: path.resolve('outside') }),
    ).rejects.toThrow(/repository-relative V2R cache path/u);
  });

  it('binds the model and operator config before attempting a pinned source build', async () => {
    await mkdir(path.join(V2R_REPOSITORY_ROOT, 'scripts/corpus/_web-cache'), {
      recursive: true,
    });
    const root = await mkdtemp(
      path.join(V2R_REPOSITORY_ROOT, 'scripts/corpus/_web-cache/v2r-runtime-test-'),
    );
    temporaryRoots.push(root);
    const relativeCandidate = 'scripts/corpus/_web-cache/autocomplete-v2r/candidates/unit';
    const candidate = path.join(root, ...relativeCandidate.split('/'));
    await mkdir(candidate, { recursive: true });
    const model = Buffer.from('valid-onnx-placeholder');
    const operatorConfig = Buffer.from('ai.onnx;18;Add,MatMul\n');
    await writeFile(path.join(candidate, 'model.int8.onnx'), model);
    await writeFile(path.join(candidate, 'required-operators.config'), operatorConfig);
    await writeFile(
      path.join(candidate, 'training-report.json'),
      `${JSON.stringify({
        schema: 'jotluck.autocomplete.v2r-training-report.v1',
        assets: {
          int8: { sha256: sha256(model) },
          operatorConfig: { sha256: sha256(operatorConfig) },
        },
      })}\n`,
      'utf8',
    );

    await expect(
      buildAutocompleteV2RRuntime({ workspaceRoot: root, candidateDir: relativeCandidate }),
    ).rejects.toThrow(/Pinned ONNX Runtime source is missing/u);

    await writeFile(path.join(candidate, 'model.int8.onnx'), 'tampered');
    await expect(
      buildAutocompleteV2RRuntime({ workspaceRoot: root, candidateDir: relativeCandidate }),
    ).rejects.toThrow(/does not match its training report/u);
  });
});
