import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DIRECTORY_RENAME_RETRY_DELAYS_MS,
  publishV2SCandidateDirectory,
  type AtomicDirectoryOperations,
} from '../autocomplete-v2s/atomic-directory';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('V2S candidate atomic directory publication', () => {
  it('retries transient Windows directory locks with the fixed backoff schedule', async () => {
    const root = await createRoot();
    const temporary = await createDirectory(root, 'candidate.tmp');
    const finalDirectory = path.join(root, 'candidate');
    const delays: number[] = [];
    let attempts = 0;
    const operations = withOperations({
      rename: async (from, to) => {
        attempts += 1;
        if (attempts < 3) throw nodeError('EPERM');
        await renameDirectory(from, to);
      },
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    await publishV2SCandidateDirectory(temporary, finalDirectory, operations);

    expect(attempts).toBe(3);
    expect(delays).toEqual(DIRECTORY_RENAME_RETRY_DELAYS_MS.slice(0, 2));
    await expect(readFile(path.join(finalDirectory, 'marker.txt'), 'utf8')).resolves.toBe('ready');
  });

  it('refuses to replace an existing candidate and removes its temporary directory', async () => {
    const root = await createRoot();
    const temporary = await createDirectory(root, 'candidate.tmp');
    const finalDirectory = await createDirectory(root, 'candidate');
    let renamed = false;

    await expect(
      publishV2SCandidateDirectory(
        temporary,
        finalDirectory,
        withOperations({
          rename: async () => {
            renamed = true;
          },
        }),
      ),
    ).rejects.toThrow(/already exists/u);

    expect(renamed).toBe(false);
    await expect(readFile(path.join(finalDirectory, 'marker.txt'), 'utf8')).resolves.toBe('ready');
    await expect(readFile(path.join(temporary, 'marker.txt'), 'utf8')).rejects.toThrow();
  });

  it('cleans the temporary directory after bounded retry exhaustion', async () => {
    const root = await createRoot();
    const temporary = await createDirectory(root, 'candidate.tmp');
    const finalDirectory = path.join(root, 'candidate');
    const delays: number[] = [];
    let attempts = 0;

    await expect(
      publishV2SCandidateDirectory(
        temporary,
        finalDirectory,
        withOperations({
          rename: async () => {
            attempts += 1;
            throw nodeError('EBUSY');
          },
          sleep: async (delayMs) => {
            delays.push(delayMs);
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'EBUSY' });

    expect(attempts).toBe(DIRECTORY_RENAME_RETRY_DELAYS_MS.length + 1);
    expect(delays).toEqual(DIRECTORY_RENAME_RETRY_DELAYS_MS);
    await expect(readFile(path.join(temporary, 'marker.txt'), 'utf8')).rejects.toThrow();
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'jotluck-v2s-atomic-'));
  roots.push(root);
  return root;
}

async function createDirectory(root: string, name: string): Promise<string> {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'marker.txt'), 'ready', 'utf8');
  return directory;
}

function withOperations(overrides: Partial<AtomicDirectoryOperations>): AtomicDirectoryOperations {
  return {
    exists: async (target) => {
      try {
        await readFile(path.join(target, 'marker.txt'));
        return true;
      } catch {
        return false;
      }
    },
    rename: renameDirectory,
    remove: async (target) => rm(target, { recursive: true, force: true }),
    sleep: async () => undefined,
    ...overrides,
  };
}

async function renameDirectory(from: string, to: string): Promise<void> {
  const { rename } = await import('node:fs/promises');
  await rename(from, to);
}

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`synthetic ${code}`), { code });
}
