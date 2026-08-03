import type { FileChangeEvent } from '@/types';

export interface ActiveFileChangeSummary {
  /** The active path was the source of a delete or rename with no replacement in this batch. */
  removed: boolean;
  /** At least one event says the active path was deleted or renamed away. */
  destructive: boolean;
  /** New content arrived at the active path through create, modify, or rename. */
  changed: boolean;
}

function normalizeChangePath(path: string | undefined): string {
  const normalized = (path ?? '').replace(/\\/g, '/');
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

/**
 * Summarize watcher events by rename direction.
 *
 * Atomic saves commonly arrive as `temporary -> active`, sometimes together with a delete for
 * the replaced inode. That means the final active path still exists and must be treated as a
 * content change, not as the active file moving away.
 */
export function summarizeActiveFileChanges(
  events: readonly FileChangeEvent[],
  activePath: string,
): ActiveFileChangeSummary {
  const active = normalizeChangePath(activePath);
  if (!active) return { removed: false, destructive: false, changed: false };

  let destructiveEvent = false;
  let arrivalEvent = false;

  for (const event of events) {
    const path = normalizeChangePath(event.path);
    const oldPath = normalizeChangePath(event.oldPath);

    if (event.type === 'deleted' && path === active) destructiveEvent = true;

    if (event.type === 'renamed') {
      if (oldPath === active && path !== active) destructiveEvent = true;
      if (path === active) arrivalEvent = true;
      continue;
    }

    if ((event.type === 'created' || event.type === 'modified') && path === active) {
      arrivalEvent = true;
    }
  }

  return {
    removed: destructiveEvent && !arrivalEvent,
    destructive: destructiveEvent,
    changed: arrivalEvent,
  };
}
