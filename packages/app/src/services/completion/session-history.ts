import type { CompletionCandidate, CompletionContext, CompletionProvider } from './types';

const MAX_SESSION_HISTORY_PER_WORKSPACE = 100;

interface SessionHistoryEntry {
  contextTail: string;
  insertText: string;
  retainedAt: number;
}

export class CompletionSessionHistory {
  private readonly entriesByScope = new Map<string, SessionHistoryEntry[]>();

  record(scope: string, context: string, insertText: string): void {
    const contextTail = takeLastCodePoints(context, 24);
    const normalizedInsert = insertText.replace(/[\r\n\0]/gu, '');
    if (contextTail.length < 2 || !normalizedInsert.trim()) return;
    const entries = this.entriesByScope.get(scope) ?? [];
    const duplicateIndex = entries.findIndex(
      (entry) => entry.contextTail === contextTail && entry.insertText === normalizedInsert,
    );
    if (duplicateIndex >= 0) entries.splice(duplicateIndex, 1);
    entries.unshift({ contextTail, insertText: normalizedInsert, retainedAt: Date.now() });
    if (entries.length > MAX_SESSION_HISTORY_PER_WORKSPACE) {
      entries.splice(MAX_SESSION_HISTORY_PER_WORKSPACE);
    }
    this.entriesByScope.set(scope, entries);
  }

  match(scope: string, beforeCursor: string, limit = 5): readonly SessionHistoryEntry[] {
    const entries = this.entriesByScope.get(scope) ?? [];
    return entries
      .filter((entry) => {
        const suffix = takeLastCodePoints(
          entry.contextTail,
          Math.min(12, entry.contextTail.length),
        );
        return suffix.length >= 2 && beforeCursor.endsWith(suffix);
      })
      .slice(0, Math.max(0, limit));
  }

  clear(scope?: string): void {
    if (scope) this.entriesByScope.delete(scope);
    else this.entriesByScope.clear();
  }

  size(scope: string): number {
    return this.entriesByScope.get(scope)?.length ?? 0;
  }
}

export class SessionHistoryProvider implements CompletionProvider {
  readonly id = 'session-history';
  readonly priority = 76;

  constructor(
    private readonly history: CompletionSessionHistory,
    private readonly getScope: () => string,
  ) {}

  canProvide(context: CompletionContext): boolean {
    return (
      context.syntax.type === 'general' &&
      context.atEndOfLine &&
      !context.emptyLine &&
      context.languageHint !== 'mixed' &&
      (context.blockType === 'paragraph' ||
        context.blockType === 'list' ||
        context.blockType === 'quote')
    );
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    return this.provideMany(context)[0] ?? null;
  }

  provideMany(context: CompletionContext): CompletionCandidate[] {
    const beforeCursor = context.doc.slice(0, context.localCursorPos);
    return this.history.match(this.getScope(), beforeCursor).map((entry, index) => ({
      text: entry.insertText,
      confidence: Math.max(0.66, 0.82 - index * 0.03),
      from: context.cursorPos,
      providerId: this.id,
      source: 'recent',
      sourceLayer: 'session',
      syntaxType: 'session-history',
      learnable: true,
      priority: this.priority,
    }));
  }
}

function takeLastCodePoints(text: string, count: number): string {
  return Array.from(text).slice(-count).join('');
}
