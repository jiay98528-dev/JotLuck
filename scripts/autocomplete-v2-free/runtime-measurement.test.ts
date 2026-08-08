import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { measureV2FreeRuntime, type RuntimeMeasurementDependencies } from './runtime-measurement';

const temporaryRoots: string[] = [];
const CANDIDATE_SHA = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('Windows runtime measurement producer', () => {
  it('runs 10 warmups plus 100 measured requests and binds raw samples to hashes', async () => {
    const root = await fixtureWorkspace();
    let generated = 0;
    let closed = false;
    let clock = 0;
    let wallClock = 1_000_000;
    const deadlines: number[] = [];
    const dependencies: RuntimeMeasurementDependencies = {
      platform: 'win32',
      now: () => clock++,
      wallNow: () => wallClock++,
      async openSession() {
        return {
          ready: {
            protocolVersion: 1,
            engineId: 'public-v2-free-decoder-v1',
            candidateId: 'candidate-16m-q4',
            workerPid: 42,
            manifestBytes: 10,
            modelBytes: 20,
            tokenizerBytes: 30,
            runtimeStaticDeltaBytes: 0,
            peakMemoryLimitBytes: 192 * 1024 * 1024,
          },
          async generate(_requestId, request) {
            generated++;
            deadlines.push((request as { deadlineAt: number }).deadlineAt);
          },
          async close() {
            closed = true;
          },
        };
      },
      async startMemorySampler(processId) {
        expect(processId).toBe(42);
        return {
          async stop() {
            return [50_000_000, 70_000_000, 60_000_000];
          },
        };
      },
    };

    const result = await measureV2FreeRuntime(measurementOptions(root), dependencies);

    expect(generated).toBe(110);
    expect(closed).toBe(true);
    expect(result.artifact.measurement.warmupRequests).toBe(10);
    expect(result.artifact.measurement.measuredRequests).toBe(100);
    expect(result.artifact.measurement.memoryAccounting).toBe(
      'isolated-worker-absolute-working-set',
    );
    expect(result.artifact.measurement.memoryBaselineBytes).toBe(0);
    expect(new Set(deadlines)).toHaveLength(110);
    expect(deadlines[0]).toBe(1_005_000);
    expect(deadlines.at(-1)).toBe(1_005_109);
    expect(result.artifact.modelInferenceSamplesMs).toHaveLength(100);
    expect(result.artifact.modelP90Ms).toBe(1);
    expect(result.artifact.peakMemoryBytes).toBe(70_000_000);
    expect(result.artifact.runtimeStaticDeltaBytes).toBe(4);
    expect(result.artifact.candidateArtifactSha256).toBe(CANDIDATE_SHA);
    expect(result.artifact.workerExecutableSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.artifact.evaluatorTreeSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(await readFile(path.join(root, 'out/runtime.json'), 'utf8'))).toEqual(
      result.artifact,
    );
  });

  it('rejects empty memory sampling instead of manufacturing a peak claim', async () => {
    const root = await fixtureWorkspace();
    const dependencies: RuntimeMeasurementDependencies = {
      platform: 'win32',
      now: (() => {
        let clock = 0;
        return () => clock++;
      })(),
      wallNow: () => Date.now(),
      async openSession() {
        return {
          ready: {
            protocolVersion: 1,
            engineId: 'public-v2-free-decoder-v1',
            candidateId: 'candidate-16m-q4',
            workerPid: 42,
            manifestBytes: 10,
            modelBytes: 20,
            tokenizerBytes: 30,
            runtimeStaticDeltaBytes: 0,
            peakMemoryLimitBytes: 192 * 1024 * 1024,
          },
          async generate() {},
          async close() {},
        };
      },
      async startMemorySampler() {
        return {
          async stop() {
            return [];
          },
        };
      },
    };
    await expect(measureV2FreeRuntime(measurementOptions(root), dependencies)).rejects.toThrow(
      /memory sampler/u,
    );
  });
});

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'jotluck-runtime-measurement-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'scripts/autocomplete-v2-free'), { recursive: true });
  await mkdir(path.join(root, 'candidate'), { recursive: true });
  await mkdir(path.join(root, 'bin'), { recursive: true });
  await mkdir(path.join(root, 'out'), { recursive: true });
  for (const file of [
    'contract.ts',
    'evaluation-manifest.ts',
    'evaluator.ts',
    'holdout-validator.ts',
  ]) {
    await writeFile(path.join(root, 'scripts/autocomplete-v2-free', file), `${file}\n`);
  }
  await writeFile(
    path.join(root, 'candidate/manifest.json'),
    `${JSON.stringify({
      engine: 'public-v2-free-decoder-v1',
      candidateId: 'candidate-16m-q4',
      candidateArtifactSha256: CANDIDATE_SHA,
    })}\n`,
  );
  await writeFile(path.join(root, 'bin/worker.exe'), 'worker-bytes');
  await writeFile(path.join(root, 'bin/baseline.exe'), 'baseline');
  return root;
}

function measurementOptions(root: string) {
  return {
    workspaceRoot: root,
    workerExecutablePath: 'bin/worker.exe',
    runtimeBaselineExecutablePath: 'bin/baseline.exe',
    candidateManifestPath: 'candidate/manifest.json',
    outputPath: 'out/runtime.json',
    createdAt: '2026-08-08T00:00:00.000Z',
  };
}
