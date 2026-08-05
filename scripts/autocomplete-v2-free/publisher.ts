import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  computeV2FreeCandidateArtifactSha256,
  V2_FREE_STATIC_LIMIT_BYTES,
  assessV2FreeCandidate,
  type V2FreeCandidateEvidence,
} from './contract';
import {
  parsePublicFreeDecoderManifest,
  type PublicFreeDecoderAsset,
  type PublicFreeDecoderManifest,
} from '../../packages/app/src/services/completion/public-free-decoder-contract';

type EvaluationManifest = PublicFreeDecoderManifest & {
  lifecycle: 'oraclePassed';
  evaluationOnly: true;
  releaseEligible: false;
  releaseEvidence?: never;
};

export interface PublishV2FreeOptions {
  workspaceRoot: string;
  candidateDirectory: string;
  evidencePath: string;
  windowsGuiEvidencePath: string;
}

export interface PublishV2FreeResult {
  candidateId: string;
  manifestSha256: string;
  frontendManifestPath: string;
  resourceManifestPath: string;
}

/**
 * The only writer for a canonical V2 free engine. Tauri bundles the resource
 * directory, while the frontend receives only the small canonical manifest.
 */
export function publishV2FreeCanonical(options: PublishV2FreeOptions): PublishV2FreeResult {
  const root = path.resolve(options.workspaceRoot);
  const candidateDirectory = resolveInside(root, options.candidateDirectory);
  const candidateRoot = resolveInside(
    root,
    'scripts/corpus/_web-cache/autocomplete-v2-free/candidates',
  );
  if (!isWithin(candidateDirectory, candidateRoot) || candidateDirectory === candidateRoot) {
    throw new Error('V2 free publisher candidate escaped the isolated candidate root.');
  }
  const evidence = readJson<V2FreeCandidateEvidence>(resolveInside(root, options.evidencePath));
  const assessment = assessV2FreeCandidate(evidence);
  if (!assessment.passed || assessment.stage !== 'release-eligible') {
    throw new Error(`V2 free candidate is not release-eligible: ${assessment.failures.join(',')}`);
  }
  const evaluationManifestPath = path.join(candidateDirectory, 'evaluation-manifest.json');
  const { manifest, bytes: evaluationManifestBytes } =
    readEvaluationManifest(evaluationManifestPath);
  if (manifest.candidateId !== evidence.candidateId) {
    throw new Error('V2 free candidate/evidence identity mismatch.');
  }
  const model = readBoundAsset(candidateDirectory, manifest.assets.model);
  const tokenizer = readBoundAsset(candidateDirectory, manifest.assets.tokenizer);
  const candidateArtifactSha256 = computeV2FreeCandidateArtifactSha256({
    candidateId: manifest.candidateId,
    parameterCount: manifest.parameterCount,
    quantization: manifest.quantization,
    model: manifest.assets.model,
    tokenizer: manifest.assets.tokenizer,
  });
  if (
    candidateArtifactSha256 !== manifest.candidateArtifactSha256 ||
    candidateArtifactSha256 !== evidence.candidateArtifactSha256
  ) {
    throw new Error('V2 free candidate asset/evidence hash mismatch.');
  }
  if (
    evidence.parameterCount !== manifest.parameterCount ||
    evidence.quantization !== manifest.quantization ||
    evidence.peakMemoryBytes !== manifest.measuredPeakMemoryBytes ||
    evidence.licenseAuditPassed !== manifest.training.licenseAuditPassed ||
    evidence.staticBytes !==
      evaluationManifestBytes.byteLength +
        model.byteLength +
        tokenizer.byteLength +
        manifest.runtimeStaticDeltaBytes ||
    evidence.oracle.checkpoints !== manifest.oraclePrecheck.checkpoints ||
    evidence.oracle.at8.rate !== manifest.oraclePrecheck.oracleAt8 ||
    evidence.oracle.at32.rate !== manifest.oraclePrecheck.oracleAt32 ||
    evidence.oracle.byLanguage.zh.at8Rate !== manifest.oraclePrecheck.chineseOracleAt8 ||
    evidence.oracle.byLanguage.en.at8Rate !== manifest.oraclePrecheck.englishOracleAt8
  ) {
    throw new Error('V2 free manifest does not match its measured evidence.');
  }
  const windowsGuiEvidencePath = resolveInside(root, options.windowsGuiEvidencePath);
  const windowsGuiEvidence = readFileSync(windowsGuiEvidencePath);
  if (sha256(windowsGuiEvidence) !== evidence.windowsGuiEvidenceSha256) {
    throw new Error('Windows GUI evidence identity mismatch.');
  }
  const coldFinalSha256 = canonicalSha256(evidence.coldFinal);
  const workspaceFinalSha256 = canonicalSha256(evidence.workspaceFinal);
  const baselineSha256 = evidence.coldFinal?.baselineSha256;
  if (!baselineSha256 || baselineSha256 !== evidence.workspaceFinal?.baselineSha256) {
    throw new Error('V2 free finals do not bind the same baseline.');
  }
  const releaseManifest = {
    ...manifest,
    lifecycle: 'releaseEligible' as const,
    evaluationOnly: false,
    releaseEligible: true,
    releaseEvidence: {
      schema: 'jotluck.autocomplete.public-free-decoder-release.v1',
      coldFinalSha256,
      workspaceFinalSha256,
      windowsGuiEvidenceSha256: sha256(windowsGuiEvidence),
      baselineSha256,
    },
  };
  const manifestBytes = Buffer.from(`${canonicalJson(releaseManifest)}\n`, 'utf8');
  const staticBytes =
    manifestBytes.byteLength * 2 +
    model.byteLength +
    tokenizer.byteLength +
    manifest.runtimeStaticDeltaBytes;
  if (staticBytes > V2_FREE_STATIC_LIMIT_BYTES) {
    throw new Error('Release packaging exceeds the 24 MiB static budget.');
  }

  const frontendTarget = path.join(root, 'packages/app/public/autocomplete');
  const resourceTarget = path.join(root, 'packages/app/src-tauri/resources/autocomplete');
  const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
  const frontendStage = `${frontendTarget}.stage-${token}`;
  const resourceStage = `${resourceTarget}.stage-${token}`;
  const frontendBackup = `${frontendTarget}.backup-${token}`;
  const resourceBackup = `${resourceTarget}.backup-${token}`;
  try {
    mkdirSync(frontendStage, { recursive: false });
    mkdirSync(resourceStage, { recursive: false });
    writeDurable(path.join(frontendStage, 'autocomplete-public.manifest.json'), manifestBytes);
    writeDurable(path.join(resourceStage, 'autocomplete-public.manifest.json'), manifestBytes);
    writeDurable(path.join(resourceStage, manifest.assets.model.file), model);
    writeDurable(path.join(resourceStage, manifest.assets.tokenizer.file), tokenizer);
    swapDirectory(frontendTarget, frontendStage, frontendBackup);
    try {
      swapDirectory(resourceTarget, resourceStage, resourceBackup);
    } catch (error) {
      restoreDirectory(frontendTarget, frontendBackup);
      throw error;
    }
    verifyInstalled(frontendTarget, resourceTarget, releaseManifest, manifestBytes);
    rmSync(frontendBackup, { recursive: true, force: true });
    rmSync(resourceBackup, { recursive: true, force: true });
  } catch (error) {
    restoreDirectory(frontendTarget, frontendBackup);
    restoreDirectory(resourceTarget, resourceBackup);
    rmSync(frontendStage, { recursive: true, force: true });
    rmSync(resourceStage, { recursive: true, force: true });
    throw error;
  }
  return {
    candidateId: evidence.candidateId,
    manifestSha256: sha256(manifestBytes),
    frontendManifestPath: path
      .relative(root, path.join(frontendTarget, 'autocomplete-public.manifest.json'))
      .replaceAll('\\', '/'),
    resourceManifestPath: path
      .relative(root, path.join(resourceTarget, 'autocomplete-public.manifest.json'))
      .replaceAll('\\', '/'),
  };
}

function readEvaluationManifest(filePath: string): {
  manifest: EvaluationManifest;
  bytes: Buffer;
} {
  const bytes = readFileSync(filePath);
  const value = JSON.parse(bytes.toString('utf8')) as unknown;
  const manifest = parsePublicFreeDecoderManifest(value, bytes.byteLength);
  if (manifest.evaluationOnly !== true || manifest.releaseEligible !== false) {
    throw new Error('V2 free evaluation manifest is invalid.');
  }
  return { manifest: manifest as EvaluationManifest, bytes };
}

function readBoundAsset(directory: string, asset: PublicFreeDecoderAsset): Buffer {
  const target = path.join(directory, asset.file);
  const canonical = path.resolve(target);
  if (path.dirname(canonical) !== directory)
    throw new Error('Candidate asset escaped its directory.');
  const bytes = readFileSync(canonical);
  if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256) {
    throw new Error(`Candidate asset identity mismatch: ${asset.file}`);
  }
  return bytes;
}

function swapDirectory(target: string, stage: string, backup: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) renameSync(target, backup);
  renameSync(stage, target);
}

function restoreDirectory(target: string, backup: string): void {
  if (!existsSync(backup)) return;
  rmSync(target, { recursive: true, force: true });
  renameSync(backup, target);
}

function verifyInstalled(
  frontend: string,
  resources: string,
  manifest: Pick<EvaluationManifest, 'assets'>,
  manifestBytes: Buffer,
): void {
  for (const root of [frontend, resources]) {
    if (
      sha256(readFileSync(path.join(root, 'autocomplete-public.manifest.json'))) !==
      sha256(manifestBytes)
    ) {
      throw new Error('Installed canonical manifest identity mismatch.');
    }
  }
  for (const asset of [manifest.assets.model, manifest.assets.tokenizer]) {
    const bytes = readFileSync(path.join(resources, asset.file));
    if (bytes.byteLength !== asset.bytes || sha256(bytes) !== asset.sha256) {
      throw new Error('Installed canonical asset identity mismatch.');
    }
  }
}

function writeDurable(target: string, bytes: Buffer): void {
  writeFileSync(target, bytes, { flag: 'wx' });
  const descriptor = openSync(target, 'r+');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function resolveInside(root: string, value: string): string {
  if (!value || path.isAbsolute(value) || value.replaceAll('\\', '/').split('/').includes('..')) {
    throw new Error('V2 free publisher path is unsafe.');
  }
  const resolved = path.resolve(root, value);
  if (!isWithin(resolved, root)) throw new Error('V2 free publisher path escaped the workspace.');
  return resolved;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Canonical JSON cannot encode undefined.');
  return encoded;
}

function canonicalSha256(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArgument(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = publishV2FreeCanonical({
      workspaceRoot: process.cwd(),
      candidateDirectory: readArgument(process.argv, '--candidate'),
      evidencePath: readArgument(process.argv, '--evidence'),
      windowsGuiEvidencePath: readArgument(process.argv, '--windows-gui-evidence'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
