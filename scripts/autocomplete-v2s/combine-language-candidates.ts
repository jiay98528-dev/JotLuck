import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { assertV2SArchitectureActive } from './architecture-stop';
import { canonicalJson, sha256, V2S_ENGINE_ID } from './common';
import {
  finalizeV2SManifest,
  packV2SContainer,
  unpackV2SContainer,
  verifyV2SManifest,
  type V2SPublicModelManifest,
} from './container-v6';
import { resolveV2SCandidateDirectory } from './matrix';

export interface CombineV2SLanguageCandidatesOptions {
  workspaceRoot: string;
  zhCandidateId: string;
  enCandidateId: string;
  candidateId: string;
}

export interface V2SLanguageCombinationReport {
  schema: 'jotluck.autocomplete.v2s-language-combination.v1';
  engine: typeof V2S_ENGINE_ID;
  candidateId: string;
  formalResult: false;
  methodCorrection: 'per-language-tokenizer-selection';
  sources: {
    zh: { candidateId: string; manifestSha256: string; tokenizer: 'bpe' | 'unigram' };
    en: { candidateId: string; manifestSha256: string; tokenizer: 'bpe' | 'unigram' };
    gate: { candidateId: string; kind: 'g0-rules' | 'g1-mlp16-int8' };
  };
  containerBytes: number;
  assetBudgetBytes: number;
  note: 'candidate-only; gate must be recalibrated after architecture Oracle passes';
}

export async function combineV2SLanguageCandidates(
  options: CombineV2SLanguageCandidatesOptions,
): Promise<{ directory: string; manifest: V2SPublicModelManifest }> {
  assertV2SArchitectureActive(options.workspaceRoot);
  const [zh, en] = await Promise.all([
    loadCandidate(options.workspaceRoot, options.zhCandidateId),
    loadCandidate(options.workspaceRoot, options.enCandidateId),
  ]);
  assertCompatibleCandidates(zh.manifest, en.manifest);

  const zhSections = unpackV2SContainer(zh.asset).sections;
  const enSections = unpackV2SContainer(en.asset).sections;
  const requiredSection = (sections: ReadonlyMap<string, Uint8Array>, id: string) => {
    const value = sections.get(id);
    if (!value) throw new Error(`V2S source candidate is missing ${id}.`);
    return value;
  };
  const metadata = new TextEncoder().encode(
    canonicalJson({
      schema: 'jotluck.autocomplete.v2s-runtime-metadata.v1',
      engine: V2S_ENGINE_ID,
      candidateId: options.candidateId,
      maxOrder: zh.manifest.architecture.ngramOrders[1],
      providerId: V2S_ENGINE_ID,
      source: 'public-v2s',
      sourceLayer: 'l3',
    }),
  );
  const packed = packV2SContainer(
    [
      { id: 'tokenizer.zh', bytes: requiredSection(zhSections, 'tokenizer.zh') },
      { id: 'tokenizer.en', bytes: requiredSection(enSections, 'tokenizer.en') },
      { id: 'lm.zh', bytes: requiredSection(zhSections, 'lm.zh') },
      { id: 'lm.en', bytes: requiredSection(enSections, 'lm.en') },
      { id: 'gate', bytes: requiredSection(zhSections, 'gate') },
      { id: 'metadata', bytes: metadata },
    ],
    zh.manifest.architecture.assetBudgetBytes,
  );

  const finalDirectory = resolveV2SCandidateDirectory(options.workspaceRoot, options.candidateId);
  const temporaryDirectory = `${finalDirectory}.tmp-${process.pid}`;
  await mkdir(path.dirname(finalDirectory), { recursive: true });
  await rm(temporaryDirectory, { recursive: true, force: true });
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const assetPath = `${path
      .relative(options.workspaceRoot, finalDirectory)
      .replaceAll(path.sep, '/')}/public-v2s.bin`;
    const { manifestSha256: _zhManifestSha256, ...zhUnsigned } = zh.manifest;
    const manifest = finalizeV2SManifest({
      ...zhUnsigned,
      profile: 'candidate',
      candidateId: options.candidateId,
      architecture: {
        ...zh.manifest.architecture,
        tokenizers: {
          zh: zh.manifest.architecture.tokenizers.zh,
          en: en.manifest.architecture.tokenizers.en,
        },
      },
      asset: {
        path: assetPath,
        bytes: packed.bytes.byteLength,
        sha256: sha256(packed.bytes),
        containerHeaderSha256: packed.headerSha256,
      },
      evidenceBindings: {
        ...zh.manifest.evidenceBindings,
        zhCandidateManifest: zh.binding,
        enCandidateManifest: en.binding,
      },
      runtimeEligible: false,
      qualityGatePassed: false,
      releaseEligible: false,
      formalResult: false,
    });
    const report: V2SLanguageCombinationReport = {
      schema: 'jotluck.autocomplete.v2s-language-combination.v1',
      engine: V2S_ENGINE_ID,
      candidateId: options.candidateId,
      formalResult: false,
      methodCorrection: 'per-language-tokenizer-selection',
      sources: {
        zh: {
          candidateId: zh.manifest.candidateId,
          manifestSha256: zh.manifest.manifestSha256,
          tokenizer: zh.manifest.architecture.tokenizers.zh,
        },
        en: {
          candidateId: en.manifest.candidateId,
          manifestSha256: en.manifest.manifestSha256,
          tokenizer: en.manifest.architecture.tokenizers.en,
        },
        gate: {
          candidateId: zh.manifest.candidateId,
          kind: zh.manifest.architecture.gateKind,
        },
      },
      containerBytes: packed.bytes.byteLength,
      assetBudgetBytes: zh.manifest.architecture.assetBudgetBytes,
      note: 'candidate-only; gate must be recalibrated after architecture Oracle passes',
    };
    await Promise.all([
      writeFile(path.join(temporaryDirectory, 'public-v2s.bin'), packed.bytes),
      writeFile(
        path.join(temporaryDirectory, 'manifest.json'),
        `${canonicalJson(manifest)}\n`,
        'utf8',
      ),
      writeFile(
        path.join(temporaryDirectory, 'training-report.json'),
        `${canonicalJson(report)}\n`,
        'utf8',
      ),
    ]);
    await rename(temporaryDirectory, finalDirectory);
    return { directory: finalDirectory, manifest };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function loadCandidate(workspaceRoot: string, candidateId: string) {
  const directory = resolveV2SCandidateDirectory(workspaceRoot, candidateId);
  const [manifestRaw, asset] = await Promise.all([
    readFile(path.join(directory, 'manifest.json'), 'utf8'),
    readFile(path.join(directory, 'public-v2s.bin')),
  ]);
  const manifest = JSON.parse(manifestRaw) as V2SPublicModelManifest;
  verifyV2SManifest(manifest);
  if (
    manifest.engine !== V2S_ENGINE_ID ||
    manifest.profile !== 'candidate' ||
    manifest.runtimeEligible ||
    manifest.qualityGatePassed ||
    manifest.releaseEligible ||
    sha256(asset) !== manifest.asset.sha256 ||
    asset.byteLength !== manifest.asset.bytes
  ) {
    throw new Error(`V2S source candidate ${candidateId} is not a valid fail-closed candidate.`);
  }
  return {
    manifest,
    asset,
    binding: {
      path: `${path.relative(workspaceRoot, path.join(directory, 'manifest.json')).replaceAll(path.sep, '/')}`,
      sha256: sha256(manifestRaw),
    },
  };
}

function assertCompatibleCandidates(zh: V2SPublicModelManifest, en: V2SPublicModelManifest): void {
  if (
    zh.training.selectionSha256 !== en.training.selectionSha256 ||
    zh.training.inputTreeSha256 !== en.training.inputTreeSha256 ||
    zh.training.selectedDocumentCount !== en.training.selectedDocumentCount ||
    zh.training.selectedBytes !== en.training.selectedBytes ||
    zh.architecture.vocabularyLimitPerLanguage !== en.architecture.vocabularyLimitPerLanguage ||
    canonicalJson(zh.architecture.ngramOrders) !== canonicalJson(en.architecture.ngramOrders) ||
    zh.architecture.assetBudgetBytes !== en.architecture.assetBudgetBytes ||
    zh.architecture.gateKind !== en.architecture.gateKind ||
    zh.architecture.quantization !== en.architecture.quantization
  ) {
    throw new Error('V2S language candidates do not share one training and runtime identity.');
  }
}
