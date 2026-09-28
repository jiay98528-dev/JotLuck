import type { ChangeDesc, Text } from '@codemirror/state';
import type { DocumentAnalysis } from '@/services/document-analysis';
import type { BacklinkEntry } from '@/types';
import type { WikiLinkOccurrence } from '@jotluck/renderer';

export interface DocumentLocation {
  analysis: DocumentAnalysis;
  revision: number;
  position: number;
  reason: 'cursor' | 'scroll';
  line?: number;
  column?: number;
  changes?: ChangeDesc;
  doc?: Text;
}

/** A changed document requires unique contextual confirmation, never the first same-name word. */
export function relocateBacklink(
  entry: BacklinkEntry,
  occurrences: WikiLinkOccurrence[],
): WikiLinkOccurrence | null {
  const location = entry.location;
  if (!location) {
    const onLine = occurrences.filter((item) => item.lineNumber === entry.lineNumber);
    return onLine.length === 1 ? onLine[0]! : null;
  }
  const matches = occurrences.filter(
    (item) =>
      item.target === location.target &&
      item.raw === location.raw &&
      item.before === location.before &&
      item.after === location.after,
  );
  if (matches.length) return matches.length === 1 ? matches[0]! : null;
  const adjacent = occurrences.filter(
    (item) =>
      item.target === location.target &&
      item.raw === location.raw &&
      ((location.before.length > 0 && item.before === location.before) ||
        (location.after.length > 0 && item.after === location.after)),
  );
  return adjacent.length === 1 ? adjacent[0]! : null;
}
