import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  buildSyntheticCorpusReport,
  familySupportAnchor,
  generateSyntheticDocument,
  GENERATED_CORPUS_RELATIVE_ROOT,
  MAX_PHYSICAL_BYTES,
  PACKS_PER_SOURCE,
  resolveGeneratedCorpusRoot,
  runSyntheticCorpusGenerator,
  serializeSyntheticJsonlRecord,
  SYNTHETIC_GENERATOR_SEED,
  SYNTHETIC_GENERATOR_VERSION,
  SYNTHETIC_REPOSITORY_ROOT,
  SYNTHETIC_LICENSE_ID,
  SYNTHETIC_OWNER,
  SYNTHETIC_SOURCE_PLANS,
  TARGET_CANONICAL_BYTES,
  writeSyntheticCorpus,
  type SyntheticCorpusFileSystem,
  type SyntheticCorpusReport,
  type SyntheticSourcePlan,
} from '../generate-autocomplete-synthetic-corpus';
import {
  findForbiddenCorpusText,
  nearDuplicateCorpusKey,
  normalizeCorpusFragment,
} from '../web-corpus-utils';

class MemoryFileSystem implements SyntheticCorpusFileSystem {
  readonly writes = new Map<string, string>();
  readonly directories = new Set<string>();
  listCalls = 0;

  constructor(private readonly existingFiles: string[] = []) {}

  listFilesRecursive(): string[] {
    this.listCalls++;
    return [...this.existingFiles];
  }

  ensureDirectory(directory: string): void {
    this.directories.add(path.resolve(directory));
  }

  writeUtf8(filePath: string, content: string): void {
    this.writes.set(path.resolve(filePath), content);
  }
}

const SMALL_PLANS: readonly SyntheticSourcePlan[] = SYNTHETIC_SOURCE_PLANS.slice(0, 2).map(
  (plan) => ({ ...plan, targetCanonicalBytes: 24 * 1024 }),
);

let cachedDefaultReport: SyntheticCorpusReport | undefined;

function defaultReport(): SyntheticCorpusReport {
  cachedDefaultReport ??= buildSyntheticCorpusReport();
  return cachedDefaultReport;
}

describe('project-owned synthetic autocomplete corpus', () => {
  it('resolves the default workspace from the generator module location', () => {
    const testFileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    expect(SYNTHETIC_REPOSITORY_ROOT).toBe(testFileRoot);
  });

  it('uses fixed generator identity and produces deterministic documents and source hashes', () => {
    const firstDocument = generateSyntheticDocument(SYNTHETIC_SOURCE_PLANS[0]!, 17);
    const secondDocument = generateSyntheticDocument(SYNTHETIC_SOURCE_PLANS[0]!, 17);
    const firstReport = buildSyntheticCorpusReport(SMALL_PLANS);
    const secondReport = buildSyntheticCorpusReport(SMALL_PLANS);

    expect(SYNTHETIC_GENERATOR_VERSION).toBe('jotluck-synthetic-short-notes-v1');
    expect(SYNTHETIC_GENERATOR_SEED).toBe('project-owned-seed-2026-07-11');
    expect(firstDocument).toEqual(secondDocument);
    expect(firstReport.corpusSha256).toBe(secondReport.corpusSha256);
    expect(firstReport.sources.map((source) => source.contentSha256)).toEqual(
      secondReport.sources.map((source) => source.contentSha256),
    );
    expect(firstReport.sources.map((source) => source.packs)).toEqual(
      secondReport.sources.map((source) => source.packs),
    );
  });

  it('plans about 24MiB canonical text below the 25MiB physical ceiling', () => {
    const report = defaultReport();

    expect(report.sources).toHaveLength(5);
    expect(new Set(report.sources.map((source) => source.family)).size).toBe(5);
    expect(report.totalCanonicalBytes).toBeGreaterThan(TARGET_CANONICAL_BYTES - 64 * 1024);
    expect(report.totalCanonicalBytes).toBeLessThanOrEqual(TARGET_CANONICAL_BYTES);
    expect(report.totalPhysicalBytes).toBeLessThanOrEqual(MAX_PHYSICAL_BYTES);
    expect(report.totalLogicalDocuments).toBe(11_130);
    expect(report.totalPacks).toBe(20);
    expect(report.totalPhysicalFiles).toBe(21);
    expect(report.sources.every((source) => source.logicalDocuments > 100)).toBe(true);
    expect(
      report.sources.every(
        (source) =>
          source.packCount >= 1 &&
          source.packCount <= PACKS_PER_SOURCE &&
          source.packCount === source.packs.length,
      ),
    ).toBe(true);
    expect(
      Math.max(
        ...report.sources.map((source) => source.canonicalBytes / report.totalCanonicalBytes),
      ),
    ).toBeLessThanOrEqual(0.4);
    expect(report).toMatchObject({
      owner: SYNTHETIC_OWNER,
      licenseId: SYNTHETIC_LICENSE_ID,
      registrationStatus: 'approved-project-owned-input',
      outputRoot: GENERATED_CORPUS_RELATIVE_ROOT,
    });
  });

  it('keeps sampled short-note fragments diverse while preserving cross-document support', () => {
    const report = defaultReport();
    const exact = new Set<string>();
    const near = new Set<string>();
    const documentIds = new Set<string>();
    let exactDuplicates = 0;
    let nearDuplicates = 0;
    let fragments = 0;

    for (const plan of SYNTHETIC_SOURCE_PLANS) {
      const source = report.sources.find((item) => item.id === plan.id)!;
      const sampleCount = Math.min(200, source.logicalDocuments);
      const anchor = familySupportAnchor(plan.family);
      let anchoredDocuments = 0;
      for (let index = 0; index < sampleCount; index++) {
        const document = generateSyntheticDocument(plan, index);
        expect(document.textBytes).toBeLessThan(8 * 1024);
        expect(documentIds.has(document.documentId)).toBe(false);
        documentIds.add(document.documentId);
        if (document.text.includes(anchor)) anchoredDocuments++;
        expect(document.text).not.toMatch(
          /click here|subscribe|sign in|log in|copyright|navigation menu/iu,
        );
        for (const fragment of document.fragments) {
          expect(findForbiddenCorpusText(fragment)).toEqual([]);
          const exactKey = normalizeCorpusFragment(fragment);
          const nearKey = nearDuplicateCorpusKey(fragment);
          if (exact.has(exactKey)) exactDuplicates++;
          else exact.add(exactKey);
          if (nearKey.length >= 12) {
            if (near.has(nearKey)) nearDuplicates++;
            else near.add(nearKey);
          }
          fragments++;
        }
      }
      expect(anchoredDocuments).toBeGreaterThanOrEqual(3);
    }

    expect(exactDuplicates / fragments).toBeLessThanOrEqual(0.01);
    expect(nearDuplicates / fragments).toBeLessThanOrEqual(0.03);
  });

  it('serializes every logical document as one strict JSONL record with a global id', () => {
    const report = defaultReport();
    const documentIds = new Set<string>();
    let parsedLines = 0;

    for (const plan of SYNTHETIC_SOURCE_PLANS) {
      const source = report.sources.find((item) => item.id === plan.id)!;
      for (let index = 0; index < source.logicalDocuments; index++) {
        const document = generateSyntheticDocument(plan, index);
        const line = serializeSyntheticJsonlRecord(document);
        const record = JSON.parse(line) as Record<string, unknown>;
        if (Object.keys(record).join(',') !== 'documentId,text,family') {
          throw new Error(`Unexpected JSONL keys for ${document.documentId}.`);
        }
        if (
          record.documentId !== document.documentId ||
          record.text !== document.text ||
          record.family !== plan.familyCode ||
          /[\r\n]/u.test(String(record.text))
        ) {
          throw new Error(`Invalid JSONL record for ${document.documentId}.`);
        }
        if (documentIds.has(document.documentId)) {
          throw new Error(`Duplicate logical document id: ${document.documentId}.`);
        }
        documentIds.add(document.documentId);
        parsedLines++;
      }
    }

    expect(parsedLines).toBe(report.totalLogicalDocuments);
    expect(documentIds.size).toBe(report.totalLogicalDocuments);
  });

  it('writes only fixed JSONL packs and metadata to an in-memory filesystem', () => {
    const workspaceRoot = path.resolve('synthetic-workspace');
    const root = resolveGeneratedCorpusRoot(workspaceRoot);
    const report = buildSyntheticCorpusReport(SMALL_PLANS);
    const fileSystem = new MemoryFileSystem();

    writeSyntheticCorpus(root, report, fileSystem, SMALL_PLANS);

    expect(fileSystem.writes.size).toBe(report.totalPhysicalFiles);
    const jsonlOutputs = [...fileSystem.writes].filter(([filePath]) => filePath.endsWith('.jsonl'));
    expect(jsonlOutputs).toHaveLength(report.totalPacks);
    let logicalDocuments = 0;
    for (const [filePath, content] of jsonlOutputs) {
      expect(content.endsWith('\n')).toBe(true);
      const lines = content.trimEnd().split('\n');
      const relativePath = path.relative(root, filePath).replace(/\\/gu, '/');
      const pack = report.sources
        .flatMap((source) => source.packs)
        .find((candidate) => candidate.relativePath === relativePath);
      expect(pack).toBeDefined();
      expect(lines).toHaveLength(pack!.logicalDocuments);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
      logicalDocuments += lines.length;
    }
    expect(logicalDocuments).toBe(report.totalLogicalDocuments);

    const metadata = JSON.parse(
      fileSystem.writes.get(path.join(root, '_metadata.json'))!,
    ) as SyntheticCorpusReport;
    expect(metadata.totalLogicalDocuments).toBe(report.totalLogicalDocuments);
    expect(metadata.totalPacks).toBe(report.totalPacks);
    expect(
      metadata.sources.every((source) =>
        source.packs.every(
          (pack) => pack.logicalDocuments > 0 && /^[0-9a-f]{64}$/u.test(pack.sha256),
        ),
      ),
    ).toBe(true);
  });

  it('resolves output only to the fixed generated-project-owned root', () => {
    const workspaceRoot = path.resolve('synthetic-workspace');
    const allowed = resolveGeneratedCorpusRoot(workspaceRoot);

    expect(allowed).toBe(path.resolve(workspaceRoot, GENERATED_CORPUS_RELATIVE_ROOT));
    expect(() =>
      resolveGeneratedCorpusRoot(workspaceRoot, 'scripts/corpus/another-directory'),
    ).toThrow(/must be exactly/);
    expect(() => resolveGeneratedCorpusRoot(workspaceRoot, '../outside')).toThrow(
      /must be exactly/,
    );
  });

  it('fails closed on an unknown target file before performing any write', () => {
    const workspaceRoot = path.resolve('synthetic-workspace');
    const root = resolveGeneratedCorpusRoot(workspaceRoot);
    const report = buildSyntheticCorpusReport(SMALL_PLANS);
    const fileSystem = new MemoryFileSystem([
      path.join(root, SMALL_PLANS[0]!.relativeDirectory, 'pack-05.jsonl'),
    ]);

    expect(() => writeSyntheticCorpus(root, report, fileSystem, SMALL_PLANS)).toThrow(
      /Unknown file blocks synthetic corpus generation/,
    );
    expect(fileSystem.writes.size).toBe(0);
    expect(fileSystem.directories.size).toBe(0);
  });

  it('dry-run reports source bytes and hashes without touching the filesystem', () => {
    const workspaceRoot = path.resolve('synthetic-workspace');
    const fileSystem = new MemoryFileSystem();
    const output: string[] = [];

    const report = runSyntheticCorpusGenerator(['--dry-run'], {
      workspaceRoot,
      fileSystem,
      sourcePlans: SMALL_PLANS,
      log: (value) => output.push(value),
    });

    expect(report.totalLogicalDocuments).toBeGreaterThan(0);
    expect(report.totalPacks).toBe(SMALL_PLANS.length * PACKS_PER_SOURCE);
    expect(report.totalPhysicalFiles).toBe(report.totalPacks + 1);
    expect(report.sources.every((source) => /^[0-9a-f]{64}$/u.test(source.contentSha256))).toBe(
      true,
    );
    expect(fileSystem.listCalls).toBe(0);
    expect(fileSystem.writes.size).toBe(0);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]!) as unknown).toMatchObject({
      generatorVersion: SYNTHETIC_GENERATOR_VERSION,
      registrationStatus: 'approved-project-owned-input',
      totalLogicalDocuments: report.totalLogicalDocuments,
      totalPacks: report.totalPacks,
      corpusSha256: report.corpusSha256,
    });
  });
});
