import { describe, expect, it } from 'vitest';

import {
  computeRemoteTrainingJobSha256,
  createRemoteBundleManifest,
  parseRemoteBundleManifest,
  parseRemoteTrainingJob,
  parseTrainingResult,
  type RemoteTrainingJob,
  type TrainingResult,
} from '../autocomplete-v2-free/remote/contract';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

function job(): RemoteTrainingJob {
  return {
    schema: 'jotluck.autocomplete.v2-free.remote-training-job.v1',
    jobId: 'v2-free-24m-q4-seed-42',
    sourceTree: { commit: '1'.repeat(40), tree: '2'.repeat(40), bundleSha256: HASH_A },
    recipe: {
      id: 'decoder-train-v1',
      relativePath: 'scripts/train-v2-free.mjs',
      sha256: HASH_B,
      arguments: ['--matrix', '24m-q4'],
    },
    selection: {
      matrixId: '24m-q4',
      parameterCount: 24_000_000,
      quantization: 'q4',
      candidateMatrixIds: ['24m-q4'],
    },
    model: {
      engine: 'public-v2-free-decoder-v1',
      candidateId: '24m-q4-seed-42',
      format: 'JLFDQ02',
    },
    seed: 42,
    inputs: [
      {
        id: 'corpus-v1',
        role: 'training-corpus',
        relativePath: 'training/corpus.jsonl',
        bytes: 4096,
        sha256: HASH_C,
      },
    ],
    resume: { mode: 'if-available', checkpointDirectory: 'training/checkpoints/job-42' },
    output: {
      rootDirectory: 'training/output/job-42',
      bundleName: '24m-q4-seed-42',
      statusPath: 'job-42/status.json',
      heartbeatPath: 'job-42/heartbeat.json',
    },
    deadlineAt: '2026-08-06T12:00:00.000Z',
  };
}

function result(status: TrainingResult['status']): TrainingResult {
  const base = {
    schema: 'jotluck.autocomplete.v2-free.remote-training-result.v1' as const,
    jobId: job().jobId,
    jobFileSha256: HASH_D,
    status,
    createdAt: '2026-08-05T12:00:00.000Z',
    heartbeatAt: '2026-08-05T12:01:00.000Z',
  };
  if (status === 'queued') return base;
  if (status === 'running') return { ...base, startedAt: '2026-08-05T12:00:01.000Z' };
  if (status === 'checkpointed') {
    return {
      ...base,
      startedAt: '2026-08-05T12:00:01.000Z',
      latestCheckpoint: {
        relativePath: 'checkpoints/step-10.bin',
        step: 10,
        score: 0.4,
        bytes: 1024,
        sha256: HASH_A,
        createdAt: '2026-08-05T12:00:30.000Z',
      },
    };
  }
  if (status === 'completed') {
    return {
      ...base,
      startedAt: '2026-08-05T12:00:01.000Z',
      finishedAt: '2026-08-05T12:02:00.000Z',
      outputBundle: { manifestPath: 'output/manifest.json', bytes: 2048, sha256: HASH_B },
    };
  }
  return {
    ...base,
    startedAt: '2026-08-05T12:00:01.000Z',
    finishedAt: '2026-08-05T12:02:00.000Z',
    failure: { code: 'training-failed', message: 'exit 1', retryable: false },
  };
}

describe('remote V2 free training contracts', () => {
  it('validates and content-addresses the complete remote job', () => {
    const parsed = parseRemoteTrainingJob(job());
    expect(parsed).toEqual(job());
    expect(computeRemoteTrainingJobSha256(parsed)).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      computeRemoteTrainingJobSha256({
        ...parsed,
        recipe: { ...parsed.recipe, arguments: [...parsed.recipe.arguments, '--changed'] },
      }),
    ).not.toBe(computeRemoteTrainingJobSha256(parsed));
  });

  it.each(['queued', 'running', 'checkpointed', 'completed', 'failed'] as const)(
    'accepts a valid %s result',
    (status) => expect(parseTrainingResult(result(status))).toEqual(result(status)),
  );

  it('rejects matrix drift, path traversal, invalid resume identity, and invalid terminal state', () => {
    const wrongMatrix = structuredClone(job());
    wrongMatrix.selection.parameterCount = 16_000_000;
    expect(() => parseRemoteTrainingJob(wrongMatrix)).toThrow(/selection matrix/u);

    const traversal = structuredClone(job());
    traversal.inputs[0]!.relativePath = '../secrets.txt';
    expect(() => parseRemoteTrainingJob(traversal)).toThrow(/relativePath/u);

    const requiredWithoutHash = structuredClone(job());
    requiredWithoutHash.resume.mode = 'required';
    expect(() => parseRemoteTrainingJob(requiredWithoutHash)).toThrow(/checkpointBundleSha256/u);

    const legacyFormat = structuredClone(job()) as unknown as Record<string, unknown>;
    (legacyFormat.model as Record<string, unknown>).format = 'JLFDQ01';
    expect(() => parseRemoteTrainingJob(legacyFormat)).toThrow(/model/u);

    const invalidCompleted = result('completed');
    delete invalidCompleted.outputBundle;
    expect(() => parseTrainingResult(invalidCompleted)).toThrow(/completed result state/u);
  });

  it('exports the 16M Q4/Q8 pair from one recipe and rejects standalone 16M Q8 training', () => {
    const shared16m = structuredClone(job());
    shared16m.selection = {
      matrixId: '16m-q4',
      parameterCount: 16_000_000,
      quantization: 'q4',
      candidateMatrixIds: ['16m-q4', '16m-q8'],
    };
    expect(parseRemoteTrainingJob(shared16m).selection.candidateMatrixIds).toEqual([
      '16m-q4',
      '16m-q8',
    ]);

    const standaloneQ8 = structuredClone(shared16m) as unknown as Record<string, unknown>;
    (standaloneQ8.selection as Record<string, unknown>).matrixId = '16m-q8';
    expect(() => parseRemoteTrainingJob(standaloneQ8)).toThrow(/selection.matrixId/u);
  });

  it('builds a sorted content-addressed manifest and rejects tampering', () => {
    const manifest = createRemoteBundleManifest({
      schema: 'jotluck.autocomplete.v2-free.remote-bundle.v1',
      jobId: job().jobId,
      sourceJobSha256: HASH_D,
      createdAt: '2026-08-05T12:02:00.000Z',
      files: [
        { relativePath: 'tokenizer.bin', role: 'tokenizer', bytes: 50, sha256: HASH_A },
        { relativePath: 'model.bin', role: 'model', bytes: 100, sha256: HASH_B },
      ],
    });
    expect(manifest.files.map((file) => file.relativePath)).toEqual(['model.bin', 'tokenizer.bin']);
    expect(manifest.totalBytes).toBe(150);
    expect(parseRemoteBundleManifest(manifest)).toEqual(manifest);

    const tampered = structuredClone(manifest);
    tampered.files[0]!.bytes += 1;
    expect(() => parseRemoteBundleManifest(tampered)).toThrow(/bundle identity/u);
  });
});
