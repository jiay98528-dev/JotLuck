import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndValidateWorkspaceFinalV2 } from './workspace-final-holdout';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { audit } = loadAndValidateWorkspaceFinalV2(repositoryRoot);
process.stdout.write(`${audit.datasetSha256}\n`);
