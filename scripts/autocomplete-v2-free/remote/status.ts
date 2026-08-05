import type { RemoteTrainingStatus, TrainingResult } from './contract';

const STATUS_TRANSITIONS: Readonly<Record<RemoteTrainingStatus, readonly RemoteTrainingStatus[]>> =
  {
    queued: ['running', 'failed'],
    running: ['checkpointed', 'completed', 'failed'],
    checkpointed: ['running', 'checkpointed', 'completed', 'failed'],
    completed: [],
    failed: [],
  };

export function canTransitionRemoteTrainingStatus(
  from: RemoteTrainingStatus,
  to: RemoteTrainingStatus,
): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function isHeartbeatStale(
  result: Pick<TrainingResult, 'heartbeatAt'>,
  nowMs: number,
  maximumAgeMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0) {
    throw new Error('Heartbeat time and maximum age must be finite, with a positive maximum age.');
  }
  const heartbeatMs = Date.parse(result.heartbeatAt);
  if (!Number.isFinite(heartbeatMs)) throw new Error('Heartbeat must be an ISO timestamp.');
  return nowMs - heartbeatMs > maximumAgeMs;
}
