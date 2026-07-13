import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runAutocompleteV2RTrainingMatrix } from '../run-autocomplete-v2r-training-matrix';
import { V2R_REPOSITORY_ROOT } from '../autocomplete-v2r/workspace';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('V2R bounded training matrix', () => {
  it('fails on missing frozen validation before checking Python or starting CPU training', async () => {
    const parent = path.join(V2R_REPOSITORY_ROOT, 'scripts/corpus/_web-cache');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'v2r-matrix-test-'));
    temporaryRoots.push(root);

    await expect(runAutocompleteV2RTrainingMatrix({ workspaceRoot: root })).rejects.toThrow(
      /Frozen V2R validation holdout is missing.*cold-validation-v3/iu,
    );
  });

  it('stops long training when the fixed-phrase architecture is explicitly blocked', async () => {
    const parent = path.join(V2R_REPOSITORY_ROOT, 'scripts/corpus/_web-cache');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'v2r-architecture-stop-test-'));
    temporaryRoots.push(root);
    const stopPath = path.join(root, 'scripts/corpus/autocomplete-v2r-architecture-stop.json');
    await mkdir(path.dirname(stopPath), { recursive: true });
    await writeFile(
      stopPath,
      JSON.stringify({
        schema: 'jotluck.autocomplete.v2r-architecture-stop.v1',
        engine: 'public-phrase-transformer-v1',
        status: 'architecture-blocked',
        stopLongTraining: true,
      }),
      'utf8',
    );

    await expect(runAutocompleteV2RTrainingMatrix({ workspaceRoot: root })).rejects.toThrow(
      /architecture is blocked/iu,
    );
  });
});
