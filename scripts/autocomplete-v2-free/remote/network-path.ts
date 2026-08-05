export const ONE_GIBIBYTE = 1024 * 1024 * 1024;

export interface OneGiBTransferTrial {
  path: 'direct' | 'peer-relay';
  bytes: typeof ONE_GIBIBYTE;
  durationMs: number;
}

export interface TailscalePathAssessment {
  decision: 'use-direct' | 'test-peer-relay' | 'use-peer-relay' | 'recommend-wireguard';
  directMbps: number;
  peerRelayMbps?: number;
  reasons: string[];
}

export function assessTailscalePath(
  direct: OneGiBTransferTrial,
  peerRelay?: OneGiBTransferTrial,
): TailscalePathAssessment {
  validateTrial(direct, 'direct');
  const directMbps = throughputMbps(direct);
  if (directMbps >= 20) {
    return { decision: 'use-direct', directMbps, reasons: ['direct-at-least-20mbps'] };
  }
  if (!peerRelay) {
    return { decision: 'test-peer-relay', directMbps, reasons: ['direct-below-20mbps'] };
  }
  validateTrial(peerRelay, 'peer-relay');
  const peerRelayMbps = throughputMbps(peerRelay);
  if (peerRelayMbps >= 10) {
    return {
      decision: 'use-peer-relay',
      directMbps,
      peerRelayMbps,
      reasons: ['direct-below-20mbps', 'peer-relay-at-least-10mbps'],
    };
  }
  return {
    decision: 'recommend-wireguard',
    directMbps,
    peerRelayMbps,
    reasons: ['direct-below-20mbps', 'peer-relay-below-10mbps'],
  };
}

export function throughputMbps(trial: OneGiBTransferTrial): number {
  if (!Number.isFinite(trial.durationMs) || trial.durationMs <= 0) {
    throw new Error('Transfer duration must be a positive finite number.');
  }
  return (trial.bytes * 8) / (trial.durationMs / 1_000) / 1_000_000;
}

function validateTrial(
  trial: OneGiBTransferTrial,
  expectedPath: OneGiBTransferTrial['path'],
): void {
  if (trial.path !== expectedPath || trial.bytes !== ONE_GIBIBYTE) {
    throw new Error(`Expected an exact 1 GiB ${expectedPath} transfer trial.`);
  }
  throughputMbps(trial);
}
