export type V2RLanguage = 'zh' | 'en';
export type EnglishCursorBoundary = 'inside-word' | 'after-word' | 'before-word' | 'between';

const HAN_PATTERN = /\p{Script=Han}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;
const ENGLISH_WORD_PATTERN = /[A-Za-z]+(?:['’-][A-Za-z]+)*/uy;
const ENGLISH_LEADING_SEPARATOR_PATTERN = /^[ \t]*(?:[,.;:!?()[\]{}'"“”‘’—–-][ \t]*)*/u;
const ENGLISH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'with',
]);

export interface PhraseExtractionOptions {
  maxEnglishWords?: number;
  maxEnglishUtf8Bytes?: number;
  minChineseCharacters?: number;
  maxChineseCharacters?: number;
}

export function classifyEnglishCursorBoundary(
  document: string,
  cursorUtf16Offset: number,
): EnglishCursorBoundary {
  assertCursor(document, cursorUtf16Offset);
  const previous = document.slice(0, cursorUtf16Offset).at(-1) ?? '';
  const next = document.slice(cursorUtf16Offset)[0] ?? '';
  const previousIsWord = /[A-Za-z0-9]/u.test(previous);
  const nextIsWord = /[A-Za-z0-9]/u.test(next);
  if (previousIsWord && nextIsWord) return 'inside-word';
  if (previousIsWord) return 'after-word';
  if (nextIsWord) return 'before-word';
  return 'between';
}

export function extractPhraseAtCursor(
  document: string,
  cursorUtf16Offset: number,
  language: V2RLanguage,
  options: PhraseExtractionOptions = {},
): string | null {
  return extractPhraseVariantsAtCursor(document, cursorUtf16Offset, language, options)[0] ?? null;
}

/**
 * Returns nested, complete-boundary continuations from the shortest useful
 * phrase to the longest configured phrase. Keeping the variants in the bank
 * gives Oracle@32 a genuine short-prefix path without teaching partial words.
 */
export function extractPhraseVariantsAtCursor(
  document: string,
  cursorUtf16Offset: number,
  language: V2RLanguage,
  options: PhraseExtractionOptions = {},
): string[] {
  assertCursor(document, cursorUtf16Offset);
  return language === 'en'
    ? extractEnglishPhraseVariants(document, cursorUtf16Offset, options)
    : extractChinesePhraseVariants(document.slice(cursorUtf16Offset), options);
}

export function isMeaningfulPhrase(candidate: string, language: V2RLanguage): boolean {
  if (!candidate || /[\r\n]/u.test(candidate)) return false;
  if (isMixedLanguageCandidate(candidate, language)) return false;
  if (language === 'zh') return countHanCharacters(candidate) >= 3;
  const words = candidate.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu) ?? [];
  return words.length >= 1 && words.join('').replace(/[^A-Za-z]/gu, '').length >= 5;
}

/**
 * Public phrase-bank entries must be useful ghost text, not merely legal text.
 * A single complete English content word is intentionally valid: the release
 * rubric requires one complete word with at least five letters, and excluding
 * that shape made the fixed phrase library incapable of representing ordinary
 * prose. Chinese fragments remain particle-gated while allowing three useful
 * Han characters, matching the frozen quality contract.
 */
export function isTrainablePublicPhrase(candidate: string, language: V2RLanguage): boolean {
  if (!isMeaningfulPhrase(candidate, language)) return false;
  if (language === 'en') {
    const words = candidate.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu) ?? [];
    const informative = words.filter(
      (word) => !ENGLISH_STOP_WORDS.has(word.toLocaleLowerCase('en-US')),
    );
    return informative.join('').replace(/[^A-Za-z]/gu, '').length >= 4;
  }

  const text = candidate.replace(/^[\s\p{P}\p{S}]+/gu, '');
  if (/^[的了着过吗呢吧啊呀兮]/u.test(text)) return false;
  const informativeHan = Array.from(text).filter(
    (character) =>
      /\p{Script=Han}/u.test(character) && !/[的一了是在和与或而及于为把被将]/u.test(character),
  );
  return countHanCharacters(text) >= 3 && informativeHan.length >= 3;
}

export function isMixedLanguageCandidate(candidate: string, language: V2RLanguage): boolean {
  let hasHan = false;
  let hasLatin = false;
  for (const character of candidate.normalize('NFKC')) {
    if (HAN_PATTERN.test(character)) hasHan = true;
    if (LATIN_LETTER_PATTERN.test(character)) hasLatin = true;
  }
  return language === 'zh' ? hasLatin : hasHan;
}

export function countHanCharacters(value: string): number {
  let count = 0;
  for (const character of value) if (HAN_PATTERN.test(character)) count++;
  return count;
}

function extractEnglishPhraseVariants(
  document: string,
  cursorUtf16Offset: number,
  options: PhraseExtractionOptions,
): string[] {
  if (classifyEnglishCursorBoundary(document, cursorUtf16Offset) === 'inside-word') return [];
  const suffix = document.slice(cursorUtf16Offset);
  if (!suffix || /^[\r\n]/u.test(suffix)) return [];
  const maxWords = options.maxEnglishWords ?? 6;
  const maxBytes = options.maxEnglishUtf8Bytes ?? 72;
  if (!Number.isInteger(maxWords) || maxWords < 1)
    throw new Error('maxEnglishWords must be positive.');
  if (!Number.isInteger(maxBytes) || maxBytes < 5)
    throw new Error('maxEnglishUtf8Bytes is too small.');

  const leading = suffix.match(ENGLISH_LEADING_SEPARATOR_PATTERN)?.[0] ?? '';
  let offset = leading.length;
  let wordCount = 0;
  const variants: string[] = [];
  while (wordCount < maxWords && offset < suffix.length) {
    ENGLISH_WORD_PATTERN.lastIndex = offset;
    const match = ENGLISH_WORD_PATTERN.exec(suffix);
    if (!match || match.index !== offset) break;
    wordCount++;
    const end = ENGLISH_WORD_PATTERN.lastIndex;
    const phrase = suffix.slice(0, end);
    if (new TextEncoder().encode(phrase).byteLength > maxBytes) break;
    if (isTrainablePublicPhrase(phrase, 'en')) variants.push(phrase);
    const separator = suffix.slice(end).match(/^[ \t]+/u)?.[0] ?? '';
    if (!separator || /[\r\n]/u.test(separator)) break;
    offset = end + separator.length;
  }
  return variants;
}

function extractChinesePhraseVariants(suffix: string, options: PhraseExtractionOptions): string[] {
  const min = options.minChineseCharacters ?? 3;
  const max = options.maxChineseCharacters ?? 12;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    throw new Error('Chinese phrase character limits are invalid.');
  }

  let phrase = '';
  let han = 0;
  const variants: string[] = [];
  const seen = new Set<string>();
  for (const character of suffix) {
    if (character === '\r' || character === '\n') break;
    if (LATIN_LETTER_PATTERN.test(character)) break;
    phrase += character;
    if (HAN_PATTERN.test(character)) han++;
    const normalized = phrase.replace(/^[ \t]+/u, '').replace(/[ \t]+$/u, '');
    if (
      han >= min &&
      han <= max &&
      !seen.has(normalized) &&
      isTrainablePublicPhrase(normalized, 'zh')
    ) {
      seen.add(normalized);
      variants.push(normalized);
    }
    if (han >= min && /[。！？；]/u.test(character)) break;
    if (han >= max) break;
  }
  return variants;
}

function assertCursor(document: string, cursorUtf16Offset: number): void {
  if (
    !Number.isInteger(cursorUtf16Offset) ||
    cursorUtf16Offset < 0 ||
    cursorUtf16Offset > document.length
  ) {
    throw new Error('cursorUtf16Offset is outside the document.');
  }
}
