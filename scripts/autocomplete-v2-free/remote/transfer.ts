import { createHash } from 'node:crypto';

import { isSafeRelativePath } from './contract';

export interface AtomicUploadPlan {
  transferId: string;
  finalRelativePath: string;
  temporaryRelativePath: string;
  bytes: number;
  sha256: string;
}

export function createAtomicUploadPlan(input: {
  transferId: string;
  finalRelativePath: string;
  bytes: number;
  sha256: string;
}): AtomicUploadPlan {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(input.transferId)) {
    throw new Error('Invalid transfer ID.');
  }
  if (!isSafeRelativePath(input.finalRelativePath)) {
    throw new Error('Final upload path must be a safe relative path.');
  }
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 1) {
    throw new Error('Upload size must be a positive safe integer.');
  }
  if (!/^[a-f0-9]{64}$/u.test(input.sha256)) {
    throw new Error('Upload SHA-256 must be lowercase hexadecimal.');
  }
  const slash = input.finalRelativePath.lastIndexOf('/');
  const parent = slash === -1 ? '' : input.finalRelativePath.slice(0, slash + 1);
  const name = slash === -1 ? input.finalRelativePath : input.finalRelativePath.slice(slash + 1);
  return {
    transferId: input.transferId,
    finalRelativePath: input.finalRelativePath,
    temporaryRelativePath: `${parent}.${name}.upload-${input.transferId}.tmp`,
    bytes: input.bytes,
    sha256: input.sha256,
  };
}

export function verifyUploadedBytes(bytes: Uint8Array, plan: AtomicUploadPlan): void {
  if (bytes.byteLength !== plan.bytes) {
    throw new Error(
      `Upload byte count mismatch: expected ${plan.bytes}, received ${bytes.byteLength}.`,
    );
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== plan.sha256) {
    throw new Error(`Upload SHA-256 mismatch: expected ${plan.sha256}, received ${actualSha256}.`);
  }
}
