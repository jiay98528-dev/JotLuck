import { readFile } from 'node:fs/promises';
import { canonicalSha256, compareStrings, resolveInside, sha256 } from './common';

export const V2S_SELECTION_SCHEMA = 'jotluck.autocomplete.v2s-corpus-selection.v1';
export const V3_SELECTION_SCHEMA = 'jotluck.autocomplete.v2r-corpus-selection.v1';
const V3_GENERATOR_VERSION = 'jotluck-project-owned-short-notes-v3.1';
const V3_GENERATOR_SEED = 'v2r-project-owned-2026-07-12-b';
const PROJECT_CONTENT_PREFIX =
  'scripts/corpus/_web-cache/autocomplete-v2r/generated-project-owned-v3.1';
const TATOEBA_SOURCE_ID = 'tatoeba-cc0-en-2026-07-12';
const TATOEBA_CONTENT_ROOT =
  'scripts/corpus/_web-cache/autocomplete-v2r/generated-external/tatoeba/en';

export type V2SLanguage = 'zh' | 'en';
export type V2SSplit = 'train' | 'development' | 'internal-selection';

export interface V2SSelectionDocument {
  documentId: string;
  sourceId: string;
  language: V2SLanguage;
  category: string;
  relativePath: string;
  split: V2SSplit;
  bytes: number;
  sha256: string;
}

export interface V2SSelectionManifest {
  schema: typeof V2S_SELECTION_SCHEMA;
  schemaVersion: 1;
  sourceSelection: {
    path: string;
    sha256: string;
    schema: typeof V3_SELECTION_SCHEMA;
  };
  generator: {
    version: typeof V3_GENERATOR_VERSION;
    seed: typeof V3_GENERATOR_SEED;
  };
  documentCount: number;
  selectedBytes: number;
  inputTreeSha256: string;
  documents: V2SSelectionDocument[];
  selectionSha256: string;
}

interface SourceDocument {
  documentId?: unknown;
  sourceId?: unknown;
  language?: unknown;
  category?: unknown;
  relativePath?: unknown;
  split?: unknown;
  bytes?: unknown;
  sha256?: unknown;
}

interface SourceEntry {
  id?: unknown;
  kind?: unknown;
  language?: unknown;
  category?: unknown;
  contentRoot?: unknown;
  licenseSpdx?: unknown;
  licenseEvidencePath?: unknown;
  cleanerVersion?: unknown;
  generatorVersion?: unknown;
  generatorSeed?: unknown;
}

interface ApprovedSource {
  id: string;
  language: V2SLanguage;
  category: string;
  contentRoot: string;
}

export async function deriveV2SSelection(options: {
  workspaceRoot: string;
  sourceSelectionPath: string;
  maxDocuments?: number;
}): Promise<V2SSelectionManifest> {
  const sourceAbsolutePath = resolveInside(
    options.workspaceRoot,
    options.sourceSelectionPath,
    'source selection path',
  );
  const sourceBytes = await readFile(sourceAbsolutePath);
  const parsed: unknown = JSON.parse(sourceBytes.toString('utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('V3.1 selection must be an object.');
  }
  const source = parsed as Record<string, unknown>;
  if (source.schema !== V3_SELECTION_SCHEMA) {
    throw new Error(`V2S requires ${V3_SELECTION_SCHEMA}.`);
  }
  const sources = source.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('V3.1 selection has no source registry.');
  }
  const approvedSources = buildApprovedSources(sources as SourceEntry[]);
  if (!Array.isArray(source.documents) || source.documents.length === 0) {
    throw new Error('V3.1 selection has no documents.');
  }
  const limit = options.maxDocuments ?? source.documents.length;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > source.documents.length) {
    throw new Error('maxDocuments must select at least one listed document.');
  }

  const documents: V2SSelectionDocument[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of (source.documents as SourceDocument[]).slice(0, limit).entries()) {
    const document = await verifySourceDocument(raw, index, options.workspaceRoot, approvedSources);
    if (seen.has(document.documentId)) {
      throw new Error(`Duplicate documentId: ${document.documentId}.`);
    }
    seen.add(document.documentId);
    documents.push(document);
  }

  const inputTreeSha256 = calculateInputTreeSha256(documents);
  const withoutSelectionHash: Omit<V2SSelectionManifest, 'selectionSha256'> = {
    schema: V2S_SELECTION_SCHEMA,
    schemaVersion: 1 as const,
    sourceSelection: {
      path: options.sourceSelectionPath.replaceAll('\\', '/'),
      sha256: sha256(sourceBytes),
      schema: V3_SELECTION_SCHEMA,
    },
    generator: { version: V3_GENERATOR_VERSION, seed: V3_GENERATOR_SEED },
    documentCount: documents.length,
    selectedBytes: documents.reduce((total, document) => total + document.bytes, 0),
    inputTreeSha256,
    documents,
  };
  return {
    ...withoutSelectionHash,
    selectionSha256: canonicalSha256(withoutSelectionHash),
  };
}

export async function verifyV2SSelection(
  manifest: V2SSelectionManifest,
  workspaceRoot: string,
): Promise<V2SSelectionManifest> {
  if (manifest.schema !== V2S_SELECTION_SCHEMA || manifest.schemaVersion !== 1) {
    throw new Error('Unsupported V2S selection schema.');
  }
  if (manifest.generator.version !== V3_GENERATOR_VERSION) {
    throw new Error('V2S selection generator version is not v3.1.');
  }
  if (manifest.generator.seed !== V3_GENERATOR_SEED) {
    throw new Error('V2S selection generator seed is not approved.');
  }
  const sourceSelectionPath = resolveInside(
    workspaceRoot,
    manifest.sourceSelection.path,
    'V2S source selection path',
  );
  const sourceBytes = await readFile(sourceSelectionPath);
  if (sha256(sourceBytes) !== manifest.sourceSelection.sha256) {
    throw new Error('V2S upstream source selection SHA-256 is invalid.');
  }
  const sourceParsed = JSON.parse(sourceBytes.toString('utf8')) as Record<string, unknown>;
  if (sourceParsed.schema !== V3_SELECTION_SCHEMA || !Array.isArray(sourceParsed.sources)) {
    throw new Error('V2S upstream source selection schema is invalid.');
  }
  const approvedSources = buildApprovedSources(sourceParsed.sources as SourceEntry[]);
  const verified: V2SSelectionDocument[] = [];
  for (const [index, document] of manifest.documents.entries()) {
    verified.push(await verifySourceDocument(document, index, workspaceRoot, approvedSources));
  }
  const inputTreeSha256 = calculateInputTreeSha256(verified);
  if (inputTreeSha256 !== manifest.inputTreeSha256) {
    throw new Error('V2S selection input tree does not match the current document bytes.');
  }
  const { selectionSha256: _selectionSha256, ...unsigned } = manifest;
  if (canonicalSha256(unsigned) !== manifest.selectionSha256) {
    throw new Error('V2S selection manifest hash is invalid.');
  }
  return manifest;
}

export function calculateInputTreeSha256(documents: V2SSelectionDocument[]): string {
  return canonicalSha256(
    documents
      .map(({ documentId, sha256: documentSha256 }) => ({
        documentId,
        sha256: documentSha256,
      }))
      .sort((left, right) => compareStrings(left.documentId, right.documentId)),
  );
}

async function verifySourceDocument(
  raw: SourceDocument,
  index: number,
  workspaceRoot: string,
  approvedSources: Map<string, ApprovedSource>,
): Promise<V2SSelectionDocument> {
  const label = `documents[${index}]`;
  if (
    typeof raw.documentId !== 'string' ||
    typeof raw.sourceId !== 'string' ||
    typeof raw.category !== 'string' ||
    (raw.language !== 'zh' && raw.language !== 'en') ||
    typeof raw.relativePath !== 'string' ||
    typeof raw.bytes !== 'number' ||
    typeof raw.sha256 !== 'string'
  ) {
    throw new Error(`${label} has invalid fields.`);
  }
  const approvedSource = approvedSources.get(raw.sourceId);
  if (!approvedSource) throw new Error(`${label} references an unknown or unapproved source.`);
  if (raw.language !== approvedSource.language || raw.category !== approvedSource.category) {
    throw new Error(`${label} language or category disagrees with its approved source.`);
  }
  const relativePath = raw.relativePath.replaceAll('\\', '/');
  if (
    relativePath !== approvedSource.contentRoot &&
    !relativePath.startsWith(`${approvedSource.contentRoot}/`)
  ) {
    throw new Error(`${label} is outside its approved source contentRoot.`);
  }
  const split = normalizeSplit(raw.split, label);
  const absolutePath = resolveInside(workspaceRoot, relativePath, `${label}.relativePath`);
  const bytes = await readFile(absolutePath);
  const digest = sha256(bytes);
  if (bytes.byteLength !== raw.bytes || digest !== raw.sha256) {
    throw new Error(`${label} content does not match its declared bytes and SHA-256.`);
  }
  return {
    documentId: raw.documentId,
    sourceId: raw.sourceId,
    language: raw.language,
    category: raw.category,
    relativePath,
    split,
    bytes: bytes.byteLength,
    sha256: digest,
  };
}

function buildApprovedSources(sources: SourceEntry[]): Map<string, ApprovedSource> {
  const approved = new Map<string, ApprovedSource>();
  for (const [index, source] of sources.entries()) {
    const label = `sources[${index}]`;
    if (typeof source.id !== 'string' || approved.has(source.id)) {
      throw new Error(`${label} has an invalid or duplicate source id.`);
    }
    const value = approveSource(source, label);
    approved.set(value.id, value);
  }
  return approved;
}

function approveSource(source: SourceEntry, label: string): ApprovedSource {
  const sourceId = typeof source.id === 'string' ? source.id : '';
  if (sourceId === TATOEBA_SOURCE_ID) {
    if (
      source.kind !== 'tatoeba-cc0' ||
      source.language !== 'en' ||
      source.category !== 'reading-note' ||
      source.contentRoot !== TATOEBA_CONTENT_ROOT ||
      source.licenseSpdx !== 'CC0-1.0' ||
      source.licenseEvidencePath !== 'scripts/corpus/licenses/tatoeba-cc0.md' ||
      source.cleanerVersion !== 'jotluck-tatoeba-cc0-cleaner-v1'
    ) {
      throw new Error(`${label} does not match the frozen approved Tatoeba CC0 source.`);
    }
    return {
      id: TATOEBA_SOURCE_ID,
      language: 'en',
      category: 'reading-note',
      contentRoot: TATOEBA_CONTENT_ROOT,
    };
  }
  const match =
    /^project-v3-(zh|en)-(field-observation|maintenance-log|meeting-note|reading-note|household-plan)$/u.exec(
      sourceId,
    );
  if (!match) throw new Error(`${label} is an unknown V2S source.`);
  const language = match[1] as V2SLanguage;
  const category = match[2]!;
  const expectedRoot = `${PROJECT_CONTENT_PREFIX}/${language}/${category}`;
  if (
    source.kind !== 'project-owned' ||
    source.language !== language ||
    source.category !== category ||
    source.contentRoot !== expectedRoot ||
    source.licenseSpdx !== 'MIT' ||
    source.licenseEvidencePath !== 'LICENSE' ||
    source.cleanerVersion !== V3_GENERATOR_VERSION ||
    source.generatorVersion !== V3_GENERATOR_VERSION ||
    source.generatorSeed !== V3_GENERATOR_SEED
  ) {
    throw new Error(`${label} does not match the approved deterministic v3.1 project source.`);
  }
  return { id: match[0], language, category, contentRoot: expectedRoot };
}

function normalizeSplit(value: unknown, label: string): V2SSplit {
  if (value === 'train' || value === 'development' || value === 'internal-selection') {
    return value;
  }
  if (value === 'internalSelection') return 'internal-selection';
  throw new Error(`${label}.split is not supported by V2S.`);
}
