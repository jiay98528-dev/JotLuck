import type { CompletionCandidate, CompletionContext, CompletionProvider } from './types';
import { detectFencedLanguage } from './v24-routing';

export const CODE_SYNTAX_LANGUAGES = Object.freeze([
  'typescript',
  'javascript',
  'python',
  'rust',
  'powershell',
  'pwsh',
  'json',
  'yaml',
  'yml',
] as const);

export type CodeSyntaxLanguage = (typeof CODE_SYNTAX_LANGUAGES)[number];

export interface CodeSyntaxSnapshot {
  language: CodeSyntaxLanguage;
  prefix: string;
  suffix: string;
  linePrefix: string;
  lineSuffix: string;
  indentation: string;
  delimiterStack: readonly string[];
}

const PREFIX_LIMIT = 8 * 1024;
const SUFFIX_LIMIT = 2 * 1024;

export class CodeSyntaxProvider implements CompletionProvider {
  readonly id = 'code-syntax';
  readonly priority = 110;

  canProvide(context: CompletionContext): boolean {
    return this.createSnapshot(context) !== null;
  }

  provide(context: CompletionContext): CompletionCandidate | null {
    const snapshot = this.createSnapshot(context);
    if (!snapshot) return null;
    const text = deterministicSyntaxEdit(snapshot);
    if (!text) return null;
    return {
      text,
      displayText: text,
      edit: { from: context.cursorPos, to: context.cursorPos, insertText: text },
      mode: 'structured',
      kind: 'code-syntax',
      confidence: 0.99,
      from: context.cursorPos,
      providerId: this.id,
      source: 'structured',
      sourceLayer: 'provider',
      syntaxType: 'code-syntax',
      learnable: false,
      priority: this.priority,
      priorityTier: 'structured',
      rawScore: 1,
      calibratedScore: 0.99,
      feedbackPolicy: 'none',
    };
  }

  private createSnapshot(context: CompletionContext): CodeSyntaxSnapshot | null {
    if (context.blockType !== 'code' || context.disabled === false) return null;
    const language = normalizeLanguage(
      detectFencedLanguage(context.doc, context.localCursorPos) ?? '',
    );
    if (!language) return null;
    const prefix = context.doc.slice(
      Math.max(0, context.localCursorPos - PREFIX_LIMIT),
      context.localCursorPos,
    );
    const suffix = context.doc.slice(
      context.localCursorPos,
      Math.min(context.doc.length, context.localCursorPos + SUFFIX_LIMIT),
    );
    const lineStart = prefix.lastIndexOf('\n') + 1;
    const lineEnd = suffix.indexOf('\n');
    const lineSuffix = lineEnd < 0 ? suffix : suffix.slice(0, lineEnd);
    const linePrefix = prefix.slice(lineStart);
    const indentation = linePrefix.match(/^\s*/u)?.[0] ?? '';
    return {
      language,
      prefix,
      suffix,
      linePrefix,
      lineSuffix,
      indentation,
      delimiterStack: scanDelimiters(prefix, language),
    };
  }
}

function deterministicSyntaxEdit(snapshot: CodeSyntaxSnapshot): string | null {
  const { language, linePrefix, lineSuffix, prefix } = snapshot;
  const trimmed = linePrefix.trimStart();
  const rustPathBoundary =
    language === 'rust' &&
    /^[A-Za-z_][\w]*$/u.test(linePrefix) &&
    /^[A-Za-z_][\w]*/u.test(lineSuffix);
  if (rustPathBoundary) return '::';

  // Every other deterministic rule describes an insertion at the user's
  // current line end. Rust's identifier::identifier seam is the sole bounded
  // exception because its proof necessarily consumes the suffix identifier.
  if (lineSuffix.length > 0) return null;
  if (isJson(language) && /^(?:[,{]\s*)?"(?:[^"\\]|\\.)+"\s*$/u.test(linePrefix.trim())) {
    return ': ';
  }
  if (isYaml(language) && /^[A-Za-z_][\w.-]*\s*$/u.test(trimmed)) return ': ';
  if (language === 'python' && isPythonControlHeader(trimmed)) return ':';

  const topDelimiter = snapshot.delimiterStack.at(-1);
  if (topDelimiter && !lineSuffix.trimStart().startsWith(matchingDelimiter(topDelimiter))) {
    return matchingDelimiter(topDelimiter);
  }

  if (linePrefix === snapshot.indentation) {
    const previousLine = prefix.split('\n').at(-2)?.replace(/\r$/u, '') ?? '';
    if (/[{:]\s*$/u.test(previousLine)) {
      return '    ';
    }
  }
  return null;
}

function scanDelimiters(prefix: string, language: CodeSyntaxLanguage): string[] {
  const stack: string[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (const character of prefix) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (language === 'python' && character === '#') continue;
    if ('([{'.includes(character)) stack.push(character);
    else if (')]}'.includes(character)) {
      let index = -1;
      for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
        if (matchingDelimiter(stack[cursor] ?? '') === character) {
          index = cursor;
          break;
        }
      }
      if (index >= 0) stack.splice(index, 1);
    }
  }
  if (quote) stack.push(quote);
  return stack;
}

function matchingDelimiter(value: string): string {
  switch (value) {
    case '(':
      return ')';
    case '[':
      return ']';
    case '{':
      return '}';
    case '"':
      return '"';
    case "'":
      return "'";
    default:
      return '';
  }
}

function isPythonControlHeader(line: string): boolean {
  return /^(?:if|elif|else|for|while|def|class|with|try|except|finally|match|case)\b.*[^:]\s*$/u.test(
    line,
  );
}

function normalizeLanguage(language: string): CodeSyntaxLanguage | null {
  const normalized = language.toLocaleLowerCase('en-US') as CodeSyntaxLanguage;
  return CODE_SYNTAX_LANGUAGES.includes(normalized) ? normalized : null;
}

function isJson(language: CodeSyntaxLanguage): boolean {
  return language === 'json';
}

function isYaml(language: CodeSyntaxLanguage): boolean {
  return language === 'yaml' || language === 'yml';
}

export function isSupportedCodeLanguage(language: string): language is CodeSyntaxLanguage {
  return CODE_SYNTAX_LANGUAGES.includes(language as CodeSyntaxLanguage);
}
