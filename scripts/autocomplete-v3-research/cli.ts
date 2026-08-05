#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { V3_RESEARCH_MATRIX, assessV3PaidValue, type V3ResearchReport } from './contract';

export async function runV3ResearchCli(argv: readonly string[]): Promise<number> {
  if (!argv[0] || argv[0] === '--help') {
    process.stdout.write('Usage: autocomplete-v3-research <matrix|assess> [report.json]\n');
    return 0;
  }
  if (argv[0] === 'matrix') {
    process.stdout.write(`${JSON.stringify(V3_RESEARCH_MATRIX, null, 2)}\n`);
    return 0;
  }
  if (argv[0] === 'assess') {
    if (!argv[1]) throw new Error('A V3 research report path is required.');
    const report = JSON.parse(await readFile(argv[1], 'utf8')) as V3ResearchReport;
    const assessment = assessV3PaidValue(report);
    process.stdout.write(`${JSON.stringify(assessment)}\n`);
    return assessment.passed ? 0 : 2;
  }
  throw new Error(`Unknown autocomplete-v3-research command: ${argv[0]}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runV3ResearchCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
