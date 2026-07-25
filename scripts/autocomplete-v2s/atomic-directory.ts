import { lstat, rename, rm } from 'node:fs/promises';

export const DIRECTORY_RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

export interface AtomicDirectoryOperations {
  rename: (from: string, to: string) => Promise<void>;
  exists: (target: string) => Promise<boolean>;
  remove: (target: string) => Promise<void>;
  sleep: (delayMs: number) => Promise<void>;
}

const defaultOperations: AtomicDirectoryOperations = {
  rename,
  exists: async (target) => {
    try {
      await lstat(target);
      return true;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false;
      throw error;
    }
  },
  remove: async (target) => rm(target, { recursive: true, force: true }),
  sleep: async (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};

/**
 * Publishes a fully-written candidate directory without replacing an existing candidate.
 * Windows virus scanners can briefly lock a just-written directory, so only those transient
 * lock errors receive a bounded retry. Every failed path removes the caller-owned temporary
 * directory before the error is returned.
 */
export async function publishAtomicDirectory(
  temporaryDirectory: string,
  finalDirectory: string,
  operations: AtomicDirectoryOperations = defaultOperations,
): Promise<void> {
  try {
    for (let attempt = 0; ; attempt += 1) {
      if (await operations.exists(finalDirectory)) {
        throw new Error(`V2S candidate output already exists: ${finalDirectory}`);
      }
      try {
        await operations.rename(temporaryDirectory, finalDirectory);
        return;
      } catch (error) {
        if (!isRetryableRenameError(error) || attempt >= DIRECTORY_RENAME_RETRY_DELAYS_MS.length) {
          throw error;
        }
        await operations.sleep(DIRECTORY_RENAME_RETRY_DELAYS_MS[attempt]);
      }
    }
  } catch (error) {
    await operations.remove(temporaryDirectory);
    throw error;
  }
}

export const publishV2SCandidateDirectory = publishAtomicDirectory;

function isRetryableRenameError(error: unknown): boolean {
  return isNodeError(error, 'EPERM') || isNodeError(error, 'EACCES') || isNodeError(error, 'EBUSY');
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
