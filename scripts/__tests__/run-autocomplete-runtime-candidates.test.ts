import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installRuntimeCandidate,
  resolveWorkspaceOutput,
  selectRuntimeCandidateTiers,
} from '../run-autocomplete-runtime-candidates';
import type { LearningCurveReport } from '../run-autocomplete-learning-curve';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempRoot = path.join(repositoryRoot, 'scripts/__tests__/.runtime-candidate-test');
const outsideRoot = path.join(repositoryRoot, 'scripts/__tests__/.runtime-candidate-outside');

afterEach(() => {
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  if (existsSync(outsideRoot)) rmSync(outsideRoot, { recursive: true, force: true });
});

describe('runtime candidate orchestration', () => {
  it('selects only deterministic candidates and preserves byte-tier order', () => {
    const report = {
      selectedTier: null,
      releaseEligible: false,
      tiers: [
        tier('3mib', 3_145_728, true),
        tier('0.1mib', 104_858, false),
        tier('1mib', 1_048_576, true),
      ],
    } as Pick<LearningCurveReport, 'tiers' | 'selectedTier' | 'releaseEligible'>;
    expect(selectRuntimeCandidateTiers(report).map((item) => item.id)).toEqual(['1mib', '3mib']);
  });

  it('temporarily installs the exact candidate and restores fail-closed public bytes', () => {
    const candidateDirectory =
      'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/0.1mib';
    const candidateRoot = path.join(tempRoot, candidateDirectory);
    const publicRoot = path.join(tempRoot, 'packages/app/public');
    mkdirSync(candidateRoot, { recursive: true });
    mkdirSync(publicRoot, { recursive: true });
    const candidateModel = '# jotluck-baseline-v4\n[character]\n["61",[["62",2000]]]\n[word]\n';
    const candidateSha = sha(candidateModel);
    writeFileSync(path.join(candidateRoot, 'model.compact.txt'), candidateModel, 'utf8');
    writeFileSync(
      path.join(candidateRoot, 'manifest.json'),
      `${JSON.stringify({
        sha256: candidateSha,
        modelBytes: Buffer.byteLength(candidateModel),
        runtimeEligible: false,
        qualityGatePassed: false,
        releaseEligible: false,
      })}\n`,
      'utf8',
    );
    const oldModel = '["old",[["model",1]]]\n';
    const oldManifest = '{"runtimeEligible":false}\n';
    const publicModel = path.join(publicRoot, 'baseline-ngram.web-local.compact.txt');
    const publicManifest = path.join(publicRoot, 'baseline-ngram.web-local.compact.manifest.json');
    writeFileSync(publicModel, oldModel, 'utf8');
    writeFileSync(publicManifest, oldManifest, 'utf8');

    const restore = installRuntimeCandidate(tempRoot, {
      id: '0.1mib',
      modelSha256: candidateSha,
      modelBytes: Buffer.byteLength(candidateModel),
      candidateDirectory,
    });
    expect(readFileSync(publicModel, 'utf8')).toBe(candidateModel);
    expect(JSON.parse(readFileSync(publicManifest, 'utf8'))).toMatchObject({
      sha256: candidateSha,
      runtimeEligible: true,
      qualityGatePassed: false,
      releaseEligible: false,
      rcRuntimeCandidateTier: '0.1mib',
    });
    restore();
    restore();
    expect(readFileSync(publicModel, 'utf8')).toBe(oldModel);
    expect(readFileSync(publicManifest, 'utf8')).toBe(oldManifest);

    const restoreReleaseCandidate = installRuntimeCandidate(
      tempRoot,
      {
        id: '0.1mib',
        modelSha256: candidateSha,
        modelBytes: Buffer.byteLength(candidateModel),
        candidateDirectory,
      },
      { releaseCandidate: true },
    );
    expect(JSON.parse(readFileSync(publicManifest, 'utf8'))).toMatchObject({
      runtimeEligible: true,
      qualityGatePassed: true,
      releaseEligible: true,
    });
    restoreReleaseCandidate();
    expect(readFileSync(publicModel, 'utf8')).toBe(oldModel);
  });

  it('rejects candidate and output symlinks that escape the supplied workspace', () => {
    const allowedRoot = path.join(
      tempRoot,
      'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2',
    );
    const outsideTier = path.join(outsideRoot, 'tier');
    const publicRoot = path.join(tempRoot, 'packages/app/public');
    mkdirSync(allowedRoot, { recursive: true });
    mkdirSync(outsideTier, { recursive: true });
    mkdirSync(publicRoot, { recursive: true });
    writeFileSync(path.join(outsideTier, 'model.compact.txt'), 'outside model', 'utf8');
    writeFileSync(path.join(outsideTier, 'manifest.json'), '{"releaseEligible":false}\n', 'utf8');
    writeFileSync(
      path.join(publicRoot, 'baseline-ngram.web-local.compact.txt'),
      'old model',
      'utf8',
    );
    writeFileSync(
      path.join(publicRoot, 'baseline-ngram.web-local.compact.manifest.json'),
      '{"runtimeEligible":false}\n',
      'utf8',
    );
    try {
      symlinkSync(outsideTier, path.join(allowedRoot, '0.1mib'), 'junction');
      symlinkSync(outsideRoot, path.join(tempRoot, 'output-link'), 'junction');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    expect(() =>
      installRuntimeCandidate(tempRoot, {
        id: '0.1mib',
        modelSha256: 'a'.repeat(64),
        modelBytes: 13,
        candidateDirectory:
          'scripts/corpus/_web-cache/autocomplete-candidates/learning-curve-v2/0.1mib',
      }),
    ).toThrow(/symlink escapes the workspace/u);
    expect(() => resolveWorkspaceOutput(tempRoot, 'output-link/runtime.json')).toThrow(
      /parent symlink escapes the workspace/u,
    );
  });
});

function tier(
  id: string,
  requestedBytes: number,
  runtimeMeasurementRequired: boolean,
): LearningCurveReport['tiers'][number] {
  return {
    id,
    requestedBytes,
    runtimeMeasurementRequired,
  } as LearningCurveReport['tiers'][number];
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
