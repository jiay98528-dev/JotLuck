import type { CompletionBlockType, CompletionLearningAdmission, CompletionMode } from './types';

export type CompletionSessionKind = 'workspace' | 'temporary' | 'external';

export interface CompletionLearningAdmissionDecision {
  admission: CompletionLearningAdmission;
  reason:
    | 'workspace-prose'
    | 'memory-only-session'
    | 'structured'
    | 'code'
    | 'frontmatter'
    | 'sensitive-content';
}

export function decideCompletionLearningAdmission(args: {
  sessionKind: CompletionSessionKind;
  blockType: CompletionBlockType;
  mode: CompletionMode;
  contextText: string;
  insertedText: string;
}): CompletionLearningAdmissionDecision {
  if (args.mode === 'structured') return { admission: 'skip', reason: 'structured' };
  if (args.blockType === 'code') return { admission: 'skip', reason: 'code' };
  if (args.blockType === 'frontmatter') return { admission: 'skip', reason: 'frontmatter' };
  if (containsSensitiveCompletionText(`${args.contextText}\n${args.insertedText}`)) {
    return { admission: 'skip', reason: 'sensitive-content' };
  }
  if (args.sessionKind !== 'workspace') {
    return { admission: 'memoryOnly', reason: 'memory-only-session' };
  }
  return { admission: 'persist', reason: 'workspace-prose' };
}

export function containsSensitiveCompletionText(text: string): boolean {
  const normalized = text.normalize('NFKC');
  return (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(normalized) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(normalized) ||
    /\b(?:sk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/iu.test(normalized) ||
    /\b(?:password|passwd|pwd|secret|client_secret|access_token|refresh_token|api[_-]?key|private[_-]?key)\b\s*[:=]\s*\S{4,}/iu.test(
      normalized,
    ) ||
    /(?:密码|口令|密钥|令牌)\s*[:：=]\s*\S{4,}/u.test(normalized)
  );
}
