import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Exact source closure whose bytes define the deterministic and runtime
 * autocomplete evaluators. Keep this list ordered: its order is part of the
 * tree identity and prevents an evidence file from choosing its own scope.
 */
export const AUTOCOMPLETE_EVIDENCE_SOURCE_FILES = Object.freeze([
  'scripts/autocomplete-evidence-integrity.mjs',
  'scripts/autocomplete-model-evaluator.ts',
  'scripts/autocomplete-v1-frozen-adapter.ts',
  'scripts/generate-autocomplete-synthetic-corpus.ts',
  'scripts/publish-autocomplete-final.ts',
  'scripts/run-autocomplete-final-evaluation.ts',
  'scripts/run-autocomplete-learning-curve.ts',
  'scripts/run-autocomplete-post-final-rc.ts',
  'scripts/run-autocomplete-runtime-candidates.ts',
  'scripts/run-autocomplete-workspace-final-runtime.ts',
  'scripts/train-baseline.ts',
  'scripts/verify-autocomplete-evidence.mjs',
  'scripts/web-corpus-utils.ts',
  'scripts/workspace-final-holdout.ts',
  'e2e/tests/25-autocomplete-runtime-evidence.spec.ts',
  'e2e/tests/26-autocomplete-workspace-final-runtime.spec.ts',
  'e2e/tauri/tauri-webview-smoke.spec.mjs',
  'packages/app/src/services/CompletionSettings.ts',
  'packages/app/src/services/CompletionTrainingService.ts',
  'packages/app/src/services/MarkdownPredictor.ts',
  'packages/app/src/services/completion/context.ts',
  'packages/app/src/services/completion/engine-router.ts',
  'packages/app/src/services/completion/hybrid-retrieval-backend.ts',
  'packages/app/src/services/completion/hybrid-retrieval-core.ts',
  'packages/app/src/services/completion/hybrid-retrieval-types.ts',
  'packages/app/src/services/completion/hybrid-retrieval.worker.ts',
  'packages/app/src/services/completion/learning-repository.ts',
  'packages/app/src/services/completion/learning-signals.ts',
  'packages/app/src/services/completion/metrics.ts',
  'packages/app/src/services/completion/providers.ts',
  'packages/app/src/services/completion/quality-gate.ts',
  'packages/app/src/services/completion/resolver.ts',
  'packages/app/src/services/completion/types.ts',
  'packages/app/src/utils/ngram-engine.ts',
  'packages/app/src/utils/word-ngram-engine.ts',
  'packages/app/src/utils/cm6-ghost-text.ts',
  'packages/app/src/utils/e2e-bridge.ts',
  'packages/app/src/components/editor/MarkdownEditor.vue',
  'packages/app/src/pages/NotebookHome.vue',
  'packages/app/src-tauri/src/completion_retrieval.rs',
  'packages/app/src-tauri/src/lib.rs',
  'packages/app/src-tauri/fixtures/completion-retrieval-golden.json',
]);

/**
 * V2R extends the legacy evaluator closure instead of mutating it. This keeps
 * current fail-closed v4 evidence reproducible while requiring every neural
 * runtime, corpus, training, and v5 verification source for a future release.
 */
export const AUTOCOMPLETE_V2R_EVIDENCE_SOURCE_FILES = Object.freeze([
  ...AUTOCOMPLETE_EVIDENCE_SOURCE_FILES,
  'scripts/verify-autocomplete-v2r-evidence.mjs',
  'scripts/aggregate-autocomplete-v2r-evidence.ts',
  'scripts/audit-autocomplete-v2r-final-overlap.ts',
  'scripts/collect-autocomplete-v2r-external.ts',
  'scripts/materialize-autocomplete-v2r-corpus.ts',
  'scripts/measure-autocomplete-v2r-bundle.ts',
  'scripts/publish-autocomplete-v2r-final.ts',
  'scripts/build-autocomplete-v2r-training-data.ts',
  'scripts/build-autocomplete-v2r-runtime.ts',
  'scripts/build-autocomplete-v2r-evaluation-bundle.ts',
  'scripts/run-autocomplete-v2r-training-matrix.ts',
  'scripts/run-autocomplete-v2r-post-final-rc.ts',
  'scripts/run-autocomplete-v2r-holdout.ts',
  'scripts/print-autocomplete-v2r-holdout-sha.ts',
  'scripts/build-autocomplete-v2r-evaluator-tree.mjs',
  'scripts/release-rc-gate.mjs',
  'scripts/corpus/autocomplete-v2r-generator.json',
  'scripts/corpus/autocomplete-v2r-external.json',
  'scripts/corpus/tatoeba-cc0-cleaning-report.json',
  'scripts/corpus/autocomplete-v2r-holdouts/README.md',
  'scripts/corpus/autocomplete-v2r-architecture-stop.json',
  'scripts/corpus/licenses/tatoeba-cc0.md',
  'scripts/autocomplete-v2r/requirements.lock.txt',
  'scripts/autocomplete-v2r/train_phrase_transformer.py',
  'scripts/autocomplete-v2r/common.ts',
  'scripts/autocomplete-v2r/clean_tatoeba_cc0.py',
  'scripts/autocomplete-v2r/context-window.ts',
  'scripts/autocomplete-v2r/corpus-governance.ts',
  'scripts/autocomplete-v2r/external-corpus.ts',
  'scripts/autocomplete-v2r/final-overlap-audit.ts',
  'scripts/autocomplete-v2r/generator-v3.ts',
  'scripts/autocomplete-v2r/holdout-v3.ts',
  'scripts/autocomplete-v2r/index.ts',
  'scripts/autocomplete-v2r/manifest-v5.ts',
  'scripts/autocomplete-v2r/metrics.ts',
  'scripts/autocomplete-v2r/phrase-extraction.ts',
  'scripts/autocomplete-v2r/phrase-bank-representation.ts',
  'scripts/autocomplete-v2r/release-evidence.ts',
  'scripts/autocomplete-v2r/training-data.ts',
  'scripts/autocomplete-v2r/workspace.ts',
  'packages/app/src/services/completion/public-engine-types.ts',
  'packages/app/src/services/completion/public-v2s-cache.ts',
  'e2e/tests/27-autocomplete-v2r-evidence.spec.ts',
  'packages/app/playwright.config.ts',
  '.github/workflows/autocomplete-v2r-rc.yml',
  'package.json',
  'packages/app/package.json',
  'packages/app/vite.config.ts',
  'pnpm-lock.yaml',
]);

/**
 * V2S is the only future production public-engine line. Its evidence closure
 * is intentionally independent from the stopped V2R sources and from the
 * frozen V1 comparison snapshot.
 */
export const AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES = Object.freeze([
  'scripts/autocomplete-evidence-integrity.mjs',
  'scripts/verify-autocomplete-v2s-evidence.mjs',
  'scripts/build-autocomplete-v2s-evaluator-tree.mjs',
  'scripts/publish-autocomplete-v2s-final.ts',
  'scripts/release-rc-gate.mjs',
  'scripts/autocomplete-v2s/architecture-stop.ts',
  'scripts/autocomplete-v2s/cli.ts',
  'scripts/autocomplete-v2s/combine-language-candidates.ts',
  'scripts/autocomplete-v2s/common.ts',
  'scripts/autocomplete-v2s/container-v6.ts',
  'scripts/autocomplete-v2s/diagnostic.ts',
  'scripts/autocomplete-v2s/evaluator.ts',
  'scripts/autocomplete-v2s/gate.ts',
  'scripts/autocomplete-v2s/holdout.ts',
  'scripts/autocomplete-v2s/index.ts',
  'scripts/autocomplete-v2s/matrix.ts',
  'scripts/autocomplete-v2s/metrics.ts',
  'scripts/autocomplete-v2s/mkn.ts',
  'scripts/autocomplete-v2s/repack-gate.ts',
  'scripts/autocomplete-v2s/replay-evidence.ts',
  'scripts/autocomplete-v2s/selection.ts',
  'scripts/autocomplete-v2s/tokenizer.ts',
  'scripts/autocomplete-v2s/tokenizer_reference.py',
  'scripts/autocomplete-v2s/trainer.ts',
  'packages/app/src/services/MarkdownPredictor.ts',
  'packages/app/src/services/CompletionSettings.ts',
  'packages/app/src/services/CompletionTrainingService.ts',
  'packages/app/src/services/completion/context.ts',
  'packages/app/src/services/completion/engine-router.ts',
  'packages/app/src/services/completion/hybrid-retrieval-backend.ts',
  'packages/app/src/services/completion/hybrid-retrieval-core.ts',
  'packages/app/src/services/completion/hybrid-retrieval-types.ts',
  'packages/app/src/services/completion/hybrid-retrieval.worker.ts',
  'packages/app/src/services/completion/learning-repository.ts',
  'packages/app/src/services/completion/learning-signals.ts',
  'packages/app/src/services/completion/metrics.ts',
  'packages/app/src/services/completion/providers.ts',
  'packages/app/src/services/completion/public-engine-types.ts',
  'packages/app/src/services/completion/public-v2s-binary.ts',
  'packages/app/src/services/completion/public-v2s-engine.ts',
  'packages/app/src/services/completion/public-v2s-factory.ts',
  'packages/app/src/services/completion/public-v2s-protocol.ts',
  'packages/app/src/services/completion/public-v2s.worker.ts',
  'packages/app/src/services/completion/quality-gate.ts',
  'packages/app/src/services/completion/resolver.ts',
  'packages/app/src/services/completion/types.ts',
  'packages/app/src/utils/ngram-engine.ts',
  'packages/app/src/utils/word-ngram-engine.ts',
  'packages/app/package.json',
  'packages/app/vite.config.ts',
  'pnpm-lock.yaml',
  '.github/workflows/autocomplete-rc.yml',
]);

export const FROZEN_V1_EXPECTED_IDENTITY = Object.freeze({
  snapshotId: 'v1-frozen-fb46b1e',
  commit: 'fb46b1e',
  runnerId: 'v1-frozen-fb46b1e-independent-runner-v2',
  productionEligible: false,
  modelSha256: '1ab73f76357dc1e383990103aead0908213c042443cd541b906f3814d53882f5',
  modelBytes: 5_978_321,
  treeSha256: '664a107de8919c70280b0fbf864716bbead3e1632e7fa4b22f20ff52515dfffd',
  observationPatchSha256: '9df0e2e9e16ca639ef3750e42421ec97519930c76a88aaf666a55051d80ec16f',
  sourcePaths: Object.freeze([
    'src/services/CompletionSettings.ts',
    'src/services/MarkdownPredictor.ts',
    'src/services/completion/context.ts',
    'src/services/completion/providers.ts',
    'src/services/completion/resolver.ts',
    'src/services/completion/types.ts',
    'src/services/completion/metrics.ts',
    'src/services/completion/learning-signals.ts',
    'src/utils/ngram-engine.ts',
  ]),
});

export function verifyEvaluatorSourceTree(
  rootDir,
  identity,
  expectedFiles = AUTOCOMPLETE_EVIDENCE_SOURCE_FILES,
) {
  if (identity?.schemaVersion !== 1 || !Array.isArray(identity.files)) {
    throw new Error('Evaluator source-tree identity is invalid.');
  }
  if (
    identity.files.length !== expectedFiles.length ||
    identity.files.some((item, index) => item?.path !== expectedFiles[index])
  ) {
    throw new Error('Evaluator source-tree file set is incomplete or reordered.');
  }
  const files = expectedFiles.map((relativePath, index) => {
    const item = identity.files[index];
    const absolutePath = resolveWorkspaceFile(rootDir, relativePath);
    const actualSha256 = sha256(readFileSync(absolutePath));
    if (item.sha256 !== actualSha256) {
      throw new Error(`Evaluator source SHA mismatch: ${relativePath}.`);
    }
    return { path: relativePath, sha256: actualSha256 };
  });
  const treeSha256 = sha256(canonicalJson(files));
  if (identity.treeSha256 !== treeSha256) {
    throw new Error('Evaluator aggregate source-tree SHA is invalid.');
  }
  return { files, treeSha256 };
}

export function verifyFrozenV1Snapshot(
  rootDir,
  manifestRelativePath,
  manifest,
  expected = FROZEN_V1_EXPECTED_IDENTITY,
) {
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.snapshotId !== expected.snapshotId ||
    manifest.commit !== expected.commit ||
    manifest.runnerId !== expected.runnerId ||
    manifest.productionEligible !== expected.productionEligible ||
    manifest.observationPatchSha256 !== expected.observationPatchSha256 ||
    !Array.isArray(manifest.sourceFiles)
  ) {
    throw new Error('Frozen V1 snapshot identity is invalid.');
  }
  if (
    manifest.sourceFiles.length !== expected.sourcePaths.length ||
    manifest.sourceFiles.some((item, index) => item?.snapshotPath !== expected.sourcePaths[index])
  ) {
    throw new Error('Frozen V1 source-file set is incomplete or reordered.');
  }

  const manifestPath = resolveWorkspaceFile(rootDir, manifestRelativePath);
  const snapshotRoot = path.dirname(manifestPath);
  const modelPath = resolveSnapshotFile(snapshotRoot, manifest.model?.path);
  const compressed = readFileSync(modelPath);
  if (
    manifest.model?.compression !== 'gzip-level-9-mtime-0' ||
    compressed.byteLength !== manifest.model.compressedBytes ||
    sha256(compressed) !== manifest.model.compressedSha256
  ) {
    throw new Error('Frozen V1 compressed model does not match its manifest.');
  }
  let uncompressed;
  try {
    uncompressed = gunzipSync(compressed);
  } catch (error) {
    throw new Error(`Frozen V1 compressed model is invalid: ${String(error)}.`);
  }
  if (
    uncompressed.byteLength !== manifest.model.uncompressedBytes ||
    sha256(uncompressed) !== manifest.model.uncompressedSha256 ||
    uncompressed.byteLength !== expected.modelBytes ||
    sha256(uncompressed) !== expected.modelSha256
  ) {
    throw new Error('Frozen V1 uncompressed model identity is invalid.');
  }

  for (const file of manifest.sourceFiles) {
    const snapshotPath = resolveSnapshotFile(snapshotRoot, file.snapshotPath);
    if (
      !isSha256(file.upstreamSha256) ||
      sha256(readFileSync(snapshotPath)) !== file.snapshotSha256
    ) {
      throw new Error(`Frozen V1 source does not match its manifest: ${file.snapshotPath}.`);
    }
    if (file.observationPatched !== true && file.upstreamSha256 !== file.snapshotSha256) {
      throw new Error(`Frozen V1 source unexpectedly differs from fb46b1e: ${file.snapshotPath}.`);
    }
  }
  const runnerSha256 = sha256(readFileSync(resolveSnapshotFile(snapshotRoot, 'runner.ts')));
  const tsconfigSha256 = sha256(readFileSync(resolveSnapshotFile(snapshotRoot, 'tsconfig.json')));
  if (runnerSha256 !== manifest.runnerSha256 || tsconfigSha256 !== manifest.tsconfigSha256) {
    throw new Error('Frozen V1 runner or tsconfig does not match its manifest.');
  }
  const { treeSha256, ...core } = manifest;
  const actualTreeSha256 = sha256(canonicalJson(core));
  if (treeSha256 !== actualTreeSha256 || treeSha256 !== expected.treeSha256) {
    throw new Error('Frozen V1 aggregate tree SHA is invalid.');
  }
  return {
    treeSha256: actualTreeSha256,
    modelSha256: expected.modelSha256,
    modelBytes: expected.modelBytes,
  };
}

export function resolveWorkspaceFile(rootDir, relativePath) {
  const realRoot = realpathSync(path.resolve(rootDir));
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Evidence path must be workspace-relative: ${String(relativePath)}.`);
  }
  const resolved = path.resolve(realRoot, relativePath);
  if (!isWithin(resolved, realRoot)) {
    throw new Error(`Evidence path escapes the workspace: ${relativePath}.`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`Evidence file does not exist: ${relativePath}.`);
  }
  const real = realpathSync(resolved);
  if (!isWithin(real, realRoot)) {
    throw new Error(`Evidence symlink escapes the workspace: ${relativePath}.`);
  }
  return real;
}

function resolveSnapshotFile(snapshotRoot, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Frozen V1 path must be snapshot-relative: ${String(relativePath)}.`);
  }
  const resolved = path.resolve(snapshotRoot, relativePath);
  if (!isWithin(resolved, snapshotRoot)) {
    throw new Error(`Frozen V1 path escapes the snapshot root: ${relativePath}.`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`Frozen V1 file does not exist: ${relativePath}.`);
  }
  const real = realpathSync(resolved);
  if (!isWithin(real, snapshotRoot)) {
    throw new Error(`Frozen V1 symlink escapes the snapshot root: ${relativePath}.`);
  }
  return real;
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
