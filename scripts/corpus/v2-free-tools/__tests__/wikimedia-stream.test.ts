import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  computeV2FreeSupplementInputTreeSha256,
  type V2FreeSupplementDocumentRecord,
} from '../../../autocomplete-v2-free/selection-builder';
import { canonicalSha256, sha256 } from '../common';
import {
  materializeRegisteredWikimediaRaw,
  OFFICIAL_WIKIMEDIA_20260801_RAW_SOURCES,
} from '../wikimedia-cleaner';

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.includes(`${path.sep}scripts${path.sep}corpus${path.sep}.tmp-`)) {
      throw new Error('Refusing to remove an unexpected test directory.');
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe('Wikimedia 20260801 streaming materializer', () => {
  it('pins the four primary raw identities and the fixed Chinese Wikisource fallback range', () => {
    expect(Object.values(OFFICIAL_WIKIMEDIA_20260801_RAW_SOURCES)).toMatchObject([
      {
        filename: 'enwiki-20260801-pages-articles-multistream1.xml-p1p41242.bz2',
        bytes: 299_138_062,
      },
      { filename: 'enwikibooks-20260801-pages-articles-multistream.xml.bz2', bytes: 207_199_592 },
      {
        filename: 'zhwiki-20260801-pages-articles-multistream1.xml-p1p187712.bz2',
        bytes: 255_349_033,
      },
      { filename: 'zhwikibooks-20260801-pages-articles-multistream.xml.bz2', bytes: 19_924_402 },
      {
        filename: 'zhwikisource-20260801-pages-articles-multistream.prefix-0-300313200.xml.bz2',
        bytes: 300_313_201,
        byteRange: 'bytes=0-300313200',
      },
    ]);
  });

  it('streams bz2 pages into a directly consumable supplement with deterministic segment provenance', async () => {
    const root = await mkdtemp(path.join(workspaceRoot, 'scripts/corpus/.tmp-wikimedia-'));
    roots.push(root);
    const xmlPath = path.join(root, 'fixture.xml');
    const rawPath = path.join(root, 'fixture.xml.bz2');
    const evidencePath = path.join(root, 'license.txt');
    const first =
      'The first field observation explains how a quiet offline notebook records maintenance decisions,\uFEFFreview questions, and follow-up actions without sending private text to a remote service. '.repeat(
        4,
      );
    const second =
      'The second reading note compares several writing routines, documents why each local workflow remains reproducible, and lists the next checks for editors working in two languages. '.repeat(
        4,
      );
    const xml = `<mediawiki>
      <page><title>First fixture</title><ns>0</ns><id>101</id><revision><id>1001</id><text>${first}</text></revision></page>
      <page><title>Second fixture</title><ns>0</ns><id>202</id><revision><id>2002</id><text>${second}</text></revision></page>
      <page><title>Talk fixture</title><ns>1</ns><id>303</id><revision><id>3003</id><text>${first}</text></revision></page>
    `;
    await writeFile(xmlPath, xml, 'utf8');
    await execFileAsync('python', [
      '-c',
      'import bz2,pathlib,sys; pathlib.Path(sys.argv[2]).write_bytes(bz2.compress(pathlib.Path(sys.argv[1]).read_bytes()))',
      xmlPath,
      rawPath,
    ]);
    const raw = await readFile(rawPath);
    const evidence = Buffer.from('Wikimedia CC-BY-SA-4.0 fixture evidence.\n', 'utf8');
    await writeFile(evidencePath, evidence);
    const source = {
      sourceId: 'fixture-wikimedia-en',
      filename: path.basename(rawPath),
      bytes: raw.byteLength,
      sha1: createHash('sha1').update(raw).digest('hex'),
      sha256: sha256(raw),
      language: 'en',
      project: 'wikipedia',
      dumpDate: '2026-08-01',
      upstreamObjectBytes: raw.byteLength + 1024,
      upstreamObjectSha1: '1111111111111111111111111111111111111111',
      byteRange: `bytes=0-${raw.byteLength - 1}`,
    };
    const registrationWithoutHash = {
      schema: 'jotluck.autocomplete.v2-free-wikimedia-raw-registration.v1',
      schemaVersion: 1,
      source,
      rawPath: relative(rawPath),
      verifiedBytes: source.bytes,
      verifiedSha1: source.sha1,
      verifiedSha256: source.sha256,
      extractionBoundary: 'direct-bzip2-streaming-iterparse',
    };
    const registration = {
      ...registrationWithoutHash,
      registrationSha256: canonicalSha256(registrationWithoutHash),
    };
    const registrationPath = path.join(root, 'registration.json');
    await writeFile(registrationPath, JSON.stringify(registration), 'utf8');
    const outputRoot = `${relative(root)}/materialized`;
    const plan = {
      schema: 'jotluck.autocomplete.v2-free-wikimedia-stream-plan.v1',
      schemaVersion: 1,
      datasetId: 'fixture-wikimedia-supplement',
      registrationPath: relative(registrationPath),
      outputRoot,
      maximumSelectedBytes: 800,
      category: 'field-observation',
      cleanerVersion: 'fixture-cleaner-v1',
      licenseSpdx: 'CC-BY-SA-4.0',
      licenseEvidencePath: relative(evidencePath),
      licenseEvidenceBytes: evidence.byteLength,
      licenseEvidenceSha256: sha256(evidence),
      attributionUrl: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
      upstreamDumpUrl: 'https://dumps.wikimedia.org/fixture.xml.bz2',
    };
    const planPath = path.join(root, 'plan.json');
    await writeFile(planPath, JSON.stringify(plan), 'utf8');

    const result = await materializeRegisteredWikimediaRaw({
      workspaceRoot,
      planPath: relative(planPath),
    });
    const manifest = JSON.parse(
      await readFile(path.join(workspaceRoot, outputRoot, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(result.selectedBytes).toBeGreaterThanOrEqual(256);
    expect(result.selectedBytes).toBeLessThanOrEqual(800);
    expect(manifest.schema).toBe('jotluck.autocomplete.v2-free-supplement.v1');
    expect(manifest.sources).toMatchObject([
      {
        kind: 'wikimedia-cc-by-sa',
        licenseSpdx: 'CC-BY-SA-4.0',
        snapshotSha256: source.sha256,
        byteRange: source.byteRange,
      },
    ]);
    const documents = manifest.documents as Array<Record<string, unknown>>;
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      pageId: expect.stringMatching(/^(101|202)$/u),
      segmentIndex: 0,
      selectionSeed: '20260805',
      snapshotSha256: source.sha256,
    });
    expect(documents[0]!.selectionKeySha256).toBe(
      sha256(`fixture-wikimedia-en|${documents[0]!.pageId}|0|20260805`),
    );
    const selectedDocument = await readFile(
      path.join(workspaceRoot, documents[0]!.relativePath as string),
      'utf8',
    );
    const normalizedIdentity = selectedDocument
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLocaleLowerCase('en-US');
    expect(documents[0]!.normalizedSha256).toBe(sha256(normalizedIdentity));
    expect(manifest.inputTreeSha256).toBe(
      computeV2FreeSupplementInputTreeSha256(
        documents as unknown as V2FreeSupplementDocumentRecord[],
      ),
    );
    await expect(stat(path.join(root, 'fixture.xml.decompressed'))).rejects.toThrow();
  });
});

function relative(value: string): string {
  return path.relative(workspaceRoot, value).replaceAll('\\', '/');
}
