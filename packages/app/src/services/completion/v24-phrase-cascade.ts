import { containsSensitiveCompletionText, type CompletionSessionKind } from './learning-admission';
import { resolveCompletionCandidates } from './resolver';
import type {
  CompletionCandidate,
  CompletionContext,
  CompletionMode,
  CompletionProvider,
} from './types';

const MAX_ACCEPTED_PHRASES_PER_SCOPE = 200;
const MIN_RETAINED_COUNT = 2;

export interface V24PhraseRecord {
  contextSuffix: string;
  phrase: string;
  language: 'zh' | 'en';
  retainedCount: number;
  lastRetainedAt: number;
}

export interface V24DocumentPhraseOccurrence {
  paragraphId: string;
  context: string;
  phrase: string;
  language: 'zh' | 'en';
}

interface V24DocumentPhraseRecord extends V24PhraseRecord {
  paragraphIds: Set<string>;
}

export interface V24CascadeStage {
  id: string;
  provide(context: CompletionContext): readonly CompletionCandidate[];
  shortCircuit?: (candidate: CompletionCandidate, context: CompletionContext) => boolean;
}

export interface V24CascadeResult {
  candidate: CompletionCandidate | null;
  stageId: string | null;
  consultedStages: readonly string[];
  shortCircuited: boolean;
}

export class V24RetainedPhraseStore {
  private readonly memory = new Map<string, V24PhraseRecord[]>();

  /**
   * Exact retained phrases are session data only. Workspace persistence is
   * owned by MarkdownPredictor's Personal-v5 n-gram contract so neither note
   * context nor accepted phrases are copied into a second storage record.
   */
  constructor(_legacyPersistFlag = false) {}

  recordRetained(args: {
    scope: string;
    context: string;
    phrase: string;
    language: 'zh' | 'en';
    sessionKind: CompletionSessionKind;
    blockType: CompletionContext['blockType'];
    mode: CompletionMode;
  }): boolean {
    if (
      args.mode === 'structured' ||
      args.blockType === 'code' ||
      args.blockType === 'frontmatter' ||
      !isAdmissiblePhrase(args.phrase, args.language) ||
      containsSensitiveCompletionText(`${args.context}\n${args.phrase}`)
    ) {
      return false;
    }
    const scope = normalizeScope(args.scope);
    const records = this.getRecords(scope);
    const contextSuffix = takeLastCodePoints(args.context, 32);
    const phrase = normalizePhrase(args.phrase, args.language);
    const existing = records.find(
      (record) =>
        record.contextSuffix === contextSuffix &&
        record.phrase === phrase &&
        record.language === args.language,
    );
    if (existing) {
      existing.retainedCount += 1;
      existing.lastRetainedAt = Date.now();
    } else {
      records.unshift({
        contextSuffix,
        phrase,
        language: args.language,
        retainedCount: 1,
        lastRetainedAt: Date.now(),
      });
    }
    records.sort((left, right) => right.lastRetainedAt - left.lastRetainedAt);
    records.splice(MAX_ACCEPTED_PHRASES_PER_SCOPE);
    this.memory.set(scope, records);
    return true;
  }

  match(scope: string, beforeCursor: string, language: 'zh' | 'en'): readonly V24PhraseRecord[] {
    return this.getRecords(normalizeScope(scope)).filter(
      (record) =>
        record.language === language &&
        record.retainedCount >= MIN_RETAINED_COUNT &&
        beforeCursor.endsWith(record.contextSuffix),
    );
  }

  clear(scope?: string): void {
    if (scope) this.memory.delete(normalizeScope(scope));
    else this.memory.clear();
  }

  size(scope: string): number {
    return this.getRecords(normalizeScope(scope)).length;
  }

  snapshot(scope: string): readonly V24PhraseRecord[] {
    return this.getRecords(normalizeScope(scope)).map((record) => ({ ...record }));
  }

  exactRecord(
    scope: string,
    context: string,
    phrase: string,
    language: 'zh' | 'en',
  ): V24PhraseRecord | null {
    const contextSuffix = takeLastCodePoints(context, 32);
    const normalizedPhrase = normalizePhrase(phrase, language);
    const record = this.getRecords(normalizeScope(scope)).find(
      (item) =>
        item.contextSuffix === contextSuffix &&
        item.phrase === normalizedPhrase &&
        item.language === language,
    );
    return record ? { ...record } : null;
  }

  replace(scope: string, records: readonly V24PhraseRecord[]): void {
    const normalizedScope = normalizeScope(scope);
    const normalizedRecords = records
      .filter(
        (record) =>
          (record.language === 'zh' || record.language === 'en') &&
          Number.isSafeInteger(record.retainedCount) &&
          record.retainedCount > 0 &&
          isAdmissiblePhrase(record.phrase, record.language),
      )
      .map((record) => ({
        contextSuffix: takeLastCodePoints(record.contextSuffix, 32),
        phrase: normalizePhrase(record.phrase, record.language),
        language: record.language,
        retainedCount: record.retainedCount,
        lastRetainedAt: Number.isFinite(record.lastRetainedAt) ? record.lastRetainedAt : 0,
      }))
      .sort((left, right) => right.lastRetainedAt - left.lastRetainedAt)
      .slice(0, MAX_ACCEPTED_PHRASES_PER_SCOPE);
    this.memory.set(normalizedScope, normalizedRecords);
  }

  private getRecords(scope: string): V24PhraseRecord[] {
    const current = this.memory.get(scope);
    if (current) return current;
    const records: V24PhraseRecord[] = [];
    this.memory.set(scope, records);
    return records;
  }
}

export class V24SessionPhraseStore extends V24RetainedPhraseStore {
  constructor() {
    super(false);
  }
}

/**
 * Incremental current-document phrase evidence. Callers replace one paragraph
 * at a time; matching never rescans the complete document on the hot path.
 */
export class V24DocumentPhraseStore {
  private readonly documents = new Map<string, Map<string, V24DocumentPhraseRecord>>();
  private readonly paragraphKeys = new Map<string, Map<string, Set<string>>>();
  private readonly revisions = new Map<string, number>();
  private readonly exactParagraphs = new Map<string, Map<string, ExactSubstringIndex>>();

  updateParagraph(args: {
    documentSessionId: string;
    documentRevision: number;
    paragraphId: string;
    occurrences: readonly Omit<V24DocumentPhraseOccurrence, 'paragraphId'>[];
  }): void {
    const documentId = normalizeScope(args.documentSessionId);
    const previousRevision = this.revisions.get(documentId) ?? -1;
    if (args.documentRevision < previousRevision) return;
    this.revisions.set(documentId, args.documentRevision);
    const records = this.documents.get(documentId) ?? new Map();
    const previousKeys = this.paragraphKeys.get(documentId) ?? new Map();
    for (const key of previousKeys.get(args.paragraphId) ?? []) {
      const record = records.get(key);
      if (!record) continue;
      record.paragraphIds.delete(args.paragraphId);
      if (record.paragraphIds.size === 0) records.delete(key);
    }
    previousKeys.delete(args.paragraphId);

    for (const occurrence of args.occurrences) {
      if (
        !isAdmissiblePhrase(occurrence.phrase, occurrence.language) ||
        containsSensitiveCompletionText(`${occurrence.context}\n${occurrence.phrase}`)
      ) {
        continue;
      }
      const phrase = normalizePhrase(occurrence.phrase, occurrence.language);
      const contextSuffix = takeLastCodePoints(occurrence.context, 32);
      const key = phraseRecordKey(contextSuffix, phrase, occurrence.language);
      const record = records.get(key) ?? {
        contextSuffix,
        phrase,
        language: occurrence.language,
        retainedCount: 1,
        lastRetainedAt: Date.now(),
        paragraphIds: new Set<string>(),
      };
      record.paragraphIds.add(args.paragraphId);
      records.set(key, record);
      const keys = previousKeys.get(args.paragraphId) ?? new Set<string>();
      keys.add(key);
      previousKeys.set(args.paragraphId, keys);
    }
    this.documents.set(documentId, records);
    this.paragraphKeys.set(documentId, previousKeys);
  }

  match(
    documentSessionId: string,
    beforeCursor: string,
    language: 'zh' | 'en',
  ): readonly V24PhraseRecord[] {
    const records = this.documents.get(normalizeScope(documentSessionId));
    if (!records) return [];
    return [...records.values()]
      .filter(
        (record) =>
          record.language === language &&
          record.paragraphIds.size >= 2 &&
          beforeCursor.endsWith(record.contextSuffix),
      )
      .sort((left, right) => right.paragraphIds.size - left.paragraphIds.size)
      .map(({ paragraphIds, ...record }) => ({
        ...record,
        retainedCount: paragraphIds.size,
      }));
  }

  updateParagraphText(args: {
    documentSessionId: string;
    paragraphId: string;
    text: string;
  }): void {
    const documentId = normalizeScope(args.documentSessionId);
    const paragraphs = this.exactParagraphs.get(documentId) ?? new Map();
    paragraphs.set(args.paragraphId, new ExactSubstringIndex(args.text));
    this.exactParagraphs.set(documentId, paragraphs);
  }

  removeParagraph(documentSessionId: string, paragraphId: string): void {
    const documentId = normalizeScope(documentSessionId);
    const paragraphs = this.exactParagraphs.get(documentId);
    if (!paragraphs) return;
    paragraphs.delete(paragraphId);
    if (paragraphs.size === 0) this.exactParagraphs.delete(documentId);
  }

  exactSupport(
    documentSessionId: string,
    beforeCursor: string,
    phrase: string,
    contextLength: number,
  ): number {
    const contextSuffix = takeLastCodePoints(beforeCursor, contextLength);
    if (Array.from(contextSuffix).length !== contextLength || !phrase) return 0;
    const needle = `${contextSuffix}${phrase}`;
    const paragraphs = this.exactParagraphs.get(normalizeScope(documentSessionId));
    if (!paragraphs) return 0;
    let support = 0;
    for (const index of paragraphs.values()) {
      if (index.has(needle)) support += 1;
    }
    return support;
  }

  clear(documentSessionId?: string): void {
    if (documentSessionId) {
      const key = normalizeScope(documentSessionId);
      this.documents.delete(key);
      this.paragraphKeys.delete(key);
      this.revisions.delete(key);
      this.exactParagraphs.delete(key);
      return;
    }
    this.documents.clear();
    this.paragraphKeys.clear();
    this.revisions.clear();
    this.exactParagraphs.clear();
  }
}

export class V24PhraseProvider implements CompletionProvider {
  readonly id: string;
  readonly priority = 90;

  constructor(
    private readonly store: V24RetainedPhraseStore,
    private readonly getScope: () => string,
    id: string,
    private readonly sourceLayer: CompletionCandidate['sourceLayer'] = 'session',
  ) {
    this.id = id;
  }

  canProvide(context: CompletionContext): boolean {
    return (
      context.syntax.type === 'general' &&
      context.atEndOfLine &&
      !context.emptyLine &&
      (context.blockType === 'paragraph' ||
        context.blockType === 'list' ||
        context.blockType === 'quote') &&
      (context.languageHint === 'zh' || context.languageHint === 'en')
    );
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    if (!this.canProvide(context)) return null;
    const language = context.languageHint as 'zh' | 'en';
    const beforeCursor = context.doc.slice(0, context.localCursorPos);
    const record = this.store.match(this.getScope(), beforeCursor, language)[0];
    if (!record) return null;
    return {
      text: record.phrase,
      displayText: record.phrase,
      edit: { from: context.cursorPos, to: context.cursorPos, insertText: record.phrase },
      mode: 'predictive',
      kind: 'phrase',
      confidence: 0.92,
      from: context.cursorPos,
      providerId: this.id,
      source: 'recent',
      sourceLayer: this.sourceLayer,
      syntaxType: 'v24-retained-phrase',
      learnable: true,
      priority: this.priority,
      priorityTier: 'document-session',
      rawScore: 0.92,
      calibratedScore: 0.92,
      feedbackPolicy: 'retained',
      support: record.retainedCount,
    };
  }
}

export class V24DocumentPhraseProvider implements CompletionProvider {
  readonly priority = 84;

  constructor(
    private readonly store: V24DocumentPhraseStore,
    private readonly getDocumentSessionId: () => string,
    id = 'document-phrase',
  ) {
    this.id = id;
  }

  readonly id: string;

  canProvide(context: CompletionContext): boolean {
    return (
      context.syntax.type === 'general' &&
      context.atEndOfLine &&
      !context.emptyLine &&
      (context.blockType === 'paragraph' ||
        context.blockType === 'list' ||
        context.blockType === 'quote') &&
      (context.languageHint === 'zh' || context.languageHint === 'en')
    );
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    if (!this.canProvide(context)) return null;
    const language = context.languageHint as 'zh' | 'en';
    const beforeCursor = context.doc.slice(0, context.localCursorPos);
    const record = this.store.match(this.getDocumentSessionId(), beforeCursor, language)[0];
    if (!record) return null;
    return {
      text: record.phrase,
      displayText: record.phrase,
      edit: { from: context.cursorPos, to: context.cursorPos, insertText: record.phrase },
      mode: 'predictive',
      kind: 'phrase',
      confidence: 0.9,
      from: context.cursorPos,
      providerId: this.id,
      source: 'recent',
      sourceLayer: 'session',
      syntaxType: 'v24-document-phrase',
      learnable: false,
      priority: this.priority,
      priorityTier: 'document-session',
      rawScore: 0.9,
      calibratedScore: 0.9,
      feedbackPolicy: 'none',
      documentParagraphSupport: record.retainedCount,
    };
  }
}

export class V24LocalCascade {
  constructor(private readonly stages: readonly V24CascadeStage[]) {}

  resolve(context: CompletionContext): V24CascadeResult {
    const consultedStages: string[] = [];
    const accumulated: CompletionCandidate[] = [];
    const firstStageByEdit = new Map<string, string>();
    let candidate: CompletionCandidate | null = null;
    let candidateStageId: string | null = null;
    for (const stage of this.stages) {
      consultedStages.push(stage.id);
      const rawCandidates = stage
        .provide(context)
        .filter((item) => isValidCascadeCandidate(item, context));
      for (const item of rawCandidates) {
        const key = cascadeCandidateKey(item);
        if (!firstStageByEdit.has(key)) firstStageByEdit.set(key, stage.id);
      }
      accumulated.push(...rawCandidates);
      const resolution = resolveCompletionCandidates(context, accumulated);
      candidate = resolution.candidate;
      if (!candidate) continue;
      candidateStageId = firstStageByEdit.get(cascadeCandidateKey(candidate)) ?? null;
      const shortCircuitCandidate = stage.shortCircuit
        ? resolveCompletionCandidates(context, rawCandidates).rankedCandidates.find((item) =>
            stage.shortCircuit!(item, context),
          )
        : undefined;
      if (shortCircuitCandidate) {
        const mergedCandidate =
          resolution.rankedCandidates.find(
            (item) => cascadeCandidateKey(item) === cascadeCandidateKey(shortCircuitCandidate),
          ) ?? shortCircuitCandidate;
        return {
          candidate: mergedCandidate,
          stageId: stage.id,
          consultedStages,
          shortCircuited: true,
        };
      }
    }
    return {
      candidate,
      stageId: candidateStageId,
      consultedStages,
      shortCircuited: false,
    };
  }
}

class ExactSubstringIndex {
  private readonly states: Array<{
    length: number;
    link: number;
    transitions: Map<string, number>;
  }> = [{ length: 0, link: -1, transitions: new Map() }];

  constructor(text: string) {
    let last = 0;
    for (const point of Array.from(text)) last = this.extend(last, point);
  }

  has(value: string): boolean {
    let state = 0;
    for (const point of Array.from(value)) {
      const next = this.states[state]?.transitions.get(point);
      if (next === undefined) return false;
      state = next;
    }
    return value.length > 0;
  }

  private extend(last: number, point: string): number {
    const current = this.states.length;
    this.states.push({
      length: (this.states[last]?.length ?? 0) + 1,
      link: 0,
      transitions: new Map(),
    });
    let cursor = last;
    while (cursor >= 0 && !this.states[cursor]!.transitions.has(point)) {
      this.states[cursor]!.transitions.set(point, current);
      cursor = this.states[cursor]!.link;
    }
    if (cursor < 0) return current;
    const target = this.states[cursor]!.transitions.get(point)!;
    if (this.states[cursor]!.length + 1 === this.states[target]!.length) {
      this.states[current]!.link = target;
      return current;
    }
    const clone = this.states.length;
    this.states.push({
      length: this.states[cursor]!.length + 1,
      link: this.states[target]!.link,
      transitions: new Map(this.states[target]!.transitions),
    });
    while (cursor >= 0 && this.states[cursor]!.transitions.get(point) === target) {
      this.states[cursor]!.transitions.set(point, clone);
      cursor = this.states[cursor]!.link;
    }
    this.states[target]!.link = clone;
    this.states[current]!.link = clone;
    return current;
  }
}

function cascadeCandidateKey(candidate: CompletionCandidate): string {
  const edit = candidate.edit ?? {
    from: candidate.from,
    to: candidate.from,
    insertText: candidate.text,
  };
  return `${edit.from}\u001f${edit.to}\u001f${edit.insertText}`;
}

export function stageFromProvider(provider: CompletionProvider): V24CascadeStage {
  return {
    id: provider.id,
    provide: (context) => {
      if (!provider.canProvide(context)) return [];
      return provider.provideMany?.(context) ?? [provider.provide(context)].filter(isCandidate);
    },
  };
}

function isValidCascadeCandidate(
  candidate: CompletionCandidate,
  context: CompletionContext,
): boolean {
  const edit = candidate.edit ?? {
    from: candidate.from,
    to: candidate.from,
    insertText: candidate.text,
  };
  return (
    edit.from >= 0 &&
    edit.to >= edit.from &&
    edit.to <= context.documentFrom + context.doc.length &&
    edit.insertText.length > 0 &&
    !/[\r\n\0]/u.test(edit.insertText)
  );
}

function isCandidate(value: CompletionCandidate | null): value is CompletionCandidate {
  return value !== null;
}

function phraseRecordKey(contextSuffix: string, phrase: string, language: 'zh' | 'en'): string {
  return `${language}\u001f${contextSuffix}\u001f${phrase}`;
}

function isAdmissiblePhrase(phrase: string, language: 'zh' | 'en'): boolean {
  if (language === 'zh') return takeLastCodePoints(phrase, 6).length >= 6;
  return (phrase.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/gu) ?? []).length >= 3;
}

function normalizePhrase(value: string, language: 'zh' | 'en'): string {
  const normalized = value.normalize('NFC').replace(/[\r\n\0]/gu, '');
  const content = normalized.trim();
  return language === 'en' && normalized.startsWith(' ') ? ` ${content}` : content;
}

function normalizeScope(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, '-') || 'unscoped'
  );
}

function takeLastCodePoints(value: string, count: number): string {
  return Array.from(value).slice(-count).join('');
}
