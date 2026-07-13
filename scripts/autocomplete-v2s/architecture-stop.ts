import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalJson, resolveInside } from './common';
import {
  finalizeArchitectureStop,
  validateArchitectureStop,
  V2S_ARCHITECTURE_STOP_PATH,
  type V2SArchitectureStop,
} from './metrics';

export function readV2SArchitectureStop(workspaceRoot: string): V2SArchitectureStop | null {
  const stopPath = resolveInside(
    workspaceRoot,
    V2S_ARCHITECTURE_STOP_PATH,
    'V2S architecture stop',
  );
  if (!existsSync(stopPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(stopPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `V2S architecture stop record is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateArchitectureStop(parsed as V2SArchitectureStop);
  return parsed as V2SArchitectureStop;
}

export function assertV2SArchitectureActive(workspaceRoot: string): void {
  const stop = readV2SArchitectureStop(workspaceRoot);
  if (!stop) return;
  throw new Error(
    `V2S architecture ${stop.architectureId} is stopped (${stop.reasonCode}); training, Gate repacking and publication are disabled.`,
  );
}

export function writeV2SArchitectureStop(
  workspaceRoot: string,
  value: Omit<V2SArchitectureStop, 'recordSha256'>,
): V2SArchitectureStop {
  const stopPath = resolveInside(
    workspaceRoot,
    V2S_ARCHITECTURE_STOP_PATH,
    'V2S architecture stop',
  );
  const finalized = finalizeArchitectureStop(value);
  writeFileSync(stopPath, `${canonicalJson(finalized)}\n`, { encoding: 'utf8', flag: 'wx' });
  return finalized;
}
