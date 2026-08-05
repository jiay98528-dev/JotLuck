import type { PublicEngineContextCapsule } from './public-engine-types';
import type { CompletionContext, CompletionLanguageHint } from './types';

export const PUBLIC_FREE_CONTEXT_CAPSULE_SCHEMA_VERSION = 1;
export const PUBLIC_FREE_CONTEXT_MAX_TOKENS = 256;
export const PUBLIC_FREE_CONTEXT_CAPSULE_MAX_UTF8_BYTES = 16 * 1024;

const MAX_HEADING_COUNT = 6;
const MAX_HEADING_CODE_POINTS = 128;
const MAX_CURRENT_PARAGRAPH_CODE_POINTS = 2_048;
const MAX_PREVIOUS_PARAGRAPH_CODE_POINTS = 768;
const MAX_RETRIEVAL_CODE_POINTS = 768;

export function createPublicFreeContextCapsule(
  context: CompletionContext,
  retrievalSnippet?: string,
): PublicEngineContextCapsule {
  const snapshot = context.contextSnapshot;
  const capsule: PublicEngineContextCapsule = {
    schemaVersion: PUBLIC_FREE_CONTEXT_CAPSULE_SCHEMA_VERSION,
    maxTokens: PUBLIC_FREE_CONTEXT_MAX_TOKENS,
    languageHint: context.languageHint,
    headingTrail: (snapshot?.headingTrail ?? [])
      .slice(-MAX_HEADING_COUNT)
      .map((heading) => normalizeSegment(heading, MAX_HEADING_CODE_POINTS))
      .filter(Boolean),
    currentParagraph: normalizeSegment(
      snapshot?.currentParagraph.text ?? context.paragraphBeforeCursor,
      MAX_CURRENT_PARAGRAPH_CODE_POINTS,
      true,
    ),
    previousParagraphTail: normalizeSegment(
      snapshot?.previousParagraph?.text ?? '',
      MAX_PREVIOUS_PARAGRAPH_CODE_POINTS,
      true,
    ),
    retrievalSnippet: normalizeSegment(retrievalSnippet ?? '', MAX_RETRIEVAL_CODE_POINTS, true),
  };
  return fitCapsuleToByteLimit(capsule);
}

/** Stable text representation shared by the TypeScript and Rust worker tests. */
export function serializePublicFreeContextCapsule(capsule: PublicEngineContextCapsule): string {
  const sections: string[] = [];
  for (const heading of capsule.headingTrail) sections.push(`<heading>${heading}</heading>`);
  if (capsule.previousParagraphTail) {
    sections.push(`<previous>${capsule.previousParagraphTail}</previous>`);
  }
  if (capsule.retrievalSnippet) {
    sections.push(`<retrieval>${capsule.retrievalSnippet}</retrieval>`);
  }
  sections.push(`<current>${capsule.currentParagraph}</current>`);
  return sections.join('\n');
}

export function isPublicEngineContextCapsule(value: unknown): value is PublicEngineContextCapsule {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === PUBLIC_FREE_CONTEXT_CAPSULE_SCHEMA_VERSION &&
    value.maxTokens === PUBLIC_FREE_CONTEXT_MAX_TOKENS &&
    isLanguageHint(value.languageHint) &&
    Array.isArray(value.headingTrail) &&
    value.headingTrail.length <= MAX_HEADING_COUNT &&
    value.headingTrail.every((item) => typeof item === 'string') &&
    typeof value.currentParagraph === 'string' &&
    typeof value.previousParagraphTail === 'string' &&
    typeof value.retrievalSnippet === 'string' &&
    utf8ByteLength(
      serializePublicFreeContextCapsule(value as unknown as PublicEngineContextCapsule),
    ) <= PUBLIC_FREE_CONTEXT_CAPSULE_MAX_UTF8_BYTES
  );
}

function fitCapsuleToByteLimit(capsule: PublicEngineContextCapsule): PublicEngineContextCapsule {
  let fitted = capsule;
  while (
    utf8ByteLength(serializePublicFreeContextCapsule(fitted)) >
    PUBLIC_FREE_CONTEXT_CAPSULE_MAX_UTF8_BYTES
  ) {
    if (fitted.retrievalSnippet) {
      fitted = { ...fitted, retrievalSnippet: halveTail(fitted.retrievalSnippet) };
      continue;
    }
    if (fitted.previousParagraphTail) {
      fitted = { ...fitted, previousParagraphTail: halveTail(fitted.previousParagraphTail) };
      continue;
    }
    if (fitted.headingTrail.length > 0) {
      fitted = { ...fitted, headingTrail: fitted.headingTrail.slice(1) };
      continue;
    }
    fitted = { ...fitted, currentParagraph: halveTail(fitted.currentParagraph) };
    if (!fitted.currentParagraph) break;
  }
  return fitted;
}

function normalizeSegment(value: string, maximumCodePoints: number, keepTail = false): string {
  const normalized = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  const points = [...normalized];
  if (points.length <= maximumCodePoints) return normalized;
  return (keepTail ? points.slice(-maximumCodePoints) : points.slice(0, maximumCodePoints)).join(
    '',
  );
}

function halveTail(value: string): string {
  const points = [...value];
  return points.slice(-Math.floor(points.length / 2)).join('');
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isLanguageHint(value: unknown): value is CompletionLanguageHint {
  return value === 'zh' || value === 'en' || value === 'mixed' || value === 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
