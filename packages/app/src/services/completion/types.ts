import type { CompletionSettings } from '../CompletionSettings';

export type CompletionSourceKind = 'structured' | 'ngram' | 'recent' | 'neural';
export type CompletionLanguageHint = 'zh' | 'en' | 'mixed' | 'unknown';
export type CompletionMode = 'structured' | 'predictive';
export type CompletionFeedbackPolicy = 'none' | 'session' | 'retained';
export type CompletionLearningAdmission = 'persist' | 'memoryOnly' | 'skip';
export type CompletionPriorityTier =
  | 'structured'
  | 'document-session'
  | 'personal-workspace'
  | 'public'
  | 'fallback';
export type CompletionCandidateKind =
  | 'format'
  | 'wiki-link'
  | 'tag'
  | 'file-path'
  | 'list'
  | 'sequence'
  | 'phrase'
  | 'word'
  | 'text';
export type CompletionSourceLayer =
  | 'l1'
  | 'session'
  | 'l2'
  | 'notebook'
  | 'l3'
  | 'short-l1'
  | 'short-l2'
  | 'short-notebook'
  | 'short-l3'
  | 'provider'
  | 'fallback';
export type CompletionAblationMode =
  | 'full-stack'
  | 'provider-only'
  | 'l1-only'
  | 'l2-only'
  | 'l3-only';
export type CompletionBlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'quote'
  | 'table'
  | 'code'
  | 'frontmatter';

export type SyntaxType =
  | 'wiki-link'
  | 'tag'
  | 'file-path'
  | 'markdown-format'
  | 'markdown-structure'
  | 'general';

export interface SyntaxContext {
  type: SyntaxType;
  prefix: string;
  openMarker?: string;
}

export interface CompletionLine {
  text: string;
  from: number;
  to: number;
  cursorColumn: number;
  beforeCursor: string;
}

export interface CompletionTextEdit {
  /** UTF-16 document offset, inclusive. */
  from: number;
  /** UTF-16 document offset, exclusive. */
  to: number;
  insertText: string;
}

export interface CompletionContributor {
  providerId: string;
  sourceLayer?: CompletionSourceLayer;
  rawScore: number;
  calibratedScore: number;
}

export interface BoundedTextSlice {
  from: number;
  to: number;
  text: string;
  truncatedBefore: boolean;
  truncatedAfter: boolean;
}

export interface CompletionDocumentContextSnapshot {
  documentRevision: number;
  cursor: number;
  nodePath: readonly string[];
  blockType: CompletionBlockType;
  headingTrail: readonly string[];
  line: CompletionLine | null;
  currentParagraph: BoundedTextSlice;
  previousParagraph: BoundedTextSlice | null;
  documentWindow: BoundedTextSlice;
  syntax: SyntaxContext;
  languageHint: CompletionLanguageHint;
  disabled: boolean;
  emptyLine: boolean;
  atEndOfLine: boolean;
  compositionStable: boolean;
}

export interface PredictorIndexData {
  getAllNoteTitles(): string[];
  getAllTags(): string[];
  getRecentNoteTitles?(): string[];
  matchFilePaths(prefix: string): string[];
}

export interface CompletionContext {
  /** Bounded document window. Legacy callers use a full document with documentFrom=0. */
  doc: string;
  documentFrom: number;
  documentRevision: number;
  cursorPos: number;
  localCursorPos: number;
  line: CompletionLine | null;
  syntax: SyntaxContext;
  settings: CompletionSettings;
  indexData: PredictorIndexData | null;
  n: number;
  disabled: boolean;
  emptyLine: boolean;
  atEndOfLine: boolean;
  languageHint: CompletionLanguageHint;
  blockType: CompletionBlockType;
  paragraphBeforeCursor: string;
  paragraphStart: number;
  sentencePrefix: string;
  recentTokens: string[];
  contextSnapshot?: CompletionDocumentContextSnapshot;
}

export interface CompletionCandidate {
  /** Compatibility alias for displayText/edit.insertText during the V2.2 migration. */
  text: string;
  confidence: number;
  informationScore?: number;
  learningBoost?: number;
  learningPenalty?: number;
  from: number;
  providerId: string;
  source: CompletionSourceKind;
  sourceLayer?: CompletionSourceLayer;
  syntaxType: string;
  learnable: boolean;
  priority: number;
  /** Authoritative body mutation. */
  edit?: CompletionTextEdit;
  /** Ghost-only representation; never use this value as an editor mutation. */
  displayText?: string;
  mode?: CompletionMode;
  kind?: CompletionCandidateKind;
  contributors?: readonly CompletionContributor[];
  priorityTier?: CompletionPriorityTier;
  rawScore?: number;
  calibratedScore?: number;
  feedbackPolicy?: CompletionFeedbackPolicy;
}

export type CompletionProviderDataAccess =
  | 'context'
  | 'index'
  | 'document'
  | 'session'
  | 'personal'
  | 'notebook'
  | 'public';

export interface CompletionProviderDescriptor {
  id: string;
  modes: readonly CompletionMode[];
  contextCapabilities: readonly CompletionBlockType[];
  priorityTier: CompletionPriorityTier;
  maxCandidates: number;
  softBudgetMs: number;
  feedbackCapability: CompletionFeedbackPolicy;
  dataAccess: readonly CompletionProviderDataAccess[];
  genericFallback?: boolean;
}

export interface CompletionProvider {
  id: string;
  priority: number;
  canProvide(context: CompletionContext): boolean;
  provide(context: CompletionContext): CompletionCandidate | null;
  provideMany?(context: CompletionContext): CompletionCandidate[];
}
