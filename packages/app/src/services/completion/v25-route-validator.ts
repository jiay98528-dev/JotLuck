export const V25_ROUTE_VALIDATOR_ID = 'jotluck-v2.5-route-validator-v5';
export const V25_ROUTE_VALIDATOR_VERSION = 5;

export interface V25DisplayValidationInput {
  route: 'writing' | 'code';
  text: string;
  language: string;
  prefix: string;
  suffix?: string;
  blockType?: 'paragraph' | 'list' | 'quote' | 'code';
  confidence?: number;
  taskType?: 'fim';
  fimKind?: 'member-call' | 'call-argument' | 'expression';
  codeLanguage?: 'typescript' | 'javascript' | 'rust' | 'json';
}

export interface V25DisplayValidationDecision {
  id: typeof V25_ROUTE_VALIDATOR_ID;
  version: typeof V25_ROUTE_VALIDATOR_VERSION;
  allowed: boolean;
  reasons: string[];
}

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
const HAN_GLOBAL = /[\u3400-\u4dbf\u4e00-\u9fff]/gu;
const LATIN = /\p{Script=Latin}/u;
const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';
const ZH_DANGLING = new Set(Array.from('的和与及在为将并而但或把被向从由以了'));

export function validateV25DisplayCandidate(
  input: V25DisplayValidationInput,
): V25DisplayValidationDecision {
  const reasons = input.route === 'writing' ? validateWriting(input) : validateCode(input);
  if (
    typeof input.confidence !== 'number' ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    reasons.push('visibility-score-invalid');
  }
  const unique = [...new Set(reasons)].sort();
  return {
    id: V25_ROUTE_VALIDATOR_ID,
    version: V25_ROUTE_VALIDATOR_VERSION,
    allowed: unique.length === 0,
    reasons: unique,
  };
}

function validateWriting(input: V25DisplayValidationInput): string[] {
  const reasons: string[] = [];
  const { text, prefix, language } = input;
  const stripped = text.trim();
  const hasHan = HAN.test(text);
  const hasLatin = LATIN.test(text);
  if (/[\r\n]/u.test(text)) reasons.push('writing-cross-line');
  if (hasHan && hasLatin) reasons.push('writing-mixed-language');
  else if ((language === 'en' && !hasLatin) || (language !== 'en' && !hasHan)) {
    reasons.push('writing-language-mismatch');
  }
  if (hasWritingLoop(text, language)) reasons.push('writing-loop');
  if (language === 'en') {
    if (/\p{L}|\p{N}/u.test(Array.from(prefix).at(-1) ?? '') && /^[\p{L}\p{N}]/u.test(text)) {
      reasons.push('writing-missing-word-boundary');
    }
    if (/\s$/u.test(prefix) && text.startsWith(' ')) reasons.push('writing-double-boundary-space');
    if (/[.!?;:]$/u.test(prefix) && /^\p{L}/u.test(text)) {
      reasons.push('writing-missing-sentence-space');
    }
    const words = stripped.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];
    if (words.length === 0) reasons.push('writing-too-short');
    if (words.length > 5 || Array.from(text).length > 24) reasons.push('writing-too-long');
  } else {
    if (text.startsWith(' ')) reasons.push('writing-unexpected-leading-space');
    // v5: a single Han character is a legal lexical unit (我/就/也…); the
    // dangling-connector set below still rejects particle-only suggestions.
    if ((stripped.match(HAN_GLOBAL) ?? []).length < 1) reasons.push('writing-too-short');
    if (Array.from(text).length > 16) reasons.push('writing-too-long');
    const last = Array.from(stripped).at(-1);
    if (last && ZH_DANGLING.has(last)) reasons.push('writing-dangling-connector');
  }
  const marker = stripped.at(0);
  if (marker === '-' || marker === '>') {
    const line = prefix.split('\n').at(-1) ?? '';
    const nestedQuoteList =
      input.blockType === 'quote' && /^\s*>\s*$/u.test(line) && marker === '-';
    if (!nestedQuoteList && !(input.blockType === 'list' && line.trim() === '')) {
      reasons.push('writing-cross-block-marker');
    }
  }
  return reasons;
}

function validateCode(input: V25DisplayValidationInput): string[] {
  const reasons: string[] = [];
  const stripped = input.text.trim();
  const fimFeature = codeFimFeature(input);
  if (/[\r\n]/u.test(input.text)) reasons.push('code-cross-line');
  if (/```|~~~/u.test(input.text)) reasons.push('code-fence-in-candidate');
  if (/^[^A-Za-z0-9_\u3400-\u9fff]+$/u.test(stripped) && !fimFeature) {
    reasons.push('code-low-information-punctuation');
  }
  if (/^(?:class|function|struct|var|let|const)\b/u.test(stripped)) {
    reasons.push('code-incomplete-declaration');
  }
  if (!fimFeature && (stripped.match(/[A-Za-z0-9_\u3400-\u9fff]/gu) ?? []).length < 2) {
    reasons.push('code-insufficient-information');
  }
  if (!fimFeature) reasons.push('code-no-validated-structural-join');
  return reasons;
}

function codeFimFeature(input: V25DisplayValidationInput): boolean {
  if (
    input.taskType !== 'fim' ||
    !input.fimKind ||
    !input.codeLanguage ||
    input.codeLanguage === 'json'
  ) {
    return false;
  }
  const { text, prefix, suffix = '' } = input;
  if (!text || text.trim() !== text || Array.from(text).length > 48 || /[\r\n]/u.test(text)) {
    return false;
  }
  if (input.fimKind === 'member-call') {
    return (
      new RegExp(`${IDENTIFIER}\\.$`, 'u').test(prefix) &&
      /^\s*\(/u.test(suffix) &&
      new RegExp(`^${IDENTIFIER}$`, 'u').test(text)
    );
  }
  if (input.fimKind === 'call-argument') {
    return (
      /(?:\(|,)\s*$/u.test(prefix) &&
      /^\s*(?:,|\))/u.test(suffix) &&
      isCodeAtom(text, input.codeLanguage)
    );
  }
  return (
    /(?:=|=>|\breturn)\s*$/u.test(prefix) &&
    (input.codeLanguage !== 'rust' || !/=>\s*$/u.test(prefix)) &&
    /^\s*[,;)}\]]/u.test(suffix) &&
    isCodeAtom(text, input.codeLanguage)
  );
}

function isCodeAtom(text: string, language: 'typescript' | 'javascript' | 'rust'): boolean {
  if (/^[-+]?\d+(?:\.\d+)?$/u.test(text) || /^(?:true|false)$/u.test(text)) return true;
  if (text === 'null') return language !== 'rust';
  if (text === 'None') return language === 'rust';
  if (/^"[^"\r\n]{1,48}"$/u.test(text)) return true;
  if (/^'[^'\r\n]{1,48}'$/u.test(text)) {
    return language !== 'rust' || Array.from(text.slice(1, -1)).length === 1;
  }
  const pointer = /^(?:[&*]\s*)/u.test(text);
  if (pointer && language !== 'rust') return false;
  const value = pointer ? text.replace(/^[&*]\s*/u, '') : text;
  return new RegExp(`^${IDENTIFIER}(?:\\.${IDENTIFIER})*(?:\\([^()\\r\\n]{0,48}\\))?$`, 'u').test(
    value,
  );
}

function hasWritingLoop(text: string, language: string): boolean {
  const normalized = text.trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
  if (language === 'en') {
    const words = normalized.match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];
    return words.some((word, index) => word === words[index + 1] && word === words[index + 2]);
  }
  const han = (normalized.match(HAN_GLOBAL) ?? []).join('');
  for (let width = 1; width <= Math.min(8, Math.floor(han.length / 3)); width += 1) {
    for (let start = 0; start + width * 3 <= han.length; start += 1) {
      const unit = han.slice(start, start + width);
      if (han.slice(start, start + width * 3) === unit.repeat(3)) return true;
    }
  }
  return false;
}
