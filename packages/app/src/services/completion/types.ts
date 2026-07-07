import type { CompletionSettings } from '../CompletionSettings';

export type CompletionSourceKind = 'structured' | 'ngram' | 'recent' | 'llm';
export type CompletionLanguageHint = 'zh' | 'en' | 'mixed' | 'unknown';
export type CompletionSourceLayer =
  | 'l1'
  | 'l2'
  | 'l3'
  | 'short-l1'
  | 'short-l2'
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

export interface PredictorIndexData {
  getAllNoteTitles(): string[];
  getAllTags(): string[];
  getRecentNoteTitles?(): string[];
  matchFilePaths(prefix: string): string[];
}

export interface CompletionContext {
  doc: string;
  cursorPos: number;
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
}

export interface CompletionCandidate {
  text: string;
  confidence: number;
  informationScore?: number;
  from: number;
  providerId: string;
  source: CompletionSourceKind;
  sourceLayer?: CompletionSourceLayer;
  syntaxType: string;
  learnable: boolean;
  priority: number;
}

export interface CompletionProvider {
  id: string;
  priority: number;
  canProvide(context: CompletionContext): boolean;
  provide(context: CompletionContext): CompletionCandidate | null;
  provideMany?(context: CompletionContext): CompletionCandidate[];
}
