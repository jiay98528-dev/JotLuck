import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES } from './autocomplete-evidence-integrity.mjs';
import { assertV2SArchitectureActive } from './autocomplete-v2s/architecture-stop';
// @ts-expect-error See scripts/verify-autocomplete-v2s-evidence.mjs.
import {
  prepareAutocompleteV2SPublication,
  verifyAutocompleteV2SEvidence,
} from './verify-autocomplete-v2s-evidence.mjs';

export interface PublishAutocompleteV2SFinalOptions {
  rootDir?: string;
  candidatePath: string;
  expectedEvaluatorFiles?: readonly string[];
}

export interface PublishAutocompleteV2SFinalResult {
  releaseId: string;
  assetPath: string;
  manifestPath: string;
}

interface PreparedPublication {
  assetBytes: Buffer;
  assetTarget: string;
  manifestText: string;
  manifestTarget: string;
  releaseId: string;
  stalePublicPaths: string[];
}

interface TransactionEntry {
  target: string;
  backup: string;
  existed: boolean;
}

export function publishAutocompleteV2SFinal(
  options: PublishAutocompleteV2SFinalOptions,
): PublishAutocompleteV2SFinalResult {
  const rootDir = fs.realpathSync(
    path.resolve(
      options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    ),
  );
  const expectedEvaluatorFiles =
    options.expectedEvaluatorFiles ?? AUTOCOMPLETE_V2S_EVIDENCE_SOURCE_FILES;

  assertV2SArchitectureActive(rootDir);

  // All evidence, metrics, hashes and the release id are recomputed before the
  // first filesystem mutation. A rejected candidate therefore performs zero
  // public writes.
  const prepared = prepareAutocompleteV2SPublication({
    rootDir,
    candidatePath: options.candidatePath,
    expectedEvaluatorFiles,
  }) as PreparedPublication;

  atomicPublish(rootDir, prepared, () => {
    const verified = verifyAutocompleteV2SEvidence({
      rootDir,
      mode: 'rc',
      expectedEvaluatorFiles,
    });
    if (verified.releaseId !== prepared.releaseId) {
      throw new Error('Post-install V2S release identity differs from the prepared release.');
    }
  });

  return {
    releaseId: prepared.releaseId,
    assetPath: prepared.assetTarget,
    manifestPath: prepared.manifestTarget,
  };
}

function atomicPublish(
  rootDir: string,
  prepared: PreparedPublication,
  verifyInstalled: () => void,
): void {
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const assetTarget = resolveOutput(rootDir, prepared.assetTarget);
  const manifestTarget = resolveOutput(rootDir, prepared.manifestTarget);
  const canonicalDir = path.dirname(manifestTarget);
  const canonicalDirExisted = fs.existsSync(canonicalDir);
  const backupRoot = path.join(rootDir, 'packages/app', `.autocomplete-publish-${token}`);
  const stagedAsset = `${assetTarget}.tmp-${token}`;
  const stagedManifest = `${manifestTarget}.tmp-${token}`;
  const staleTargets = new Set(
    [...prepared.stalePublicPaths, prepared.assetTarget, prepared.manifestTarget].map((item) =>
      resolveOutput(rootDir, item),
    ),
  );
  const transaction: TransactionEntry[] = [];
  let committedAsset = false;
  let committedManifest = false;

  try {
    fs.mkdirSync(canonicalDir, { recursive: true });
    writeAndSync(stagedAsset, prepared.assetBytes);
    writeAndSync(stagedManifest, Buffer.from(prepared.manifestText, 'utf8'));
    fs.mkdirSync(backupRoot, { recursive: false });

    for (const [index, target] of [...staleTargets].entries()) {
      const existed = fs.existsSync(target);
      const backup = path.join(backupRoot, String(index));
      transaction.push({ target, backup, existed });
      if (existed) fs.renameSync(target, backup);
    }

    fs.renameSync(stagedAsset, assetTarget);
    committedAsset = true;
    // The canonical manifest is the state-transition point and is committed
    // last, after the content-addressed asset is fully durable.
    fs.renameSync(stagedManifest, manifestTarget);
    committedManifest = true;
    verifyInstalled();

    for (const item of transaction) {
      try {
        if (item.existed && fs.existsSync(item.backup)) fs.unlinkSync(item.backup);
      } catch (error) {
        writeWarning(`Could not remove completed V2S backup ${item.backup}: ${String(error)}`);
      }
    }
    try {
      if (fs.existsSync(backupRoot) && fs.readdirSync(backupRoot).length === 0) {
        fs.rmdirSync(backupRoot);
      }
    } catch (error) {
      writeWarning(`Could not remove completed V2S backup directory: ${String(error)}`);
    }
  } catch (error) {
    if (committedManifest && fs.existsSync(manifestTarget)) fs.unlinkSync(manifestTarget);
    if (committedAsset && fs.existsSync(assetTarget)) fs.unlinkSync(assetTarget);
    for (const item of [...transaction].reverse()) {
      if (item.existed && fs.existsSync(item.backup)) fs.renameSync(item.backup, item.target);
    }
    if (fs.existsSync(stagedManifest)) fs.unlinkSync(stagedManifest);
    if (fs.existsSync(stagedAsset)) fs.unlinkSync(stagedAsset);
    if (fs.existsSync(backupRoot) && fs.readdirSync(backupRoot).length === 0) {
      fs.rmdirSync(backupRoot);
    }
    if (
      !canonicalDirExisted &&
      fs.existsSync(canonicalDir) &&
      fs.readdirSync(canonicalDir).length === 0
    ) {
      fs.rmdirSync(canonicalDir);
    }
    throw error;
  }
}

function writeAndSync(target: string, bytes: Buffer): void {
  fs.writeFileSync(target, bytes);
  const descriptor = fs.openSync(target, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function resolveOutput(rootDir: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`V2S output path must be workspace-relative: ${relativePath}.`);
  }
  const resolved = path.resolve(rootDir, relativePath);
  if (!isWithin(resolved, rootDir)) {
    throw new Error(`V2S output escapes the workspace: ${relativePath}.`);
  }
  const expectedPublicRoot = path.join(rootDir, 'packages/app/public');
  if (!isWithin(resolved, expectedPublicRoot)) {
    throw new Error(`V2S publisher may only mutate packages/app/public: ${relativePath}.`);
  }
  const ancestor = findExistingAncestor(resolved);
  if (!isWithin(fs.realpathSync(ancestor), rootDir)) {
    throw new Error(`V2S output parent symlink escapes the workspace: ${relativePath}.`);
  }
  if (fs.existsSync(resolved) && !isWithin(fs.realpathSync(resolved), rootDir)) {
    throw new Error(`V2S output symlink escapes the workspace: ${relativePath}.`);
  }
  return resolved;
}

function findExistingAncestor(value: string): string {
  let current = value;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Cannot resolve an existing parent for ${value}.`);
    current = parent;
  }
  return fs.statSync(current).isDirectory() ? current : path.dirname(current);
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeWarning(message: string): void {
  process.stderr.write(`${message}\n`);
}

function readArg(argv: string[], name: string): string | undefined {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const candidatePath = readArg(process.argv.slice(2), '--candidate');
    if (!candidatePath)
      throw new Error('Usage: publish-autocomplete-v2s-final --candidate <path>.');
    const result = publishAutocompleteV2SFinal({
      rootDir: readArg(process.argv.slice(2), '--root'),
      candidatePath,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
