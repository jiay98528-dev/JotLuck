import { expect, it } from 'vitest';
import { parseDocument, extractWikiLinkOccurrences } from '@jotluck/renderer';
import { relocateBacklink } from '../document-location';
import type { BacklinkEntry } from '@/types';

it('relocates a shifted reference only when its surrounding context is unique', () => {
  const old = extractWikiLinkOccurrences(parseDocument('first [[Note]] after'))[0]!;
  const entry: BacklinkEntry = {
    notePath: '/source.md',
    noteTitle: 'Source',
    context: '',
    lineNumber: 1,
    location: { ...old, revision: 1 },
  };
  const updated = extractWikiLinkOccurrences(
    parseDocument('A new paragraph\n\nfirst [[Note]] after'),
  );
  expect(relocateBacklink(entry, updated)?.from).toBe(updated[0]!.from);
  const edited = extractWikiLinkOccurrences(parseDocument('changed prefix [[Note]] after'));
  expect(relocateBacklink(entry, edited)?.from).toBe(edited[0]!.from);
  const ambiguous = extractWikiLinkOccurrences(
    parseDocument('first [[Note]] after\n\nfirst [[Note]] after'),
  );
  expect(relocateBacklink(entry, ambiguous)).toBeNull();
  expect(relocateBacklink(entry, [])).toBeNull();
});
