import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import {
  V2_FREE_SUPPLEMENT_SCHEMA,
  computeV2FreeSupplementInputTreeSha256,
  type V2FreeSupplementDocumentRecord,
  type V2FreeSupplementManifest,
  type V2FreeSupplementSourceRecord,
} from './selection-builder';

export const V2_FREE_SUPPLEMENT_PLAN_SCHEMA = 'jotluck.autocomplete.v2-free-supplement-plan.v1';

type Language = 'zh' | 'en';

interface PinnedFile {
  path: string;
  bytes: number;
  sha256: string;
}

interface LicenseEvidence extends PinnedFile {
  spdx: 'MIT' | 'CC0-1.0';
}

interface ProjectOwnedSourcePlan {
  metadataSourceId: string;
  outputSourceId: string;
  targetBytes: number;
}

interface ProjectOwnedPlan {
  metadata: PinnedFile;
  licenseEvidence: LicenseEvidence;
  sources: ProjectOwnedSourcePlan[];
}

interface TatoebaPlan {
  outputSourceId: string;
  language: 'en';
  category: string;
  targetBytes: number;
  cleaned: PinnedFile;
  cleaningReport: PinnedFile;
  licenseEvidence: LicenseEvidence;
  cleanerVersion: string;
}

export interface V2FreeSupplementPlan {
  schema: typeof V2_FREE_SUPPLEMENT_PLAN_SCHEMA;
  schemaVersion: 1;
  datasetId: string;
  materializerVersion: string;
  selectionSeed: string;
  baselineSelection: PinnedFile & { inputTreeSha256: string };
  outputRoot: string;
  outputManifest: string;
  targets: {
    minimumTotalBytes: number;
    languageBytes: Record<Language, number>;
  };
  projectOwned: ProjectOwnedPlan;
  tatoeba: TatoebaPlan;
}

interface ProjectMetadataPack {
  relativePath: string;
  logicalDocuments: number;
  physicalBytes: number;
  sha256: string;
}

interface ProjectMetadataSource {
  id: string;
  language: Language;
  category: string;
  licenseId: string;
  logicalDocuments: number;
  packCount: number;
  packs: ProjectMetadataPack[];
  familyCode: string;
}

interface ProjectMetadata {
  schemaVersion: number;
  generatorVersion: string;
  seed: string;
  licenseId: string;
  licenseEvidence: string;
  totalLogicalDocuments: number;
  totalPacks: number;
  sources: ProjectMetadataSource[];
}

interface BaselineSelection {
  inputTreeSha256: string;
  documents: Array<{ normalizedSha256: string }>;
}

interface TatoebaCleaningReport {
  schema: string;
  schemaVersion: number;
  cleanerVersion: string;
  outputSha256: string;
  outputBytes: number;
}

interface Candidate {
  rawDocumentId: string;
  text: string;
  normalizedSha256: string;
  source: V2FreeSupplementSourceRecord;
  rank: string;
}

interface MaterializeOptions {
  workspaceRoot: string;
  configPath: string;
}

export async function materializeV2FreeSupplement(
  options: MaterializeOptions,
): Promise<V2FreeSupplementManifest> {
  const root = await realpath(path.resolve(options.workspaceRoot));
  const configPath = await resolveExistingInside(root, options.configPath, 'config');
  const plan = parsePlan(await readFile(configPath));
  const outputRoot = resolveOutputInsideCache(root, plan.outputRoot, 'output root');
  const outputManifest = resolveOutputInsideCache(root, plan.outputManifest, 'output manifest');
  if (isWithin(outputManifest, outputRoot)) {
    throw new Error('Output manifest must be outside the materialized document root.');
  }
  await assertAbsent(outputRoot, 'output root');
  await assertAbsent(outputManifest, 'output manifest');

  const baseline = await loadBaseline(root, plan.baselineSelection);
  const baselineIdentities = new Set(
    baseline.documents.map(({ normalizedSha256 }) => normalizedSha256),
  );
  const { sources: projectSources, candidates: projectCandidates } = await loadProjectCandidates(
    root,
    plan,
  );
  const { source: tatoebaSource, candidates: tatoebaCandidates } = await loadTatoebaCandidates(
    root,
    plan,
  );
  const sources = [...projectSources, tatoebaSource];
  assertUniqueSourceIds(sources);

  const candidatesBySource = new Map<string, Candidate[]>();
  for (const candidate of [...projectCandidates, ...tatoebaCandidates]) {
    if (baselineIdentities.has(candidate.normalizedSha256)) continue;
    const group = candidatesBySource.get(candidate.source.id) ?? [];
    group.push(candidate);
    candidatesBySource.set(candidate.source.id, group);
  }

  const targetBySource = new Map<string, number>([
    ...plan.projectOwned.sources.map(
      (source) => [source.outputSourceId, source.targetBytes] as const,
    ),
    [plan.tatoeba.outputSourceId, plan.tatoeba.targetBytes] as const,
  ]);
  const selected: Candidate[] = [];
  const selectedIdentities = new Set<string>();
  for (const source of sources) {
    const candidates = candidatesBySource.get(source.id) ?? [];
    candidates.sort((left, right) => left.rank.localeCompare(right.rank));
    const targetBytes = targetBySource.get(source.id);
    if (!targetBytes) throw new Error(`Missing byte target for source: ${source.id}.`);
    let sourceBytes = 0;
    for (const candidate of candidates) {
      if (selectedIdentities.has(candidate.normalizedSha256)) continue;
      selected.push(candidate);
      selectedIdentities.add(candidate.normalizedSha256);
      sourceBytes += Buffer.byteLength(candidate.text, 'utf8');
      if (sourceBytes >= targetBytes) break;
    }
    if (sourceBytes < targetBytes) {
      throw new Error(
        `Pinned source ${source.id} has only ${sourceBytes} eligible bytes; ${targetBytes} required.`,
      );
    }
  }

  const stageRoot = `${outputRoot}.pending-${process.pid}`;
  await assertAbsent(stageRoot, 'staging root');
  const documents: V2FreeSupplementDocumentRecord[] = [];
  try {
    await mkdir(stageRoot, { recursive: true });
    for (const candidate of selected) {
      const documentId = createOutputDocumentId(candidate.source.id, candidate.rawDocumentId);
      const relativeWithinOutput = `${candidate.source.id}/${documentId}.md`;
      const stagePath = path.join(stageRoot, ...relativeWithinOutput.split('/'));
      await mkdir(path.dirname(stagePath), { recursive: true });
      const bytes = Buffer.from(candidate.text, 'utf8');
      await writeFile(stagePath, bytes, { flag: 'wx' });
      documents.push({
        documentId,
        sourceId: candidate.source.id,
        language: candidate.source.language,
        category: candidate.source.category,
        relativePath: `${normalizeRelativePath(plan.outputRoot)}/${relativeWithinOutput}`,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        normalizedSha256: candidate.normalizedSha256,
      });
    }
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await rename(stageRoot, outputRoot);
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }

  const manifest = createManifest(plan, sources, documents);
  try {
    await mkdir(path.dirname(outputManifest), { recursive: true });
    await writeFile(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    await rm(outputRoot, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export async function runV2FreeSupplementCli(argv: readonly string[]): Promise<void> {
  let workspaceRoot = '.';
  let configPath = 'scripts/corpus/autocomplete-v2-free-supplement.json';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--workspace-root' && value) {
      workspaceRoot = value;
      index += 1;
    } else if (argument === '--config' && value) {
      configPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete supplement argument: ${String(argument)}.`);
    }
  }
  const manifest = await materializeV2FreeSupplement({ workspaceRoot, configPath });
  process.stdout.write(
    `${JSON.stringify({
      schema: manifest.schema,
      datasetId: manifest.datasetId,
      selectedBytes: manifest.selectedBytes,
      languageBytes: manifest.languageBytes,
      documents: manifest.documents.length,
      inputTreeSha256: manifest.inputTreeSha256,
    })}\n`,
  );
}

async function loadBaseline(root: string, pin: PinnedFile & { inputTreeSha256: string }) {
  const bytes = await readPinnedFile(root, pin, 'baseline selection');
  const value = parseJson(bytes, 'baseline selection') as Partial<BaselineSelection>;
  if (
    value.inputTreeSha256 !== pin.inputTreeSha256 ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0
  ) {
    throw new Error('Baseline selection identity or documents are invalid.');
  }
  assertSha256(value.inputTreeSha256, 'baseline input tree');
  for (const document of value.documents) {
    assertSha256(document.normalizedSha256, 'baseline normalized identity');
  }
  return value as BaselineSelection;
}

async function loadProjectCandidates(
  root: string,
  plan: V2FreeSupplementPlan,
): Promise<{ sources: V2FreeSupplementSourceRecord[]; candidates: Candidate[] }> {
  const metadataBytes = await readPinnedFile(root, plan.projectOwned.metadata, 'project metadata');
  const metadata = parseJson(metadataBytes, 'project metadata') as Partial<ProjectMetadata>;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.licenseId !== 'MIT' ||
    !metadata.generatorVersion ||
    !metadata.seed ||
    !Array.isArray(metadata.sources) ||
    metadata.sources.length === 0
  ) {
    throw new Error('Project-owned metadata license or generator identity is invalid.');
  }
  const license = plan.projectOwned.licenseEvidence;
  if (license.spdx !== 'MIT') throw new Error('Project-owned source license must be MIT.');
  await readPinnedFile(root, license, 'project-owned license evidence');

  const sources: V2FreeSupplementSourceRecord[] = [];
  const candidates: Candidate[] = [];
  for (const sourcePlan of plan.projectOwned.sources) {
    const metadataSource = metadata.sources.find(({ id }) => id === sourcePlan.metadataSourceId);
    if (!metadataSource || metadataSource.licenseId !== 'MIT') {
      throw new Error(
        `Unknown or unlicensed project-owned source: ${sourcePlan.metadataSourceId}.`,
      );
    }
    assertLanguage(metadataSource.language, metadataSource.id);
    assertSafeIdentifier(metadataSource.category, 'project category');
    if (
      !Array.isArray(metadataSource.packs) ||
      metadataSource.packs.length !== metadataSource.packCount ||
      metadataSource.packCount < 1
    ) {
      throw new Error(`Project-owned pack inventory is invalid: ${metadataSource.id}.`);
    }
    const outputSource = createSourceRecord({
      id: sourcePlan.outputSourceId,
      kind: 'project-owned',
      language: metadataSource.language,
      category: metadataSource.category,
      contentRoot: `${normalizeRelativePath(plan.outputRoot)}/${sourcePlan.outputSourceId}`,
      license,
      cleanerVersion: plan.materializerVersion,
      generatorVersion: metadata.generatorVersion,
      generatorSeed: metadata.seed,
    });
    sources.push(outputSource);
    let sourceDocuments = 0;
    for (const pack of metadataSource.packs) {
      assertSha256(pack.sha256, `${metadataSource.id} pack identity`);
      const packPin: PinnedFile = {
        path: `scripts/corpus/_web-cache/generated-project-owned/${normalizeRelativePath(pack.relativePath)}`,
        bytes: pack.physicalBytes,
        sha256: pack.sha256,
      };
      const packPath = await resolveExistingInside(root, packPin.path, 'project-owned pack');
      await assertPinnedFile(packPath, packPin, 'project-owned pack');
      const packCandidates = await readJsonLines(packPath, (value, line) => {
        const record = value as { documentId?: unknown; text?: unknown; family?: unknown };
        if (
          typeof record.documentId !== 'string' ||
          typeof record.text !== 'string' ||
          record.family !== metadataSource.familyCode
        ) {
          throw new Error(`Project-owned pack record is invalid at line ${line}.`);
        }
        return createCandidate(outputSource, record.documentId, record.text, plan.selectionSeed);
      });
      if (packCandidates.length !== pack.logicalDocuments) {
        throw new Error(`Project-owned pack document count mismatch: ${pack.relativePath}.`);
      }
      sourceDocuments += packCandidates.length;
      candidates.push(...packCandidates);
    }
    if (sourceDocuments !== metadataSource.logicalDocuments) {
      throw new Error(`Project-owned source document count mismatch: ${metadataSource.id}.`);
    }
  }
  return { sources, candidates };
}

async function loadTatoebaCandidates(
  root: string,
  plan: V2FreeSupplementPlan,
): Promise<{ source: V2FreeSupplementSourceRecord; candidates: Candidate[] }> {
  const sourcePlan = plan.tatoeba;
  if (sourcePlan.licenseEvidence.spdx !== 'CC0-1.0') {
    throw new Error('Tatoeba source license must be CC0-1.0.');
  }
  await readPinnedFile(root, sourcePlan.licenseEvidence, 'Tatoeba license evidence');
  const reportBytes = await readPinnedFile(root, sourcePlan.cleaningReport, 'Tatoeba report');
  const report = parseJson(reportBytes, 'Tatoeba report') as Partial<TatoebaCleaningReport>;
  if (
    report.schema !== 'jotluck.autocomplete.v2r-tatoeba-cleaning.v1' ||
    report.schemaVersion !== 1 ||
    report.cleanerVersion !== sourcePlan.cleanerVersion ||
    report.outputSha256 !== sourcePlan.cleaned.sha256 ||
    report.outputBytes !== sourcePlan.cleaned.bytes
  ) {
    throw new Error('Tatoeba cleaning report does not bind the pinned cleaned corpus.');
  }
  const cleanedPath = await resolveExistingInside(root, sourcePlan.cleaned.path, 'Tatoeba cleaned');
  await assertPinnedFile(cleanedPath, sourcePlan.cleaned, 'Tatoeba cleaned');
  const source = createSourceRecord({
    id: sourcePlan.outputSourceId,
    kind: 'tatoeba-cc0',
    language: sourcePlan.language,
    category: sourcePlan.category,
    contentRoot: `${normalizeRelativePath(plan.outputRoot)}/${sourcePlan.outputSourceId}`,
    license: sourcePlan.licenseEvidence,
    cleanerVersion: sourcePlan.cleanerVersion,
  });
  const candidates = await readJsonLines(cleanedPath, (value, line) => {
    const record = value as { id?: unknown; text?: unknown };
    if (
      (typeof record.id !== 'string' && typeof record.id !== 'number') ||
      typeof record.text !== 'string'
    ) {
      throw new Error(`Tatoeba cleaned record is invalid at line ${line}.`);
    }
    return createCandidate(source, String(record.id), record.text, plan.selectionSeed);
  });
  return { source, candidates };
}

function createSourceRecord(options: {
  id: string;
  kind: 'project-owned' | 'tatoeba-cc0';
  language: Language;
  category: string;
  contentRoot: string;
  license: LicenseEvidence;
  cleanerVersion?: string;
  generatorVersion?: string;
  generatorSeed?: string;
}): V2FreeSupplementSourceRecord {
  assertSafeIdentifier(options.id, 'output source id');
  assertSafeIdentifier(options.category, 'output source category');
  return {
    id: options.id,
    kind: options.kind,
    language: options.language,
    category: options.category,
    contentRoot: normalizeRelativePath(options.contentRoot),
    licenseSpdx: options.license.spdx,
    licenseEvidencePath: normalizeRelativePath(options.license.path),
    licenseEvidenceBytes: options.license.bytes,
    licenseEvidenceSha256: options.license.sha256,
    cleanerVersion: options.cleanerVersion,
    generatorVersion: options.generatorVersion,
    generatorSeed: options.generatorSeed,
  };
}

function createCandidate(
  source: V2FreeSupplementSourceRecord,
  rawDocumentId: string,
  text: string,
  selectionSeed: string,
): Candidate {
  assertSafeIdentifier(rawDocumentId.toLocaleLowerCase('en-US'), 'input document id');
  assertAllowedText(text, `${source.id}/${rawDocumentId}`);
  const normalized = normalizeText(text);
  if (!normalized) throw new Error(`Empty training document: ${source.id}/${rawDocumentId}.`);
  const normalizedSha256 = sha256(Buffer.from(normalized, 'utf8'));
  return {
    rawDocumentId: rawDocumentId.toLocaleLowerCase('en-US'),
    text,
    normalizedSha256,
    source,
    rank: sha256(
      Buffer.from(`${selectionSeed}\0${source.id}\0${rawDocumentId}\0${normalizedSha256}`, 'utf8'),
    ),
  };
}

function createManifest(
  plan: V2FreeSupplementPlan,
  sources: V2FreeSupplementSourceRecord[],
  documents: V2FreeSupplementDocumentRecord[],
): V2FreeSupplementManifest {
  documents.sort((left, right) => left.documentId.localeCompare(right.documentId));
  const sourceBytes: Record<string, number> = {};
  const languageBytes: Record<Language, number> = { zh: 0, en: 0 };
  const categoryBytes: Record<string, number> = {};
  let selectedBytes = 0;
  for (const document of documents) {
    selectedBytes += document.bytes;
    sourceBytes[document.sourceId] = (sourceBytes[document.sourceId] ?? 0) + document.bytes;
    languageBytes[document.language] += document.bytes;
    categoryBytes[document.category] = (categoryBytes[document.category] ?? 0) + document.bytes;
  }
  if (
    selectedBytes < plan.targets.minimumTotalBytes ||
    languageBytes.zh < plan.targets.languageBytes.zh ||
    languageBytes.en < plan.targets.languageBytes.en
  ) {
    throw new Error('Materialized supplement did not meet the pinned language/total targets.');
  }
  return {
    schema: V2_FREE_SUPPLEMENT_SCHEMA,
    schemaVersion: 1,
    datasetId: plan.datasetId,
    sources,
    documents,
    selectedBytes,
    sourceBytes,
    languageBytes,
    categoryBytes,
    inputTreeSha256: computeV2FreeSupplementInputTreeSha256(documents),
  };
}

async function readJsonLines<T>(
  filePath: string,
  parse: (value: unknown, line: number) => T,
): Promise<T[]> {
  const records: T[] = [];
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line) throw new Error(`JSONL contains an empty line: ${filePath}:${lineNumber}.`);
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`JSONL is invalid at ${filePath}:${lineNumber}: ${String(error)}`);
    }
    records.push(parse(value, lineNumber));
  }
  if (records.length === 0) throw new Error(`JSONL input is empty: ${filePath}.`);
  return records;
}

function parsePlan(bytes: Buffer): V2FreeSupplementPlan {
  const value = parseJson(bytes, 'supplement plan') as Partial<V2FreeSupplementPlan>;
  if (
    value.schema !== V2_FREE_SUPPLEMENT_PLAN_SCHEMA ||
    value.schemaVersion !== 1 ||
    !value.datasetId ||
    !value.materializerVersion ||
    !value.selectionSeed ||
    !value.baselineSelection ||
    !value.outputRoot ||
    !value.outputManifest ||
    !value.targets ||
    !value.projectOwned ||
    !value.tatoeba
  ) {
    throw new Error('Unsupported V2 free supplement plan.');
  }
  assertSafeIdentifier(value.datasetId, 'dataset id');
  assertSafeIdentifier(value.materializerVersion, 'materializer version');
  assertSafeIdentifier(value.selectionSeed, 'selection seed');
  assertPinnedFileContract(value.baselineSelection, 'baseline selection');
  assertSha256(value.baselineSelection.inputTreeSha256, 'baseline input tree');
  assertPinnedFileContract(value.projectOwned.metadata, 'project metadata');
  assertLicenseContract(value.projectOwned.licenseEvidence, 'project license');
  if (!Array.isArray(value.projectOwned.sources) || value.projectOwned.sources.length === 0) {
    throw new Error('Project-owned source plan is empty.');
  }
  for (const source of value.projectOwned.sources) {
    assertSafeIdentifier(source.metadataSourceId, 'metadata source id');
    assertSafeIdentifier(source.outputSourceId, 'output source id');
    assertPositiveInteger(source.targetBytes, 'project source target');
  }
  assertSafeIdentifier(value.tatoeba.outputSourceId, 'Tatoeba output source id');
  assertSafeIdentifier(value.tatoeba.category, 'Tatoeba category');
  if (value.tatoeba.language !== 'en' || !value.tatoeba.cleanerVersion) {
    throw new Error('Tatoeba language/cleaner contract is invalid.');
  }
  assertPositiveInteger(value.tatoeba.targetBytes, 'Tatoeba target');
  assertPinnedFileContract(value.tatoeba.cleaned, 'Tatoeba cleaned');
  assertPinnedFileContract(value.tatoeba.cleaningReport, 'Tatoeba report');
  assertLicenseContract(value.tatoeba.licenseEvidence, 'Tatoeba license');
  assertPositiveInteger(value.targets.minimumTotalBytes, 'minimum total target');
  assertPositiveInteger(value.targets.languageBytes.zh, 'Chinese target');
  assertPositiveInteger(value.targets.languageBytes.en, 'English target');
  const plannedProject = value.projectOwned.sources.reduce(
    (sum, source) => sum + source.targetBytes,
    0,
  );
  const plannedTotal = plannedProject + value.tatoeba.targetBytes;
  if (
    value.targets.languageBytes.zh + value.targets.languageBytes.en !==
      value.targets.minimumTotalBytes ||
    plannedTotal !== value.targets.minimumTotalBytes
  ) {
    throw new Error('Supplement source/language byte targets do not sum to the minimum total.');
  }
  return value as V2FreeSupplementPlan;
}

function assertPinnedFileContract(value: PinnedFile, label: string): void {
  normalizeRelativePath(value.path);
  assertPositiveInteger(value.bytes, `${label} bytes`);
  assertSha256(value.sha256, `${label} SHA-256`);
}

function assertLicenseContract(value: LicenseEvidence, label: string): void {
  assertPinnedFileContract(value, label);
  if (value.spdx !== 'MIT' && value.spdx !== 'CC0-1.0') {
    throw new Error(`${label} uses an unapproved license.`);
  }
}

async function readPinnedFile(root: string, pin: PinnedFile, label: string): Promise<Buffer> {
  const filePath = await resolveExistingInside(root, pin.path, label);
  await assertPinnedFile(filePath, pin, label);
  return readFile(filePath);
}

async function assertPinnedFile(filePath: string, pin: PinnedFile, label: string): Promise<void> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size !== pin.bytes) {
    throw new Error(`${label} byte identity mismatch.`);
  }
  const actualSha256 = await sha256File(filePath);
  if (actualSha256 !== pin.sha256) throw new Error(`${label} SHA-256 identity mismatch.`);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function assertAllowedText(text: string, id: string): void {
  const disallowed: Array<[string, RegExp]> = [
    ['frontmatter', /^\uFEFF?---\s*\r?\n/u],
    ['code', /(?:^|\n)\s*(?:```|~~~)|(?:^|\n)\s{4,}(?:const|let|var|def|class|fn)\b/u],
    ['URL', /(?:https?:\/\/|www\.)\S+/iu],
    ['email/PII', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ['phone/PII', /(?:\+?\d[\s().-]*){8,}/u],
    [
      'secret',
      /(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|bearer)\s*[:=]\s*[^\s]+/iu,
    ],
    ['control character', /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u],
  ];
  const hit = disallowed.find(([, pattern]) => pattern.test(text));
  if (hit) throw new Error(`Training document ${id} contains ${hit[0]}.`);
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function createOutputDocumentId(sourceId: string, rawId: string): string {
  const id = `${sourceId}-${rawId}`.toLocaleLowerCase('en-US');
  assertSafeIdentifier(id, 'output document id');
  return id;
}

function assertUniqueSourceIds(sources: V2FreeSupplementSourceRecord[]): void {
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`Duplicate supplement source id: ${source.id}.`);
    ids.add(source.id);
  }
}

async function resolveExistingInside(root: string, value: string, label: string): Promise<string> {
  const normalized = normalizeRelativePath(value);
  const resolved = await realpath(path.resolve(root, ...normalized.split('/')));
  if (!isWithin(resolved, root)) throw new Error(`${label} path escaped the workspace.`);
  return resolved;
}

function resolveOutputInsideCache(root: string, value: string, label: string): string {
  const normalized = normalizeRelativePath(value);
  if (!normalized.startsWith('scripts/corpus/_web-cache/')) {
    throw new Error(`${label} must stay inside scripts/corpus/_web-cache/.`);
  }
  const resolved = path.resolve(root, ...normalized.split('/'));
  if (!isWithin(resolved, root)) throw new Error(`${label} path escaped the workspace.`);
  return resolved;
}

function normalizeRelativePath(value: string): string {
  if (typeof value !== 'string') throw new Error('Repository-relative path must be a string.');
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Repository-relative path is invalid: ${value}.`);
  }
  return normalized;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function assertAbsent(value: string, label: string): Promise<void> {
  try {
    await access(value);
  } catch {
    return;
  }
  throw new Error(`${label} already exists; refusing to overwrite it.`);
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${String(error)}`);
  }
}

function assertLanguage(value: string, label: string): asserts value is Language {
  if (value !== 'zh' && value !== 'en') throw new Error(`${label} language is invalid.`);
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error(`${label} is invalid: ${String(value)}.`);
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is not a SHA-256 identity.`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  runV2FreeSupplementCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
