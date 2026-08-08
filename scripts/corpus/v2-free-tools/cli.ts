import { readFile } from 'node:fs/promises';

import {
  decodeUtf8,
  resolveCorpusOutput,
  resolveWorkspaceInput,
  writeExclusiveJson,
} from './common';
import {
  auditSelectionFingerprints,
  readFingerprintInventory,
  type HoldoutClassification,
} from './fingerprints';
import {
  authorFourHoldoutDrafts,
  createHoldoutAuthoringTemplate,
  freezeV2FreeHoldoutSet,
  publishFrozenHoldoutEvidence,
  type HoldoutSetFreezePlan,
} from './holdout-tools';
import {
  createFormal128SelectionStageReceipt,
  type FormalSelectionManifest,
} from './selection-stage';
import {
  materializeRegisteredWikimediaRaw,
  materializeWikimediaXmlFixture,
  registerOfficialWikimedia20260801Raw,
  type OfficialWikimedia20260801RawSourceId,
  type WikimediaXmlFixturePlan,
} from './wikimedia-cleaner';

export async function runV2FreeCorpusCli(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help') {
    process.stdout.write(
      [
        'Usage: node --import tsx scripts/corpus/v2-free-tools/cli.ts <command>',
        'Commands:',
        '  holdout-template --classification <kind> --workspace-root <path> --output <path>',
        '  author-holdout-drafts --workspace-root <path> --output-root <path>',
        '  freeze-holdouts --workspace-root <path> --plan <path>',
        '  publish-holdout-evidence --workspace-root <path> --frozen-root <path> --output-root <path>',
        '  register-wikimedia-raw --workspace-root <path> --source-id <id> --raw-root <path> --output <path>',
        '  clean-wikimedia --workspace-root <path> --plan <path> [--python <path>]',
        '  clean-wikimedia-fixture --workspace-root <path> --plan <path>',
        '  audit-fingerprints --workspace-root <path> --selection <path> --holdout-inventory <path>... --output <path>',
        '  formal-128-stage --workspace-root <path> --selection <path> --audit <path> --output <path> [--require-final-fingerprints]',
      ].join('\n') + '\n',
    );
    return 0;
  }
  if (command === 'holdout-template') return holdoutTemplateCommand(argv.slice(1));
  if (command === 'author-holdout-drafts') return authorHoldoutDraftsCommand(argv.slice(1));
  if (command === 'freeze-holdouts') return freezeHoldoutsCommand(argv.slice(1));
  if (command === 'publish-holdout-evidence') {
    return publishHoldoutEvidenceCommand(argv.slice(1));
  }
  if (command === 'register-wikimedia-raw') return registerWikimediaRawCommand(argv.slice(1));
  if (command === 'clean-wikimedia') return cleanWikimediaCommand(argv.slice(1));
  if (command === 'clean-wikimedia-fixture') return cleanWikimediaFixtureCommand(argv.slice(1));
  if (command === 'audit-fingerprints') return auditFingerprintsCommand(argv.slice(1));
  if (command === 'formal-128-stage') return formalStageCommand(argv.slice(1));
  throw new Error(`Unknown V2 free corpus command: ${command}`);
}

async function authorHoldoutDraftsCommand(argv: readonly string[]): Promise<number> {
  const result = await authorFourHoldoutDrafts({
    workspaceRoot: required(argv, '--workspace-root'),
    outputRoot: required(argv, '--output-root'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

async function holdoutTemplateCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = required(argv, '--workspace-root');
  const classification = required(argv, '--classification') as HoldoutClassification;
  const output = await resolveCorpusOutput(workspaceRoot, required(argv, '--output'));
  await writeExclusiveJson(output, createHoldoutAuthoringTemplate(classification));
  return 0;
}

async function freezeHoldoutsCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = required(argv, '--workspace-root');
  const plan = await readJson<HoldoutSetFreezePlan>(workspaceRoot, required(argv, '--plan'));
  const result = await freezeV2FreeHoldoutSet({ workspaceRoot, plan });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

async function publishHoldoutEvidenceCommand(argv: readonly string[]): Promise<number> {
  const result = await publishFrozenHoldoutEvidence({
    workspaceRoot: required(argv, '--workspace-root'),
    frozenRoot: required(argv, '--frozen-root'),
    outputRoot: required(argv, '--output-root'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

async function cleanWikimediaCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = required(argv, '--workspace-root');
  const result = await materializeRegisteredWikimediaRaw({
    workspaceRoot,
    planPath: required(argv, '--plan'),
    pythonExecutable: optional(argv, '--python'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

async function cleanWikimediaFixtureCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = required(argv, '--workspace-root');
  const plan = await readJson<WikimediaXmlFixturePlan>(workspaceRoot, required(argv, '--plan'));
  const result = await materializeWikimediaXmlFixture({ workspaceRoot, plan });
  process.stdout.write(`${JSON.stringify({ manifestPath: result.manifestPath })}\n`);
  return 0;
}

async function registerWikimediaRawCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = required(argv, '--workspace-root');
  const registration = await registerOfficialWikimedia20260801Raw({
    workspaceRoot,
    sourceId: required(argv, '--source-id') as OfficialWikimedia20260801RawSourceId,
    rawRoot: required(argv, '--raw-root'),
    outputPath: required(argv, '--output'),
  });
  process.stdout.write(
    `${JSON.stringify({ registrationSha256: registration.registrationSha256 })}\n`,
  );
  return 0;
}

async function auditFingerprintsCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = required(argv, '--workspace-root');
  const selectionPath = await resolveWorkspaceInput(workspaceRoot, required(argv, '--selection'));
  const selectionManifestBytes = await readFile(selectionPath);
  const selection = JSON.parse(
    decodeUtf8(selectionManifestBytes, 'selection'),
  ) as FormalSelectionManifest;
  const inventoryPaths = repeated(argv, '--holdout-inventory');
  if (inventoryPaths.length < 2) throw new Error('At least two holdout inventories are required.');
  const inventories = [];
  for (const value of inventoryPaths) {
    inventories.push(
      await readFingerprintInventory(await resolveWorkspaceInput(workspaceRoot, value)),
    );
  }
  const report = await auditSelectionFingerprints({
    workspaceRoot,
    selection,
    selectionManifestBytes,
    holdoutInventories: inventories,
  });
  const output = await resolveCorpusOutput(workspaceRoot, required(argv, '--output'));
  await writeExclusiveJson(output, report);
  process.stdout.write(
    `${JSON.stringify({ passed: report.passed, reportSha256: report.reportSha256 })}\n`,
  );
  return report.passed ? 0 : 2;
}

async function formalStageCommand(argv: readonly string[]): Promise<number> {
  const workspaceRoot = required(argv, '--workspace-root');
  const selectionPath = await resolveWorkspaceInput(workspaceRoot, required(argv, '--selection'));
  const selectionManifestBytes = await readFile(selectionPath);
  const selection = JSON.parse(
    decodeUtf8(selectionManifestBytes, 'selection'),
  ) as FormalSelectionManifest;
  const audit = await readJson<
    Parameters<typeof createFormal128SelectionStageReceipt>[0]['fingerprintAudit']
  >(workspaceRoot, required(argv, '--audit'));
  const receipt = createFormal128SelectionStageReceipt({
    selection,
    selectionManifestBytes,
    fingerprintAudit: audit,
    requireFinalFingerprints: argv.includes('--require-final-fingerprints'),
  });
  const output = await resolveCorpusOutput(workspaceRoot, required(argv, '--output'));
  await writeExclusiveJson(output, receipt);
  process.stdout.write(
    `${JSON.stringify({ passed: true, receiptSha256: receipt.receiptSha256 })}\n`,
  );
  return 0;
}

async function readJson<T>(workspaceRoot: string, value: string): Promise<T> {
  const input = await resolveWorkspaceInput(workspaceRoot, value);
  return JSON.parse(decodeUtf8(await readFile(input), value)) as T;
}

function required(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing ${flag}.`);
  return value;
}

function optional(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith('--'))) throw new Error(`Missing ${flag}.`);
  return value;
}

function repeated(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === flag) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
      values.push(value);
      index++;
    }
  }
  return values;
}

runV2FreeCorpusCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
