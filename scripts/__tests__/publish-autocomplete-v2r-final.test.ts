import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publishAutocompleteV2RFinal } from '../publish-autocomplete-v2r-final';
import { V2R_REPOSITORY_ROOT } from '../autocomplete-v2r/workspace';

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('V2R final publisher', () => {
  it('refuses publication while the fixed-phrase architecture stop is present', async () => {
    const root = await createWorkspace();
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

    expect(() =>
      publishAutocompleteV2RFinal({
        rootDir: root,
        candidateDir: 'scripts/corpus/_web-cache/autocomplete-v2r/candidates/blocked',
        evidenceBundleDir: 'scripts/corpus/_web-cache/autocomplete-v2r/evidence/blocked',
        evaluatorTreePath: 'missing-evaluator.json',
        webviewSmokePath: 'missing-webview.json',
        holdoutPaths: {
          coldValidation: 'missing-cold-validation.json',
          workspaceValidation: 'missing-workspace-validation.json',
          coldFinal: 'missing-cold-final.json',
          workspaceFinal: 'missing-workspace-final.json',
        },
      }),
    ).toThrow(/architecture is blocked/iu);
  });

  it('fails before public writes when the frozen candidate is not eligible', async () => {
    const root = await createWorkspace();
    const candidateRelative =
      'scripts/corpus/_web-cache/autocomplete-v2r/candidates/ineligible-candidate';
    const evidenceRelative =
      'scripts/corpus/_web-cache/autocomplete-v2r/evidence/ineligible-candidate';
    await mkdir(path.join(root, candidateRelative), { recursive: true });
    await mkdir(path.join(root, evidenceRelative), { recursive: true });
    await writeFile(
      path.join(root, candidateRelative, 'training-report.json'),
      `${JSON.stringify({
        schema: 'jotluck.autocomplete.v2r-training-report.v1',
        schemaVersion: 1,
        engine: 'public-phrase-transformer-v1',
        candidateEligible: false,
        releaseEligible: false,
        architecture: { phraseBankSize: 8192, hiddenSize: 96, layers: 2 },
        assets: {},
        seed: 98528,
      })}\n`,
      'utf8',
    );
    const sentinelPath = path.join(root, 'packages/app/public/existing.txt');
    await mkdir(path.dirname(sentinelPath), { recursive: true });
    await writeFile(sentinelPath, 'unchanged', 'utf8');

    expect(() =>
      publishAutocompleteV2RFinal({
        rootDir: root,
        candidateDir: candidateRelative,
        evidenceBundleDir: evidenceRelative,
        evaluatorTreePath: 'missing-evaluator.json',
        webviewSmokePath: 'missing-webview.json',
        holdoutPaths: {
          coldValidation: 'missing-cold-validation.json',
          workspaceValidation: 'missing-workspace-validation.json',
          coldFinal: 'missing-cold-final.json',
          workspaceFinal: 'missing-workspace-final.json',
        },
      }),
    ).toThrow(/not eligible for final publication/u);
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('unchanged');
    await expect(
      readFile(
        path.join(root, 'packages/app/public/public-phrase-transformer-v1.web-local.manifest.json'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects repository traversal before reading candidate evidence', async () => {
    const root = await createWorkspace();
    expect(() =>
      publishAutocompleteV2RFinal({
        rootDir: root,
        candidateDir: '../outside',
        evidenceBundleDir: 'scripts/corpus/_web-cache/autocomplete-v2r/evidence/unit',
        evaluatorTreePath: 'evaluator.json',
        webviewSmokePath: 'smoke.json',
        holdoutPaths: {
          coldValidation: 'cold-validation.json',
          workspaceValidation: 'workspace-validation.json',
          coldFinal: 'cold-final.json',
          workspaceFinal: 'workspace-final.json',
        },
      }),
    ).toThrow(/repository-relative path/u);
  });
});

async function createWorkspace(): Promise<string> {
  const parent = path.join(V2R_REPOSITORY_ROOT, 'scripts/corpus/_web-cache');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'v2r-publisher-test-'));
  temporaryRoots.push(root);
  return root;
}
