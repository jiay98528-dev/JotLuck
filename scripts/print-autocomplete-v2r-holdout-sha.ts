import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateV2RHoldoutV3, type V2RHoldoutV3 } from './autocomplete-v2r/index';
import { resolveWorkspaceInput } from './workspace-paths';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv.find((argument) => argument.startsWith('--holdout='));
if (!input) throw new Error('--holdout is required.');
const holdoutPath = resolveWorkspaceInput(rootDir, input.slice('--holdout='.length));
const holdout = JSON.parse(fs.readFileSync(holdoutPath, 'utf8')) as V2RHoldoutV3;
process.stdout.write(validateV2RHoldoutV3(holdout).datasetSha256);
