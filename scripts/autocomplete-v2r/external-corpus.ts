import { access, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { canonicalSha256, sha256 } from './common';
import type { V2RCorpusCandidate, V2RCorpusSource } from './corpus-governance';
import { assertPathInsideV2RCache, normalizeRepositoryRelativePath } from './workspace';

const EXTERNAL_CONFIG_PATH = 'scripts/corpus/autocomplete-v2r-external.json';
const TATOEBA_CONTENT_ROOT =
  'scripts/corpus/_web-cache/autocomplete-v2r/generated-external/tatoeba/en';

interface ExternalSourceConfig {
  id: string;
  kind: 'tatoeba-cc0';
  language: 'en';
  category: 'reading-note';
  downloadUrl: string;
  rawCachePath: string;
  rawBytes: number;
  rawSha256: string;
  cleanedCachePath: string;
  cleanedBytes: number;
  cleanedSha256: string;
  cleaningReportPath: string;
  licenseSpdx: 'CC0-1.0';
  licenseEvidencePath: string;
  collectedAt: string;
  cleanerVersion: string;
}

interface ExternalSourceRegistry {
  schema: 'jotluck.autocomplete.v2r-external-sources.v1';
  schemaVersion: 1;
  sources: ExternalSourceConfig[];
}

interface TatoebaRow {
  id: number;
  text: string;
  sourceDate: string;
}

export interface LoadedExternalCorpus {
  documents: V2RCorpusCandidate[];
  sourceConfig: ExternalSourceConfig;
  cleaningReportSha256: string;
}

export async function loadOptionalTatoebaCc0Corpus(
  workspaceRoot: string,
): Promise<LoadedExternalCorpus | null> {
  const registry = JSON.parse(
    await readFile(path.join(workspaceRoot, EXTERNAL_CONFIG_PATH), 'utf8'),
  ) as ExternalSourceRegistry;
  if (
    registry.schema !== 'jotluck.autocomplete.v2r-external-sources.v1' ||
    registry.schemaVersion !== 1 ||
    registry.sources.length !== 1
  ) {
    throw new Error('V2R external source registry is invalid.');
  }
  const source = registry.sources[0]!;
  validateSourceConfig(source);
  const cleanedPath = path.resolve(workspaceRoot, ...source.cleanedCachePath.split('/'));
  try {
    await access(cleanedPath);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
  const [cleanedBytes, reportBytes] = await Promise.all([
    readFile(cleanedPath),
    readFile(path.join(workspaceRoot, source.cleaningReportPath)),
  ]);
  if (
    cleanedBytes.byteLength !== source.cleanedBytes ||
    sha256(cleanedBytes) !== source.cleanedSha256
  ) {
    throw new Error('Pinned Tatoeba CC0 cleaned cache identity is invalid.');
  }
  const report = JSON.parse(reportBytes.toString('utf8')) as Record<string, unknown>;
  const reportIdentity = { ...report };
  delete reportIdentity.reportSha256;
  if (
    report.schema !== 'jotluck.autocomplete.v2r-tatoeba-cleaning.v1' ||
    report.schemaVersion !== 1 ||
    report.cleanerVersion !== source.cleanerVersion ||
    report.rawSha256 !== source.rawSha256 ||
    report.rawBytes !== source.rawBytes ||
    report.outputSha256 !== source.cleanedSha256 ||
    report.outputBytes !== source.cleanedBytes ||
    report.reportSha256 !== canonicalSha256(reportIdentity)
  ) {
    throw new Error('Pinned Tatoeba CC0 cleaning report is invalid.');
  }
  const seen = new Set<number>();
  const documents = cleanedBytes
    .toString('utf8')
    .split(/\r?\n/gu)
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as TatoebaRow;
      if (
        !Number.isSafeInteger(row.id) ||
        row.id < 1 ||
        seen.has(row.id) ||
        typeof row.text !== 'string' ||
        Buffer.byteLength(row.text, 'utf8') < 20 ||
        /[\r\n\p{Script=Han}]/u.test(row.text) ||
        typeof row.sourceDate !== 'string'
      ) {
        throw new Error('Pinned Tatoeba CC0 cleaned row is invalid.');
      }
      seen.add(row.id);
      const documentId = `tatoeba-cc0-en-${row.id}`;
      return {
        documentId,
        sourceId: source.id,
        language: 'en' as const,
        category: 'reading-note' as const,
        relativePath: `${TATOEBA_CONTENT_ROOT}/${documentId}.md`,
        text: row.text,
      };
    });
  if (documents.length !== report.accepted) {
    throw new Error('Pinned Tatoeba CC0 cleaned row count is invalid.');
  }
  return {
    documents,
    sourceConfig: source,
    cleaningReportSha256: canonicalSha256(report),
  };
}

export function buildTatoebaCc0Source(
  loaded: LoadedExternalCorpus,
  selected: readonly V2RCorpusCandidate[],
): V2RCorpusSource {
  const documents = selected
    .filter((document) => document.sourceId === loaded.sourceConfig.id)
    .sort((left, right) => left.documentId.localeCompare(right.documentId));
  if (documents.length === 0) throw new Error('Tatoeba CC0 source has no selected documents.');
  return {
    id: loaded.sourceConfig.id,
    kind: 'tatoeba-cc0',
    language: 'en',
    category: 'reading-note',
    contentRoot: TATOEBA_CONTENT_ROOT,
    licenseSpdx: 'CC0-1.0',
    licenseEvidencePath: loaded.sourceConfig.licenseEvidencePath,
    contentTreeSha256: canonicalSha256(
      documents.map((document) => ({ id: document.documentId, sha256: sha256(document.text) })),
    ),
    collectedAt: loaded.sourceConfig.collectedAt,
    cleanerVersion: loaded.sourceConfig.cleanerVersion,
  };
}

function validateSourceConfig(value: ExternalSourceConfig): void {
  assertPathInsideV2RCache(value.rawCachePath, 'Tatoeba rawCachePath');
  assertPathInsideV2RCache(value.cleanedCachePath, 'Tatoeba cleanedCachePath');
  normalizeRepositoryRelativePath(value.cleaningReportPath, 'Tatoeba cleaningReportPath');
  normalizeRepositoryRelativePath(value.licenseEvidencePath, 'Tatoeba licenseEvidencePath');
  if (
    value.kind !== 'tatoeba-cc0' ||
    value.language !== 'en' ||
    value.category !== 'reading-note' ||
    value.licenseSpdx !== 'CC0-1.0' ||
    !value.downloadUrl.startsWith('https://downloads.tatoeba.org/') ||
    !Number.isSafeInteger(value.rawBytes) ||
    !Number.isSafeInteger(value.cleanedBytes) ||
    !/^[0-9a-f]{64}$/u.test(value.rawSha256) ||
    !/^[0-9a-f]{64}$/u.test(value.cleanedSha256) ||
    !Number.isFinite(Date.parse(value.collectedAt)) ||
    new Date(value.collectedAt).toISOString() !== value.collectedAt ||
    value.cleanerVersion !== 'jotluck-tatoeba-cc0-cleaner-v1'
  ) {
    throw new Error('V2R Tatoeba CC0 source config is invalid.');
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
