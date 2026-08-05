import type { RemoteCheckpointRecord } from './contract';

export interface CheckpointRetention {
  keep: RemoteCheckpointRecord[];
  discard: RemoteCheckpointRecord[];
  reasons: Record<string, readonly ('latest' | 'best')[]>;
}

export function selectLastTwoAndBest(
  checkpoints: readonly RemoteCheckpointRecord[],
  scoreDirection: 'higher-is-better' | 'lower-is-better' = 'higher-is-better',
): CheckpointRetention {
  const byPath = new Map<string, RemoteCheckpointRecord>();
  for (const checkpoint of checkpoints) {
    if (byPath.has(checkpoint.relativePath)) {
      throw new Error(`Duplicate checkpoint path: ${checkpoint.relativePath}`);
    }
    byPath.set(checkpoint.relativePath, checkpoint);
  }
  const ordered = [...checkpoints].sort(
    (left, right) => right.step - left.step || right.createdAt.localeCompare(left.createdAt),
  );
  const reasons = new Map<string, Set<'latest' | 'best'>>();
  for (const checkpoint of ordered.slice(0, 2))
    addReason(reasons, checkpoint.relativePath, 'latest');
  const best = [...checkpoints].sort((left, right) => {
    const scoreOrder =
      scoreDirection === 'higher-is-better' ? right.score - left.score : left.score - right.score;
    return (
      scoreOrder || right.step - left.step || left.relativePath.localeCompare(right.relativePath)
    );
  })[0];
  if (best) addReason(reasons, best.relativePath, 'best');
  const keep = ordered.filter((checkpoint) => reasons.has(checkpoint.relativePath));
  const discard = ordered.filter((checkpoint) => !reasons.has(checkpoint.relativePath));
  return {
    keep,
    discard,
    reasons: Object.fromEntries([...reasons].map(([path, values]) => [path, [...values].sort()])),
  };
}

function addReason(
  reasons: Map<string, Set<'latest' | 'best'>>,
  path: string,
  reason: 'latest' | 'best',
): void {
  const current = reasons.get(path) ?? new Set<'latest' | 'best'>();
  current.add(reason);
  reasons.set(path, current);
}
