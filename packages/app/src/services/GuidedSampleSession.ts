import type { DirEntry, SupportedLocale } from '@/types';
import { getCurrentLocale } from '@/i18n';
import { stripSupportedNoteExtension } from '@/utils/note-files';
import { createSampleNotebookSeed } from './SampleSeed';

export interface GuidedSampleNote {
  path: string;
  title: string;
  content: string;
  originalContent: string;
}

export interface GuidedSampleSession {
  notebookName: string;
  notes: GuidedSampleNote[];
}

export type EmptyWorkspaceFallback = 'guided-sample' | 'web-default' | 'gate';

function normalizeNotePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized || normalized === '/') return '/';
  return normalized.startsWith('/') ? normalized.replace(/\/+$/, '') : `/${normalized}`;
}

export function decideEmptyWorkspaceFallback(input: {
  isDesktop: boolean;
  forceGate: boolean;
  recentCount: number;
}): EmptyWorkspaceFallback {
  if (input.forceGate || input.recentCount > 0) return 'gate';
  return input.isDesktop ? 'guided-sample' : 'web-default';
}

export function createGuidedSampleSession(
  locale: SupportedLocale = getCurrentLocale(),
): GuidedSampleSession {
  const seed = createSampleNotebookSeed(locale);
  return {
    notebookName: seed.directoryName,
    notes: seed.files.map((file) => {
      const path = normalizeNotePath(file.path);
      const title = stripSupportedNoteExtension(path.split('/').pop() ?? path);
      return {
        path,
        title,
        content: file.content,
        originalContent: file.content,
      };
    }),
  };
}

export function findGuidedSampleNote(
  session: GuidedSampleSession,
  path: string,
): GuidedSampleNote | undefined {
  const normalized = normalizeNotePath(path);
  return session.notes.find((note) => note.path === normalized);
}

export function findGuidedSampleNoteByTitle(
  session: GuidedSampleSession,
  title: string,
): GuidedSampleNote | undefined {
  const target = title.trim();
  if (!target) return undefined;
  return (
    session.notes.find((note) => note.title === target) ??
    session.notes.find(
      (note) => stripSupportedNoteExtension(note.path.split('/').pop() ?? '') === target,
    )
  );
}

export function isGuidedSampleDirty(note: GuidedSampleNote): boolean {
  return note.content !== note.originalContent;
}

export function applyGuidedSampleEdit(
  session: GuidedSampleSession,
  path: string,
  content: string,
): GuidedSampleSession {
  const normalized = normalizeNotePath(path);
  const index = session.notes.findIndex((note) => note.path === normalized);
  if (index < 0) return session;
  const current = session.notes[index];
  if (!current || current.content === content) return session;
  const notes = session.notes.slice();
  notes[index] = { ...current, content };
  return { ...session, notes };
}

export function guidedSampleWikiLinkExists(session: GuidedSampleSession, title: string): boolean {
  return Boolean(findGuidedSampleNoteByTitle(session, title));
}

export function guidedNotesAsDirEntries(session: GuidedSampleSession): DirEntry[] {
  return session.notes.map((note) => ({
    name: note.path.split('/').pop() ?? note.title,
    path: note.path,
    isDirectory: false,
    isFile: true,
    size: new TextEncoder().encode(note.content).length,
    mtime: 0,
  }));
}

export function nextAvailableNotePath(
  existingPaths: readonly string[],
  desiredPath: string,
): string {
  const normalized = normalizeNotePath(desiredPath);
  const taken = new Set(existingPaths.map((path) => normalizeNotePath(path)));
  if (!taken.has(normalized)) return normalized;

  const slash = normalized.lastIndexOf('/');
  const directory = slash >= 0 ? normalized.slice(0, slash) : '';
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${directory}/${stem}-${index}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${directory}/${stem}-${Date.now()}${extension}`;
}
